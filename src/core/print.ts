/*
 * Minimal-diff printer.
 *
 * printFile writes a FileDoc back into source text by copying the base source and
 * replacing only what changed. An untouched subtree is copied byte for byte. An
 * edited element keeps its tag, its untouched attributes, and its untouched style
 * entries as written, and reprints just the parts that differ. Code Frame doesn't
 * model, such as handlers, spreads, `.map` callbacks, and comments, always comes
 * through as written. Only nodes created in Frame are printed from scratch.
 *
 * Everything is spliced into the base source by offset, so the printer always runs
 * on the FileInfo parsed from `doc.base`.
 */

import * as t from '@babel/types';
import type { EditorNode, FileDoc, Style } from './model';
import { allNodes, voidTags } from './model';
import { attrName, literalValue, propertyKey, walk, type FileInfo } from './parse';

/** A span of the base source and the text that replaces it, computed on first use. */
interface Replacement {
  start: number;
  end: number;
  text: () => string;
}

/** Pristine nodes by origin, per FileInfo. */
const pristineCache = new WeakMap<FileInfo, Map<number, EditorNode>>();
function pristineNodes(info: FileInfo) {
  let map = pristineCache.get(info);
  if (!map) {
    map = new Map();
    for (const root of info.roots.values())
      for (const node of allNodes(root)) if (node.origin !== undefined) map.set(node.origin, node);
    pristineCache.set(info, map);
  }
  return map;
}

/** String literals and template quasis by start offset, which literal edits refer to. */
const literalCache = new WeakMap<FileInfo, Map<number, t.StringLiteral | t.TemplateElement>>();
export function literalNodes(info: FileInfo) {
  let map = literalCache.get(info);
  if (!map) {
    map = new Map();
    if (info.ast)
      walk(info.ast.program, (node) => {
        if (t.isStringLiteral(node) || t.isTemplateElement(node)) map!.set(node.start!, node);
      });
    literalCache.set(info, map);
  }
  return map;
}

const shallowEqual = (a: Record<string, unknown>, b: Record<string, unknown>) => {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
};

/** Whether a node would print the same as its pristine counterpart. Lock state never prints. */
export function samePrint(a: EditorNode, b: EditorNode | undefined): boolean {
  if (a === b) return true;
  if (!b) return false;
  return (
    a.kind === b.kind &&
    a.tag === b.tag &&
    a.text === b.text &&
    a.name === b.name &&
    !!a.hidden === !!b.hidden &&
    shallowEqual(a.style, b.style) &&
    shallowEqual(a.attrs, b.attrs) &&
    shallowEqual(a.dyn?.attrs || {}, b.dyn?.attrs || {}) &&
    a.children.length === b.children.length &&
    a.children.every(
      (child, i) =>
        child.origin !== undefined &&
        child.origin === b.children[i].origin &&
        samePrint(child, b.children[i]),
    )
  );
}

/** The style a node prints with. Hidden nodes print as display: none. */
const printedStyle = (node: EditorNode): Style =>
  node.hidden ? { ...node.style, display: 'none' } : node.style;

