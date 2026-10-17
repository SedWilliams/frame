/*
 * The canvas.
 *
 * An infinite, pannable, zoomable surface holding the page's frames. Pointer
 * input lands here, because frames ignore the pointer in design mode, and turns
 * into selection and gestures:
 *
 * - Click selects by Figma's rules, Shift-click adds, Cmd-click selects deep.
 * - Dragging an absolutely positioned layer moves it freely, with smart guides.
 *   Dragging a layer in flow reorders it, or moves it into another container,
 *   with an insertion line showing where it lands. Alt-drag duplicates first.
 * - Dragging on the page background draws a marquee.
 * - Drawing tools drag out a new layer. In a flex or grid container it joins the
 *   flow; anywhere else it's placed absolutely where you drew it.
 * - Space-drag, the hand tool, the middle button, and the trackpad pan.
 *   Cmd-scroll and pinch zoom around the pointer.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createNode, createVector, uid, type InsertType } from '../core/model';
import type { RNode } from '../core/render';
import * as edit from '../app/edit';
import {
  activeIndex,
  COMPONENTS_PAGE,
  commit,
  currentView,
  frameTarget,
  get,
  renderTarget,
  select,
  set,
  toast,
  updateView,
  useEditor,
  workspace,
  type CanvasFrame,
} from '../app/state';
import { canDropInto, insertComponent, insertElement, moveLayers, pageRoot, pointIn, selectedNodes, setText, structural, styleMode, styleTarget, targetAt } from '../app/actions';
import { handleShortcut } from '../app/commands';
import { childrenOf, editableText, instanceScope, isInside, keysFor, parentOf, selectable } from '../app/selection';
import { computedOf, elementOf, frameHandles, keysAt, localRect, union, intersects, type Rect } from './registry';
import { gesture, guideLines, normalize, previewStyles, resetGesture, simplify, snapRect, type Line } from './gestures';
import { FrameView } from './FrameView';
import { Overlay } from './Overlay';
import { Rulers } from './Rulers';

let viewport: HTMLDivElement | null = null;
const DRAG_THRESHOLD = 3;

/* Coordinates. Screen points are viewport-relative from here on. */

function viewportRect() {
  return viewport?.getBoundingClientRect() ?? new DOMRect();
}

/** A frame's iframe box in viewport coordinates. */
export function frameScreenRect(frameId: string): Rect | undefined {
  const iframe = frameHandles.get(frameId)?.iframe;
  if (!iframe) return;
  const r = iframe.getBoundingClientRect();
  const v = viewportRect();
  return { x: r.left - v.left, y: r.top - v.top, width: r.width, height: r.height };
}

/** A layer's box in viewport coordinates. */
export function screenRect(frameId: string, key: string): Rect | undefined {
  const frame = frameScreenRect(frameId);
  const local = localRect(frameId, key);
  const zoom = currentView()?.zoom || 1;
  if (!frame || !local) return;
  return { x: frame.x + local.x * zoom, y: frame.y + local.y * zoom, width: local.width * zoom, height: local.height * zoom };
}

/** The frame under a viewport point, and the point in that frame's CSS pixels. */
function frameAt(x: number, y: number): { frame: CanvasFrame; lx: number; ly: number } | undefined {
  const view = currentView();
  const zoom = view?.zoom || 1;
  for (const frame of view?.frames ?? []) {
    const r = frameScreenRect(frame.id);
    if (r && x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height)
      return { frame, lx: (x - r.x) / zoom, ly: (y - r.y) / zoom };
  }
}

function toWorld(x: number, y: number) {
  const view = currentView()!;
  return { x: (x - view.panX) / view.zoom, y: (y - view.panY) / view.zoom };
}

/* Zoom. */

export function zoomAround(zoom: number, anchor?: { x: number; y: number }) {
  const view = currentView();
  if (!view) return;
  const next = Math.min(256, Math.max(0.02, zoom));
  const v = viewportRect();
  const a = anchor ?? { x: v.width / 2, y: v.height / 2 };
  updateView((current) => ({
    ...current,
    zoom: next,
    panX: a.x - ((a.x - current.panX) / current.zoom) * next,
    panY: a.y - ((a.y - current.panY) / current.zoom) * next,
  }));
}

export function zoomBy(factor: number) {
  zoomAround((currentView()?.zoom || 1) * factor);
}

/** Fits a box in world coordinates into the viewport. */
function fitWorld(box: Rect, padding = 64, maxZoom = 1) {
  const v = viewportRect();
  if (!v.width || !box.width) return;
  const zoom = Math.min(maxZoom, (v.width - padding * 2) / box.width, (v.height - padding * 2) / Math.max(1, box.height));
  updateView((view) => ({
    ...view,
    zoom,
    panX: (v.width - box.width * zoom) / 2 - box.x * zoom,
    panY: Math.max(padding, (v.height - box.height * zoom) / 2) - box.y * zoom,
  }));
}

