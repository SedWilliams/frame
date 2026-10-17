/*
 * Document edits.
 *
 * Every change the editor makes to source goes through these functions. They
 * take a Doc and return a new one, and know nothing about React or the canvas.
 * A target is the tree node a layer came from: `{ file, id }`. Style edits
 * become Tailwind classes in Tailwind projects and inline styles elsewhere. Text
 * edits go wherever the string lives: the JSX itself, a prop at a component's
 * call site, or a literal in a data array.
 */

import * as t from '@babel/types';
import type { Doc, EditorNode, Style } from '../core/model';
import {
  cloneNode,
  findNode,
  findParent,
  insertNodes,
  isComponentTag,
  mapNode,
  moveNodes,
  removeNodes,
  uid,
  unwrapNode,
  voidTags,
  wrapNodes,
} from '../core/model';
import { walk } from '../core/parse';
import { literalNodes } from '../core/print';
import { applyTailwind, canWriteTailwind, classFor } from '../core/tailwind';
import type { TextSource } from '../core/values';
import type { RNode } from '../core/render';
import { Workspace, type ComponentEntry, type ProjectConfig } from '../core/workspace';
import { dirname, joinPath } from '../core/cssfile';

export interface Target {
  file: string;
  id: string;
}

export type StyleChange = Record<string, string | number | null>;

const ws = (doc: Doc, config: ProjectConfig) => new Workspace(doc, config);

/** Which root of a file holds a node, with the current tree. */
export function locate(doc: Doc, config: ProjectConfig, target: Target) {
  const workspace = ws(doc, config);
  const info = workspace.info(target.file);
  const file = doc.code[target.file];
  if (!info || !file) return;
  for (const [offset, pristine] of info.roots) {
    const root = file.roots[offset] ?? pristine;
    const node = findNode(root, target.id);
    if (node) return { offset, root, node, info };
  }
}

function setRoot(doc: Doc, file: string, offset: number, root: EditorNode): Doc {
  const current = doc.code[file];
  if (current.roots[offset] === root) return doc;
  return { ...doc, code: { ...doc.code, [file]: { ...current, roots: { ...current.roots, [offset]: root } } } };
}

/** Applies `change` to one node. Returns the doc unchanged when the node is gone. */
export function editNode(doc: Doc, config: ProjectConfig, target: Target, change: (node: EditorNode) => EditorNode): Doc {
  const found = locate(doc, config, target);
  if (!found) return doc;
  const root = mapNode(found.root, target.id, change);
  return root === found.root ? doc : setRoot(doc, target.file, found.offset, root);
}

/** Sets an edited string literal, or clears the edit when the value is back to the original. */
export function setLiteral(doc: Doc, config: ProjectConfig, file: string, start: number, value: string): Doc {
  const info = ws(doc, config).info(file);
  const current = doc.code[file];
  if (!info || !current) return doc;
  const node = literalNodes(info).get(start);
  const original = t.isStringLiteral(node) ? node.value : node ? (node.value.cooked ?? node.value.raw) : undefined;
  const literals = { ...current.literals };
  if (value === original) delete literals[start];
  else literals[start] = value;
  return { ...doc, code: { ...doc.code, [file]: { ...current, literals } } };
}

/** Writes text wherever it came from. */
export function applyText(doc: Doc, config: ProjectConfig, source: TextSource, text: string): Doc {
  if (source.kind === 'literal') return setLiteral(doc, config, source.file, source.start, text);
  if (source.kind === 'attr')
    return editNode(doc, config, { file: source.file, id: source.nodeId }, (node) => ({ ...node, attrs: { ...node.attrs, [source.attr]: text } }));
  return editNode(doc, config, { file: source.file, id: source.nodeId }, (node) => ({ ...node, text }));
}

/** Sets or removes an attribute. A static value replaces a dynamic one. */
export function applyAttr(doc: Doc, config: ProjectConfig, target: Target, name: string, value: string | null): Doc {
  return editNode(doc, config, target, (node) => {
    const attrs = { ...node.attrs };
    if (value === null) delete attrs[name];
    else attrs[name] = value;
    let dyn = node.dyn;
    if (dyn?.attrs?.[name] !== undefined) {
      const rest = { ...dyn.attrs };
      delete rest[name];
      dyn = { ...dyn, attrs: rest };
    }
    return { ...node, attrs, ...(dyn ? { dyn } : {}) };
  });
}

