/*
 * The live DOM behind each canvas frame.
 *
 * Every FrameView registers its iframe and the elements it rendered, by render
 * key. The overlay measures layers through here, and pointer handling hit-tests
 * through here. `layout` is a counter that frames bump whenever their content
 * may have moved, such as after a render, an image load, or a font swap, so the
 * overlay knows to measure again.
 */

import { useSyncExternalStore } from 'react';
import type { RNode } from '../core/render';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FrameHandle {
  id: string;
  iframe: HTMLIFrameElement;
  doc: Document;
  elements: Map<string, Element>;
  /** Render nodes by key, for measuring layers without boxes of their own. */
  nodes: Map<string, RNode>;
}

export const frameHandles = new Map<string, FrameHandle>();

let tick = 0;
const listeners = new Set<() => void>();
let scheduled = false;
/** Tells the overlay to measure again on the next animation frame. */
export function bumpLayout() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    tick++;
    listeners.forEach((listener) => listener());
  });
}
export function useLayoutTick() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => tick,
  );
}

export function union(rects: (Rect | undefined)[]): Rect | undefined {
  const list = rects.filter((r): r is Rect => !!r && (r.width > 0 || r.height > 0));
  if (!list.length) return;
  const x = Math.min(...list.map((r) => r.x));
  const y = Math.min(...list.map((r) => r.y));
  const right = Math.max(...list.map((r) => r.x + r.width));
  const bottom = Math.max(...list.map((r) => r.y + r.height));
  return { x, y, width: right - x, height: bottom - y };
}

export const intersects = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

export const containsPoint = (r: Rect, x: number, y: number) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;

/**
 * A layer's box inside its frame, in CSS pixels. Layers without a box of their
 * own, such as instances and `display: contents` groups, measure as the union
 * of their children.
 */
export function localRect(frameId: string, key: string): Rect | undefined {
  const handle = frameHandles.get(frameId);
  if (!handle) return;
  const element = handle.elements.get(key);
  if (element?.isConnected) {
    const box = element.getBoundingClientRect();
    const display = handle.doc.defaultView?.getComputedStyle(element).display;
    if (display !== 'contents' && (box.width > 0 || box.height > 0 || element.tagName === 'HR')) {
      return { x: box.left, y: box.top, width: box.width, height: box.height };
    }
  }
  const node = handle.nodes.get(key);
  if (!node) return;
  return union(node.children.map((child) => localRect(frameId, child.key)));
}

/** The DOM element for a layer, if it has one. */
export function elementOf(frameId: string, key: string): HTMLElement | undefined {
  const element = frameHandles.get(frameId)?.elements.get(key);
  return element?.isConnected ? (element as HTMLElement) : undefined;
}

/** Computed style of a layer's element, or of its first child element for boxless layers. */
export function computedOf(frameId: string, key: string): CSSStyleDeclaration | undefined {
  const handle = frameHandles.get(frameId);
  let element = handle?.elements.get(key);
  if (!element) {
    const node = handle?.nodes.get(key);
    const first = node?.children.find((child) => handle?.elements.has(child.key));
    element = first ? handle?.elements.get(first.key) : undefined;
  }
  return element?.isConnected ? handle!.doc.defaultView!.getComputedStyle(element) : undefined;
}

/**
 * The render keys under a point in a frame, topmost first. Coordinates are CSS
 * pixels inside the frame.
 */
export function keysAt(frameId: string, x: number, y: number, skip?: Set<string>): string[] {
  const handle = frameHandles.get(frameId);
  if (!handle) return [];
  const keys: string[] = [];
  for (const element of handle.doc.elementsFromPoint(x, y)) {
    const owner = element.closest('[data-fkey]');
    const key = owner?.getAttribute('data-fkey');
    if (key && !keys.includes(key) && !(skip && [...skip].some((s) => key === s || key.startsWith(`${s}/`)))) keys.push(key);
  }
  return keys;
}
