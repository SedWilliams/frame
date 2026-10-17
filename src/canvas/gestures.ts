/*
 * Gesture feedback and geometry.
 *
 * While a drag is in progress, the canvas writes what the overlay should draw
 * here: smart guides, the marquee, the insertion line for a reorder, the shape
 * being drawn. Keeping it in its own small store means a pointer move redraws
 * the overlay and nothing else.
 */

import { createStore, useStoreSlice } from '../app/store';
import type { Rect } from './registry';

export interface Line {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface GestureView {
  kind: 'none' | 'move' | 'resize' | 'rotate' | 'marquee' | 'draw' | 'pen' | 'pan';
  /** Viewport-relative screen coordinates from here on. */
  marquee?: Rect;
  draw?: Rect;
  ellipse?: boolean;
  guides?: Line[];
  /** Distances shown along guides, such as the gap to a neighbor. */
  labels?: { x: number; y: number; text: string }[];
  drop?: Line;
  dropBox?: Rect;
  ghost?: Rect;
  pen?: { x: number; y: number }[];
  penCursor?: { x: number; y: number };
  size?: { x: number; y: number; text: string };
}

export const gesture = createStore<GestureView>({ kind: 'none' });
export const useGesture = () => useStoreSlice(gesture, (g) => g);
export const resetGesture = () => gesture.set({ kind: 'none', marquee: undefined, draw: undefined, guides: undefined, labels: undefined, drop: undefined, dropBox: undefined, ghost: undefined, pen: undefined, penCursor: undefined, size: undefined, ellipse: undefined });

/**
 * Inline styles that show a gesture live on a frame element. `restore` puts back
 * what was there, which React set from the source and won't set again for
 * properties the committed edit leaves unchanged.
 */
export function previewStyles(el: HTMLElement) {
  const saved = new Map<string, { value: string; priority: string }>();
  return {
    set(prop: string, value: string, priority = '') {
      if (!saved.has(prop)) saved.set(prop, { value: el.style.getPropertyValue(prop), priority: el.style.getPropertyPriority(prop) });
      el.style.setProperty(prop, value, priority);
    },
    restore() {
      for (const [prop, { value, priority }] of saved) {
        if (value) el.style.setProperty(prop, value, priority);
        else el.style.removeProperty(prop);
      }
      saved.clear();
    },
  };
}

export function normalize(x1: number, y1: number, x2: number, y2: number): Rect {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}

/**
 * Snaps a moving box to other boxes' edges and centers. Returns the nudge to
 * apply and the lines it snapped to, all in the same coordinates as the input.
 */
export function snapRect(moving: Rect, targets: Rect[], threshold: number) {
  const xs = [moving.x, moving.x + moving.width / 2, moving.x + moving.width];
  const ys = [moving.y, moving.y + moving.height / 2, moving.y + moving.height];
  let best = { dx: Infinity, x: undefined as number | undefined, dy: Infinity, y: undefined as number | undefined };
  for (const target of targets) {
    const txs = [target.x, target.x + target.width / 2, target.x + target.width];
    const tys = [target.y, target.y + target.height / 2, target.y + target.height];
    for (const a of xs)
      for (const b of txs) {
        const d = b - a;
        if (Math.abs(d) < threshold && Math.abs(d) < Math.abs(best.dx)) best = { ...best, dx: d, x: b };
      }
    for (const a of ys)
      for (const b of tys) {
        const d = b - a;
        if (Math.abs(d) < threshold && Math.abs(d) < Math.abs(best.dy)) best = { ...best, dy: d, y: b };
      }
  }
  return {
    dx: Number.isFinite(best.dx) ? best.dx : 0,
    dy: Number.isFinite(best.dy) ? best.dy : 0,
    x: best.x,
    y: best.y,
  };
}

/** Guide lines through a snapped coordinate, spanning every box that touches it. */
export function guideLines(moved: Rect, targets: Rect[], x?: number, y?: number): Line[] {
  const lines: Line[] = [];
  const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
  if (x !== undefined) {
    const touching = [moved, ...targets.filter((t) => [t.x, t.x + t.width / 2, t.x + t.width].some((v) => near(v, x)))];
    lines.push({ x1: x, x2: x, y1: Math.min(...touching.map((r) => r.y)), y2: Math.max(...touching.map((r) => r.y + r.height)) });
  }
  if (y !== undefined) {
    const touching = [moved, ...targets.filter((t) => [t.y, t.y + t.height / 2, t.y + t.height].some((v) => near(v, y)))];
    lines.push({ y1: y, y2: y, x1: Math.min(...touching.map((r) => r.x)), x2: Math.max(...touching.map((r) => r.x + r.width)) });
  }
  return lines;
}

/** Simplifies a freehand path, dropping points within `tolerance` of the line between their neighbors. */
export function simplify(points: { x: number; y: number }[], tolerance = 1.5): { x: number; y: number }[] {
  if (points.length < 3) return points;
  const [first, last] = [points[0], points[points.length - 1]];
  let index = -1;
  let max = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = distanceToLine(points[i], first, last);
    if (d > max) {
      max = d;
      index = i;
    }
  }
  if (max <= tolerance) return [first, last];
  return [...simplify(points.slice(0, index + 1), tolerance).slice(0, -1), ...simplify(points.slice(index), tolerance)];
}

function distanceToLine(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (!length) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / length;
}

/** Distance lines between two boxes, as Figma shows when you hold Alt. */
export function measureLines(a: Rect, b: Rect): { line: Line; value: number }[] {
  const result: { line: Line; value: number }[] = [];
  const insideX = a.x >= b.x && a.x + a.width <= b.x + b.width;
  const insideY = a.y >= b.y && a.y + a.height <= b.y + b.height;
  const cy = a.y + a.height / 2;
  const cx = a.x + a.width / 2;
  if (insideX && insideY) {
    // A box inside another: distances to each side.
    result.push({ line: { x1: b.x, y1: cy, x2: a.x, y2: cy }, value: a.x - b.x });
    result.push({ line: { x1: a.x + a.width, y1: cy, x2: b.x + b.width, y2: cy }, value: b.x + b.width - a.x - a.width });
    result.push({ line: { x1: cx, y1: b.y, x2: cx, y2: a.y }, value: a.y - b.y });
    result.push({ line: { x1: cx, y1: a.y + a.height, x2: cx, y2: b.y + b.height }, value: b.y + b.height - a.y - a.height });
    return result.filter((r) => r.value > 0.5);
  }
  if (b.x >= a.x + a.width) result.push({ line: { x1: a.x + a.width, y1: cy, x2: b.x, y2: cy }, value: b.x - a.x - a.width });
  else if (a.x >= b.x + b.width) result.push({ line: { x1: b.x + b.width, y1: cy, x2: a.x, y2: cy }, value: a.x - b.x - b.width });
  if (b.y >= a.y + a.height) result.push({ line: { x1: cx, y1: a.y + a.height, x2: cx, y2: b.y }, value: b.y - a.y - a.height });
  else if (a.y >= b.y + b.height) result.push({ line: { x1: cx, y1: b.y + b.height, x2: cx, y2: a.y }, value: a.y - b.y - b.height });
  return result;
}