/** World box of every frame, measured from the DOM. */
function framesBox(): Rect | undefined {
  const view = currentView();
  if (!view) return;
  const rects = view.frames.map((f) => frameScreenRect(f.id)).filter((r): r is Rect => !!r);
  const box = union(rects);
  if (!box) return;
  const a = toWorld(box.x, box.y);
  return { x: a.x, y: a.y, width: box.width / view.zoom, height: box.height / view.zoom };
}

export function zoomToFit() {
  const box = framesBox();
  if (box) fitWorld(box, 48, 1);
}

export function zoomToSelection() {
  const state = get();
  const rects = state.selection.map((key) => screenRect(state.activeFrame, key));
  const box = union(rects);
  if (!box) return zoomToFit();
  const a = toWorld(box.x, box.y);
  const zoom = currentView()!.zoom;
  fitWorld({ x: a.x, y: a.y, width: box.width / zoom, height: box.height / zoom }, 96, 8);
}

/** Starting view: frames side by side, fit to the viewport's width, tops aligned. */
function initialFit(frames: CanvasFrame[]) {
  const v = viewportRect();
  if (!v.width || !frames.length) return;
  // Components wrap in rows, so their positions come from layout, not the view.
  const flowed = [...(viewport?.querySelectorAll<HTMLElement>('.canvas-world.flow > .frame') ?? [])];
  const boxes = flowed.length ? flowed.map((el) => ({ x: el.offsetLeft, width: el.offsetWidth })) : frames;
  const left = Math.min(...boxes.map((f) => f.x));
  const right = Math.max(...boxes.map((f) => f.x + f.width));
  const width = right - left;
  const zoom = Math.min(1, Math.max(0.05, (v.width - 160) / width));
  updateView((view) => ({ ...view, zoom, panX: (v.width - width * zoom) / 2 - left * zoom, panY: 72 }));
}

/* Pages and frames. */

/** Frame presets, as Figma offers when you pick the frame tool. */
export const framePresets = [
  { name: 'Desktop', width: 1440, height: 1024 },
  { name: 'Laptop', width: 1280, height: 800 },
  { name: 'Tablet', width: 768, height: 1024 },
  { name: 'Mobile', width: 390, height: 844 },
];

/** Adds a frame showing the page at another width, to the right of the others. */
export function addFrame(preset: { name: string; width: number; height: number }) {
  updateView((view) => {
    const right = Math.max(0, ...view.frames.map((f) => f.x + f.width));
    const frame: CanvasFrame = { id: `f-${uid()}`, name: preset.name, width: preset.width, height: preset.height, x: view.frames.length ? right + 120 : 0, y: 0 };
    return { ...view, frames: [...view.frames, frame] };
  });
}

/** Lays out every component in a frame of its own, for the Components page. */
export function componentFrames(): CanvasFrame[] {
  const ws = workspace();
  return ws.components().map((entry) => {
    const wide = /nav|header|footer|hero|section|layout|page|banner|sidebar|shell|navbar|cta/i.test(entry.name);
    return {
      id: `c:${entry.id}`,
      name: entry.name,
      width: wide ? 1280 : 480,
      height: 800,
      x: 0,
      y: 0,
      componentId: entry.id,
      target: { kind: 'component' as const, file: entry.file, exportName: entry.exportName ?? entry.name, route: '/', props: ws.sampleProps(entry) },
    };
  });
}

export function openPage(pageId: string) {
  const state = get();
  if (state.pageId === pageId && state.views[pageId]) return;
  const views = { ...state.views };
  if (!views[pageId]) {
    const frames = pageId === COMPONENTS_PAGE ? componentFrames() : (currentView(state)?.frames.filter((f) => !f.target).map((f) => ({ ...f })) ?? undefined);
    views[pageId] = { frames: frames?.length || pageId === COMPONENTS_PAGE ? frames! : [{ id: 'desktop', name: 'Desktop', width: 1280, height: 800, x: 0, y: 0 }], zoom: 0, panX: 0, panY: 0, guides: [] };
  }
  set({ pageId, views, selection: [], hover: null, scope: null, editingText: null, activeFrame: views[pageId].frames[0]?.id ?? '' });
}

/* The component. */

