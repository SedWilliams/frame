/*
 * Document model.
 *
 * A page is a tree of EditorNode objects. Every edit function takes a root and
 * returns a new root, leaving the old one untouched, so the undo history in
 * useEditor can hold earlier versions without copying them. This file knows
 * nothing about Babel or React.
 */

/** Inline style values, written the way React's style prop takes them. */
export type Style = Record<string, string | number>;

/** One element, text run, or preserved expression in the page tree. */
export interface EditorNode {
  id: string;
  /** Source key of the JSX this node came from, as `jsx-<offset>`. Unset for nodes added in Frame. */
  origin?: string;
  name: string;
  tag: string;
  text?: string;
  /** Text as imported. Export leaves the source text alone while `text` still equals it. */
  originalText?: string;
  style: Style;
  /** Style as imported. Export rewrites only the keys that differ from it. */
  originalStyle?: Style;
  attrs: Record<string, string>;
  children: EditorNode[];
  /** Custom components and dynamic expressions. Shown as placeholders, exported unchanged. */
  opaque?: boolean;
  locked?: boolean;
  hidden?: boolean;
}

/** An open file: its full source, plus the editable tree for one JSX root inside it. */
export interface Project {
  name: string;
  fileName: string;
  source: string;
  /** Origin of the JSX root that `root` came from. Export replaces only that span of `source`. */
  rootOrigin: string;
  root: EditorNode;
}

/** IDs for nodes created in Frame. Imported nodes use their origin as their ID. */
export const uid = () => `new-${crypto.randomUUID().slice(0, 8)}`;

// Tree helpers. Lookups return the node itself. Edits return a new root.
export function findNode(root: EditorNode, id: string): EditorNode | undefined {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
}

export function updateNode(root: EditorNode, id: string, patch: Partial<EditorNode>): EditorNode {
  if (root.id === id) return { ...root, ...patch };
  return { ...root, children: root.children.map((child) => updateNode(child, id, patch)) };
}

export function removeNode(root: EditorNode, id: string): EditorNode {
  return {
    ...root,
    children: root.children
      .filter((child) => child.id !== id)
      .map((child) => removeNode(child, id)),
  };
}

export function findParent(root: EditorNode, id: string): EditorNode | undefined {
  if (root.children.some((child) => child.id === id)) return root;
  for (const child of root.children) {
    const found = findParent(child, id);
    if (found) return found;
  }
}

/**
 * Deep copy with fresh IDs. Origins carry over, so a copy of imported JSX exports
 * with the original's props and handlers.
 */
export function cloneNode(node: EditorNode): EditorNode {
  return {
    ...node,
    id: uid(),
    name: `${node.name} copy`,
    children: node.children.map(cloneNode),
  };
}

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
/** Whether a node can take new children. Text, void, locked, and preserved nodes can't. */
export function canContain(node: EditorNode) {
  return !node.opaque && !node.locked && node.text === undefined && !voidTags.has(node.tag);
}

/**
 * Moves a node before `targetId`, or to the end of `targetId` when `inside` is set.
 * Returns `root` unchanged when the node is locked or is the root, when the move
 * would put a node inside itself, or when the destination can't take children.
 */
/** Layer drops insert before a sibling; canvas drops append into a container. */
export function moveNode(
  root: EditorNode,
  id: string,
  targetId: string,
  inside = false,
): EditorNode {
  const node = findNode(root, id);
  const target = findNode(root, targetId);
  if (!node || !target || node.locked || id === root.id || findNode(node, targetId)) return root;
  const parent = inside ? target : findParent(root, targetId);
  if (!parent || !canContain(parent)) return root;
  const cleaned = removeNode(root, id);
  const newParent = findNode(cleaned, parent.id)!;
  const children = [...newParent.children];
  const index = inside ? children.length : children.findIndex((child) => child.id === targetId);
  children.splice(index, 0, node);
  return updateNode(cleaned, parent.id, { children });
}

/** Appends a new node to the target, or to the target's parent when the target can't take children. */
export function insertNode(root: EditorNode, targetId: string, node: EditorNode): EditorNode {
  const target = findNode(root, targetId) || root;
  const parent = canContain(target) ? target : findParent(root, target.id);
  if (!parent || !canContain(parent)) return root;
  return updateNode(root, parent.id, { children: [...parent.children, node] });
}

/** Layer count for the status bar. */
export function countNodes(root: EditorNode): number {
  return 1 + root.children.reduce((sum, node) => sum + countNodes(node), 0);
}

/** Starting element for each Insert tab entry and canvas tool, styled to match the demo. */
export type InsertType = 'text' | 'heading' | 'button' | 'frame' | 'image' | 'divider';
export function createNode(type: InsertType): EditorNode {
  const base = { id: uid(), attrs: {}, children: [] };
  switch (type) {
    case 'heading':
      return {
        ...base,
        tag: 'h2',
        name: 'Heading',
        text: 'A new perspective.',
        style: { fontSize: 36, fontWeight: 500, color: '#293c32', margin: 0 },
      };
    case 'text':
      return {
        ...base,
        tag: 'p',
        name: 'Text',
        text: 'A little room for your next big idea.',
        style: { fontSize: 16, lineHeight: 1.6, color: '#647168', margin: 0 },
      };
    case 'button':
      return {
        ...base,
        tag: 'button',
        name: 'Button',
        text: 'Get in touch ↗',
        style: {
          padding: '14px 24px',
          backgroundColor: '#293c32',
          color: '#ffffff',
          borderRadius: 4,
          border: 'none',
          fontSize: 14,
        },
      };
    case 'frame':
      return {
        ...base,
        tag: 'div',
        name: 'Frame',
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          padding: 24,
          minHeight: 100,
          backgroundColor: '#efeee8',
          borderRadius: 4,
        },
      };
    case 'image':
      return {
        ...base,
        tag: 'img',
        name: 'Image',
        attrs: { src: '/images/kitchen.jpg', alt: 'A light-filled interior' },
        style: { width: '100%', height: 240, objectFit: 'cover', borderRadius: 4 },
      };
    case 'divider':
      return {
        ...base,
        tag: 'hr',
        name: 'Divider',
        style: { width: '100%', border: 'none', borderTop: '1px solid #d9ddd5', margin: '16px 0' },
      };
  }
}
