/*
 * The color picker.
 *
 * A swatch that opens Figma's picker: a saturation and brightness square, hue
 * and opacity sliders, a hex field, the browser's eyedropper where available,
 * and the project's color variables. Picking a variable writes var(--name), so
 * the page keeps following the design token.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pipette } from 'lucide-react';
import { hexLabel, hsvToRgb, parseColor, rgbToHsv, toHex, type HSV } from '../core/color';
import { cssVariables } from '../core/cssfile';
import { get } from '../app/state';
import { IconButton } from './controls';

interface ColorPickerProps {
  value: string;
  onChange: (value: string) => void;
  /** Called once when the picker closes after changes, for undo grouping. */
  label: string;
}

/** Color variables defined in the project's stylesheets. */
export function colorVariables() {
  const { doc } = get();
  const seen = new Set<string>();
  const list: { name: string; value: string; resolved?: string }[] = [];
  for (const [path, text] of Object.entries(doc.text)) {
    if (!path.endsWith('.css')) continue;
    for (const variable of cssVariables(text, path)) {
      if (variable.mode === 'dark' || seen.has(variable.name)) continue;
      const resolved = parseColor(variable.value) ? variable.value : undefined;
      if (!resolved && !/color|bg|background|foreground|primary|accent|ink|paper|muted|border|ring/.test(variable.name)) continue;
      seen.add(variable.name);
      list.push({ name: variable.name, value: variable.value, resolved });
    }
  }
  return list;
}

export function ColorSwatch({ value, onChange, label }: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const color = parseColor(value);
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="swatch"
        aria-label={`${label} color`}
        title={value}
        onClick={() => setOpen(!open)}
        style={{ '--swatch': color ? toHex(color) : 'transparent' } as React.CSSProperties}
      >
        <span />
      </button>
      {open && ref.current && <Picker anchor={ref.current} value={value} onChange={onChange} onClose={() => setOpen(false)} />}
    </>
  );
}

function Picker({ anchor, value, onChange, onClose }: { anchor: HTMLElement; value: string; onChange: (value: string) => void; onClose: () => void }) {
  const initial = parseColor(value) ?? { r: 0, g: 0, b: 0, a: 1 };
  const [hsv, setHsv] = useState<HSV>(() => rgbToHsv(initial));
  const [tab, setTab] = useState<'custom' | 'variables'>(value.startsWith('var(') ? 'variables' : 'custom');
  const panel = useRef<HTMLDivElement>(null);
  const variables = useMemo(() => colorVariables(), []);
  const rect = anchor.getBoundingClientRect();
  const top = Math.min(window.innerHeight - 420, rect.top);
  const left = Math.max(8, rect.left - 260);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!panel.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key);
    };
  }, [anchor, onClose]);

  const apply = (next: HSV) => {
    setHsv(next);
    onChange(toHex(hsvToRgb(next)));
  };

  const drag = (event: React.PointerEvent, area: 'sv' | 'hue' | 'alpha') => {
    const target = event.currentTarget as HTMLElement;
    const box = target.getBoundingClientRect();
    const update = (e: { clientX: number; clientY: number }) => {
      const x = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
      const y = Math.min(1, Math.max(0, (e.clientY - box.top) / box.height));
      setHsv((current) => {
        const next = area === 'sv' ? { ...current, s: x, v: 1 - y } : area === 'hue' ? { ...current, h: x * 360 } : { ...current, a: Math.round(x * 100) / 100 };
        onChange(toHex(hsvToRgb(next)));
        return next;
      });
    };
    update(event);
    const move = (e: PointerEvent) => update(e);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const rgb = hsvToRgb(hsv);
  const pure = toHex(hsvToRgb({ h: hsv.h, s: 1, v: 1, a: 1 }));
  const eyedropper = (window as unknown as { EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper;

  return createPortal(
    <div ref={panel} className="color-picker" style={{ top, left }} role="dialog" aria-label="Color picker">
      <div className="picker-tabs">
        <button className={tab === 'custom' ? 'active' : ''} onClick={() => setTab('custom')}>
          Custom
        </button>
        <button className={tab === 'variables' ? 'active' : ''} onClick={() => setTab('variables')}>
          Variables
        </button>
      </div>
      {tab === 'custom' ? (
        <>
          <div className="sv" style={{ background: pure }} onPointerDown={(e) => drag(e, 'sv')}>
            <span style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
          </div>
          <div className="picker-sliders">
            {eyedropper && (
              <IconButton
                label="Pick a color from the screen"
                onClick={async () => {
                  try {
                    const { sRGBHex } = await new eyedropper().open();
                    const color = parseColor(sRGBHex);
                    if (color) apply(rgbToHsv({ ...color, a: hsv.a }));
                  } catch {
                    /* cancelled */
                  }
                }}
              >
                <Pipette size={14} />
              </IconButton>
            )}
            <div>
              <div className="hue" onPointerDown={(e) => drag(e, 'hue')}>
                <span style={{ left: `${(hsv.h / 360) * 100}%` }} />
              </div>
              <div className="alpha" style={{ '--solid': toHex({ ...rgb, a: 1 }) } as React.CSSProperties} onPointerDown={(e) => drag(e, 'alpha')}>
                <span style={{ left: `${hsv.a * 100}%` }} />
              </div>
            </div>
          </div>
          <div className="picker-values">
            <span>Hex</span>
            <input
              aria-label="Hex"
              defaultValue={hexLabel(rgb)}
              key={hexLabel(rgb)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              onBlur={(e) => {
                const color = parseColor(`#${e.currentTarget.value.replace('#', '')}`);
                if (color) apply(rgbToHsv({ ...color, a: color.a === 1 ? hsv.a : color.a }));
              }}
            />
            <input
              aria-label="Opacity"
              defaultValue={`${Math.round(hsv.a * 100)}%`}
              key={`a${Math.round(hsv.a * 100)}`}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              onBlur={(e) => {
                const a = parseFloat(e.currentTarget.value);
                if (Number.isFinite(a)) apply({ ...hsv, a: Math.min(1, Math.max(0, a / 100)) });
              }}
            />
          </div>
        </>
      ) : (
        <div className="variable-list">
          {variables.length ? (
            variables.map((variable) => (
              <button key={variable.name} className={value === `var(${variable.name})` ? 'active' : ''} onClick={() => onChange(`var(${variable.name})`)}>
                <span className="swatch-dot" style={{ background: variable.resolved ?? `var(${variable.name})` }} />
                <span>{variable.name.replace(/^--/, '')}</span>
                <small>{variable.value}</small>
              </button>
            ))
          ) : (
            <p className="muted">No color variables yet. Add them under Local variables.</p>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}
