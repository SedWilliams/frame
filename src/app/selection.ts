/*
 * Selection rules.
 *
 * Frame follows Figma: a click selects the layer under the pointer, except that
 * an instance of a component catches clicks on its insides, so the first click
 * selects the whole instance. Double-click enters it. Cmd or Ctrl-click selects
 * the deepest layer directly. Render keys are paths, so a key's ancestors are
 * its prefixes.
 */

import type { RNode } from '../core/render';

type Index = { byKey: Map<string, RNode>; parent: Map<string, RNode | undefined> };

export const isInside = (key: string, ancestor: string) => key === ancestor || key.startsWith(`${ancestor}/`);

/** Layers the user can select: anything with a source or editable text. */
export function selectable(node: RNode | undefined): boolean {
  return !!node && (!!node.source || !!node.textSource);
}

/** The layer and its ancestors, outermost first. */
export function chainOf(index: Index, key: string): RNode[] {
  const chain: RNode[] = [];
  for (let node = index.byKey.get(key); node; node = index.parent.get(node.key)) chain.unshift(node);
  return chain;
}

/** The innermost instance containing a layer, or null. The layer itself counts. */
export function instanceScope(index: Index, key: string | undefined): string | null {
  if (!key) return null;
  const chain = chainOf(index, key);
  for (let i = chain.length - 1; i >= 0; i--) if (chain[i].kind === 'instance') return chain[i].key;
  return null;
}

/** What a click on `hit` selects, given the instance the user has entered. */
export function clickTarget(index: Index, hit: string | undefined, scope: string | null, deep: boolean): string | undefined {
  if (!hit) return;
  const chain = chainOf(index, hit);
  if (!deep)
    for (const node of chain)
      if (node.kind === 'instance' && !(scope && isInside(scope, node.key)) && selectable(node)) return node.key;
  for (let i = chain.length - 1; i >= 0; i--) if (selectable(chain[i])) return chain[i].key;
}

/** The nearest selectable ancestor of a layer. */
export function parentOf(index: Index, key: string): string | undefined {
  for (let node = index.parent.get(key); node; node = index.parent.get(node.key)) if (selectable(node)) return node.key;
}

/** Selectable children of a layer, looking through layers that can't be selected. */
export function childrenOf(index: Index, key: string | undefined, roots: RNode[] = []): RNode[] {
  const list = key ? (index.byKey.get(key)?.children ?? []) : roots;
  return list.flatMap((child) => (selectable(child) ? [child] : childrenOf(index, child.key)));
}

/** Render keys for tree nodes, after an edit moved them. Prefers keys near `near`. */
export function keysFor(index: Index, sources: { file: string; id: string }[], near?: string): string[] {
  const keys: string[] = [];
  for (const source of sources) {
    const matches = [...index.byKey.values()].filter((node) => node.source?.id === source.id && node.source.file === source.file);
    if (!matches.length) continue;
    const prefix = near?.slice(0, near.lastIndexOf('/'));
    keys.push((prefix !== undefined && matches.find((m) => m.key.startsWith(prefix))?.key) || matches[0].key);
  }
  return keys;
}

/** The text a layer can edit in place: a text run, or an element that holds only text. */
export function editableText(node: RNode | undefined) {
  return !!node && !!node.textSource && node.text !== undefined;
}
