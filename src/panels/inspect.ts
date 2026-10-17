/*
 * What the Design panel knows about the selection.
 *
 * useInspect reads each selected layer's computed style from its frame, the
 * declared values Frame wrote (inline styles and classes), and its parent's
 * layout, and reports values shared by every selected layer or MIXED.
 */

import { useMemo } from 'react';
import type { EditorNode } from '../core/model';
import type { RNode } from '../core/render';
import { activeIndex, currentPage, findRender, get, useEditor } from '../app/state';
import { componentOf, styleMode, styleTarget } from '../app/actions';
import { locate } from '../app/edit';
import { computedOf, localRect, useLayoutTick } from '../canvas/registry';
import { instanceScope, parentOf } from '../app/selection';
import { MIXED, type FieldValue } from '../ui/controls';

export interface Inspected {
  nodes: RNode[];
  primary: RNode;
  frame: string;
  computed: (CSSStyleDeclaration | undefined)[];
  /** The primary layer's tree node, for declared values. */
  tree?: EditorNode;
  parentComputed?: CSSStyleDeclaration;
  parentNode?: RNode;
  /** Whether every selected layer takes style edits. */
  stylable: boolean;
  /** The primary layer comes from inside a component instance. */
  insideInstance: boolean;
  /** File the primary layer's source lives in, when it isn't the page's own. */
  sharedFile?: string;
  mode: 'tailwind' | 'inline';
  /** A computed property shared by all selected layers, or MIXED. */
  value(prop: string): FieldValue;
  /** The same as a number of pixels, where it is one. */
  number(prop: string): number | typeof MIXED | undefined;
  isText: boolean;
  isContainer: boolean;
  isFlex: boolean;
  isGrid: boolean;
  isAbsolute: boolean;
  parentFlex: boolean;
  parentRow: boolean;
  /** The primary layer's offset inside its parent's padding box, for switching to absolute position. */
  primaryOffset?: { x: number; y: number };
}

export function useInspect(): Inspected | undefined {
  const tick = useLayoutTick();
  const selection = useEditor((s) => s.selection);
  const frame = useEditor((s) => s.activeFrame);
  const doc = useEditor((s) => s.doc);
  const scope = useEditor((s) => s.scope);
  return useMemo(() => {
    const state = get();
    const nodes = selection.map((key) => findRender(state, key)?.node).filter((n): n is RNode => !!n);
    if (!nodes.length) return;
    const primary = nodes[0];
    const computed = nodes.map((n) => snapshot(computedOf(frame, n.key)));
    const index = activeIndex(state);
    const parentKey = index ? parentOf(index, primary.key) : undefined;
    const parentNode = parentKey ? index!.byKey.get(parentKey) : undefined;
    const parentComputed = parentKey ? snapshot(computedOf(frame, parentKey)) : undefined;
    const tree = primary.source ? locate(state.doc, state.config, primary.source)?.node : undefined;
    const page = currentPage(state);
    const value = (prop: string): FieldValue => {
      const values = computed.map((c) => (c ? c.getPropertyValue(prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)) : undefined));
      return values.every((v) => v === values[0]) ? values[0] : MIXED;
    };
    const number = (prop: string) => {
      const v = value(prop);
      if (v === MIXED) return MIXED;
      const n = typeof v === 'string' ? parseFloat(v) : undefined;
      return n !== undefined && Number.isFinite(n) ? n : undefined;
    };
    const c = computed[0];
    const display = c?.display ?? '';
    const insideInstance = !!index && !!instanceScope(index, index.parent.get(primary.key)?.key) && primary.kind !== 'instance';
    const sourceFile = primary.source?.file;
    const rect = localRect(frame, primary.key);
    const parentRect = parentKey ? localRect(frame, parentKey) : undefined;
    const primaryOffset =
      rect && parentRect
        ? {
            x: rect.x - parentRect.x - (parseFloat(parentComputed?.borderLeftWidth ?? '0') || 0),
            y: rect.y - parentRect.y - (parseFloat(parentComputed?.borderTopWidth ?? '0') || 0),
          }
        : undefined;
    void scope;
    void tick;
    void doc;
    return {
      nodes,
      primary,
      frame,
      computed,
      tree,
      parentComputed,
      parentNode,
      stylable: nodes.every((n) => !!styleTarget(n, state) && !n.locked),
      insideInstance,
      sharedFile: sourceFile && page && sourceFile !== page.file && !insideInstance ? sourceFile : insideInstance ? (primary.source?.file ?? componentOf(primary)?.file) : undefined,
      mode: styleMode(state),
      value,
      number,
      isText: nodes.every((n) => n.kind === 'text' || n.text !== undefined),
      isContainer: nodes.every((n) => n.kind === 'element' && n.text === undefined && !/^(img|input|hr|br|video|svg)$/.test(n.tag)),
      isFlex: /flex/.test(display),
      isGrid: /grid/.test(display),
      isAbsolute: /absolute|fixed/.test(c?.position ?? ''),
      parentFlex: /flex/.test(parentComputed?.display ?? ''),
      parentRow: (parentComputed?.flexDirection ?? '').startsWith('row'),
      primaryOffset,
    } satisfies Inspected;
  }, [selection, frame, doc, scope, tick]);
}