/** Patches tree-only fields: name, hidden, locked, tag. */
export function applyNode(doc: Doc, config: ProjectConfig, target: Target, patch: Partial<Pick<EditorNode, 'name' | 'hidden' | 'locked' | 'tag'>>): Doc {
  return editNode(doc, config, target, (node) => {
    const next = { ...node, ...patch };
    if (patch.name === '') delete next.name;
    return next;
  });
}

/** Whether style edits in this project should be Tailwind classes. */
export function tailwindProject(doc: Doc, config: ProjectConfig) {
  return !!ws(doc, config).styles().tailwind;
}

/**
 * Applies a style change. In Tailwind mode the change becomes classes, edited in
 * the className string literal that already holds the property when className
 * is dynamic, as in `cn('p-4', active && 'bg-white')`. Properties without a
 * class, and every property in inline mode, go to the style object.
 */
export function applyStyle(doc: Doc, config: ProjectConfig, target: Target, change: StyleChange, mode: 'tailwind' | 'inline', variant = ''): Doc {
  const found = locate(doc, config, target);
  if (!found) return doc;
  const node = found.node;
  let inline: StyleChange = change;
  if (mode === 'tailwind') {
    const classProps = Object.keys(change).filter((prop) => canWriteTailwind([prop]));
    const classChange = Object.fromEntries(classProps.map((prop) => [prop, change[prop]]));
    inline = Object.fromEntries(Object.entries(change).filter(([prop]) => !classProps.includes(prop)));
    if (classProps.length) {
      const dynamicOffset = node.dyn?.attrs?.className;
      const expression = dynamicOffset !== undefined ? found.info.exprs.get(dynamicOffset) : undefined;
      if (node.attrs.className !== undefined || dynamicOffset === undefined) {
        const classes = applyTailwind(node.attrs.className ?? '', classChange, variant);
        doc = editNode(doc, config, target, (n) => {
          const attrs = { ...n.attrs };
          if (classes) attrs.className = classes;
          else delete attrs.className;
          return { ...n, attrs, style: without(n.style, classProps) };
        });
      } else if (expression) {
        const literal = pickClassLiteral(doc, config, target.file, expression, classProps, variant);
        if (literal) {
          doc = setLiteral(doc, config, target.file, literal.start, applyTailwind(literal.value, classChange, variant));
          doc = editNode(doc, config, target, (n) => ({ ...n, style: without(n.style, classProps) }));
        } else inline = change;
      } else inline = change;
    }
  }
  if (!Object.keys(inline).length) return doc;
  return editNode(doc, config, target, (n) => {
    const style: Style = { ...n.style };
    for (const [prop, value] of Object.entries(inline)) {
      if (value === null || value === '') delete style[prop];
      else style[prop] = value;
    }
    return { ...n, style };
  });
}

const without = (style: Style, keys: string[]) => {
  if (!keys.some((key) => key in style)) return style;
  const next = { ...style };
  for (const key of keys) delete next[key];
  return next;
};

/**
 * The string literal inside a className expression to edit: one that already
 * sets a changed property, else the first one with classes in it.
 */
function pickClassLiteral(doc: Doc, config: ProjectConfig, file: string, expression: t.Node, props: string[], variant: string) {
  const current = doc.code[file].literals;
  const literals: { start: number; value: string }[] = [];
  walk(expression, (node) => {
    // Conditional class strings, such as `active && 'bg-white'`, only apply sometimes. Skip them.
    if (t.isLogicalExpression(node) || t.isConditionalExpression(node)) return false;
    if (t.isObjectExpression(node)) return false;
    if (t.isStringLiteral(node)) literals.push({ start: node.start!, value: current[node.start!] ?? node.value });
    if (t.isTemplateElement(node)) literals.push({ start: node.start!, value: current[node.start!] ?? node.value.cooked ?? node.value.raw });
  });
  void config;
  return (
    literals.find((literal) => props.some((prop) => classFor(literal.value, prop, variant))) ??
    literals.find((literal) => /[a-z]/.test(literal.value))
  );
}

/* Structure. */

