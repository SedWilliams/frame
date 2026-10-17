/*
 * Rulers and guides.
 *
 * Shift+R shows rulers along the top and left of the canvas, measured from the
 * active frame's top-left corner, with the selection's extent marked. Dragging
 * out of a ruler places a guide. Dragging a guide back onto its ruler removes it.
 */

import type { PointerEvent as ReactPointerEvent } from 'react';
import { currentView, updateView, useEditor } from '../app/state';
import { union, useLayoutTick } from './registry';
import { frameScreenRect, screenRect } from './Canvas';

const SIZE = 20;
const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];

export function Rulers() {
  useLayoutTick();
  const view = useEditor((s) => s.views[s.pageId]);
  const selection = useEditor((s) => s.selection);
  const activeFrame = useEditor((s) => s.activeFrame);
  const canvas = document.querySelector('.canvas')?.getBoundingClientRect();
  if (!view || !canvas) return null;
  const zoom = view.zoom || 1;
  const origin = frameScreenRect(activeFrame) ?? { x: view.panX, y: view.panY, width: 0, height: 0 };
  const step = steps.find((s) => s * zoom >= 56) ?? 10000;
  const box = union(selection.map((key) => screenRect(activeFrame, key)));

  const ticks = (length: number, start: number) => {
    const first = Math.floor(-start / zoom / step) * step;
    const marks: number[] = [];
    for (let v = first; (v * zoom + start) < length; v += step) marks.push(v);
    return marks;
  };

  const startGuide = (axis: 'x' | 'y', at?: number) => (event: ReactPointerEvent) => {
    event.stopPropagation();
    event.preventDefault();
    const index = at === undefined ? currentView()!.guides.length : view.guides.findIndex((g) => g.axis === axis && g.at === at);
    const move = (e: PointerEvent) => {
      const current = currentView()!;
      const value = axis === 'x' ? (e.clientX - canvas.left - current.panX) / current.zoom : (e.clientY - canvas.top - current.panY) / current.zoom;
      updateView((v) => {
        const guides = [...v.guides];
        guides[index] = { axis, at: Math.round(value) };
        return { ...v, guides };
      });
    };
    const up = (e: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const onRuler = axis === 'x' ? e.clientY - canvas.top < SIZE : e.clientX - canvas.left < SIZE;
      if (onRuler) updateView((v) => ({ ...v, guides: v.guides.filter((_, i) => i !== index) }));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <>
      {view.guides.map((guide, i) => {
        const at = guide.axis === 'x' ? guide.at * zoom + view.panX : guide.at * zoom + view.panY;
        return (
          <div
            key={i}
            data-overlay-control
            className={`ruler-guide ${guide.axis}`}
            style={guide.axis === 'x' ? { left: at } : { top: at }}
            onPointerDown={startGuide(guide.axis, guide.at)}
          />
        );
      })}
      <div className="ruler top" data-overlay-control onPointerDown={startGuide('y')}>
        {box && <div className="ruler-span" style={{ left: box.x, width: box.width }} />}
        {ticks(canvas.width, origin.x).map((v) => (
          <span key={v} style={{ left: origin.x + v * zoom }}>
            {v}
          </span>
        ))}
      </div>
      <div className="ruler left" data-overlay-control onPointerDown={startGuide('x')}>
        {box && <div className="ruler-span" style={{ top: box.y, height: box.height }} />}
        {ticks(canvas.height, origin.y).map((v) => (
          <span key={v} style={{ top: origin.y + v * zoom }}>
            {v}
          </span>
        ))}
      </div>
      <div className="ruler-corner" />
    </>
  );
}
