/*
 * The canvas overlay.
 *
 * Everything drawn over the frames in screen space, so lines stay one pixel wide
 * at any zoom: frame labels, hover and selection boxes, resize and rotate
 * handles, the size label, smart guides, insertion lines, the marquee, Alt
 * measurements, layout grids, and comment pins. Selections inside components
 * draw in purple, as in Figma.
 */

import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { activeIndex, currentView, findRender, get, select, set, updateView, useEditor, type CanvasFrame } from '../app/state';
import { setStyle, styleTarget } from '../app/actions';
import { instanceScope } from '../app/selection';
import { computedOf, elementOf, localRect, union, useLayoutTick, type Rect } from './registry';
import { gesture, measureLines, previewStyles, resetGesture, snapRect, useGesture } from './gestures';
import { frameScreenRect, screenRect } from './Canvas';
import { CommentLayer } from './CommentLayer';

type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
const handles: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const cursors: Record<Handle, string> = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };

function useAltKey() {
  const [alt, setAlt] = useState(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => e.key === 'Alt' && setAlt(true);
    const up = (e: KeyboardEvent) => e.key === 'Alt' && setAlt(false);
    const blur = () => setAlt(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);
  return alt;
}

export function Overlay() {
  useLayoutTick();
  const view = useEditor((s) => s.views[s.pageId]);
  const selection = useEditor((s) => s.selection);
  const hover = useEditor((s) => s.hover);
  const activeFrame = useEditor((s) => s.activeFrame);
  const editing = useEditor((s) => s.editingText);
  const tool = useEditor((s) => s.tool);
  const frameSelected = useEditor((s) => s.frameSelected);
  const showGrids = useEditor((s) => s.ui.grids);
  useEditor((s) => s.doc);
  const g = useGesture();
  const alt = useAltKey();
  if (!view) return null;
  const zoom = view.zoom || 1;
  const index = activeIndex(get());
  const scope = get().scope;
  const purple = (key: string) => {
    if (!index) return false;
    const node = index.byKey.get(key);
    return node?.kind === 'instance' || !!(instanceScope(index, key) && scope);
  };

  const selectionRects = selection.map((key) => ({ key, rect: screenRect(activeFrame, key) }));
  const box = union(selectionRects.map((s) => s.rect));
  const primary = selection.length ? findRender(get(), selection[0])?.node : undefined;
  const resizable = selection.length === 1 && primary && primary.kind !== 'text' && primary.kind !== 'placeholder' && !!styleTarget(primary) && !primary.locked && !editing && g.kind !== 'move';
  const others = view.frames.filter((f) => f.id !== activeFrame);

  // Alt: distances from the selection to the hovered layer, or to the parent.
  let measures: { line: { x1: number; y1: number; x2: number; y2: number }; value: number }[] = [];
  if (alt && box && g.kind === 'none') {
    const parentKey = index && selection[0] ? index.parent.get(selection[0])?.key : undefined;
    const other = hover && !selection.includes(hover) ? screenRect(activeFrame, hover) : parentKey ? screenRect(activeFrame, parentKey) : undefined;
    if (other) measures = measureLines(box, other);
  }

  return (
    <div className="overlay">
      {view.frames.map((frame) => (
        <FrameLabel key={frame.id} frame={frame} zoom={zoom} active={frame.id === frameSelected} />
      ))}
      {showGrids && view.frames.map((frame) => <LayoutGrids key={`g${frame.id}`} frame={frame} zoom={zoom} />)}
      {hover && !selection.includes(hover) && g.kind === 'none' && tool !== 'comment'
        ? [activeFrame, ...others.map((f) => f.id)].map((frameId) => {
            const rect = screenRect(frameId, hover);
            return rect ? <div key={`h${frameId}`} className={`hover-box${purple(hover) ? ' component' : ''}`} style={box2css(rect)} /> : null;
          })
        : null}
      {tool === 'comment' && hover && (() => {
        const rect = screenRect(activeFrame, hover);
        return rect ? <div className="hover-box comment" style={box2css(rect)} /> : null;
      })()}
      {selectionRects.map(({ key, rect }) =>
        rect ? <div key={`s${key}`} className={`select-box${purple(key) ? ' component' : ''}${editing === key ? ' editing' : ''}`} style={box2css(rect)} /> : null,
      )}
      {/* The same layers in the other frames, more quietly. */}
      {others.flatMap((frame) =>
        selection.map((key) => {
          const rect = screenRect(frame.id, key);
          return rect ? <div key={`o${frame.id}${key}`} className="select-box ghosted" style={box2css(rect)} /> : null;
        }),
      )}
      {box && selection.length > 1 && <div className="select-box group" style={box2css(box)} />}
      {box && !editing && g.kind !== 'move' && g.kind !== 'marquee' && (
        <div className={`size-label${primary && purple(primary.key) ? ' component' : ''}`} style={{ left: box.x + box.width / 2, top: box.y + box.height + 8 }}>
          {sizeText(box, zoom, primary?.key)}
        </div>
      )}
      {resizable && box && (
        <>
          {(['nw', 'ne', 'se', 'sw'] as const).map((corner) => (
            <div
              key={`r${corner}`}
              data-overlay-control
              className="rotate-zone"
              style={{ left: corner.includes('w') ? box.x - 18 : box.x + box.width + 2, top: corner.includes('n') ? box.y - 18 : box.y + box.height + 2 }}
              onPointerDown={(e) => startRotate(e, box)}
            />
          ))}
          {handles.map((handle) => (
            <div
              key={handle}
              data-overlay-control
              data-handle={handle}
              aria-label={`Resize ${handle}`}
              className={`handle handle-${handle}${handle.length === 1 ? ' edge' : ''}${primary && purple(primary.key) ? ' component' : ''}`}
              style={handleStyle(handle, box)}
              onPointerDown={(e) => startResize(e, handle)}
            />
          ))}
        </>
      )}
      {measures.map(({ line, value }, i) => (
        <div key={`m${i}`}>
          <Line line={line} className="measure-line" />
          <div className="measure-label" style={{ left: (line.x1 + line.x2) / 2, top: (line.y1 + line.y2) / 2 }}>
            {Math.round(value / zoom)}
          </div>
        </div>
      ))}
      {g.guides?.map((line, i) => <Line key={`g${i}`} line={line} className="guide-line" />)}
      {g.labels?.map((label, i) => (
        <div key={`l${i}`} className="measure-label" style={{ left: label.x, top: label.y }}>
          {label.text}
        </div>
      ))}
      {g.dropBox && <div className="drop-box" style={box2css(g.dropBox)} />}
      {g.drop && <Line line={g.drop} className="drop-line" />}
      {g.ghost && <div className="ghost-box" style={box2css(g.ghost)} />}
      {g.marquee && <div className="marquee" style={box2css(g.marquee)} />}
      {g.draw && <div className={`draw-box${g.ellipse ? ' ellipse' : ''}`} style={box2css(g.draw)} />}
      {g.pen && (
        <svg className="pen-path">
          <polyline points={[...g.pen, ...(g.penCursor ? [g.penCursor] : [])].map((p) => `${p.x},${p.y}`).join(' ')} />
          {g.pen.map((p, i) => (
            <rect key={i} x={p.x - 3} y={p.y - 3} width={6} height={6} />
          ))}
        </svg>
      )}
      {g.size && (
        <div className="size-label" style={{ left: g.size.x, top: g.size.y - 10 }}>
          {g.size.text}
        </div>
      )}
      <CommentLayer />
    </div>
  );
}

const box2css = (r: Rect) => ({ left: r.x, top: r.y, width: r.width, height: r.height });

function Line({ line, className }: { line: { x1: number; y1: number; x2: number; y2: number }; className: string }) {
  const horizontal = Math.abs(line.y1 - line.y2) < 0.5;
  return (
    <div
      className={className}
      style={
        horizontal
          ? { left: Math.min(line.x1, line.x2), top: line.y1, width: Math.abs(line.x2 - line.x1), height: 0 }
          : { left: line.x1, top: Math.min(line.y1, line.y2), height: Math.abs(line.y2 - line.y1), width: 0 }
      }
    />
  );
}

/** "W × H", or Fill and Hug for layers sized by their layout, as Figma labels them. */
function sizeText(box: Rect, zoom: number, key?: string) {
  const w = Math.round((box.width / zoom) * 100) / 100;
  const h = Math.round((box.height / zoom) * 100) / 100;
  const state = get();
  const computed = key ? computedOf(state.activeFrame, key) : undefined;
  const parent = key ? activeIndex(state)?.parent.get(key) : undefined;
  const parentStyle = parent ? computedOf(state.activeFrame, parent.key) : undefined;
  let wLabel = `${w}`;
  if (computed && parentStyle && /flex/.test(parentStyle.display)) {
    const row = parentStyle.flexDirection.startsWith('row');
    if (row && Number(computed.flexGrow) > 0) wLabel = 'Fill';
    if (!row && computed.alignSelf === 'stretch') wLabel = 'Fill';
  }
  return `${wLabel} × ${h}`;
}

function handleStyle(handle: Handle, box: Rect) {
  const edge = handle.length === 1;
  const x = handle.includes('w') ? box.x : handle.includes('e') ? box.x + box.width : box.x + box.width / 2;
  const y = handle.includes('n') ? box.y : handle.includes('s') ? box.y + box.height : box.y + box.height / 2;
  if (!edge) return { left: x - 4, top: y - 4, cursor: cursors[handle] };
  return handle === 'n' || handle === 's'
    ? { left: box.x + 6, top: y - 4, width: Math.max(0, box.width - 12), height: 8, cursor: cursors[handle] }
    : { left: x - 4, top: box.y + 6, width: 8, height: Math.max(0, box.height - 12), cursor: cursors[handle] };
}

function local(event: { clientX: number; clientY: number }) {
  const canvas = document.querySelector('.canvas')!.getBoundingClientRect();
  return { x: event.clientX - canvas.left, y: event.clientY - canvas.top };
}

function follow(onMove: (e: PointerEvent) => void, onUp: (e: PointerEvent) => void) {
  const up = (e: PointerEvent) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    onUp(e);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

/**
 * Resizes the selected layer from a handle. Shift keeps the aspect ratio and Alt
 * resizes from the center. The size shows live and commits as one edit, with
 * `flex-shrink: 0` in a flex row or column so the new size holds.
 */
function startResize(event: ReactPointerEvent, handle: Handle) {
  event.stopPropagation();
  event.preventDefault();
  const state = get();
  const key = state.selection[0];
  const frameId = state.activeFrame;
  const el = elementOf(frameId, key);
  const rect = localRect(frameId, key);
  const computed = computedOf(frameId, key);
  const zoom = currentView()?.zoom || 1;
  if (!el || !rect || !computed) return;
  const start = local(event);
  const absolute = /absolute|fixed/.test(computed.position);
  const parentKey = activeIndex(state)?.parent.get(key)?.key;
  const parentStyle = parentKey ? computedOf(frameId, parentKey) : undefined;
  const siblings = parentKey ? (activeIndex(state)?.byKey.get(parentKey)?.children ?? []).filter((c) => c.key !== key).map((c) => localRect(frameId, c.key)).filter((r): r is Rect => !!r) : [];
  const parentRect = parentKey ? localRect(frameId, parentKey) : undefined;
  const targets = parentRect ? [...siblings, parentRect] : siblings;
  let next = { ...rect };
  const horizontal = handle.includes('e') || handle.includes('w');
  const vertical = handle.includes('n') || handle.includes('s');
  const borderBox = computed.boxSizing === 'border-box';
  const extraW = borderBox ? 0 : parseFloat(computed.paddingLeft) + parseFloat(computed.paddingRight) + parseFloat(computed.borderLeftWidth) + parseFloat(computed.borderRightWidth);
  const extraH = borderBox ? 0 : parseFloat(computed.paddingTop) + parseFloat(computed.paddingBottom) + parseFloat(computed.borderTopWidth) + parseFloat(computed.borderBottomWidth);
  // Read now: `computed` is live, and the preview overrides max-width.
  const capped = computed.maxWidth !== 'none';
  const preview = previewStyles(el);
  gesture.set({ kind: 'resize' });
  follow(
    (e) => {
      const p = local(e);
      let dx = (p.x - start.x) / zoom;
      let dy = (p.y - start.y) / zoom;
      const factor = e.altKey ? 2 : 1;
      let width = rect.width;
      let height = rect.height;
      if (handle.includes('e')) width = rect.width + dx * factor;
      if (handle.includes('w')) width = rect.width - dx * factor;
      if (handle.includes('s')) height = rect.height + dy * factor;
      if (handle.includes('n')) height = rect.height - dy * factor;
      if (e.shiftKey && horizontal && vertical) {
        const ratio = rect.width / Math.max(1, rect.height);
        if (Math.abs(width - rect.width) / rect.width > Math.abs(height - rect.height) / Math.max(1, rect.height)) height = width / ratio;
        else width = height * ratio;
      }
      width = Math.max(1, width);
      height = Math.max(1, height);
      let x = handle.includes('w') ? rect.x + rect.width - width : rect.x;
      let y = handle.includes('n') ? rect.y + rect.height - height : rect.y;
      if (e.altKey) {
        x = rect.x + (rect.width - width) / 2;
        y = rect.y + (rect.height - height) / 2;
      }
      // Snap the moving edges.
      if (get().prefs.snapping && !e.ctrlKey) {
        const edges = { x: handle.includes('w') ? x : x + width, y: handle.includes('n') ? y : y + height };
        const snapped = snapRect({ x: edges.x, y: edges.y, width: 0, height: 0 }, targets, 6 / zoom);
        if (horizontal && snapped.dx) {
          if (handle.includes('w')) {
            x += snapped.dx;
            width -= snapped.dx;
          } else width += snapped.dx;
        }
        if (vertical && snapped.dy) {
          if (handle.includes('n')) {
            y += snapped.dy;
            height -= snapped.dy;
          } else height += snapped.dy;
        }
      }
      next = { x, y, width, height };
      if (horizontal) preview.set('width', `${width - extraW}px`, 'important');
      if (vertical) preview.set('height', `${height - extraH}px`, 'important');
      if (horizontal) preview.set('max-width', 'none', 'important');
      if (absolute) preview.set('translate', `${x - rect.x}px ${y - rect.y}px`);
      void dx;
      void dy;
      const frame = frameScreenRect(frameId)!;
      gesture.set({ kind: 'resize', size: { x: frame.x + (x + width / 2) * zoom, y: frame.y + (y + height) * zoom + 18, text: `${Math.round(width)} × ${Math.round(height)}` } });
    },
    () => {
      preview.restore();
      resetGesture();
      const change: Record<string, string | number | null> = {};
      if (horizontal && Math.round(next.width) !== Math.round(rect.width)) {
        change.width = Math.round(next.width - extraW);
        if (capped) change.maxWidth = null;
      }
      if (vertical && Math.round(next.height) !== Math.round(rect.height)) change.height = Math.round(next.height - extraH);
      if (!Object.keys(change).length) return;
      if (parentStyle && /flex/.test(parentStyle.display)) {
        const row = parentStyle.flexDirection.startsWith('row');
        if ((row && 'width' in change) || (!row && 'height' in change)) {
          if (Number(computed.flexGrow) > 0) change.flexGrow = 0;
          if (Number(computed.flexShrink) !== 0) change.flexShrink = 0;
        }
      }
      if (absolute) {
        if (Math.round(next.x) !== Math.round(rect.x)) change.left = Math.round((parseFloat(computed.left) || 0) + next.x - rect.x);
        if (Math.round(next.y) !== Math.round(rect.y)) change.top = Math.round((parseFloat(computed.top) || 0) + next.y - rect.y);
      }
      setStyle(change, [key], 'resize');
    },
  );
}

/** Rotates the selection around its center. Shift snaps to 15°. */
function startRotate(event: ReactPointerEvent, box: Rect) {
  event.stopPropagation();
  event.preventDefault();
  const state = get();
  const key = state.selection[0];
  const el = elementOf(state.activeFrame, key);
  const computed = computedOf(state.activeFrame, key);
  if (!el || !computed) return;
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const start = local(event);
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  const current = computed.rotate && computed.rotate !== 'none' ? parseFloat(computed.rotate) : 0;
  let angle = current;
  const preview = previewStyles(el);
  gesture.set({ kind: 'rotate' });
  follow(
    (e) => {
      const p = local(e);
      const delta = ((Math.atan2(p.y - center.y, p.x - center.x) - startAngle) * 180) / Math.PI;
      angle = current + delta;
      if (e.shiftKey) angle = Math.round(angle / 15) * 15;
      angle = Math.round((((angle % 360) + 540) % 360) - 180);
      preview.set('rotate', `${angle}deg`);
      gesture.set({ kind: 'rotate', size: { x: p.x, y: p.y + 28, text: `${angle}°` } });
    },
    () => {
      preview.restore();
      resetGesture();
      if (angle !== current) setStyle({ rotate: angle ? `${angle}deg` : null }, [key], 'rotate');
    },
  );
}

/** The name above a frame. Click selects the frame, drag moves it, double-click renames it. */
function FrameLabel({ frame, zoom, active }: { frame: CanvasFrame; zoom: number; active: boolean }) {
  const [renaming, setRenaming] = useState(false);
  const rect = frameScreenRect(frame.id);
  if (!rect) return null;
  const flow = get().pageId === 'page:components';
  const onPointerDown = (event: ReactPointerEvent) => {
    event.stopPropagation();
    const start = local(event);
    const origin = { x: frame.x, y: frame.y };
    let moved = false;
    follow(
      (e) => {
        if (flow) return;
        const p = local(e);
        if (!moved && Math.hypot(p.x - start.x, p.y - start.y) < 3) return;
        moved = true;
        updateView((view) => ({
          ...view,
          frames: view.frames.map((f) => (f.id === frame.id ? { ...f, x: Math.round(origin.x + (p.x - start.x) / zoom), y: Math.round(origin.y + (p.y - start.y) / zoom) } : f)),
        }));
      },
      () => {
        if (moved) return;
        select([], frame.id);
        set({ frameSelected: frame.id });
      },
    );
  };
  return (
    <div
      data-overlay-control
      className={`frame-label${active ? ' active' : ''}${frame.componentId ? ' component' : ''}`}
      style={{ left: rect.x, top: rect.y - 22, maxWidth: Math.max(60, rect.width) }}
      onPointerDown={onPointerDown}
      onDoubleClick={() => !frame.componentId && setRenaming(true)}
    >
      {renaming ? (
        <input
          autoFocus
          defaultValue={frame.name}
          onBlur={(e) => {
            const name = e.currentTarget.value.trim() || frame.name;
            updateView((view) => ({ ...view, frames: view.frames.map((f) => (f.id === frame.id ? { ...f, name } : f)) }));
            setRenaming(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
            e.stopPropagation();
          }}
        />
      ) : (
        <>
          {frame.componentId && <span className="component-mark">❖</span>}
          <span>{frame.name}</span>
          {!frame.componentId && <span className="frame-size">{frame.width}</span>}
          {frame.dark && <span className="frame-size">Dark</span>}
        </>
      )}
    </div>
  );
}

/** Figma-style layout grids drawn over a frame. */
function LayoutGrids({ frame, zoom }: { frame: CanvasFrame; zoom: number }) {
  const rect = frameScreenRect(frame.id);
  if (!rect || !frame.grids?.length) return null;
  return (
    <div className="layout-grid" style={box2css(rect)}>
      {frame.grids.filter((grid) => grid.visible).map((grid, i) => {
        if (grid.type === 'grid') {
          const size = grid.size * zoom;
          return <div key={i} className="grid-squares" style={{ backgroundSize: `${size}px ${size}px`, '--grid-color': grid.color } as React.CSSProperties} />;
        }
        const total = grid.type === 'columns' ? frame.width : rect.height / zoom;
        const usable = total - grid.margin * 2 - grid.gutter * (grid.count - 1);
        const size = usable / grid.count;
        return Array.from({ length: grid.count }, (_, n) => {
          const start = (grid.margin + n * (size + grid.gutter)) * zoom;
          return (
            <div
              key={`${i}-${n}`}
              className="grid-band"
              style={grid.type === 'columns' ? { left: start, width: size * zoom, top: 0, bottom: 0, background: grid.color } : { top: start, height: size * zoom, left: 0, right: 0, background: grid.color }}
            />
          );
        });
      })}
    </div>
  );
}
