/*
 * Render trees.
 *
 * renderPage turns a page into RNodes: what the canvas draws and the Layers panel
 * lists. A layout wraps its page, a component call becomes an instance whose
 * children are the component's own output, and a `.map` produces one RNode per
 * item, flagged as repeated because they share one piece of source.
 *
 * Every RNode keeps the EditorNode it came from, and text keeps where its string
 * came from, so the editor can turn a click on the canvas into an edit of the
 * right file.
 */

import * as t from '@babel/types';
import type { EditorNode } from './model';
import { isComponentTag, layerName } from './model';
import { BudgetError, Evaluator, type Program } from './evaluate';
import {
  Closure,
  isRecord,
  JSXValue,
  Lit,
  Native,
  prim,
  Rendered,
  Scope,
  toText,
  truthy,
  Unknown,
  UNKNOWN,
  type TextSource,
  type Value,
} from './values';
import type { KnownComponent } from './known';
import { joinClasses } from './tailwind';

export interface RNode {
  /** Unique path through the render, stable across edits. Used for selection and the DOM. */
  key: string;
  kind: 'element' | 'text' | 'instance' | 'placeholder' | 'icon';
  /** HTML tag, or the component name for instances. */
  tag: string;
  name: string;
  /** DOM props, already made safe for the canvas. */
  props: Record<string, unknown>;
  /** Text content, for text runs and elements that hold only text. */
  text?: string;
  children: RNode[];
  /** The tree node this came from. */
  source?: { file: string; id: string };
  /** Where an edit to this node's text goes. */
  textSource?: TextSource;
  /** For instances: the component's file and name. */
  component?: { file: string; name: string };
  icon?: { library: string; name: string };
  /** One of several outputs of the same source, such as an item of a `.map`. */
  repeated?: boolean;
  hidden?: boolean;
  locked?: boolean;
}

export interface PageTarget {
  kind: 'next-app' | 'next-pages' | 'react-router' | 'component';
  /** The page component's file. */
  file: string;
  exportName: string;
  route: string;
  /** Next.js app router layouts, outermost first. */
  layouts?: string[];
  /** Next.js pages router _app. */
  app?: string;
  /** React Router: the component that renders <Routes>. */
  shell?: { file: string; exportName: string };
  /** Props to render a lone component with. */
  props?: Record<string, Value>;
}

export interface RenderResult {
  nodes: RNode[];
  fonts: Map<string, { family: string; variable?: string }>;
  error?: string;
}

interface Ctx {
  repeated: boolean;
  /** Component functions being rendered, outermost first, to stop runaway recursion. */
  stack: t.Node[];
  outlet?: () => RNode[];
  /** Component functions to render inline instead of as instances: the page and its layouts. */
  inline: Set<t.Node>;
}

/** Children lists made from a call site's JSX children, as opposed to arrays the code built. */
const childLists = new WeakSet<Value[]>();

const booleanAttrs = new Set([
  'disabled', 'checked', 'hidden', 'readOnly', 'required', 'multiple', 'selected', 'autoFocus', 'autoPlay',
  'controls', 'loop', 'muted', 'playsInline', 'open', 'default', 'noValidate', 'allowFullScreen', 'reversed',
  'inert', 'defaultChecked', 'async', 'defer', 'itemScope',
]);
const camelAttrs = new Set([
  'className', 'htmlFor', 'tabIndex', 'readOnly', 'maxLength', 'minLength', 'autoComplete', 'autoFocus',
  'spellCheck', 'colSpan', 'rowSpan', 'crossOrigin', 'srcSet', 'viewBox', 'preserveAspectRatio', 'dateTime',
  'playsInline', 'autoPlay', 'referrerPolicy', 'allowFullScreen', 'encType', 'accessKey', 'defaultValue',
  'defaultChecked', 'inputMode', 'enterKeyHint', 'fetchPriority', 'pathLength', 'xlinkHref', 'xmlnsXlink',
  'stdDeviation', 'baseFrequency', 'numOctaves', 'gradientUnits', 'gradientTransform', 'patternUnits',
  'patternTransform', 'spreadMethod', 'clipPathUnits', 'maskUnits', 'maskContentUnits', 'filterUnits',
  'primitiveUnits', 'refX', 'refY', 'markerWidth', 'markerHeight', 'markerUnits', 'startOffset', 'textLength',
  'lengthAdjust', 'vectorEffect', 'shapeRendering', 'imageRendering', 'textRendering', 'dominantBaseline',
  'alignmentBaseline', 'colorInterpolationFilters',
]);
const svgCamel = /^(stroke|fill|stop|clip|marker|text|font|letter|word|flood|lighting|color)[A-Z]/;
/** Attributes that load a resource, which the canvas points at the project's files. */
const resourceAttrs = new Set(['src', 'poster', 'xlinkHref', 'data']);
/** Attributes that navigate, which keep their value unless it's a script URL. */
const linkAttrs = new Set(['href', 'action', 'formAction']);
/** Tags the canvas never creates. */
const skippedTags = new Set(['head', 'script', 'noscript', 'base', 'meta', 'link', 'title', 'template', 'slot']);
const embedTags = new Set(['iframe', 'object', 'embed', 'frame', 'frameset', 'portal']);