/** Groups targets by the root they live in. Targets in other roots can't move together. */
function sameRoot(doc: Doc, config: ProjectConfig, targets: Target[]) {
  const located = targets.map((target) => ({ target, found: locate(doc, config, target) }));
  const first = located[0]?.found;
  if (!first || located.some(({ target, found }) => !found || target.file !== located[0].target.file || found.offset !== first.offset)) return;
  return { file: located[0].target.file, offset: first.offset, root: first.root };
}

/** Moves targets into `parent` before its child at `index`. All must share one root. */
export function moveInto(doc: Doc, config: ProjectConfig, targets: Target[], parent: Target, index: number): Doc {
  const found = sameRoot(doc, config, [...targets, parent]);
  if (!found) return doc;
  const root = moveNodes(found.root, targets.map((t) => t.id), parent.id, index);
  return root === found.root ? doc : setRoot(doc, found.file, found.offset, root);
}

/** Whether targets can move into `parent`: same root, not into themselves, and the parent takes children. */
export function canMoveInto(doc: Doc, config: ProjectConfig, targets: Target[], parent: Target) {
  const found = sameRoot(doc, config, [...targets, parent]);
  if (!found) return false;
  const parentNode = findNode(found.root, parent.id);
  if (!parentNode || !takesChildren(parentNode)) return false;
  return targets.every((target) => {
    const node = findNode(found.root, target.id);
    return node && !findNode(node, parent.id) && node.id !== found.root.id && !node.locked;
  });
}

/** Elements and component calls can hold children. Text-only and void elements can't. */
export function takesChildren(node: EditorNode) {
  return (node.kind === 'element' || node.kind === 'fragment') && node.text === undefined && !voidTags.has(node.tag) && !node.locked;
}

/** Inserts a node into `parent` at `index`. */
export function insertInto(doc: Doc, config: ProjectConfig, parent: Target, index: number, node: EditorNode): Doc {
  const found = locate(doc, config, parent);
  if (!found) return doc;
  if (found.node.text !== undefined && found.node.kind === 'element') {
    // Turning a text-only element into a container keeps its text as the first child.
    const text = found.node.text;
    doc = editNode(doc, config, parent, (n) => ({ ...n, text: undefined, children: text ? [{ id: uid(), kind: 'text', tag: '', text, attrs: {}, style: {}, children: [] }] : [] }));
    return insertInto(doc, config, parent, index, node);
  }
  return setRoot(doc, parent.file, found.offset, insertNodes(found.root, parent.id, index, [node]));
}

/**
 * Deletes targets. A layer that came from a `cond && <X />` takes its expression
 * with it, since the expression has nothing else to render.
 */
export function removeTargets(doc: Doc, config: ProjectConfig, targets: Target[]): Doc {
  for (const target of targets) {
    const found = locate(doc, config, target);
    if (!found || found.node.id === found.root.id) continue;
    const parent = findParent(found.root, target.id);
    const id = parent?.kind === 'expression' ? (parent.children.length === 1 ? parent.id : undefined) : target.id;
    if (!id) continue;
    doc = setRoot(doc, target.file, found.offset, removeNodes(found.root, new Set([id])));
  }
  return doc;
}

/** Copies each target right after itself. Returns the new doc and the copies' targets. */
export function duplicateTargets(doc: Doc, config: ProjectConfig, targets: Target[]): { doc: Doc; copies: Target[] } {
  const copies: Target[] = [];
  for (const target of targets) {
    const found = locate(doc, config, target);
    const parent = found && findParent(found.root, target.id);
    if (!found || !parent || parent.kind === 'expression') continue;
    const copy = cloneNode(found.node);
    const index = parent.children.findIndex((child) => child.id === target.id) + 1;
    doc = setRoot(doc, target.file, found.offset, insertNodes(found.root, parent.id, index, [copy]));
    copies.push({ file: target.file, id: copy.id });
  }
  return { doc, copies };
}

/** Wraps sibling targets in a new element. Returns the wrapper's target. */
export function wrapTargets(doc: Doc, config: ProjectConfig, targets: Target[], wrapper: EditorNode): { doc: Doc; wrapper?: Target } {
  const found = sameRoot(doc, config, targets);
  if (!found) return { doc };
  const root = wrapNodes(found.root, targets.map((t) => t.id), wrapper);
  if (root === found.root) return { doc };
  return { doc: setRoot(doc, found.file, found.offset, root), wrapper: { file: found.file, id: wrapper.id } };
}