export function Canvas() {
  const ref = useRef<HTMLDivElement>(null);
  const pageId = useEditor((s) => s.pageId);
  const view = useEditor((s) => s.views[s.pageId]);
  const tool = useEditor((s) => s.tool);
  const rulers = useEditor((s) => s.ui.rulers);
  const editing = useEditor((s) => s.editingText);
  const [space, setSpace] = useState(false);
  const spaceRef = useRef(false);
  const gestureActive = useRef(false);

  useLayoutEffect(() => {
    viewport = ref.current;
  });

  // First view of a page: fit its frames.
  useLayoutEffect(() => {
    if (view && view.zoom === 0) initialFit(view.frames);
  }, [pageId, view]);

  // Wheel pans; Cmd/Ctrl-wheel and pinch zoom around the pointer.
  useEffect(() => {
    const el = ref.current!;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const view = currentView();
      if (!view) return;
      const v = el.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) {
        const factor = Math.exp(-event.deltaY * (event.ctrlKey && !event.metaKey ? 0.01 : 0.002));
        zoomAround(view.zoom * factor, { x: event.clientX - v.left, y: event.clientY - v.top });
      } else {
        const dx = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX;
        const dy = event.shiftKey && !event.deltaX ? 0 : event.deltaY;
        updateView((current) => ({ ...current, panX: current.panX - dx, panY: current.panY - dy }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Space held: pan with the pointer.
  useEffect(() => {
    const typing = (target: EventTarget | null) => !!(target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable]');
    const down = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !typing(event.target) && !get().editingText) {
        event.preventDefault();
        if (!spaceRef.current) {
          spaceRef.current = true;
          setSpace(true);
        }
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        spaceRef.current = false;
        setSpace(false);
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const local = (event: { clientX: number; clientY: number }) => {
    const v = viewportRect();
    return { x: event.clientX - v.left, y: event.clientY - v.top };
  };

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('[data-overlay-control]')) return;
    if (event.button === 2) return;
    const state = get();
    const point = local(event);
    if (state.editingText) {
      // A click outside the text being edited ends the edit. The blur commits it.
      (frameHandles.get(state.activeFrame)?.doc.activeElement as HTMLElement | null)?.blur();
      set({ editingText: null });
      return;
    }
    gestureActive.current = true;
    if (event.button === 1 || state.tool === 'hand' || spaceRef.current) return startPan(event, point);
    const hit = frameAt(point.x, point.y);
    switch (state.tool) {
      case 'move':
      case 'scale':
        return startSelect(event, point, hit);
      case 'text':
        return startDraw(event, point, hit, 'text');
      case 'pen':
      case 'pencil':
        return startPen(event, point, hit, state.tool);
      case 'comment':
        return startComment(point, hit);
      default:
        return startDraw(event, point, hit, state.tool);
    }
  }, []);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (gestureActive.current) return;
    const state = get();
    if (state.tool !== 'move' && state.tool !== 'scale' && state.tool !== 'comment') {
      if (state.hover) set({ hover: null });
      return;
    }
    const point = local(event);
    const hit = frameAt(point.x, point.y);
    let key: string | undefined;
    if (hit) {
      const keys = keysAt(hit.frame.id, hit.lx, hit.ly);
      key = state.tool === 'comment' ? keys[0] : withFrame(hit.frame.id, () => targetAt(keys[0], event.metaKey || event.ctrlKey));
    }
    if ((key ?? null) !== state.hover) set({ hover: key ?? null });
  }, []);

  const onDoubleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const state = get();
    if (state.tool !== 'move' || (event.target as HTMLElement).closest('[data-overlay-control]')) return;
    const point = local(event);
    const hit = frameAt(point.x, point.y);
    if (!hit) return;
    const keys = keysAt(hit.frame.id, hit.lx, hit.ly);
    const index = activeIndex(get());
    if (!index) return;
    const target = targetAt(keys[0], false);
    const node = target ? index.byKey.get(target) : undefined;
    if (node?.kind === 'instance') {
      // Enter the instance: the next level down under the pointer.
      set({ scope: node.key });
      const deeper = targetAt(keys[0], false);
      if (deeper) select([deeper], hit.frame.id);
      return;
    }
    if (node && editableText(node) && !node.locked) {
      select([node.key], hit.frame.id);
      set({ editingText: node.key });
      return;
    }
    if (node) {
      const child = keys.map((k) => index.byKey.get(k)).find((n) => n && n.key !== node.key && isInside(n.key, node.key) && selectable(n));
      if (child) select([child.key], hit.frame.id);
    }
  }, []);

  const onContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const state = get();
    const point = local(event);
    const hit = frameAt(point.x, point.y);
    if (hit) {
      const keys = keysAt(hit.frame.id, hit.lx, hit.ly);
      const target = withFrame(hit.frame.id, () => targetAt(keys[0], event.metaKey || event.ctrlKey));
      if (target && !state.selection.includes(target)) select([target], hit.frame.id);
    }
    set({ menu: { kind: 'context', x: event.clientX, y: event.clientY } });
  }, []);

  const onEditDone = useCallback((key: string, text: string | null) => {
    if (text !== null) setText(key, text);
    if (get().editingText === key) set({ editingText: null });
  }, []);

  /** Runs `fn` with `frame` as the active frame, so selection rules read that frame's render. */
  function withFrame<T>(frame: string, fn: () => T): T {
    if (get().activeFrame !== frame) set({ activeFrame: frame });
    return fn();
  }

  /* Gestures. Each follows the pointer on window until release. */

  function follow(onMove: (event: PointerEvent) => void, onUp: (event: PointerEvent) => void) {
    const move = (event: PointerEvent) => onMove(event);
    const up = (event: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      gestureActive.current = false;
      onUp(event);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  function startPan(event: ReactPointerEvent, point: { x: number; y: number }) {
    const view = currentView()!;
    const start = { x: point.x, y: point.y, panX: view.panX, panY: view.panY };
    gesture.set({ kind: 'pan' });
    follow(
      (e) => {
        const p = local(e);
        updateView((v) => ({ ...v, panX: start.panX + p.x - start.x, panY: start.panY + p.y - start.y }));
      },
      () => resetGesture(),
    );
    event.preventDefault();
  }

  function startSelect(event: ReactPointerEvent, point: { x: number; y: number }, hit: ReturnType<typeof frameAt>) {
    const state = get();
    if (!hit) {
      // Empty canvas: deselect, and a drag draws a marquee over frames.
      if (!event.shiftKey) select([]);
      set({ scope: null });
      return startMarquee(point, undefined, undefined, event.shiftKey);
    }
    const frameId = hit.frame.id;
    if (state.activeFrame !== frameId) set({ activeFrame: frameId });
    const keys = keysAt(frameId, hit.lx, hit.ly);
    const deep = event.metaKey || event.ctrlKey;
    const index = activeIndex(get())!;
    // Leaving an entered instance resets the scope.
    if (state.scope && !keys.some((k) => isInside(k, state.scope!))) set({ scope: null });
    const target = targetAt(keys[0], deep);
    const node = target ? index.byKey.get(target) : undefined;
    // Dragging on the page's outermost layers draws a marquee, as dragging on a top-level frame does in Figma.
    const isRoot = !node || node.tag === 'body' || node.tag === 'html' || !parentOf(index, node.key) || node.key === pageRoot(get())?.key;
    if (event.shiftKey && target) {
      const selection = state.selection.includes(target) ? state.selection.filter((k) => k !== target) : [...state.selection, target];
      select(selection, frameId);
      return;
    }
    if (target && !state.selection.includes(target)) {
      select([target], frameId);
      set({ scope: instanceScope(index, index.parent.get(target)?.key) ?? (state.scope && isInside(target, state.scope) ? state.scope : null) });
    }
    if (!target) select([], frameId);
    const start = point;
    let started = false;
    follow(
      (e) => {
        const p = local(e);
        if (!started && Math.hypot(p.x - start.x, p.y - start.y) < DRAG_THRESHOLD) return;
        if (!started) {
          started = true;
          if (isRoot || deep && !target) startMarquee(start, frameId, node?.key, false, p);
          else if (target) startMove(start, frameId, e.altKey, p);
        }
      },
      () => {
        if (!started && target && get().selection.length > 1 && get().selection.includes(target) && !event.shiftKey) select([target], frameId);
      },
    );
  }

  function startMarquee(start: { x: number; y: number }, frameId?: string, containerKey?: string, additive = false, first?: { x: number; y: number }) {
    gestureActive.current = true;
    const base = additive ? get().selection : [];
    const update = (p: { x: number; y: number }) => {
      const rect = normalize(start.x, start.y, p.x, p.y);
      gesture.set({ kind: 'marquee', marquee: rect });
      if (!frameId) return;
      const index = activeIndex(get());
      if (!index) return;
      const candidates = childrenOf(index, containerKey, [...index.byKey.values()].filter((n) => !index.parent.get(n.key)));
      const picked = candidates.filter((n) => {
        const r = screenRect(frameId, n.key);
        return r && intersects(r, rect);
      });
      const keys = [...new Set([...base, ...picked.map((n) => n.key)])];
      const current = get().selection;
      if (keys.length !== current.length || keys.some((k, i) => k !== current[i])) select(keys, frameId);
    };
    if (first) update(first);
    follow(
      (e) => update(local(e)),
      () => resetGesture(),
    );
  }

  function startMove(start: { x: number; y: number }, frameId: string, duplicate: boolean, first: { x: number; y: number }) {
    let state = get();
    let nodes = selectedNodes(state).filter((n) => structural(n) || n.kind !== 'instance');
    if (!nodes.length || nodes.some((n) => n.locked)) return;
    if (duplicate && nodes.every(structural)) {
      const sources = nodes.map((n) => n.source!);
      let copies: edit.Target[] = [];
      commit('duplicate', (doc) => {
        const result = edit.duplicateTargets(doc, state.config, sources);
        copies = result.copies;
        return result.doc;
      }, { merge: false });
      const index = activeIndex(get());
      if (index) select(keysFor(index, copies, nodes[0].key), frameId);
      state = get();
      nodes = selectedNodes(state);
    }
    const zoom = currentView()!.zoom;
    const free = nodes.every((n) => /absolute|fixed/.test(computedOf(frameId, n.key)?.position ?? ''));
    if (free) return startFreeMove(start, frameId, nodes, zoom, first);
    if (!nodes.every(structural)) {
      toast(nodes.some((n) => n.repeated) ? 'This layer repeats for each item in a list, so it moves with its list.' : 'This layer can only move in code.', 'error');
      return;
    }
    startFlowMove(start, frameId, nodes, first);
  }

  function startFreeMove(start: { x: number; y: number }, frameId: string, nodes: RNode[], zoom: number, first: { x: number; y: number }) {
    const index = activeIndex(get())!;
    const rects = nodes.map((n) => localRect(frameId, n.key)!);
    const box = union(rects)!;
    const parentKey = parentOf(index, nodes[0].key);
    const siblings = parentKey ? childrenOf(index, parentKey).filter((n) => !nodes.includes(n)) : [];
    const targets = [...siblings.map((n) => localRect(frameId, n.key)), parentKey ? localRect(frameId, parentKey) : undefined].filter((r): r is Rect => !!r);
    const previews = nodes.flatMap((n) => {
      const el = elementOf(frameId, n.key);
      return el ? [previewStyles(el)] : [];
    });
    let delta = { x: 0, y: 0 };
    const move = (p: { x: number; y: number }, shift: boolean, noSnap: boolean) => {
      let dx = (p.x - start.x) / zoom;
      let dy = (p.y - start.y) / zoom;
      if (shift) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
      const moved = { ...box, x: box.x + dx, y: box.y + dy };
      const snapping = get().prefs.snapping && !noSnap;
      const snap = snapping ? snapRect(moved, targets, 6 / zoom) : { dx: 0, dy: 0, x: undefined, y: undefined };
      dx += snap.dx;
      dy += snap.dy;
      delta = { x: dx, y: dy };
      previews.forEach((preview) => preview.set('translate', `${dx}px ${dy}px`));
      const finalBox = { ...box, x: box.x + dx, y: box.y + dy };
      const frame = frameScreenRect(frameId)!;
      const toScreen = (l: Line): Line => ({ x1: frame.x + l.x1 * zoom, y1: frame.y + l.y1 * zoom, x2: frame.x + l.x2 * zoom, y2: frame.y + l.y2 * zoom });
      gesture.set({
        kind: 'move',
        guides: guideLines(finalBox, targets, snap.x, snap.y).map(toScreen),
        size: { x: frame.x + (finalBox.x + finalBox.width / 2) * zoom, y: frame.y + (finalBox.y + finalBox.height) * zoom + 18, text: `${Math.round(finalBox.x - (parentKey ? localRect(frameId, parentKey)?.x ?? 0 : 0))}, ${Math.round(finalBox.y - (parentKey ? localRect(frameId, parentKey)?.y ?? 0 : 0))}` },
      });
    };
    move(first, false, false);
    follow(
      (e) => move(local(e), e.shiftKey, e.ctrlKey),
      () => {
        previews.forEach((preview) => preview.restore());
        resetGesture();
        if (!delta.x && !delta.y) return;
        const state = get();
        commit('move', (doc) => {
          nodes.forEach((node) => {
            const target = styleTarget(node, state);
            const computed = computedOf(frameId, node.key);
            if (!target || !computed) return;
            const tree = edit.locate(doc, state.config, target)?.node;
            const declared = { ...(tree?.style ?? {}) };
            const classes = tree?.attrs.className ?? '';
            const usesRight = ('right' in declared || /(^|\s)-?right-/.test(classes)) && !('left' in declared || /(^|\s)-?left-/.test(classes));
            const usesBottom = ('bottom' in declared || /(^|\s)-?bottom-/.test(classes)) && !('top' in declared || /(^|\s)-?top-/.test(classes));
            const change: edit.StyleChange = {};
            if (delta.x) {
              if (usesRight) change.right = Math.round((parseFloat(computed.right) || 0) - delta.x);
              else change.left = Math.round((parseFloat(computed.left) || 0) + delta.x);
            }
            if (delta.y) {
              if (usesBottom) change.bottom = Math.round((parseFloat(computed.bottom) || 0) - delta.y);
              else change.top = Math.round((parseFloat(computed.top) || 0) + delta.y);
            }
            doc = edit.applyStyle(doc, state.config, target, change, styleMode(state, Object.keys(change)));
          });
          return doc;
        }, { merge: false });
      },
    );
  }

  function startFlowMove(start: { x: number; y: number }, frameId: string, nodes: RNode[], first: { x: number; y: number }) {
    const keys = nodes.map((n) => n.key);
    const skip = new Set(keys);
    const startRect = union(nodes.map((n) => screenRect(frameId, n.key)));
    let drop: ReturnType<typeof findDrop>;
    const move = (p: { x: number; y: number }) => {
      const ghost = startRect ? { ...startRect, x: startRect.x + p.x - start.x, y: startRect.y + p.y - start.y } : undefined;
      drop = findDrop(p, frameId, keys, skip);
      gesture.set({ kind: 'move', ghost, drop: drop?.line, dropBox: drop?.box });
    };
    move(first);
    follow(
      (e) => move(local(e)),
      () => {
        resetGesture();
        if (drop) moveLayers(keys, drop.parent, drop.index);
      },
    );
  }

  function startDraw(event: ReactPointerEvent, start: { x: number; y: number }, hit: ReturnType<typeof frameAt>, tool: string) {
    const zoom = currentView()!.zoom;
    if (!hit) {
      // Outside any frame, the frame tool adds a frame to the page: a new viewport size.
      if (tool !== 'frame' || get().pageId === COMPONENTS_PAGE) return;
      follow(
        (e) => {
          const p = local(e);
          gesture.set({ kind: 'draw', draw: normalize(start.x, start.y, p.x, p.y) });
        },
        (e) => {
          resetGesture();
          const p = local(e);
          const a = toWorld(Math.min(start.x, p.x), Math.min(start.y, p.y));
          const width = Math.round(Math.max(320, Math.abs(p.x - start.x) / zoom));
          const height = Math.round(Math.max(480, Math.abs(p.y - start.y) / zoom));
          updateView((view) => ({ ...view, frames: [...view.frames, { id: `f-${uid()}`, name: `${width} × ${height}`, width, height, x: Math.round(a.x), y: Math.round(a.y) }] }));
          set({ tool: 'move' });
        },
      );
      return;
    }
    const frameId = hit.frame.id;
    set({ activeFrame: frameId });
    const keys = keysAt(frameId, hit.lx, hit.ly);
    const container = containerAt(keys);
    if (!container) {
      toast('Draw inside a layer that can hold children.', 'error');
      return;
    }
    const type: InsertType = tool === 'text' ? 'text' : tool === 'frame' || tool === 'section' ? (tool === 'section' ? 'section' : 'frame') : (tool as InsertType);
    let end = start;
    follow(
      (e) => {
        let p = local(e);
        if (e.shiftKey) {
          const size = Math.max(Math.abs(p.x - start.x), Math.abs(p.y - start.y));
          p = { x: start.x + Math.sign(p.x - start.x || 1) * size, y: start.y + Math.sign(p.y - start.y || 1) * size };
        }
        end = p;
        const rect = normalize(start.x, start.y, p.x, p.y);
        gesture.set({ kind: 'draw', draw: rect, ellipse: tool === 'ellipse', size: { x: rect.x + rect.width / 2, y: rect.y + rect.height + 18, text: `${Math.round(rect.width / zoom)} × ${Math.round(rect.height / zoom)}` } });
      },
      () => {
        resetGesture();
        const rect = normalize(start.x, start.y, end.x, end.y);
        const sized = rect.width > 2 && rect.height > 2 ? { width: rect.width / zoom, height: rect.height / zoom } : undefined;
        const node = createNode(type, sized);
        placeNode(node, container, frameId, { x: rect.x, y: rect.y }, start);
        set({ tool: 'move' });
        if (tool === 'text') {
          const key = get().selection[0];
          if (key) set({ editingText: key });
        }
      },
    );
    event.preventDefault();
  }

  function startPen(event: ReactPointerEvent, start: { x: number; y: number }, hit: ReturnType<typeof frameAt>, tool: 'pen' | 'pencil') {
    if (!hit) return;
    const frameId = hit.frame.id;
    const container = containerAt(keysAt(frameId, hit.lx, hit.ly));
    if (!container) return;
    const points: { x: number; y: number }[] = [start];
    const finish = (closed: boolean) => {
      window.removeEventListener('keydown', onKey);
      resetGesture();
      const path = tool === 'pencil' ? simplify(points, 1.2) : points;
      if (path.length < 2) return;
      const zoom = currentView()!.zoom;
      const box = normalize(Math.min(...path.map((p) => p.x)), Math.min(...path.map((p) => p.y)), Math.max(...path.map((p) => p.x)), Math.max(...path.map((p) => p.y)));
      const d = path.map((p, i) => `${i ? 'L' : 'M'}${round((p.x - box.x) / zoom)} ${round((p.y - box.y) / zoom)}`).join(' ') + (closed ? ' Z' : '');
      const node = createVector(d, box.width / zoom, box.height / zoom, closed);
      placeNode(node, container, frameId, { x: box.x, y: box.y }, undefined, true);
      set({ tool: 'move' });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    };
    if (tool === 'pencil') {
      follow(
        (e) => {
          points.push(local(e));
          gesture.set({ kind: 'pen', pen: [...points] });
        },
        () => finish(false),
      );
      event.preventDefault();
      return;
    }
    // Pen: each click adds a point. Enter, Escape, a double click, or clicking the first point finishes.
    gestureActive.current = false;
    gesture.set({ kind: 'pen', pen: [...points] });
    window.addEventListener('keydown', onKey);
    const el = viewport!;
    const onMove = (e: PointerEvent) => gesture.set({ kind: 'pen', pen: [...points], penCursor: local(e) });
    const onDown = (e: PointerEvent) => {
      e.stopPropagation();
      const p = local(e);
      const closing = Math.hypot(p.x - points[0].x, p.y - points[0].y) < 8 && points.length > 2;
      if (closing || e.detail >= 2) {
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerdown', onDown, true);
        finish(closing);
        return;
      }
      points.push(p);
      gesture.set({ kind: 'pen', pen: [...points] });
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerdown', onDown, true);
  }

  function startComment(point: { x: number; y: number }, hit: ReturnType<typeof frameAt>) {
    gestureActive.current = false;
    if (!hit) return;
    const keys = keysAt(hit.frame.id, hit.lx, hit.ly);
    set({ activeFrame: hit.frame.id });
    const index = activeIndex(get());
    const key = keys.find((k) => selectable(index?.byKey.get(k)));
    if (!key) return;
    const rect = screenRect(hit.frame.id, key);
    if (!rect) return;
    set({ draftComment: { key, frame: hit.frame.id, x: (point.x - rect.x) / Math.max(1, rect.width), y: (point.y - rect.y) / Math.max(1, rect.height) }, openComment: null });
  }

  return (
    <main
      ref={ref}
      className={`canvas tool-${tool}${space ? ' panning' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerLeave={() => get().hover && set({ hover: null })}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onDragOver={(event) => {
        const types = event.dataTransfer.types;
        if (!types.includes('application/frame-component') && !types.includes('application/frame-element')) return;
        event.preventDefault();
        const p = local(event);
        const hit = frameAt(p.x, p.y);
        const drop = hit ? findDrop(p, hit.frame.id, [], new Set()) : undefined;
        gesture.set({ kind: 'move', drop: drop?.line, dropBox: drop?.box });
      }}
      onDragLeave={() => resetGesture()}
      onDrop={(event) => {
        resetGesture();
        const p = local(event);
        const hit = frameAt(p.x, p.y);
        const drop = hit ? findDrop(p, hit.frame.id, [], new Set()) : undefined;
        if (!drop || !hit) return;
        event.preventDefault();
        set({ activeFrame: hit.frame.id });
        const at = pointIn(drop.parent, drop.index);
        const element = event.dataTransfer.getData('application/frame-element');
        const componentId = event.dataTransfer.getData('application/frame-component');
        if (element) insertElement(element as InsertType, at);
        else if (componentId) {
          const entry = workspace().components().find((c) => c.id === componentId);
          if (entry) insertComponent(entry, at);
        }
      }}
      data-testid="canvas"
    >
      {view && (
        <div
          className={`canvas-world${pageId === COMPONENTS_PAGE ? ' flow' : ''}`}
          style={{ transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom || 1})`, visibility: view.zoom ? 'visible' : 'hidden' }}
        >
          {view.frames.map((frame) => (
            <CanvasFrameView key={frame.id} frame={frame} flow={pageId === COMPONENTS_PAGE} editing={editing} onEditDone={onEditDone} />
          ))}
          {pageId === COMPONENTS_PAGE && !view.frames.length && <div className="canvas-empty">No components found yet. Components are capitalized functions that return JSX.</div>}
        </div>
      )}
      <Overlay />
      {rulers && <Rulers />}
    </main>
  );
}