export class Renderer {
  private keys = new Set<string>();
  readonly ev: Evaluator;
  /** The props each component function got at its first call, for previewing it alone. */
  readonly calls = new Map<t.Node, Record<string, Value>>();

  constructor(readonly program: Program) {
    this.ev = new Evaluator(program);
  }

  private key(base: string) {
    let key = base;
    for (let n = 2; this.keys.has(key); n++) key = `${base}~${n}`;
    this.keys.add(key);
    return key;
  }

  /** A component function by export name. */
  component(file: string, exportName: string): Closure | undefined {
    const value = this.ev.exportOf(file, exportName);
    return value instanceof Closure ? value : undefined;
  }

  /** Renders a component's output without an instance around it. */
  inline(closure: Closure, props: Record<string, Value>, key: string, ctx: Ctx): RNode[] {
    ctx.inline.add(closure.fn);
    return this.value(this.ev.callClosure(closure, [props]), key, { ...ctx, stack: [...ctx.stack, closure.fn] });
  }

  page(target: PageTarget): RNode[] {
    const ctx: Ctx = { repeated: false, stack: [], inline: new Set() };
    const page = this.component(target.file, target.exportName);
    if (target.kind === 'react-router' && target.shell) {
      const shell = this.component(target.shell.file, target.shell.exportName);
      if (!shell) throw new Error(`Couldn't find the ${target.shell.exportName} export of ${target.shell.file}.`);
      return this.inline(shell, {}, '', ctx);
    }
    if (!page) throw new Error(`Couldn't find a component exported as ${target.exportName} from ${target.file}.`);
    if (target.kind === 'next-pages' && target.app) {
      const app = this.component(target.app, 'default');
      ctx.inline.add(page.fn);
      if (app) return this.inline(app, { Component: page, pageProps: {}, router: {} }, '', ctx);
    }
    if (target.kind === 'next-app' && target.layouts?.length) {
      // Layouts wrap from the inside out: each one gets the rendered content below it as children.
      let content = (key: string) => this.inline(page, { params: {}, searchParams: {} }, key, ctx);
      for (const file of [...target.layouts].reverse()) {
        const layout = this.component(file, 'default');
        if (!layout) continue;
        const inner = content;
        content = (key) => this.inline(layout, { children: new Rendered(inner(key)), params: {} }, key, ctx);
      }
      return content('');
    }
    return this.inline(page, target.props ?? {}, '', ctx);
  }

  /** Renders any value that can appear as JSX children. */
  value(value: Value, parent: string, ctx: Ctx, index?: number): RNode[] {
    if (value instanceof Lit) {
      const key = this.key(`${parent}/t${index ?? ''}`);
      return [{ key, kind: 'text', tag: 'span', name: layerText(value.value), props: {}, text: value.value, textSource: value.source, children: [], repeated: ctx.repeated || undefined }];
    }
    if (typeof value === 'string' || typeof value === 'number') {
      const key = this.key(`${parent}/t${index ?? ''}`);
      return [{ key, kind: 'text', tag: 'span', name: layerText(String(value)), props: {}, text: String(value), children: [], repeated: ctx.repeated || undefined }];
    }
    if (value === null || value === undefined || typeof value === 'boolean') return [];
    if (Array.isArray(value)) {
      const repeated = !childLists.has(value);
      return value.flatMap((item, i) => this.value(item, parent, repeated ? { ...ctx, repeated: true } : ctx, repeated ? i : undefined));
    }
    if (value instanceof JSXValue) return this.jsx(value.node, value.scope, parent, ctx, index);
    if (value instanceof Rendered) return value.nodes as RNode[];
    if (value instanceof Unknown) return [this.placeholder(parent, value.hint ? `{${value.hint}}` : '{…}', ctx)];
    return [];
  }