/** Writes the file's edits into its base source. Returns the base unchanged when nothing differs. */
export function printFile(info: FileInfo, doc: FileDoc): string {
  const source = doc.base;
  if (info.error || !info.ast) return source;
  const pristine = pristineNodes(info);
  const quote = info.quote;
  const unit = info.indentUnit;

  // Edits that aren't part of a tree being printed: dirty roots and literal edits.
  const global: Replacement[] = [];
  for (const [key, root] of Object.entries(doc.roots)) {
    const offset = Number(key);
    const ast = info.nodes.get(offset);
    if (!ast || samePrint(root, info.roots.get(offset))) continue;
    global.push(lazy(ast.start!, ast.end!, () => printNode(root, lineIndent(ast.start!))));
  }
  const literals = literalNodes(info);
  for (const [key, value] of Object.entries(doc.literals)) {
    const node = literals.get(Number(key));
    if (!node) continue;
    global.push(lazy(node.start!, node.end!, () => printLiteral(node, value)));
  }
  global.sort((a, b) => a.start - b.start || b.end - a.end);
  const imports = doc.addedImports?.length ? importInsertion(info, doc.addedImports) : undefined;
  if (!global.length && !imports) return source;
  const body = emit(0, source.length);
  return imports ? body.slice(0, imports.at) + imports.text + body.slice(imports.at) : body;

  function lazy(start: number, end: number, make: () => string): Replacement {
    let cached: string | undefined;
    let busy = false;
    return {
      start,
      end,
      text() {
        // A replacement asked for its own span while printing would recurse forever. It can't
        // happen with well-formed trees, but copying the source is the safe answer if it does.
        if (busy) return source.slice(start, end);
        busy = true;
        cached ??= make();
        busy = false;
        return cached;
      },
    };
  }

  /** Copies source[start, end), applying `overrides` and any global edits inside the range. */
  function emit(start: number, end: number, overrides: Replacement[] = []): string {
    const inside = global.filter((r) => r.start >= start && r.end <= end && !(r.start === start && r.end === end));
    const all = [...overrides, ...inside].sort((a, b) => a.start - b.start || b.end - a.end);
    let out = '';
    let at = start;
    for (const r of all) {
      if (r.start < at) continue;
      out += source.slice(at, r.start) + r.text();
      at = r.end;
    }
    return out + source.slice(at, end);
  }

  function lineIndent(offset: number) {
    const lineStart = source.lastIndexOf('\n', offset - 1) + 1;
    return /^[ \t]*/.exec(source.slice(lineStart, offset))![0];
  }

  function reindent(text: string, from: string, to: string) {
    if (from === to || !text.includes('\n')) return text;
    return text
      .split('\n')
      .map((line, i) => (i > 0 && line.startsWith(from) ? to + line.slice(from.length) : line))
      .join('\n');
  }

  function printNode(node: EditorNode, indent: string): string {
    const ast = node.origin !== undefined ? info.nodes.get(node.origin) : undefined;
    const original = node.origin !== undefined ? pristine.get(node.origin) : undefined;
    if (!ast || !original) return printNew(node, indent);
    if (samePrint(node, original)) return reindent(emit(ast.start!, ast.end!), lineIndent(ast.start!), indent);
    if (node.kind === 'text') return printText(node, ast);
    if (node.kind === 'expression') {
      // The expression stays as written. Only its JSX islands can differ.
      const overrides = node.children.flatMap((island) => {
        const islandAst = island.origin !== undefined ? info.nodes.get(island.origin) : undefined;
        return islandAst
          ? [lazy(islandAst.start!, islandAst.end!, () => printNode(island, lineIndent(islandAst.start!)))]
          : [];
      });
      return emit(ast.start!, ast.end!, overrides);
    }
    return reindent(printElement(node, original, ast as t.JSXElement | t.JSXFragment), lineIndent(ast.start!), indent);
  }

  /** A changed text run. Styling or hiding a bare run wraps it in a span. */
  function printText(node: EditorNode, ast: t.Node) {
    const text = node.text ?? '';
    const style = printedStyle(node);
    if (Object.keys(style).length)
      return `<span style={${styleObject(style, '')}}>${formatText(text, false, false)}</span>`;
    if (t.isJSXText(ast)) {
      const raw = source.slice(ast.start!, ast.end!);
      const lead = /^\s*\n[ \t]*/.exec(raw)?.[0] ?? '';
      const trail = /[ \t]*\n\s*$/.exec(raw)?.[0] ?? '';
      return lead + formatText(text, !!lead, !!trail) + trail;
    }
    return `{${quoteString(text)}}`;
  }

  /**
   * Text written as a JSX text child where that's safe, else as a string
   * expression. JSX drops whitespace next to a line break, so the flags say
   * whether the text will sit right after or before one.
   */
  function formatText(text: string, breakBefore: boolean, breakAfter: boolean) {
    const unsafe =
      !text ||
      /[{}<>\n]/.test(text) ||
      /&[a-zA-Z#][\w]*;/.test(text) ||
      (breakBefore && /^\s/.test(text)) ||
      (breakAfter && /\s$/.test(text));
    return unsafe ? `{${quoteString(text)}}` : text;
  }

  function quoteString(value: string, q: string = quote) {
    const escaped = value
      .replace(/\\/g, '\\\\')
      .replace(new RegExp(q, 'g'), `\\${q}`)
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
    return q + escaped + q;
  }

  function printLiteral(node: t.StringLiteral | t.TemplateElement, value: string) {
    if (t.isTemplateElement(node)) return value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
    return quoteString(value, source[node.start!] === '"' ? '"' : "'");
  }

  /** A JSX attribute value: a quoted string when JSX can hold it as written, else an expression. */
  function attrValue(value: string) {
    if (!/["\n]|&[a-zA-Z#][\w]*;/.test(value)) return `"${value}"`;
    if (!/['\n]|&[a-zA-Z#][\w]*;/.test(value)) return `'${value}'`;
    return `{${quoteString(value)}}`;
  }

  function styleValue(value: string | number) {
    return typeof value === 'number' ? String(value) : quoteString(value);
  }

  function styleKey(key: string) {
    return t.isValidIdentifier(key) ? key : quoteString(key);
  }

  /** A fresh style object. Breaks onto lines when it would run long. */
  function styleObject(style: Style, indent: string) {
    const entries = Object.entries(style).map(([key, value]) => `${styleKey(key)}: ${styleValue(value)}`);
    if (!entries.length) return '{}';
    const line = `{ ${entries.join(', ')} }`;
    if (line.length <= 72) return line;
    return `{\n${entries.map((entry) => `${indent}${unit}${entry},`).join('\n')}\n${indent}}`;
  }

  function printElement(node: EditorNode, original: EditorNode, ast: t.JSXElement | t.JSXFragment) {
    const indent = lineIndent(ast.start!);
    if (t.isJSXFragment(ast))
      return (
        emit(ast.openingFragment.start!, ast.openingFragment.end!) +
        printChildren(node, original, ast.openingFragment.end!, ast.closingFragment.start!, indent) +
        emit(ast.closingFragment.start!, ast.closingFragment.end!)
      );
    const opening = ast.openingElement;
    const nameEnd = opening.typeParameters ? opening.typeParameters.end! : opening.name.end!;
    const head =
      node.tag === original.tag
        ? source.slice(opening.start!, nameEnd)
        : `<${node.tag}${opening.typeParameters ? source.slice(opening.typeParameters.start!, opening.typeParameters.end!) : ''}`;
    const { text: attributes, end } = printAttributes(node, original, opening, nameEnd, indent);
    const tail = source.slice(end, opening.end!);
    const space = tail.replace(/\/?>$/, '');
    const hasContent = node.text !== undefined ? true : node.children.length > 0;

    if (opening.selfClosing) {
      if (!hasContent || voidTags.has(node.tag)) return head + attributes + tail;
      const content =
        node.text !== undefined
          ? formatText(node.text, false, false)
          : `${node.children.map((child) => `\n${indent}${unit}${printNode(child, indent + unit)}`).join('')}\n${indent}`;
      return `${head}${attributes}${space === ' ' ? '' : space}>${content}</${node.tag}>`;
    }
    const closing = ast.closingElement!;
    const children =
      node.text !== undefined
        ? printTextContent(node, original, opening.end!, closing.start!)
        : printChildren(node, original, opening.end!, closing.start!, indent);
    const close =
      node.tag === original.tag ? source.slice(closing.start!, closing.end!) : `</${node.tag}>`;
    return head + attributes + tail + children + close;
  }

  /** Content of a text-only element, keeping the line breaks around it. */
  function printTextContent(node: EditorNode, original: EditorNode, start: number, end: number) {
    if (node.text === original.text && original.text !== undefined) return emit(start, end);
    const raw = source.slice(start, end);
    const lead = /^\s*\n[ \t]*/.exec(raw)?.[0] ?? '';
    const trail = /[ \t]*\n\s*$/.exec(raw)?.[0] ?? '';
    const text = node.text ?? '';
    return lead + formatText(text, !!lead, !!trail) + trail;
  }

  /**
   * Children between `start` and `end`. With the same children in the same order,
   * the source between them is kept, so comments and formatting survive. Otherwise
   * the children are laid out again, one per line or all on one line as before.
   */
  function printChildren(node: EditorNode, original: EditorNode, start: number, end: number, indent: string) {
    const sameOrder =
      node.children.length === original.children.length &&
      node.children.every((child, i) => child.origin !== undefined && child.origin === original.children[i].origin);
    if (sameOrder) {
      const overrides = node.children.flatMap((child, i) => {
        if (samePrint(child, original.children[i])) return [];
        const ast = info.nodes.get(child.origin!)!;
        return [lazy(ast.start!, ast.end!, () => printNode(child, lineIndent(ast.start!)))];
      });
      return emit(start, end, overrides);
    }
    const region = source.slice(start, end);
    if (!node.children.length) return /\n/.test(region) ? `\n${indent}` : '';
    const multiLine = /\n/.test(region) || !region.trim();
    if (!multiLine) return node.children.map((child) => printNode(child, indent)).join('');
    const childIndent = /\n([ \t]*)\S/.exec(region)?.[1] ?? indent + unit;
    return (
      node.children
        .map((child) => {
          if (child.kind === 'text' && !Object.keys(printedStyle(child)).length)
            return `\n${childIndent}${formatText(child.text ?? '', true, true)}`;
          return `\n${childIndent}${printNode(child, childIndent)}`;
        })
        .join('') + `\n${indent}`
    );
  }

  /**
   * The attributes of an opening tag, from the end of its name to its last
   * attribute. Untouched attributes, spreads, and separators are copied.
   */
  function printAttributes(
    node: EditorNode,
    original: EditorNode,
    opening: t.JSXOpeningElement,
    nameEnd: number,
    indent: string,
  ) {
    const desiredStyle = printedStyle(node);
    const originalStyle = printedStyle(original);
    const styleChanged = !shallowEqual(desiredStyle, originalStyle);
    const pieces: { sep: string; text: string }[] = [];
    const seen = new Set<string>();
    let at = nameEnd;
    let lastSep = ' ';
    let styleSeen = false;
    let layerSeen = false;
    for (const attr of opening.attributes) {
      const sep = source.slice(at, attr.start!);
      at = attr.end!;
      lastSep = sep;
      if (t.isJSXSpreadAttribute(attr)) {
        pieces.push({ sep, text: emit(attr.start!, attr.end!) });
        continue;
      }
      const key = attrName(attr);
      seen.add(key);
      if (key === 'style') {
        styleSeen = true;
        if (!styleChanged) pieces.push({ sep, text: emit(attr.start!, attr.end!) });
        else {
          const text = printStyleAttr(attr, desiredStyle, original.style, indent);
          if (text) pieces.push({ sep, text });
        }
        continue;
      }
      if (key === 'data-layer' && (original.name !== undefined || node.name !== undefined)) {
        layerSeen = true;
        if (node.name === original.name) pieces.push({ sep, text: emit(attr.start!, attr.end!) });
        else if (node.name) pieces.push({ sep, text: `data-layer=${attrValue(node.name)}` });
        continue;
      }
      if (key in node.attrs) {
        const unchanged = key in original.attrs && original.attrs[key] === node.attrs[key];
        pieces.push({
          sep,
          text: unchanged ? emit(attr.start!, attr.end!) : `${key}=${attrValue(node.attrs[key])}`,
        });
      } else if (!(key in original.attrs) && node.dyn?.attrs?.[key] !== undefined)
        pieces.push({ sep, text: emit(attr.start!, attr.end!) });
      // Anything else was removed in Frame.
    }
    // A dropped first attribute must not leave the next one glued to the tag name.
    const firstSep = opening.attributes.length ? source.slice(nameEnd, opening.attributes[0].start!) : ' ';
    if (pieces.length && !/^\s/.test(pieces[0].sep)) pieces[0].sep = firstSep || ' ';
    const newSep = /\n/.test(lastSep) ? lastSep : ' ';
    for (const [key, value] of Object.entries(node.attrs))
      if (!seen.has(key)) pieces.push({ sep: newSep, text: `${key}=${attrValue(value)}` });
    if (!layerSeen && node.name !== undefined && node.name !== original.name)
      pieces.push({ sep: newSep, text: `data-layer=${attrValue(node.name)}` });
    if (!styleSeen && styleChanged && Object.keys(desiredStyle).length)
      pieces.push({ sep: newSep, text: `style={${styleObject(desiredStyle, indent)}}` });
    return { text: pieces.map((piece) => piece.sep + piece.text).join(''), end: at };
  }

  /**
   * A style attribute with edits applied. Edits a literal object in place, keeping
   * untouched entries, spreads, and dynamic values as written. Returns '' when the
   * attribute ends up empty.
   */
  function printStyleAttr(attr: t.JSXAttribute, desired: Style, staticStyle: Style, indent: string) {
    const container = attr.value;
    if (!t.isJSXExpressionContainer(container) || t.isJSXEmptyExpression(container.expression))
      return Object.keys(desired).length ? `style={${styleObject(desired, indent)}}` : '';
    const expression = container.expression;
    const prefix = source.slice(attr.start!, expression.start!);
    const suffix = source.slice(expression.end!, attr.end!);
    if (!t.isObjectExpression(expression)) {
      // style={base}: keep the variable and put the edits after it so they win.
      if (!Object.keys(desired).length) return emit(attr.start!, attr.end!);
      const entries = Object.entries(desired).map(([key, value]) => `${styleKey(key)}: ${styleValue(value)}`);
      return `${prefix}{ ...${emit(expression.start!, expression.end!)}, ${entries.join(', ')} }${suffix}`;
    }
    const object = printObject(expression, desired, staticStyle, indent);
    return object === undefined ? '' : prefix + object + suffix;
  }

  function printObject(object: t.ObjectExpression, desired: Style, staticStyle: Style, indent: string) {
    const props = object.properties;
    if (!props.length) return Object.keys(desired).length ? styleObject(desired, indent) : undefined;
    const lastSpread = props.reduce((last, prop, i) => (t.isSpreadElement(prop) ? i : last), -1);
    const pieces: { sep: string; text: string }[] = [];
    const written = new Set<string>();
    let at = object.start! + 1;
    let dynamic = false;
    props.forEach((prop, i) => {
      const sep = source.slice(at, prop.start!);
      at = prop.end!;
      const key = propertyKey(prop);
      const isStatic =
        key !== undefined &&
        key in staticStyle &&
        t.isObjectProperty(prop) &&
        literalValue(prop.value) !== undefined;
      if (isStatic) {
        if (!(key in desired)) return;
        written.add(key);
        const value = (prop as t.ObjectProperty).value;
        pieces.push({
          sep,
          text:
            desired[key] === staticStyle[key]
              ? emit(prop.start!, prop.end!)
              : source.slice(prop.start!, value.start!) + styleValue(desired[key]),
        });
        return;
      }
      if (key !== undefined && key in desired && t.isObjectProperty(prop)) {
        // A dynamic entry the user overrode. In place if nothing spreads after it,
        // otherwise at the end so the new value still wins.
        if (i > lastSpread) {
          written.add(key);
          pieces.push({ sep, text: source.slice(prop.start!, prop.value.start!) + styleValue(desired[key]) });
        }
        return;
      }
      dynamic = true;
      pieces.push({ sep, text: emit(prop.start!, prop.end!) });
    });
    const tail = source.slice(at, object.end! - 1);
    const firstSep = source.slice(object.start! + 1, props[0].start!);
    const multiLine = firstSep.includes('\n');
    const additions = Object.entries(desired).filter(([key]) => !written.has(key));
    if (!pieces.length && !additions.length) return dynamic ? '{}' : undefined;
    if (pieces.length) pieces[0].sep = firstSep;
    const between = multiLine
      ? `,${(props.length > 1 ? source.slice(props[0].end!, props[1].start!).replace(/^,/, '') : firstSep)}`
      : ', ';
    for (const [key, value] of additions)
      pieces.push({ sep: pieces.length ? between : firstSep || ' ', text: `${styleKey(key)}: ${styleValue(value)}` });
    const close = tail || (multiLine ? `\n${indent}` : ' ');
    return `{${pieces.map((piece) => piece.sep + piece.text).join('')}${close}}`;
  }

  /** A node made in Frame, printed from scratch. Its children may still be imported nodes. */
  function printNew(node: EditorNode, indent: string): string {
    if (node.kind === 'text') {
      const style = printedStyle(node);
      return Object.keys(style).length
        ? `<span style={${styleObject(style, indent)}}>${formatText(node.text ?? '', false, false)}</span>`
        : formatText(node.text ?? '', false, false);
    }
    if (node.kind === 'expression') return '';
    const open = node.kind === 'fragment' ? '<' : `<${node.tag}`;
    const close = node.kind === 'fragment' ? '</>' : `</${node.tag}>`;
    let attributes = '';
    if (node.kind === 'element') {
      for (const [key, value] of Object.entries(node.attrs)) attributes += ` ${key}=${attrValue(value)}`;
      if (node.name) attributes += ` data-layer=${attrValue(node.name)}`;
      const style = printedStyle(node);
      if (Object.keys(style).length) attributes += ` style={${styleObject(style, indent)}}`;
    }
    if (node.text !== undefined) return `${open}${attributes}>${formatText(node.text, false, false)}${close}`;
    if (!node.children.length)
      return node.kind === 'fragment' ? '<></>' : `${open}${attributes} />`;
    const inner = indent + unit;
    const children = node.children.map((child) =>
      child.kind === 'text' && !Object.keys(printedStyle(child)).length
        ? `\n${inner}${formatText(child.text ?? '', true, true)}`
        : `\n${inner}${printNode(child, inner)}`,
    );
    return `${open}${attributes}>${children.join('')}\n${indent}${close}`;
  }
}

/** Where added import lines go: after the last import, or at the top of the file. */
function importInsertion(info: FileInfo, lines: string[]) {
  const imports = info.ast!.program.body.filter((statement) => t.isImportDeclaration(statement));
  const last = imports.at(-1);
  if (last) return { at: last.end!, text: lines.map((line) => `\n${line}`).join('') };
  // Keep a 'use client' or other directive first.
  const directive = info.ast!.program.directives.at(-1);
  if (directive) return { at: directive.end!, text: lines.map((line) => `\n${line}`).join('') };
  return { at: 0, text: lines.map((line) => `${line}\n`).join('') };
}