/** A frame with its render and styles, from the store. */
function CanvasFrameView({ frame, flow, editing, onEditDone }: { frame: CanvasFrame; flow: boolean; editing: string | null; onEditDone: (key: string, text: string | null) => void }) {
  const target = useEditor((s) => frameTarget(s, frame));
  const render = useEditor((s) => (target ? renderTarget(s, target) : undefined));
  const styles = useEditor((s) => workspace(s).styles(!!frame.dark));
  const outline = useEditor((s) => s.ui.outline);
  const mountId = useEditor((s) => mountIdOf(s.doc.text['index.html'], workspace(s).framework));
  const active = useEditor((s) => s.activeFrame === frame.id);
  const editingHere = active ? editing : null;
  if (!render) return null;
  return (
    <div className="frame" style={flow ? { width: frame.width } : { left: frame.x, top: frame.y, width: frame.width }} data-frame={frame.id}>
      {render.result.error && <div className="frame-error">{render.result.error}</div>}
      <FrameView
        id={frame.id}
        width={frame.width}
        height={flow ? 120 : frame.height}
        nodes={render.result.nodes}
        styles={styles}
        fonts={render.result.fonts}
        mountId={mountId}
        dark={frame.dark}
        outline={outline}
        editingKey={editingHere}
        onEditDone={onEditDone}
        onKeyDown={forwardKey}
      />
    </div>
  );
}

