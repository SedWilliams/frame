export type Style = Record<string, string | number>;

export interface EditorNode {
  id: string;
  origin?: string;
  name: string;
  tag: string;
  text?: string;
  originalText?: string;
  style: Style;
  originalStyle?: Style;
  attrs: Record<string, string>;
  children: EditorNode[];
  opaque?: boolean;
  locked?: boolean;
  hidden?: boolean;
}

export interface Project {
  name: string;
  fileName: string;
  source: string;
  rootOrigin: string;
  root: EditorNode;
}

export const uid = () => `new-${crypto.randomUUID().slice(0, 8)}`;

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

export function cloneNode(node: EditorNode): EditorNode {
  return {
    ...node,
    id: uid(),
    name: `${node.name} copy`,
    children: node.children.map((child) => cloneNode(child)),
  };
}

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
export function canContain(node: EditorNode) {
  return !node.opaque && !node.locked && node.text === undefined && !voidTags.has(node.tag);
}

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

export function insertNode(root: EditorNode, targetId: string, node: EditorNode): EditorNode {
  const target = findNode(root, targetId) || root;
  const parent = canContain(target) ? target : findParent(root, target.id);
  if (!parent || !canContain(parent)) return root;
  return updateNode(root, parent.id, { children: [...parent.children, node] });
}

export function countNodes(root: EditorNode): number {
  return 1 + root.children.reduce((sum, node) => sum + countNodes(node), 0);
}

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