/** Replaces a wrapper with its children. */
export function unwrapTarget(doc: Doc, config: ProjectConfig, target: Target): Doc {
  const found = locate(doc, config, target);
  if (!found || found.node.id === found.root.id || isComponentTag(found.node.tag)) return doc;
  return setRoot(doc, target.file, found.offset, unwrapNode(found.root, target.id));
}

/** Moves a target among its siblings: by a step, or to the front or back. */
export function reorderTarget(doc: Doc, config: ProjectConfig, target: Target, to: number | 'first' | 'last'): Doc {
  const found = locate(doc, config, target);
  const parent = found && findParent(found.root, target.id);
  if (!found || !parent || parent.kind === 'expression') return doc;
  const count = parent.children.length;
  const index = parent.children.findIndex((child) => child.id === target.id);
  // moveNodes takes the index before the move, so moving later skips over the node itself.
  const before = to === 'first' ? 0 : to === 'last' ? count : to > 0 ? Math.min(count, index + 1 + to) : Math.max(0, index + to);
  const finalIndex = before > index ? before - 1 : before;
  if (finalIndex === index) return doc;
  return setRoot(doc, target.file, found.offset, moveNodes(found.root, [target.id], parent.id, before));
}

/* Components. */

/** Whether a subtree is plain JSX: no expressions, handlers, or other dynamic values. */
export function isStatic(node: EditorNode): boolean {
  if (node.kind === 'expression' && !node.comment) return false;
  const dynamic = node.dyn && (node.dyn.spreads?.length || node.dyn.style !== undefined || Object.keys(node.dyn.attrs ?? {}).length);
  return !dynamic && node.children.every(isStatic);
}