/** Shortcuts pressed while focus is inside a frame, such as right after editing text. */
function forwardKey(event: KeyboardEvent) {
  const state = get();
  if (state.editingText || state.palette || state.menu || state.presenting) return;
  handleShortcut(event);
}

/** The element id the app mounts into, for apps that render into index.html. */
export function mountIdOf(html: string | undefined, framework: string) {
  if (framework.startsWith('next')) return undefined;
  return /<div\s+id=["']([^"']+)["']/.exec(html ?? '')?.[1] ?? (framework === 'vite' || framework === 'react-router' ? 'root' : undefined);
}

/** The innermost layer under the pointer that can take a new child. */
function containerAt(keys: string[]): RNode | undefined {
  const state = get();
  const index = activeIndex(state);
  if (!index) return;
  for (const key of keys) {
    for (let node: RNode | undefined = index.byKey.get(key); node; node = index.parent.get(node.key)) {
      if (!node.source || node.kind !== 'element') continue;
      const tree = edit.locate(state.doc, state.config, node.source)?.node;
      if (tree && edit.takesChildren(tree) && tree.kind === 'element') return node;
    }
  }
}

/** Where dragged layers would land under a point: a container, an index in its children, and the line to draw. */
function findDrop(p: { x: number; y: number }, frameId: string, dragged: string[], skip: Set<string>) {
  const hit = frameAt(p.x, p.y);
  if (!hit || hit.frame.id !== frameId) return;
  const state = get();
  const index = activeIndex(state);
  if (!index) return;
  const keys = keysAt(frameId, hit.lx, hit.ly, skip);
  let parent: RNode | undefined;
  for (const key of keys) {
    for (let node: RNode | undefined = index.byKey.get(key); node && !parent; node = index.parent.get(node.key))
      if (node.kind === 'element' && !skip.has(node.key) && canDropInto(dragged, node)) parent = node;
    if (parent) break;
  }
  if (!parent) return;
  const box = screenRect(frameId, parent.key);
  if (!box) return;
  const computed = computedOf(frameId, parent.key);
  const row = !!computed && /flex/.test(computed.display) && computed.flexDirection.startsWith('row');
  const children = parent.children
    .map((child, i) => ({ child, i, rect: screenRect(frameId, child.key) }))
    .filter((c) => c.rect && !skip.has(c.child.key) && c.child.kind !== 'text');
  let at = parent.children.length;
  let line: Line;
  const before = children.find((c) => (row ? p.x < c.rect!.x + c.rect!.width / 2 : p.y < c.rect!.y + c.rect!.height / 2));
  if (before) {
    at = before.i;
    const r = before.rect!;
    line = row ? { x1: r.x - 2, y1: r.y, x2: r.x - 2, y2: r.y + r.height } : { x1: r.x, y1: r.y - 2, x2: r.x + r.width, y2: r.y - 2 };
  } else if (children.length) {
    const r = children[children.length - 1].rect!;
    line = row ? { x1: r.x + r.width + 2, y1: r.y, x2: r.x + r.width + 2, y2: r.y + r.height } : { x1: r.x, y1: r.y + r.height + 2, x2: r.x + r.width, y2: r.y + r.height + 2 };
  } else line = { x1: box.x + 4, y1: box.y + box.height / 2, x2: box.x + box.width - 4, y2: box.y + box.height / 2 };
  return { parent, index: at, line, box };
}