  private placeholder(parent: string, name: string, ctx: Ctx, source?: RNode['source']): RNode {
    return { key: this.key(`${parent}/p`), kind: 'placeholder', tag: 'div', name, props: {}, children: [], source, repeated: ctx.repeated || undefined };
  }

  /** Renders one tree node in the scope it was written in. */
  jsx(node: EditorNode, scope: Scope, parent: string, ctx: Ctx, index?: number): RNode[] {
    const file = scope.file;
    const key = () => this.key(`${parent}/${node.id}${index !== undefined ? `#${index}` : ''}`);
    const source = { file, id: node.id };
    const flags = { repeated: ctx.repeated || undefined, hidden: node.hidden || undefined, locked: node.locked || undefined };
    if (node.kind === 'text')
      return [{ key: key(), kind: 'text', tag: 'span', name: layerName(node), props: {}, text: node.text ?? '', textSource: { kind: 'text', file, nodeId: node.id }, source, children: [], ...flags }];
    if (node.kind === 'fragment') {
      const base = `${parent}`;
      return node.children.flatMap((child) => this.jsx(child, scope, base, ctx));
    }
    if (node.kind === 'expression') {
      if (node.comment || node.expr === undefined) return [];
      const ast = this.program.info(file)?.exprs.get(node.expr);
      if (!ast) return [];
      let value: Value;
      try {
        value = this.ev.evaluate(ast, scope);
      } catch (error) {
        if (!(error instanceof BudgetError)) throw error;
        value = UNKNOWN;
      }
      if (value instanceof Unknown || value instanceof Closure || value instanceof Native || isRecord(value)) {
        const code = this.program.info(file)!.source.slice(ast.start!, ast.end!).replace(/\s+/g, ' ');
        const placeholder = this.placeholder(parent, `{${code.length > 40 ? `${code.slice(0, 39)}…` : code}}`, ctx, source);
        return [{ ...placeholder, ...flags }];
      }
      // Output with no tree node of its own, such as the text of `{title}`, belongs to the expression.
      return this.value(value, `${parent}/${node.id}`, ctx).map((child) => ({
        ...child,
        source: child.source ?? source,
        ...(node.hidden ? { hidden: true } : {}),
      }));
    }

    // Elements.
    const tag = node.tag;
    if (skippedTags.has(tag)) return [];
    if (!isComponentTag(tag)) return [this.element(node, scope, tag, key(), ctx, this.props(node, scope))];
    const callee = this.resolveTag(tag, scope);
    if (isRecord(callee) && typeof callee.$svg === 'string') {
      // An SVG imported as a component (SVGR). Drawn as an image of the file.
      const props = { ...this.props(node, scope), src: callee.$svg };
      return [this.element({ ...node, children: [] }, scope, 'img', key(), ctx, props)];
    }
    if (typeof prim(callee) === 'string') {
      // `const Tag = as ?? 'div'; <Tag />`
      const dynamicTag = String(prim(callee));
      if (/^[a-z][a-z0-9-]*$/.test(dynamicTag)) return [this.element(node, scope, dynamicTag, key(), ctx, this.props(node, scope))];
    }
    if (callee instanceof Closure) {
      const props = this.componentProps(node, scope);
      if (ctx.inline.has(callee.fn)) return this.inline(callee, props, `${parent}/${node.id}`, ctx);
      return [this.instance(callee, props, node, scope, key(), ctx)];
    }
    if (callee instanceof Native && callee.component)
      return this.known(callee, callee.component, node, scope, key(), ctx).map((child) =>
        child.source?.id === node.id ? { ...child, ...flags } : child,
      );
    // An unknown component: show its children if it has any, else a placeholder.
    const children = this.childrenValue(node, scope);
    if (children !== undefined) return this.value(children, `${parent}/${node.id}`, ctx);
    return [{ ...this.placeholder(parent, `<${tag}>`, ctx, source), ...flags }];
  }

  private resolveTag(tag: string, scope: Scope): Value {
    const [head, ...rest] = tag.split('.');
    let value = scope.get(head);
    for (const part of rest) value = this.ev.member(value, part);
    return value;
  }

  /** Props of an element: spreads first, then attributes, then the style object. */
  props(node: EditorNode, scope: Scope): Record<string, Value> {
    const info = this.program.info(scope.file);
    const props: Record<string, Value> = {};
    for (const offset of node.dyn?.spreads ?? []) {
      const ast = info?.exprs.get(offset);
      const value = ast ? prim(this.ev.evaluate(ast, scope)) : UNKNOWN;
      if (isRecord(value)) Object.assign(props, value);
    }
    for (const [name, offset] of Object.entries(node.dyn?.attrs ?? {})) {
      if (offset === -1) props[name] = true;
      else {
        const ast = info?.exprs.get(offset);
        props[name] = ast ? this.ev.evaluate(ast, scope) : UNKNOWN;
      }
    }
    for (const [name, value] of Object.entries(node.attrs))
      props[name] = new Lit(value, { kind: 'attr', file: scope.file, nodeId: node.id, attr: name });
    let style: Record<string, Value> | undefined;
    if (node.dyn?.style !== undefined) {
      const ast = info?.exprs.get(node.dyn.style);
      style = ast ? this.styleValue(ast, scope, node) : undefined;
    }
    if (Object.keys(node.style).length || style) props.style = { ...(style ?? {}), ...node.style };
    delete props.key;
    delete props.ref;
    return props;
  }

  /** A style expression's value, without the literal entries the tree already holds. */
  private styleValue(ast: t.Expression, scope: Scope, node: EditorNode): Record<string, Value> | undefined {
    if (!t.isObjectExpression(ast)) {
      const value = prim(this.ev.evaluate(ast, scope));
      return isRecord(value) ? value : undefined;
    }
    const style: Record<string, Value> = {};
    for (const prop of ast.properties) {
      if (t.isSpreadElement(prop)) {
        const value = prim(this.ev.evaluate(prop.argument, scope));
        if (isRecord(value)) Object.assign(style, value);
        continue;
      }
      if (!t.isObjectProperty(prop)) continue;
      const key = t.isIdentifier(prop.key) && !prop.computed ? prop.key.name : t.isStringLiteral(prop.key) ? prop.key.value : undefined;
      // Literal entries live in node.style, where edits and deletions apply.
      if (!key || key in node.style || (t.isStringLiteral(prop.value) || t.isNumericLiteral(prop.value))) continue;
      style[key] = this.ev.evaluate(prop.value as t.Expression, scope);
    }
    return style;
  }

  private childrenValue(node: EditorNode, scope: Scope): Value {
    if (node.text !== undefined) return new Lit(node.text, { kind: 'text', file: scope.file, nodeId: node.id });
    const kids = node.children.filter((child) => !child.comment).map((child) => new JSXValue(child, scope));
    if (!kids.length) return undefined;
    if (kids.length === 1) return kids[0];
    childLists.add(kids);
    return kids;
  }

  private componentProps(node: EditorNode, scope: Scope): Record<string, Value> {
    const props = this.props(node, scope);
    const children = this.childrenValue(node, scope);
    if (children !== undefined) props.children = children;
    return props;
  }

  private instance(callee: Closure, props: Record<string, Value>, node: EditorNode, scope: Scope, key: string, ctx: Ctx): RNode {
    const base: RNode = {
      key,
      kind: 'instance',
      tag: node.tag,
      name: node.name ?? node.tag,
      props: {},
      children: [],
      source: { file: scope.file, id: node.id },
      component: { file: callee.scope.file, name: callee.name ?? node.tag },
      repeated: ctx.repeated || undefined,
      hidden: node.hidden || undefined,
      locked: node.locked || undefined,
    };
    if (ctx.stack.filter((fn) => fn === callee.fn).length >= 2 || ctx.stack.length > 60)
      return { ...base, children: [this.placeholder(key, 'Recursive component', ctx)] };
    if (!this.calls.has(callee.fn)) this.calls.set(callee.fn, props);
    try {
      const output = this.ev.callClosure(callee, [props]);
      base.children = this.value(output, key, { ...ctx, stack: [...ctx.stack, callee.fn] });
    } catch (error) {
      if (!(error instanceof BudgetError)) throw error;
      base.children = [this.placeholder(key, 'Too complex to preview', ctx)];
    }
    return base;
  }

  /** An HTML or SVG element. */
  private element(node: EditorNode, scope: Scope, tag: string, key: string, ctx: Ctx, props: Record<string, Value>, textOverride?: Value): RNode {
    const source = { file: scope.file, id: node.id };
    const base = {
      key,
      tag,
      name: layerName(node),
      source,
      repeated: ctx.repeated || undefined,
      hidden: node.hidden || undefined,
      locked: node.locked || undefined,
    };
    if (embedTags.has(tag)) return { ...base, kind: 'placeholder', props: {}, children: [], name: `Embedded ${tag}` };
    const childrenProp = props.children;
    const dom = this.domProps(props, tag);
    if (textOverride !== undefined || node.text !== undefined) {
      const text = textOverride !== undefined ? textOverride : new Lit(node.text!, { kind: 'text', file: scope.file, nodeId: node.id });
      return { ...base, kind: 'element', props: dom, text: toText(text), textSource: text instanceof Lit ? text.source : undefined, children: [] };
    }
    let children: RNode[];
    if (node.children.length) children = node.children.flatMap((child) => this.jsx(child, scope, key, ctx));
    else if (childrenProp !== undefined) {
      // children passed as a prop, as in <div {...props} /> inside a component.
      const plain = prim(childrenProp);
      if (childrenProp instanceof Lit || typeof plain === 'string' || typeof plain === 'number')
        return { ...base, kind: 'element', props: dom, text: toText(childrenProp), textSource: childrenProp instanceof Lit ? childrenProp.source : undefined, children: [] };
      children = this.value(childrenProp, key, ctx);
    } else children = [];
    return { ...base, kind: 'element', props: dom, children };
  }

  private known(native: Native, known: KnownComponent, node: EditorNode, scope: Scope, key: string, ctx: Ctx): RNode[] {
    const props = this.componentProps(node, scope);
    const source = { file: scope.file, id: node.id };
    switch (known.kind) {
      case 'element': {
        const mapped = known.props ? known.props(props, this.ev) : props;
        if (known.asChild && truthy(mapped.asChild) === true) return this.slot(mapped, key, ctx);
        return [this.knownElement(known.tag, mapped, node, scope, key, ctx)];
      }
      case 'transparent':
        return this.value(props.children, key, ctx);
      case 'hidden':
      case 'route':
        return [];
      case 'slot':
        return this.slot(props, key, ctx);
      case 'outlet':
        return ctx.outlet ? ctx.outlet() : [];
      case 'routes':
        return this.routes(node, scope, key, ctx);
      case 'icon':
        return [{ key, kind: 'icon', tag: 'svg', name: known.name, icon: { library: known.library, name: known.name }, props: this.domProps(props, 'svg'), children: [], source, repeated: ctx.repeated || undefined }];
      case 'context': {
        known.context.values.push(props.value);
        try {
          return this.value(props.children, key, ctx);
        } finally {
          known.context.values.pop();
        }
      }
      case 'consumer':
        return this.value(this.ev.call(props.children, [known.context.current]), key, ctx);
      case 'placeholder':
        return [this.placeholder(key, known.name, ctx, source)];
      default:
        return [this.placeholder(key, native.name, ctx, source)];
    }
  }

  /** An element from a known component, such as the <a> behind next/link. Edits go to the call site. */
  private knownElement(tag: string, props: Record<string, Value>, node: EditorNode, scope: Scope, key: string, ctx: Ctx): RNode {
    const children = props.children;
    const plain = prim(children);
    if (children instanceof Lit || typeof plain === 'string' || typeof plain === 'number')
      return this.element({ ...node, children: [], text: undefined }, scope, tag, key, ctx, props, children);
    return {
      key,
      kind: 'element',
      tag,
      name: layerName(node),
      props: this.domProps(props, tag),
      children: children === undefined ? [] : this.value(children, key, ctx),
      source: { file: scope.file, id: node.id },
      repeated: ctx.repeated || undefined,
    };
  }

  /** Radix Slot: renders the only child with the slot's props merged in. */
  private slot(props: Record<string, Value>, key: string, ctx: Ctx): RNode[] {
    const rendered = this.value(props.children, key, ctx);
    const first = rendered.findIndex((node) => node.kind === 'element' || node.kind === 'instance');
    if (first < 0) return rendered;
    const own = this.domProps({ ...props, children: undefined });
    const merge = (node: RNode): RNode => {
      if (node.kind === 'instance') return { ...node, children: node.children.map((child, i) => (i === 0 ? merge(child) : child)) };
      if (node.kind !== 'element') return node;
      const className = [own.className, node.props.className].filter(Boolean).join(' ');
      const style = { ...((own.style as object) ?? {}), ...((node.props.style as object) ?? {}) };
      return { ...node, props: { ...own, ...node.props, ...(className ? { className } : {}), ...(Object.keys(style).length ? { style } : {}) } };
    };
    return rendered.map((node, i) => (i === first ? merge(node) : node));
  }

  /** React Router <Routes>: renders the route matching the page, with <Outlet /> for nested routes. */
  private routes(node: EditorNode, scope: Scope, key: string, ctx: Ctx): RNode[] {
    interface Route { path: string; index: boolean; element: Value; children: Route[] }
    const collect = (nodes: EditorNode[], inScope: Scope): Route[] =>
      nodes.flatMap((child): Route[] => {
        if (child.kind === 'fragment') return collect(child.children, inScope);
        if (child.kind === 'expression' && child.expr !== undefined) {
          const ast = this.program.info(inScope.file)?.exprs.get(child.expr);
          const value = ast ? prim(this.ev.evaluate(ast, inScope)) : undefined;
          const list = Array.isArray(value) ? value : [value];
          return list.flatMap((item) => (item instanceof JSXValue ? collect([item.node], item.scope) : []));
        }
        if (child.kind !== 'element') return [];
        const callee = this.resolveTag(child.tag, inScope);
        if (!(callee instanceof Native && callee.component?.kind === 'route')) return [];
        const props = this.props(child, inScope);
        return [{ path: toText(props.path), index: truthy(props.index) === true, element: props.element ?? (props.Component instanceof Closure ? props.Component : undefined), children: collect(child.children, inScope) }];
      });
    const routes = collect(node.children, scope);
    const route = this.program.route.replace(/\/+$/, '') || '/';
    const match = (list: Route[], base: string): Route[] | undefined => {
      for (const candidate of list) {
        const path = candidate.index ? base : joinPath(base, candidate.path);
        if (candidate.children.length) {
          const inner = match(candidate.children, path);
          if (inner) return [candidate, ...inner];
        }
        if (matchesRoute(path, route, candidate.index)) return [candidate];
      }
    };
    const chain = match(routes, '/') ?? match(routes.filter((r) => r.path === '*'), '/');
    if (!chain) return [];
    const renderAt = (i: number): RNode[] => {
      const element = chain[i]?.element;
      if (element === undefined) return i + 1 < chain.length ? renderAt(i + 1) : [];
      const inner: Ctx = { ...ctx, outlet: () => (i + 1 < chain.length ? renderAt(i + 1) : []) };
      // Route elements are pages and layouts, so they render inline.
      if (element instanceof JSXValue && element.node.kind === 'element' && isComponentTag(element.node.tag)) {
        const callee = this.resolveTag(element.node.tag, element.scope);
        if (callee instanceof Closure) return this.inline(callee, this.componentProps(element.node, element.scope), `${key}/${element.node.id}`, inner);
      }
      if (element instanceof Closure) return this.inline(element, {}, key, inner);
      return this.value(element, key, inner);
    };
    return renderAt(0);
  }

  /** Props made safe for the canvas DOM: no handlers, no unknown props, no script URLs. */
  domProps(props: Record<string, Value>, tag = 'a'): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [rawName, value] of Object.entries(props)) {
      let name = rawName === 'class' ? 'className' : rawName === 'for' ? 'htmlFor' : rawName;
      if (name === 'children' || name === 'key' || name === 'ref' || /^on[A-Z]/i.test(name) || name === 'dangerouslySetInnerHTML' || name === 'asChild')
        continue;
      if (name === 'style') {
        const style = this.styleObject(prim(value));
        if (style) out.style = style;
        continue;
      }
      if (name === 'className') {
        const classes = Array.isArray(prim(value)) || isRecord(prim(value)) ? joinClasses([value]) : toText(value);
        if (classes) out.className = classes;
        continue;
      }
      if (!/^(data|aria)-/.test(name) && !/^[a-z][a-z0-9-]*$/.test(name) && !camelAttrs.has(name) && !svgCamel.test(name)) continue;
      const v = prim(value);
      if (v === undefined || v === null || v instanceof Unknown || typeof v === 'object' || typeof v === 'function') continue;
      if (typeof v === 'boolean') {
        if (booleanAttrs.has(name)) out[name] = v;
        else if (/^(data|aria)-/.test(name)) out[name] = String(v);
        continue;
      }
      if (name === 'value') name = 'defaultValue';
      if (name === 'checked') name = 'defaultChecked';
      if (resourceAttrs.has(name) || (name === 'href' && tag !== 'a' && tag !== 'area')) {
        const url = this.program.publicUrl(String(v));
        if (url !== undefined) out[name] = url;
        continue;
      }
      if (linkAttrs.has(name)) {
        if (!/^\s*(javascript|vbscript|data):/i.test(String(v))) out[name] = String(v);
        continue;
      }
      if (name === 'srcSet') {
        out.srcSet = String(v)
          .split(',')
          .map((part) => {
            const [url, ...rest] = part.trim().split(/\s+/);
            const safe = this.program.publicUrl(url);
            return safe ? [safe, ...rest].join(' ') : '';
          })
          .filter(Boolean)
          .join(', ');
        continue;
      }
      out[name] = typeof v === 'number' ? v : String(v);
    }
    return out;
  }

  private styleObject(value: Value): Record<string, string | number> | undefined {
    if (!isRecord(value)) return;
    const style: Record<string, string | number> = {};
    for (const [key, item] of Object.entries(value)) {
      const v = prim(item);
      if (typeof v === 'number') style[key] = v;
      else if (typeof v === 'string')
        style[key] = v.replace(/url\((['"]?)(\/[^'")]+)\1\)/g, (match, quote, url) => {
          const safe = this.program.publicUrl(url);
          return safe ? `url(${quote}${safe}${quote})` : 'none';
        });
    }
    return style;
  }
}

function layerText(text: string) {
  const line = text.replace(/\s+/g, ' ').trim() || 'Text';
  return line.length > 32 ? `${line.slice(0, 31)}…` : line;
}

function joinPath(base: string, path: string) {
  if (!path) return base;
  if (path.startsWith('/')) return path;
  return `${base.replace(/\/$/, '')}/${path}`;
}

/** Whether a route pattern such as `/blog/:slug` or `/docs/*` matches a path. */
export function matchesRoute(pattern: string, path: string, exact = true) {
  const a = pattern.split('/').filter(Boolean);
  const b = path.split('/').filter(Boolean);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '*') return true;
    if (i >= b.length) return false;
    if (!a[i].startsWith(':') && a[i] !== b[i]) return false;
  }
  return exact ? a.length === b.length : true;
}

/** Renders a page. Errors become a message instead of an exception, so one broken page can't take down the editor. */
export function renderPage(program: Program, target: PageTarget): RenderResult {
  const renderer = new Renderer(program);
  try {
    return { nodes: renderer.page(target), fonts: renderer.ev.fonts };
  } catch (error) {
    return { nodes: [], fonts: renderer.ev.fonts, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Every node in render trees, depth first, with its ancestors. */
export function walkRender(nodes: RNode[], visit: (node: RNode, ancestors: RNode[]) => void, ancestors: RNode[] = []) {
  for (const node of nodes) {
    visit(node, ancestors);
    walkRender(node.children, visit, [...ancestors, node]);
  }
}

/** Index of render nodes by key, with each node's parent. */
export function indexRender(nodes: RNode[]) {
  const byKey = new Map<string, RNode>();
  const parent = new Map<string, RNode | undefined>();
  walkRender(nodes, (node, ancestors) => {
    byKey.set(node.key, node);
    parent.set(node.key, ancestors.at(-1));
  });
  return { byKey, parent };
}