/** A static copy of rendered output, as new nodes. Used to detach instances and paste across files. */
export function staticCopy(node: RNode): EditorNode[] {
  if (node.kind === 'text') return [{ id: uid(), kind: 'text', tag: '', text: node.text ?? '', attrs: {}, style: {}, children: [] }];
  if (node.kind === 'instance') return node.children.flatMap(staticCopy);
  if (node.kind === 'placeholder' || node.kind === 'icon') return [];
  const attrs: Record<string, string> = {};
  let style: Style = {};
  for (const [name, value] of Object.entries(node.props)) {
    if (name === 'style' && value && typeof value === 'object') style = { ...(value as Style) };
    else if (typeof value === 'string' || typeof value === 'number') attrs[name === 'defaultValue' ? 'value' : name === 'defaultChecked' ? 'checked' : name] = String(value);
  }
  // Resource URLs on the canvas point at Frame's server. Write the original public paths back.
  for (const name of ['src', 'poster'])
    if (attrs[name]?.startsWith('/__frame/fs/')) attrs[name] = attrs[name].replace(/^\/__frame\/fs\//, '').replace(/^public/, '').replace(/\?.*$/, '');
  return [
    {
      id: uid(),
      kind: 'element',
      tag: node.tag,
      attrs,
      style,
      ...(node.text !== undefined ? { text: node.text } : {}),
      children: node.text !== undefined ? [] : node.children.flatMap(staticCopy),
    },
  ];
}

/** The import specifier `from` should use for `to`: the `@/` alias when the project has one, else a relative path. */
export function importPath(doc: Doc, config: ProjectConfig, from: string, to: string) {
  const workspace = ws(doc, config);
  const bare = to.replace(/\.(tsx|ts|jsx|js)$/, '').replace(/\/index$/, '');
  for (const candidate of [`@/${bare.replace(/^src\//, '')}`, `@/${bare}`])
    if (workspace.resolve(from, candidate) === to) return candidate;
  let relative = joinRelative(dirname(from), bare);
  if (!relative.startsWith('.')) relative = `./${relative}`;
  return relative;
}

function joinRelative(fromDir: string, to: string) {
  const a = fromDir ? fromDir.split('/') : [];
  const b = to.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
}

/** Adds `import { Name } from '...'` to a file unless it already imports that name. */
export function ensureImport(doc: Doc, config: ProjectConfig, file: string, component: ComponentEntry, local = component.name): Doc {
  const workspace = ws(doc, config);
  const info = workspace.info(file);
  if (!info || !component.exportName || file === component.file) return doc;
  if (info.imports.has(local) || info.topLevel.has(local)) return doc;
  const spec = importPath(doc, config, file, component.file);
  const q = info.quote;
  const line =
    component.exportName === 'default'
      ? `import ${local} from ${q}${spec}${q};`
      : `import { ${component.exportName === local ? local : `${component.exportName} as ${local}`} } from ${q}${spec}${q};`;
  const current = doc.code[file];
  if (current.addedImports?.includes(line)) return doc;
  return { ...doc, code: { ...doc.code, [file]: { ...current, addedImports: [...(current.addedImports ?? []), line] } } };
}

/** Where new components go: the project's components folder. */
export function componentsDir(doc: Doc) {
  const paths = Object.keys(doc.code);
  for (const dir of ['src/components', 'components', 'app/components', 'src/app/components'])
    if (paths.some((p) => p.startsWith(`${dir}/`))) return dir;
  return paths.some((p) => p.startsWith('src/')) ? 'src/components' : 'components';
}

/**
 * Turns a static layer into a component in its own file, and replaces the layer
 * with an instance of it. Returns undefined when the layer has dynamic parts.
 */
export function createComponent(doc: Doc, config: ProjectConfig, target: Target, name: string, printJSX: (node: EditorNode) => string) {
  const found = locate(doc, config, target);
  if (!found || !isStatic(found.node) || found.node.id === found.root.id) return;
  const file = joinPath(componentsDir(doc), `${name}.tsx`);
  if (doc.code[file]) return;
  const jsx = printJSX(found.node)
    .split('\n')
    .map((line, i) => (i === 0 ? line : `    ${line}`))
    .join('\n');
  const source = `export function ${name}() {\n  return (\n    ${jsx}\n  );\n}\n`;
  let next: Doc = { ...doc, code: { ...doc.code, [file]: { path: file, base: source, roots: {}, literals: {} } } };
  const instance: EditorNode = { id: uid(), kind: 'element', tag: name, attrs: {}, style: {}, children: [] };
  const parent = findParent(found.root, target.id)!;
  const index = parent.children.findIndex((child) => child.id === target.id);
  let root = removeNodes(found.root, new Set([target.id]));
  root = insertNodes(root, parent.id, index, [instance]);
  next = setRoot(next, target.file, found.offset, root);
  const entry: ComponentEntry = { id: `${file}#${name}`, file, name, exportName: name, props: [], acceptsClassName: false };
  next = ensureImport(next, config, target.file, entry);
  return { doc: next, file, instance: { file: target.file, id: instance.id } };
}

/** Replaces an instance's call site with a static copy of what it renders. */
export function detachInstance(doc: Doc, config: ProjectConfig, instance: RNode): Doc {
  if (instance.kind !== 'instance' || !instance.source) return doc;
  const found = locate(doc, config, instance.source);
  const parent = found && findParent(found.root, instance.source.id);
  if (!found || !parent) return doc;
  const copies = instance.children.flatMap(staticCopy);
  const index = parent.children.findIndex((child) => child.id === instance.source!.id);
  let root = removeNodes(found.root, new Set([instance.source.id]));
  root = insertNodes(root, parent.id, index, copies);
  return setRoot(doc, instance.source.file, found.offset, root);
}

/** A new page file for the project's router, from a template. */
export function newPageFile(doc: Doc, framework: string, route: string, name: string): { path: string; source: string } {
  const slug = route.replace(/^\/+|\/+$/g, '') || 'new-page';
  const component = name.replace(/[^A-Za-z0-9]+/g, ' ').replace(/(^|\s)(\w)/g, (_, __, c: string) => c.toUpperCase()).replace(/\s/g, '') || 'NewPage';
  const body = `export default function ${component}Page() {\n  return (\n    <main>\n      <h1>${name}</h1>\n    </main>\n  );\n}\n`;
  const app = Object.keys(doc.code).some((p) => p.startsWith('src/app/')) ? 'src/app' : 'app';
  if (framework === 'next-app') return { path: `${app}/${slug}/page.tsx`, source: body };
  const pages = Object.keys(doc.code).some((p) => p.startsWith('src/pages/')) ? 'src/pages' : 'pages';
  if (framework === 'next-pages') return { path: `${pages}/${slug}.tsx`, source: body };
  return { path: `src/pages/${component}.tsx`, source: body };
}

