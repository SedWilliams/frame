import { parse } from '@babel/parser';
import generate from '@babel/generator';
import * as t from '@babel/types';
import type { EditorNode, Project, Style } from './model';
import { voidTags } from './model';

const safeTags = new Set(
  'a article aside b blockquote br button caption code dd details div dl dt em figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr i img input label li main nav ol p pre section small span strong summary table tbody td textarea th thead tr ul video'.split(
    ' ',
  ),
);
const origin = (node: t.Node) => `jsx-${node.start}`;

function walk(node: t.Node, visit: (node: t.Node) => void) {
  visit(node);
  for (const key of t.VISITOR_KEYS[node.type] || []) {
    const value = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(value))
      value.forEach((child) => {
        if (child?.type) walk(child, visit);
      });
    else if (value && typeof value === 'object' && 'type' in value) walk(value as t.Node, visit);
  }
}

function parseAst(source: string) {
  return parse(source, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
}

function literal(node: t.Node | null | undefined): string | number | undefined {
  if (t.isStringLiteral(node) || t.isNumericLiteral(node)) return node.value;
  if (t.isUnaryExpression(node) && node.operator === '-' && t.isNumericLiteral(node.argument))
    return -node.argument.value;
}

function staticStyle(element: t.JSXElement): Style {
  const attr = element.openingElement.attributes.find(
    (a) => t.isJSXAttribute(a) && a.name.name === 'style',
  );
  if (
    !t.isJSXAttribute(attr) ||
    !t.isJSXExpressionContainer(attr.value) ||
    !t.isObjectExpression(attr.value.expression)
  )
    return {};
  const style: Style = {};
  for (const prop of attr.value.expression.properties) {
    if (!t.isObjectProperty(prop) || prop.computed) continue;
    const key = t.isIdentifier(prop.key)
      ? prop.key.name
      : t.isStringLiteral(prop.key)
        ? prop.key.value
        : null;
    const value = literal(prop.value);
    if (key && value !== undefined) style[key] = value;
  }
  return style;
}

function toEditor(
  node: t.JSXElement | t.JSXFragment | t.JSXExpressionContainer | t.JSXSpreadChild | t.JSXText,
): EditorNode {
  const id = origin(node);
  const base = { id, origin: id, style: {}, attrs: {}, children: [] };
  if (t.isJSXText(node))
    return { ...base, tag: 'span', name: 'Text', text: node.value, originalText: node.value };
  if (t.isJSXFragment(node))
    return {
      ...base,
      tag: 'fragment',
      name: 'Fragment',
      children: node.children.filter((c) => !t.isJSXText(c) || c.value.trim()).map(toEditor),
    };
  if (t.isJSXExpressionContainer(node) && literal(node.expression) !== undefined) {
    const text = String(literal(node.expression));
    return { ...base, tag: 'span', name: 'Text', text, originalText: text };
  }
  if (!t.isJSXElement(node))
    return { ...base, tag: 'code', name: 'Dynamic expression', opaque: true };
  const tag = t.isJSXIdentifier(node.openingElement.name)
    ? node.openingElement.name.name
    : generate(node.openingElement.name).code;
  if (!safeTags.has(tag)) return { ...base, tag, name: `<${tag}>`, opaque: true };
  const attrs: Record<string, string> = {};
  for (const attr of node.openingElement.attributes) {
    if (!t.isJSXAttribute(attr) || !t.isJSXIdentifier(attr.name)) continue;
    const value = t.isStringLiteral(attr.value)
      ? attr.value.value
      : t.isJSXExpressionContainer(attr.value)
        ? literal(attr.value.expression)
        : undefined;
    if (value !== undefined) attrs[attr.name.name] = String(value);
  }
  const textOnly =
    node.children.length > 0 &&
    node.children.every(
      (child) =>
        t.isJSXText(child) ||
        (t.isJSXExpressionContainer(child) && literal(child.expression) !== undefined),
    );
  const text = textOnly
    ? node.children
        .map((child) =>
          t.isJSXText(child)
            ? child.value.replace(/\s+/g, ' ')
            : String(literal((child as t.JSXExpressionContainer).expression)),
        )
        .join('')
        .trim()
    : undefined;
  const style = staticStyle(node);
  const label =
    attrs['data-layer'] ||
    (tag === 'img'
      ? 'Image'
      : text
        ? text.slice(0, 26)
        : (
            {
              main: 'Page',
              nav: 'Navigation',
              header: 'Header',
              section: 'Section',
              div: 'Frame',
              footer: 'Footer',
            } as Record<string, string>
          )[tag] || tag);
  return {
    ...base,
    tag,
    name: label,
    style,
    originalStyle: { ...style },
    attrs,
    ...(textOnly ? { text, originalText: text } : {}),
    children: textOnly
      ? []
      : node.children.filter((c) => !t.isJSXText(c) || c.value.trim()).map(toEditor),
  };
}

export function importSource(source: string, fileName = 'Page.tsx'): Project {
  if (source.length > 1_000_000)
    throw new Error('This file is too large. Choose a component smaller than 1 MB.');
  const ast = parseAst(source);
  let root: t.JSXElement | t.JSXFragment | undefined;
  const defaultExport = ast.program.body.find(t.isExportDefaultDeclaration);
  // Prefer the default-exported component, including `export default Component`.
  let search: t.Node = defaultExport || ast;
  if (defaultExport && t.isIdentifier(defaultExport.declaration)) {
    const name = defaultExport.declaration.name;
    search =
      ast.program.body.find(
        (n) =>
          (t.isFunctionDeclaration(n) && n.id?.name === name) ||
          (t.isVariableDeclaration(n) &&
            n.declarations.some((d) => t.isIdentifier(d.id) && d.id.name === name)),
      ) || ast;
  }
  walk(search, (node) => {
    if (!root && (t.isJSXElement(node) || t.isJSXFragment(node))) root = node;
  });
  if (!root) throw new Error('No JSX found. Choose a .jsx or .tsx component with a JSX return.');
  const editorRoot = toEditor(root);
  if (editorRoot.opaque)
    throw new Error(
      'This component only renders another component. Open the file that contains its HTML elements instead.',
    );
  return {
    name: fileName.replace(/\.(jsx|tsx)$/, ''),
    fileName,
    source,
    rootOrigin: origin(root),
    root: editorRoot,
  };
}

function valueNode(value: string | number) {
  return typeof value === 'number' ? t.numericLiteral(value) : t.stringLiteral(value);
}

function buildElement(
  node: EditorNode,
  originals: Map<string, t.Node>,
): t.JSXElement | t.JSXFragment | t.JSXExpressionContainer | t.JSXSpreadChild | t.JSXText {
  const original = node.origin ? originals.get(node.origin) : undefined;
  if (node.opaque && original) return t.cloneNode(original, true) as t.JSXElement;
  if (
    (t.isJSXText(original) || t.isJSXExpressionContainer(original)) &&
    !Object.keys(node.style).length &&
    !node.hidden
  ) {
    return node.text === node.originalText
      ? t.cloneNode(original)
      : t.jsxExpressionContainer(t.stringLiteral(node.text || ''));
  }
  if (node.tag === 'fragment')
    return t.jsxFragment(
      t.jsxOpeningFragment(),
      t.jsxClosingFragment(),
      node.children.map((child) => buildElement(child, originals)),
    );
  const element = t.isJSXElement(original)
    ? t.cloneNode(original, true)
    : t.jsxElement(
        t.jsxOpeningElement(t.jsxIdentifier(node.tag), [], voidTags.has(node.tag)),
        voidTags.has(node.tag) ? null : t.jsxClosingElement(t.jsxIdentifier(node.tag)),
        [],
        voidTags.has(node.tag),
      );
  const attributes = element.openingElement.attributes;
  const style: Style = { ...node.style, ...(node.hidden ? { display: 'none' } : {}) };
  const changed = Object.keys(style).filter((key) => style[key] !== node.originalStyle?.[key]);
  if (changed.length) {
    const index = attributes.findIndex(
      (attr) => t.isJSXAttribute(attr) && attr.name.name === 'style',
    );
    const attr = index >= 0 ? attributes[index] : undefined;
    const expression =
      t.isJSXAttribute(attr) && t.isJSXExpressionContainer(attr.value)
        ? attr.value.expression
        : undefined;
    const object = t.isObjectExpression(expression)
      ? t.cloneNode(expression, true)
      : t.objectExpression(
          expression && !t.isJSXEmptyExpression(expression)
            ? [t.spreadElement(t.cloneNode(expression, true))]
            : [],
        );
    for (const key of changed) {
      // Remove static assignments, then append after spreads so visual edits win.
      object.properties = object.properties.filter(
        (prop) =>
          !(
            t.isObjectProperty(prop) &&
            !prop.computed &&
            ((t.isIdentifier(prop.key) && prop.key.name === key) ||
              (t.isStringLiteral(prop.key) && prop.key.value === key))
          ),
      );
      object.properties.push(
        t.objectProperty(
          t.isValidIdentifier(key) ? t.identifier(key) : t.stringLiteral(key),
          valueNode(style[key]),
        ),
      );
    }
    const replacement = t.jsxAttribute(t.jsxIdentifier('style'), t.jsxExpressionContainer(object));
    if (index >= 0) attributes[index] = replacement;
    else attributes.push(replacement);
  }
  for (const [key, value] of Object.entries(node.attrs)) {
    const index = attributes.findIndex((attr) => t.isJSXAttribute(attr) && attr.name.name === key);
    const attr = index >= 0 ? attributes[index] : undefined;
    const existing =
      t.isJSXAttribute(attr) && t.isStringLiteral(attr.value)
        ? attr.value.value
        : t.isJSXAttribute(attr) && t.isJSXExpressionContainer(attr.value)
          ? literal(attr.value.expression)
          : undefined;
    if (existing !== undefined && String(existing) === value) continue;
    const replacement = t.jsxAttribute(t.jsxIdentifier(key), t.stringLiteral(value));
    if (index >= 0) attributes[index] = replacement;
    else attributes.push(replacement);
  }
  if (node.text !== undefined) {
    if (!t.isJSXElement(original) || node.text !== node.originalText)
      element.children = [t.jsxExpressionContainer(t.stringLiteral(node.text))];
  } else element.children = node.children.map((child) => buildElement(child, originals));
  if (element.children.length) {
    element.openingElement.selfClosing = false;
    element.closingElement ||= t.jsxClosingElement(t.jsxIdentifier(node.tag));
  }
  return element;
}

export function exportSource(project: Project): string {
  const ast = parseAst(project.source);
  const originals = new Map<string, t.Node>();
  let root: t.Node | undefined;
  walk(ast, (node) => {
    if (
      t.isJSXElement(node) ||
      t.isJSXFragment(node) ||
      t.isJSXExpressionContainer(node) ||
      t.isJSXSpreadChild(node) ||
      t.isJSXText(node)
    )
      originals.set(origin(node), node);
    if (origin(node) === project.rootOrigin && (t.isJSXElement(node) || t.isJSXFragment(node)))
      root = node;
  });
  if (!root || root.start == null || root.end == null)
    throw new Error('The original JSX root could not be found. Reopen the file before saving.');
  const replacement = buildElement(project.root, originals);
  const code = generate(replacement, { comments: true }).code;
  // Keep imports, hooks, functions, and all code outside this JSX byte-for-byte.
  return project.source.slice(0, root.start) + code + project.source.slice(root.end);
}
