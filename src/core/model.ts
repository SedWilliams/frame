/*
 * Document model.
 *
 * A workspace is a set of source files. Each file holds one EditorNode tree per
 * JSX root: every maximal JSX expression that isn't a child of other JSX, such as
 * a component's return value or a `const header = <h1 />`. Edits replace nodes
 * immutably and share every subtree they don't touch, so the printer can spot
 * untouched code by identity and the undo history can keep old documents cheaply.
 *
 * This file knows nothing about Babel, React, or the canvas.
 */

/** Inline style values, written the way React's style prop takes them. */
export type Style = Record<string, string | number>;

/**
 * `element` is an HTML tag or a component call. `text` is a literal run of text.
 * `expression` is a `{...}` child, kept verbatim, whose JSX islands (the JSX inside
 * it, such as a `.map` callback's return) are its children and stay editable.
 */
export type NodeKind = 'element' | 'text' | 'expression' | 'fragment';

export interface EditorNode {
  /** `<file>:<offset>` for imported nodes, `new-<random>` for nodes made in Frame. */
  id: string;
  kind: NodeKind;
  /** Offset of the JSX this node was imported from, in its file's base source. */
  origin?: number;
  /** Tag name for elements, such as `div`, `Card`, or `motion.div`. Empty otherwise. */
  tag: string;
  /** Layer name set with a `data-layer` attribute. */
  name?: string;
  /** Content of a text node, or of an element whose children are all literal text. */
  text?: string;
  /** Static entries of the inline style object. */
  style: Style;
  /** Attributes with literal values, as strings. */
  attrs: Record<string, string>;
  /** Source offsets of the parts Frame evaluates but never rewrites. */
  dyn?: {
    /** Attribute name to the offset of its value expression. */
    attrs?: Record<string, number>;
    /** Offsets of `{...spread}` attribute arguments, in source order. */
    spreads?: number[];
    /** Offset of the style expression when it isn't a plain object of literals. */
    style?: number;
  };
  /** For expression nodes: offset of the expression inside the braces. */
  expr?: number;
  /** For expression nodes: the `{/* comment *\/}` kind, which renders nothing. */
  comment?: boolean;
  children: EditorNode[];
  hidden?: boolean;
  locked?: boolean;
}

/** The editable state of one file. Trees and literal edits are relative to `base`. */
export interface FileDoc {
  path: string;
  /** Source text that the trees' origins point into. */
  base: string;
  /** Edited JSX roots by origin offset. Roots missing here are unchanged. */
  roots: Record<number, EditorNode>;
  /** Edited string literals by start offset, such as an item title in a data array. */
  literals: Record<number, string>;
  /** Import statements added in Frame, such as one for a newly placed component. */
  addedImports?: string[];
}

/** Everything Frame can edit, by project-relative path. Undo history holds whole Docs. */
export interface Doc {
  /** Source files with JSX trees. */
  code: Record<string, FileDoc>;
  /** Stylesheets and other plain text, with edits applied. */
  text: Record<string, string>;
}