/** A frozen copy of a computed style, so later reads in a render don't see layout changes halfway. */
function snapshot(style: CSSStyleDeclaration | undefined): CSSStyleDeclaration | undefined {
  if (!style) return;
  const copy: Record<string, string> = {};
  for (let i = 0; i < style.length; i++) {
    const name = style[i];
    copy[name] = style.getPropertyValue(name);
  }
  return new Proxy(copy, {
    get(target, prop) {
      if (prop === 'getPropertyValue') return (name: string) => target[name] ?? '';
      if (typeof prop === 'string') return target[prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)] ?? '';
      return undefined;
    },
  }) as unknown as CSSStyleDeclaration;
}

/** Fixed, Hug, or Fill for a dimension, from declared values and the parent's layout, as Figma shows it. */
export function sizingMode(info: Inspected, axis: 'width' | 'height'): 'fixed' | 'hug' | 'fill' {
  const tree = info.tree;
  const c = info.computed[0];
  const declared = tree?.style[axis];
  const classes = tree?.attrs.className ?? '';
  const mainAxis = info.parentFlex && (axis === 'width') === info.parentRow;
  if (mainAxis && Number(c?.flexGrow) > 0) return 'fill';
  if (info.parentFlex && !mainAxis && (c?.alignSelf === 'stretch' || (c?.alignSelf === 'auto' && info.parentComputed?.alignItems === 'stretch' && declared === undefined && !new RegExp(`(^|\\s)${axis === 'width' ? 'w' : 'h'}-`).test(classes)))) return 'fill';
  if (declared === '100%' || new RegExp(`(^|\\s)${axis === 'width' ? 'w' : 'h'}-full(\\s|$)`).test(classes)) return 'fill';
  if (typeof declared === 'number' || (typeof declared === 'string' && /px$/.test(declared))) return 'fixed';
  if (new RegExp(`(^|\\s)${axis === 'width' ? 'w' : 'h'}-(\\d|\\[|px)`).test(classes)) return 'fixed';
  if (axis === 'width' && !info.parentFlex && /^(block|flex|grid)$/.test(c?.display ?? '') && !info.isAbsolute && declared === undefined) return 'fill';
  return 'hug';
}

/** Style edits that set a dimension's sizing mode. */
export function sizingChange(info: Inspected, axis: 'width' | 'height', mode: 'fixed' | 'hug' | 'fill', current: number): Record<string, string | number | null> {
  const mainAxis = info.parentFlex && (axis === 'width') === info.parentRow;
  if (mode === 'fixed') return { [axis]: Math.round(current), ...(mainAxis ? { flexGrow: null, flexShrink: 0, flex: null } : {}) };
  if (mode === 'hug')
    return { [axis]: info.parentFlex || info.isAbsolute ? null : 'fit-content', ...(mainAxis ? { flexGrow: null, flex: null } : {}), ...(!mainAxis && info.parentFlex ? { alignSelf: null } : {}) };
  if (mainAxis) return { [axis]: null, flex: '1 1 0%' };
  if (info.parentFlex) return { [axis]: null, alignSelf: 'stretch' };
  return { [axis]: '100%' };
}