/**
 * Puts a newly drawn layer in a container. A flex or grid container takes it in
 * flow, at the index nearest the pointer. Any other container gets it absolutely
 * positioned where it was drawn, and becomes `position: relative` if it was static.
 */
function placeNode(node: ReturnType<typeof createNode>, container: RNode, frameId: string, at: { x: number; y: number }, pointer?: { x: number; y: number }, forceAbsolute = false) {
  const state = get();
  const zoom = currentView()!.zoom;
  const computed = computedOf(frameId, container.key);
  const box = screenRect(frameId, container.key);
  const tree = edit.locate(state.doc, state.config, container.source!)?.node;
  if (!computed || !box || !tree) return;
  const flow = !forceAbsolute && /flex|grid/.test(computed.display);
  let index = tree.children.length;
  if (flow && pointer) {
    const drop = findDrop(pointer, frameId, [], new Set());
    if (drop && drop.parent.key === container.key) {
      const before = container.children[drop.index]?.source?.id;
      const i = before ? tree.children.findIndex((c) => c.id === before) : -1;
      if (i >= 0) index = i;
    }
  }
  if (!flow) {
    const left = Math.round((at.x - box.x) / zoom - (parseFloat(computed.borderLeftWidth) || 0));
    const top = Math.round((at.y - box.y) / zoom - (parseFloat(computed.borderTopWidth) || 0));
    node.style = { position: 'absolute', left, top, ...node.style };
  }
  const mode = styleMode(state, ['position']);
  const changed = commit('insert', (doc) => {
    let next = doc;
    if (!flow && computed.position === 'static') next = edit.applyStyle(next, state.config, container.source!, { position: 'relative' }, mode);
    return edit.insertInto(next, state.config, container.source!, index, node);
  }, { merge: false });
  const indexNow = activeIndex(get());
  if (changed && indexNow) select(keysFor(indexNow, [{ file: container.source!.file, id: node.id }], `${container.key}/x`), frameId);
}

const round = (n: number) => Math.round(n * 10) / 10;