let counter = 0;
/** IDs for nodes created in Frame. Imported nodes use `<file>:<offset>`. */
export const uid = () => `new-${(++counter).toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** HTML elements that can't have children. */
export const voidTags = new Set([
  'img',
  'input',
  'br',
  'hr',
  'area',
  'base',
  'col',
  'embed',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/** Whether a tag is a component call rather than an HTML or SVG element. */
export const isComponentTag = (tag: string) => /^[A-Z]/.test(tag) || tag.includes('.');

/** Whether a node can take new children. */
export function canContain(node: EditorNode) {
  return (
    (node.kind === 'element' || node.kind === 'fragment') &&
    node.text === undefined &&
    !node.locked &&
    !voidTags.has(node.tag)
  );
}

// Lookups return the node itself. Edits return a new root that shares every
// subtree they didn't change.

export function findNode(root: EditorNode, id: string): EditorNode | undefined {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
}

/** Ancestors of `id` from the root down, excluding the node itself. Undefined when absent. */
export function findPath(root: EditorNode, id: string): EditorNode[] | undefined {
  if (root.id === id) return [];
  for (const child of root.children) {
    const path = findPath(child, id);
    if (path) return [root, ...path];
  }
}

export function findParent(root: EditorNode, id: string): EditorNode | undefined {
  return findPath(root, id)?.at(-1);
}

/** Replaces the node with `id` by `change(node)`. Returns `root` itself when nothing changed. */
export function mapNode(
  root: EditorNode,
  id: string,
  change: (node: EditorNode) => EditorNode,
): EditorNode {
  if (root.id === id) return change(root);
  let changed = false;
  const children = root.children.map((child) => {
    const next = mapNode(child, id, change);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? { ...root, children } : root;
}

export function updateNode(root: EditorNode, id: string, patch: Partial<EditorNode>) {
  return mapNode(root, id, (node) => ({ ...node, ...patch }));
}

/** Removes every node in `ids`, wherever it sits. */
export function removeNodes(root: EditorNode, ids: Set<string>): EditorNode {
  let changed = false;
  const children: EditorNode[] = [];
  for (const child of root.children) {
    if (ids.has(child.id)) {
      changed = true;
      continue;
    }
    const next = removeNodes(child, ids);
    if (next !== child) changed = true;
    children.push(next);
  }
  return changed ? { ...root, children } : root;
}

/** Inserts `nodes` into `parentId` at `index`, or at the end when index is past it. */
export function insertNodes(
  root: EditorNode,
  parentId: string,
  index: number,
  nodes: EditorNode[],
): EditorNode {
  return mapNode(root, parentId, (parent) => {
    const children = [...parent.children];
    children.splice(Math.max(0, Math.min(index, children.length)), 0, ...nodes);
    return { ...parent, children };
  });
}

/**
 * Moves nodes into `parentId` at `index`, keeping their relative order. `index`
 * counts children as they are before the move. Refuses moves into a node's own
 * subtree and returns `root` unchanged.
 */
export function moveNodes(
  root: EditorNode,
  ids: string[],
  parentId: string,
  index: number,
): EditorNode {
  const nodes = orderInTree(root, ids)
    .map((id) => findNode(root, id))
    .filter((node): node is EditorNode => !!node);
  if (!nodes.length || nodes.some((node) => node.id === root.id || findNode(node, parentId)))
    return root;
  const parent = findNode(root, parentId);
  if (!parent) return root;
  // Removing earlier siblings shifts the insertion point left.
  const moving = new Set(nodes.map((node) => node.id));
  const before = parent.children.slice(0, index).filter((child) => moving.has(child.id)).length;
  const removed = removeNodes(root, moving);
  return insertNodes(removed, parentId, index - before, nodes);
}

/** `ids` sorted in tree order, depth first. Unknown IDs are dropped. */
export function orderInTree(root: EditorNode, ids: string[]): string[] {
  const wanted = new Set(ids);
  const ordered: string[] = [];
  (function visit(node: EditorNode) {
    if (wanted.has(node.id)) ordered.push(node.id);
    node.children.forEach(visit);
  })(root);
  return ordered;
}

/**
 * Wraps sibling nodes in `wrapper`, which takes the place of the first of them.
 * Returns `root` unchanged when the nodes don't share a parent.
 */
export function wrapNodes(root: EditorNode, ids: string[], wrapper: EditorNode): EditorNode {
  const ordered = orderInTree(root, ids);
  const parent = ordered.length ? findParent(root, ordered[0]) : undefined;
  if (!parent || !ordered.every((id) => parent.children.some((child) => child.id === id)))
    return root;
  const wanted = new Set(ordered);
  const inside = parent.children.filter((child) => wanted.has(child.id));
  const index = parent.children.findIndex((child) => wanted.has(child.id));
  const children = parent.children.filter((child) => !wanted.has(child.id));
  children.splice(index, 0, { ...wrapper, children: [...wrapper.children, ...inside] });
  return mapNode(root, parent.id, (node) => ({ ...node, children }));
}

/** Replaces a node by its children. */
export function unwrapNode(root: EditorNode, id: string): EditorNode {
  const parent = findParent(root, id);
  const node = findNode(root, id);
  if (!parent || !node) return root;
  const children = parent.children.flatMap((child) => (child.id === id ? node.children : [child]));
  return mapNode(root, parent.id, (p) => ({ ...p, children }));
}

/**
 * Deep copy with fresh IDs. Origins carry over, so a copy of imported JSX prints
 * with the original's props and handlers.
 */
export function cloneNode(node: EditorNode): EditorNode {
  return { ...node, id: uid(), children: node.children.map(cloneNode) };
}

/** Every node in a tree, depth first. */
export function allNodes(root: EditorNode): EditorNode[] {
  const nodes: EditorNode[] = [];
  (function visit(node: EditorNode) {
    nodes.push(node);
    node.children.forEach(visit);
  })(root);
  return nodes;
}

/** Elements Frame creates from the toolbar and the Assets panel. */
export type InsertType =
  | 'frame'
  | 'section'
  | 'rectangle'
  | 'ellipse'
  | 'line'
  | 'text'
  | 'heading'
  | 'paragraph'
  | 'button'
  | 'link'
  | 'image'
  | 'input'
  | 'list'
  | 'divider'
  | 'polygon'
  | 'star';

/** A new element of the given type. `size` comes from a drag with a drawing tool. */
export function createNode(type: InsertType, size?: { width: number; height: number }): EditorNode {
  const base = { id: uid(), kind: 'element' as const, attrs: {}, children: [] };
  const box: Style = size ? { width: Math.round(size.width), height: Math.round(size.height) } : {};
  switch (type) {
    case 'frame':
      return {
        ...base,
        tag: 'div',
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          padding: 24,
          backgroundColor: '#ffffff',
          ...(size ? box : { minHeight: 100 }),
        },
      };
    case 'section':
      return {
        ...base,
        tag: 'section',
        style: { display: 'flex', flexDirection: 'column', gap: 24, padding: '64px 48px' },
      };
    case 'rectangle':
      return {
        ...base,
        tag: 'div',
        style: { width: 100, height: 100, backgroundColor: '#d9d9d9', ...box },
      };
    case 'ellipse':
      return {
        ...base,
        tag: 'div',
        style: { width: 100, height: 100, borderRadius: '50%', backgroundColor: '#d9d9d9', ...box },
      };
    case 'line':
      return {
        ...base,
        tag: 'div',
        style: { width: size ? Math.max(1, Math.round(size.width)) : 120, height: 1, backgroundColor: '#000000' },
      };
    case 'text':
      return { ...base, tag: 'p', text: 'Text', style: size ? { width: Math.round(size.width) } : {} };
    case 'heading':
      return { ...base, tag: 'h2', text: 'Heading', style: { fontSize: 36, fontWeight: 600 } };
    case 'paragraph':
      return {
        ...base,
        tag: 'p',
        text: 'Write something worth reading.',
        style: { fontSize: 16, lineHeight: 1.6 },
      };
    case 'button':
      return {
        ...base,
        tag: 'button',
        text: 'Button',
        style: {
          padding: '12px 20px',
          backgroundColor: '#18181b',
          color: '#ffffff',
          border: 'none',
          borderRadius: 8,
          fontSize: 14,
        },
      };
    case 'link':
      return { ...base, tag: 'a', text: 'Link', attrs: { href: '#' }, style: {} };
    case 'image':
      return {
        ...base,
        tag: 'img',
        attrs: { src: '/__frame/demo/kitchen.jpg', alt: '' },
        style: { width: 320, height: 200, objectFit: 'cover', ...box },
      };
    case 'input':
      return {
        ...base,
        tag: 'input',
        attrs: { placeholder: 'Placeholder' },
        style: { padding: '10px 12px', border: '1px solid #d4d4d8', borderRadius: 6 },
      };
    case 'list':
      return {
        ...base,
        tag: 'ul',
        style: { display: 'flex', flexDirection: 'column', gap: 8 },
        children: ['First item', 'Second item', 'Third item'].map((text) => ({
          id: uid(),
          kind: 'element' as const,
          tag: 'li',
          text,
          attrs: {},
          style: {},
          children: [],
        })),
      };
    case 'divider':
      return {
        ...base,
        tag: 'hr',
        style: { width: '100%', border: 'none', borderTop: '1px solid #e4e4e7', margin: 0 },
      };
    case 'polygon':
    case 'star': {
      const points =
        type === 'polygon'
          ? '50,4 96,96 4,96'
          : '50,4 61,38 97,38 68,59 79,93 50,72 21,93 32,59 3,38 39,38';
      return {
        ...base,
        tag: 'svg',
        attrs: { viewBox: '0 0 100 100' },
        style: { width: 100, height: 100, ...box },
        children: [
          {
            id: uid(),
            kind: 'element',
            tag: 'polygon',
            attrs: { points, fill: '#d9d9d9' },
            style: {},
            children: [],
          },
        ],
      };
    }
  }
}

/** An SVG drawn with the pen or pencil tool. `d` is in the svg's own pixel space. */
export function createVector(d: string, width: number, height: number, closed: boolean) {
  return {
    id: uid(),
    kind: 'element' as const,
    tag: 'svg',
    attrs: { viewBox: `0 0 ${Math.max(1, Math.round(width))} ${Math.max(1, Math.round(height))}` },
    style: { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)), overflow: 'visible' },
    children: [
      {
        id: uid(),
        kind: 'element' as const,
        tag: 'path',
        attrs: { d, fill: closed ? '#d9d9d9' : 'none', stroke: '#000000', strokeWidth: '1' },
        style: {},
        children: [],
      },
    ],
  } satisfies EditorNode;
}

/** A component call such as `<Card />`, for inserting an instance. */
export function createInstance(tag: string, attrs: Record<string, string> = {}): EditorNode {
  return { id: uid(), kind: 'element', tag, attrs, style: {}, children: [] };
}

const semanticNames: Record<string, string> = {
  main: 'Main',
  nav: 'Navigation',
  header: 'Header',
  footer: 'Footer',
  section: 'Section',
  article: 'Article',
  aside: 'Aside',
  form: 'Form',
  ul: 'List',
  ol: 'List',
  li: 'List item',
  button: 'Button',
  a: 'Link',
  img: 'Image',
  svg: 'Vector',
  path: 'Path',
  input: 'Input',
  textarea: 'Text area',
  hr: 'Divider',
  video: 'Video',
  table: 'Table',
  label: 'Label',
  select: 'Select',
};

/** The name a layer shows: its data-layer, else something readable from its tag and content. */
export function layerName(node: EditorNode): string {
  if (node.name) return node.name;
  if (node.kind === 'text') return clip(node.text?.trim() || 'Text');
  if (node.kind === 'fragment') return 'Fragment';
  if (node.kind === 'expression') return node.comment ? 'Comment' : 'Expression';
  if (isComponentTag(node.tag)) return node.tag;
  if (node.text !== undefined && node.text.trim()) return clip(node.text.trim());
  if (node.attrs.id) return node.attrs.id;
  return semanticNames[node.tag] || (node.tag === 'div' || node.tag === 'span' ? 'Frame' : node.tag);
}

function clip(text: string) {
  const line = text.replace(/\s+/g, ' ');
  return line.length > 32 ? `${line.slice(0, 31)}…` : line;
}
