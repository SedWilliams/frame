/*
 * Design panel: Appearance, Typography, Fill, Stroke, Effects, Selection
 * colors, and Export.
 *
 * Fills map to CSS backgrounds: the bottom fill is background-color and the
 * ones above it are background-image layers, so the first fill in the list is
 * the topmost, as in Figma. A text layer's fill is its color. Strokes map to
 * borders when inside and outlines when outside. Effects map to box-shadow
 * (text-shadow on text), filter, and backdrop-filter.
 */

import { useMemo, useState } from 'react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  CaseLower,
  CaseSensitive,
  CaseUpper,
  Eye,
  EyeOff,
  Italic,
  Scan,
  Strikethrough,
  Underline,
  Droplet,
} from 'lucide-react';
import { setStyle, setText, toggleHidden } from '../../app/actions';
import { get, findRender } from '../../app/state';
import { exportLayer } from '../../app/exporting';
import { formatPaint, formatShadows, parseBackgroundImage, parseBlur, parseShadows, type Paint, type Shadow } from '../../core/css';
import { parseColor, toHex } from '../../core/color';
import { computedOf } from '../../canvas/registry';
import { walkRender } from '../../core/render';
import { ColorSwatch } from '../../ui/ColorPicker';
import { IconButton, MIXED, NumberField, RemoveButton, Section, Segmented, Select, TextField } from '../../ui/controls';
import type { Inspected } from '../inspect';

const set = (info: Inspected, change: Record<string, string | number | null>, label?: string) =>
  setStyle(change, info.nodes.map((n) => n.key), label);

const asHex = (value: string | undefined) => {
  const color = parseColor(value);
  return color ? toHex(color) : value ?? '';
};

const blendModes = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];

export function AppearanceSection({ info }: { info: Inspected }) {
  const disabled = !info.stylable;
  const opacity = info.number('opacity');
  const radius = info.number('borderTopLeftRadius');
  const c = info.computed[0];
  const corners = ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius'];
  const uniform = corners.every((corner) => c?.getPropertyValue(corner.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)) === c?.borderTopLeftRadius);
  const [separate, setSeparate] = useState(false);
  const hidden = info.nodes.every((n) => n.hidden);
  return (
    <Section
      title="Appearance"
      id="appearance"
      actions={
        <IconButton label={hidden ? 'Show layer' : 'Hide layer'} onClick={() => toggleHidden()}>
          {hidden ? <EyeOff size={14} /> : <Eye size={14} />}
        </IconButton>
      }
    >
      <div className="field-grid">
        <NumberField label={<Droplet size={12} />} name="Opacity" value={opacity === MIXED ? MIXED : Math.round((opacity ?? 1) * 100)} suffix="%" min={0} max={100} disabled={disabled} onCommit={(v) => set(info, { opacity: Number(v) >= 100 || v === '' ? null : Number(v) / 100 }, 'opacity')} />
        <NumberField label={<Scan size={12} />} name="Corner radius" value={uniform ? radius : MIXED} min={0} disabled={disabled} onCommit={(v) => set(info, { borderRadius: v === '' ? null : v, borderTopLeftRadius: null, borderTopRightRadius: null, borderBottomRightRadius: null, borderBottomLeftRadius: null }, 'radius')} />
      </div>
      <div className="field-grid">
        <Select name="Blend mode" value={info.value('mixBlendMode') === MIXED ? 'normal' : String(info.value('mixBlendMode') || 'normal')} options={blendModes.map((m) => [m, m.replace(/(^|-)(\w)/g, (_, d, ch) => (d ? ' ' : '') + ch.toUpperCase())])} disabled={disabled} onChange={(v) => set(info, { mixBlendMode: v === 'normal' ? null : v }, 'blend')} />
        <button className={`toggle-button${separate || !uniform ? ' active' : ''}`} onClick={() => setSeparate(!separate)} disabled={disabled}>
          Corners
        </button>
      </div>
      {(separate || !uniform) && (
        <div className="field-grid quad">
          {corners.map((corner, i) => (
            <NumberField key={corner} label={['↖', '↗', '↘', '↙'][i]} name={['Top left radius', 'Top right radius', 'Bottom right radius', 'Bottom left radius'][i]} value={info.number(corner)} min={0} disabled={disabled} onCommit={(v) => set(info, { [corner]: v === '' ? null : v }, 'radius')} />
          ))}
        </div>
      )}
    </Section>
  );
}

const families = [
  ['inherit', 'Inherited'],
  ['Inter, sans-serif', 'Inter'],
  ['system-ui, sans-serif', 'System'],
  ['Arial, Helvetica, sans-serif', 'Arial'],
  ["'Helvetica Neue', Helvetica, sans-serif", 'Helvetica Neue'],
  ['Georgia, serif', 'Georgia'],
  ["'Times New Roman', serif", 'Times New Roman'],
  ["'Playfair Display', serif", 'Playfair Display'],
  ["'DM Sans', sans-serif", 'DM Sans'],
  ['Manrope, sans-serif', 'Manrope'],
  ['Poppins, sans-serif', 'Poppins'],
  ["'Space Grotesk', sans-serif", 'Space Grotesk'],
  ['ui-monospace, monospace', 'Monospace'],
] as [string, string][];

const weights: [string, string][] = [
  ['100', 'Thin'],
  ['200', 'Extra Light'],
  ['300', 'Light'],
  ['400', 'Regular'],
  ['500', 'Medium'],
  ['600', 'Semi Bold'],
  ['700', 'Bold'],
  ['800', 'Extra Bold'],
  ['900', 'Black'],
];

export function TypographySection({ info }: { info: Inspected }) {
  const disabled = !info.stylable;
  const c = info.computed[0];
  const family = info.value('fontFamily');
  const familyName = family === MIXED ? 'Mixed' : String(family ?? '').split(',')[0].replace(/["']/g, '').trim();
  const lineHeight = info.value('lineHeight');
  const fontSize = info.number('fontSize');
  const letter = info.value('letterSpacing');
  const decoration = c?.textDecorationLine ?? 'none';
  const transform = c?.textTransform ?? 'none';
  return (
    <Section title="Typography" id="typography">
      <Select
        name="Font family"
        className="wide"
        value={familyName}
        disabled={disabled}
        options={[...families.map(([value, label]) => [label, label] as [string, string])]}
        onChange={(label) => {
          const value = families.find(([, l]) => l === label)?.[0] ?? label;
          set(info, { fontFamily: value === 'inherit' ? null : value }, 'fontFamily');
        }}
      />
      <div className="field-grid">
        <Select name="Font weight" value={info.value('fontWeight') === MIXED ? '400' : String(info.value('fontWeight') || '400')} options={weights} disabled={disabled} onChange={(v) => set(info, { fontWeight: Number(v) }, 'fontWeight')} />
        <NumberField label="Size" name="Font size" value={fontSize} min={1} disabled={disabled} onCommit={(v) => set(info, { fontSize: v === '' ? null : v }, 'fontSize')} />
      </div>
      <div className="field-grid">
        <NumberField
          label="↕"
          name="Line height"
          value={lineHeight === MIXED ? MIXED : lineHeight === 'normal' ? 'Auto' : typeof fontSize === 'number' && lineHeight ? Math.round((parseFloat(String(lineHeight)) / fontSize) * 100) + '%' : String(lineHeight ?? '')}
          keywords={['auto']}
          disabled={disabled}
          title="Line height: a number of pixels, a percent of the font size, or Auto"
          onCommit={(v) => {
            if (v === 'auto' || v === '') return set(info, { lineHeight: null }, 'lineHeight');
            const text = String(v);
            if (text.endsWith('%')) return set(info, { lineHeight: Math.round(parseFloat(text)) / 100 }, 'lineHeight');
            set(info, { lineHeight: typeof v === 'number' ? (v < 5 ? v : `${v}px`) : text }, 'lineHeight');
          }}
        />
        <NumberField
          label="|A|"
          name="Letter spacing"
          value={letter === MIXED ? MIXED : letter === 'normal' ? 0 : parseFloat(String(letter ?? '0'))}
          step={0.1}
          disabled={disabled}
          onCommit={(v) => set(info, { letterSpacing: v === '' || v === 0 ? null : typeof v === 'number' ? `${v}px` : v }, 'letterSpacing')}
        />
      </div>
      <div className="text-options">
        <Segmented
          name="Text alignment"
          value={c?.textAlign === 'start' ? 'left' : (c?.textAlign as 'left')}
          disabled={disabled}
          onChange={(v) => set(info, { textAlign: v }, 'textAlign')}
          options={[
            { value: 'left', label: 'Align left', icon: <AlignLeft size={14} /> },
            { value: 'center', label: 'Align center', icon: <AlignCenter size={14} /> },
            { value: 'right', label: 'Align right', icon: <AlignRight size={14} /> },
            { value: 'justify', label: 'Justify', icon: <AlignJustify size={14} /> },
          ]}
        />
        <div className="segmented">
          <button aria-label="Italic" aria-pressed={c?.fontStyle === 'italic'} className={c?.fontStyle === 'italic' ? 'active' : ''} disabled={disabled} onClick={() => set(info, { fontStyle: c?.fontStyle === 'italic' ? null : 'italic' }, 'fontStyle')}>
            <Italic size={14} />
          </button>
          <button aria-label="Underline" aria-pressed={decoration.includes('underline')} className={decoration.includes('underline') ? 'active' : ''} disabled={disabled} onClick={() => set(info, { textDecorationLine: decoration.includes('underline') ? 'none' : 'underline' }, 'decoration')}>
            <Underline size={14} />
          </button>
          <button aria-label="Strikethrough" aria-pressed={decoration.includes('line-through')} className={decoration.includes('line-through') ? 'active' : ''} disabled={disabled} onClick={() => set(info, { textDecorationLine: decoration.includes('line-through') ? 'none' : 'line-through' }, 'decoration')}>
            <Strikethrough size={14} />
          </button>
        </div>
      </div>
      <div className="text-options">
        <Segmented
          name="Letter case"
          value={transform === 'none' ? 'none' : (transform as 'none')}
          disabled={disabled}
          onChange={(v) => set(info, { textTransform: v === 'none' ? null : v }, 'textTransform')}
          options={[
            { value: 'none', label: 'As typed', icon: <CaseSensitive size={14} /> },
            { value: 'uppercase', label: 'Uppercase', icon: <CaseUpper size={14} /> },
            { value: 'lowercase', label: 'Lowercase', icon: <CaseLower size={14} /> },
            { value: 'capitalize', label: 'Title case', icon: <span className="glyph">Aa</span> },
          ]}
        />
        <Select
          name="Text overflow"
          value={c?.textOverflow === 'ellipsis' ? 'truncate' : c?.whiteSpace === 'nowrap' ? 'nowrap' : 'wrap'}
          disabled={disabled}
          options={[['wrap', 'Wrap text'], ['nowrap', 'One line'], ['truncate', 'Truncate']]}
          onChange={(v) =>
            set(info, v === 'wrap' ? { whiteSpace: null, textOverflow: null, overflow: null } : v === 'nowrap' ? { whiteSpace: 'nowrap', textOverflow: null } : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, 'overflow')
          }
        />
      </div>
      {info.nodes.length === 1 && info.primary.text !== undefined && (
        <TextField
          multiline
          name="Text content"
          value={info.primary.text}
          disabled={info.primary.locked || !info.primary.textSource}
          onCommit={(text) => setText(info.primary.key, text)}
        />
      )}
    </Section>
  );
}

/** Session-only memory of hidden fills and effects, so the eye toggle can bring them back. */
const hiddenPaints = new Map<string, Paint[]>();
const hiddenShadows = new Map<string, Shadow[]>();

export function FillSection({ info }: { info: Inspected }) {
  const disabled = !info.stylable;
  const c = info.computed[0];
  if (info.isText) {
    const color = info.value('color');
    return (
      <Section title="Fill" id="fill">
        <ColorRow label="Text" value={color === MIXED ? '#000000' : asHex(String(color))} mixed={color === MIXED} disabled={disabled} onChange={(v) => set(info, { color: v }, 'color')} />
      </Section>
    );
  }
  const layers = parseBackgroundImage(c?.backgroundImage);
  const base = parseColor(c?.backgroundColor);
  const paints: Paint[] = [...layers, ...(base && base.a > 0 ? [{ type: 'solid' as const, color: toHex(base) }] : [])];
  const key = info.primary.key;
  const hidden = hiddenPaints.get(key) ?? [];
  const write = (next: Paint[]) => {
    const bottom = next.at(-1)?.type === 'solid' ? next.at(-1) : undefined;
    const above = bottom ? next.slice(0, -1) : next;
    set(info, { backgroundColor: bottom?.color ?? null, backgroundImage: above.length ? above.map(formatPaint).join(', ') : null }, 'fill');
  };
  return (
    <Section
      title="Fill"
      id="fill"
      empty={!paints.length}
      onAdd={disabled ? undefined : () => write(paints.length ? [{ type: 'solid', color: '#ffffff80' }, ...paints] : [{ type: 'solid', color: '#d9d9d9' }])}
    >
      {paints.map((paint, i) => (
        <div key={i} className="paint-row">
          {paint.type === 'solid' ? (
            <ColorRow label="Fill" value={paint.color!} disabled={disabled} onChange={(v) => write(paints.map((p, j) => (j === i ? { ...p, color: v } : p)))} />
          ) : paint.type === 'image' ? (
            <div className="image-paint">
              <span className="thumb" style={{ backgroundImage: `url(${paint.url})` }} />
              <span>Image</span>
            </div>
          ) : (
            <GradientRow paint={paint} disabled={disabled} onChange={(next) => write(paints.map((p, j) => (j === i ? next : p)))} />
          )}
          <IconButton label="Hide fill" disabled={disabled} onClick={() => {
            hiddenPaints.set(key, [...hidden, paint]);
            write(paints.filter((_, j) => j !== i));
          }}>
            <Eye size={13} />
          </IconButton>
          <RemoveButton label="Remove fill" onClick={() => write(paints.filter((_, j) => j !== i))} />
        </div>
      ))}
      {hidden.map((paint, i) => (
        <div key={`h${i}`} className="paint-row hidden-paint">
          <span className="swatch-dot" style={{ background: paint.color ?? formatPaint(paint) }} />
          <span>{paint.type === 'solid' ? asHex(paint.color).toUpperCase().slice(1) : paint.type}</span>
          <IconButton label="Show fill" onClick={() => {
            hiddenPaints.set(key, hidden.filter((_, j) => j !== i));
            write(paint.type === 'solid' ? [...paints.filter((p) => p.type !== 'solid'), paint] : [paint, ...paints]);
          }}>
            <EyeOff size={13} />
          </IconButton>
        </div>
      ))}
      {!disabled && paints.length > 0 && (
        <button className="link-button" onClick={() => write([{ type: 'linear', angle: 180, stops: [{ color: '#ffffff', at: 0 }, { color: '#000000', at: 100 }] }, ...paints])}>
          + Gradient
        </button>
      )}
    </Section>
  );
}

function ColorRow({ label, value, onChange, disabled, mixed }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean; mixed?: boolean }) {
  const color = parseColor(value);
  return (
    <div className={`color-row${disabled ? ' disabled' : ''}`}>
      <ColorSwatch value={value} onChange={onChange} label={label} />
      <TextField
        name={`${label} color`}
        value={mixed ? 'Mixed' : value.startsWith('var(') ? value : color ? toHex({ ...color, a: 1 }).slice(1).toUpperCase() : value}
        disabled={disabled}
        onCommit={(v) => {
          const next = v.startsWith('var(') || v.startsWith('#') ? v : parseColor(`#${v}`) ? `#${v}` : v;
          onChange(next.startsWith('#') ? asHex(next) : next);
        }}
      />
      <NumberField
        label=""
        name={`${label} opacity`}
        value={color ? Math.round(color.a * 100) : 100}
        suffix="%"
        min={0}
        max={100}
        disabled={disabled || !color}
        className="opacity"
        onCommit={(v) => color && onChange(toHex({ ...color, a: Math.min(1, Math.max(0, Number(v) / 100)) }))}
      />
    </div>
  );
}

function GradientRow({ paint, onChange, disabled }: { paint: Paint; onChange: (p: Paint) => void; disabled?: boolean }) {
  const stops = paint.stops ?? [];
  return (
    <div className="gradient-row">
      <div className="gradient-preview" style={{ background: formatPaint(paint) }} />
      <div className="field-grid">
        <Select name="Gradient type" value={paint.type} disabled={disabled} options={[['linear', 'Linear'], ['radial', 'Radial'], ['conic', 'Angular']]} onChange={(v) => onChange({ ...paint, type: v as Paint['type'] })} />
        {paint.type !== 'radial' && <NumberField label="∠" name="Gradient angle" value={paint.angle ?? 180} disabled={disabled} suffix="°" onCommit={(v) => onChange({ ...paint, angle: Number(v) })} />}
      </div>
      {stops.map((stop, i) => (
        <div key={i} className="stop-row">
          <ColorSwatch value={asHex(stop.color)} label={`Stop ${i + 1}`} onChange={(v) => onChange({ ...paint, stops: stops.map((s, j) => (j === i ? { ...s, color: v } : s)) })} />
          <NumberField label="" name={`Stop ${i + 1} position`} value={stop.at} suffix="%" min={0} max={100} disabled={disabled} onCommit={(v) => onChange({ ...paint, stops: stops.map((s, j) => (j === i ? { ...s, at: Number(v) } : s)) })} />
          {stops.length > 2 && <RemoveButton label="Remove stop" onClick={() => onChange({ ...paint, stops: stops.filter((_, j) => j !== i) })} />}
        </div>
      ))}
      <button className="link-button" disabled={disabled} onClick={() => onChange({ ...paint, stops: [...stops, { color: stops.at(-1)?.color ?? '#000000', at: 100 }] })}>
        + Stop
      </button>
    </div>
  );
}

export function StrokeSection({ info }: { info: Inspected }) {
  const disabled = !info.stylable;
  const c = info.computed[0];
  const width = Math.max(...['Top', 'Right', 'Bottom', 'Left'].map((s) => parseFloat(c?.getPropertyValue(`border-${s.toLowerCase()}-width`) ?? '0') || 0));
  const style = c?.borderTopStyle ?? 'none';
  const outline = (parseFloat(c?.outlineWidth ?? '0') || 0) > 0 && c?.outlineStyle !== 'none';
  const has = (width > 0 && style !== 'none') || outline;
  const position = outline && !(width > 0 && style !== 'none') ? 'outside' : 'inside';
  const color = position === 'outside' ? c?.outlineColor : c?.borderTopColor;
  const sides = ['Top', 'Right', 'Bottom', 'Left'].map((s) => parseFloat(c?.getPropertyValue(`border-${s.toLowerCase()}-width`) ?? '0') || 0);
  const individual = has && position === 'inside' && sides.some((w) => w !== sides[0]);
  const [perSide, setPerSide] = useState(false);
  const write = (change: { width?: number; color?: string; style?: string; position?: string }) => {
    const w = change.width ?? (width || 1);
    const col = change.color ?? asHex(color) ?? '#000000';
    const st = change.style ?? (style === 'none' ? 'solid' : style);
    const pos = change.position ?? position;
    if (pos === 'outside')
      set(info, { outlineWidth: w, outlineStyle: st, outlineColor: col, outlineOffset: 0, borderWidth: null, borderStyle: null, borderColor: null, border: null }, 'stroke');
    else set(info, { borderWidth: w, borderStyle: st, borderColor: col, border: null, outlineWidth: null, outlineStyle: null, outlineColor: null, outlineOffset: null }, 'stroke');
  };
  return (
    <Section
      title="Stroke"
      id="stroke"
      empty={!has}
      onAdd={disabled || has ? undefined : () => write({ width: 1, color: '#000000', style: 'solid', position: 'inside' })}
    >
      {has && (
        <>
          <div className="paint-row">
            <ColorRow label="Stroke" value={asHex(color)} disabled={disabled} onChange={(v) => write({ color: v })} />
            <RemoveButton label="Remove stroke" onClick={() => set(info, { border: null, borderWidth: null, borderStyle: null, borderColor: null, borderTopWidth: null, borderRightWidth: null, borderBottomWidth: null, borderLeftWidth: null, outlineWidth: null, outlineStyle: null, outlineColor: null }, 'stroke')} />
          </div>
          <div className="field-grid">
            <Select name="Stroke position" value={position} disabled={disabled} options={[['inside', 'Inside'], ['outside', 'Outside']]} onChange={(v) => write({ position: v })} />
            <NumberField label="≡" name="Stroke weight" value={width} min={0} disabled={disabled} onCommit={(v) => write({ width: Number(v) })} />
          </div>
          <div className="field-grid">
            <Select name="Stroke style" value={style === 'none' ? 'solid' : style} disabled={disabled} options={[['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted'], ['double', 'Double']]} onChange={(v) => write({ style: v })} />
            {position === 'inside' && (
              <button className={`toggle-button${perSide || individual ? ' active' : ''}`} disabled={disabled} onClick={() => setPerSide(!perSide)}>
                Per side
              </button>
            )}
          </div>
          {(perSide || individual) && position === 'inside' && (
            <div className="field-grid quad">
              {(['Top', 'Right', 'Bottom', 'Left'] as const).map((side, i) => (
                <NumberField key={side} label={side[0]} name={`${side} stroke`} value={sides[i]} min={0} disabled={disabled} onCommit={(v) => set(info, { [`border${side}Width`]: Number(v), borderStyle: style === 'none' ? 'solid' : style }, 'stroke')} />
              ))}
            </div>
          )}
        </>
      )}
    </Section>
  );
}

type Effect = { kind: 'drop' | 'inner'; shadow: Shadow } | { kind: 'blur' | 'backdrop'; radius: number };

export function EffectsSection({ info }: { info: Inspected }) {
  const disabled = !info.stylable;
  const c = info.computed[0];
  const text = info.isText;
  const shadows = parseShadows(text ? c?.textShadow : c?.boxShadow);
  const effects: Effect[] = [
    ...shadows.map((shadow): Effect => ({ kind: shadow.inset ? 'inner' : 'drop', shadow })),
    ...(parseBlur(c?.filter) ? [{ kind: 'blur' as const, radius: parseBlur(c?.filter) }] : []),
    ...(parseBlur(c?.backdropFilter) ? [{ kind: 'backdrop' as const, radius: parseBlur(c?.backdropFilter) }] : []),
  ];
  const [open, setOpen] = useState<number | null>(null);
  const key = info.primary.key;
  const write = (next: Effect[]) => {
    const list = next.filter((e): e is Extract<Effect, { shadow: Shadow }> => e.kind === 'drop' || e.kind === 'inner').map((e) => ({ ...e.shadow, inset: e.kind === 'inner' }));
    const blur = next.find((e) => e.kind === 'blur') as { radius: number } | undefined;
    const backdrop = next.find((e) => e.kind === 'backdrop') as { radius: number } | undefined;
    set(info, {
      [text ? 'textShadow' : 'boxShadow']: formatShadows(list, text),
      filter: blur ? `blur(${blur.radius}px)` : null,
      backdropFilter: backdrop ? `blur(${backdrop.radius}px)` : null,
    }, 'effects');
  };
  const add = () => write([...effects, { kind: 'drop', shadow: { inset: false, x: 0, y: 4, blur: 4, spread: 0, color: '#00000040' } }]);
  return (
    <Section title="Effects" id="effects" empty={!effects.length} onAdd={disabled ? undefined : add}>
      {effects.map((effect, i) => (
        <div key={i} className="effect">
          <div className="paint-row">
            <Select
              name="Effect type"
              value={effect.kind}
              disabled={disabled}
              options={text ? [['drop', 'Drop shadow']] : [['drop', 'Drop shadow'], ['inner', 'Inner shadow'], ['blur', 'Layer blur'], ['backdrop', 'Background blur']]}
              onChange={(kind) => {
                const replacement: Effect = kind === 'drop' || kind === 'inner' ? { kind, shadow: 'shadow' in effect ? effect.shadow : { inset: false, x: 0, y: 4, blur: 4, spread: 0, color: '#00000040' } } : { kind: kind as 'blur', radius: 'radius' in effect ? effect.radius : 4 };
                write(effects.map((e, j) => (j === i ? replacement : e)));
              }}
            />
            <IconButton label="Effect settings" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
              <span className="glyph">⋯</span>
            </IconButton>
            <IconButton label="Hide effect" onClick={() => {
              if ('shadow' in effect) hiddenShadows.set(key, [...(hiddenShadows.get(key) ?? []), effect.shadow]);
              write(effects.filter((_, j) => j !== i));
            }}>
              <Eye size={13} />
            </IconButton>
            <RemoveButton label="Remove effect" onClick={() => write(effects.filter((_, j) => j !== i))} />
          </div>
          {open === i &&
            ('shadow' in effect ? (
              <div className="effect-settings">
                <div className="field-grid">
                  <NumberField label="X" value={effect.shadow.x} disabled={disabled} onCommit={(v) => write(effects.map((e, j) => (j === i && 'shadow' in e ? { ...e, shadow: { ...e.shadow, x: Number(v) } } : e)))} />
                  <NumberField label="Y" value={effect.shadow.y} disabled={disabled} onCommit={(v) => write(effects.map((e, j) => (j === i && 'shadow' in e ? { ...e, shadow: { ...e.shadow, y: Number(v) } } : e)))} />
                </div>
                <div className="field-grid">
                  <NumberField label="Blur" value={effect.shadow.blur} min={0} disabled={disabled} onCommit={(v) => write(effects.map((e, j) => (j === i && 'shadow' in e ? { ...e, shadow: { ...e.shadow, blur: Number(v) } } : e)))} />
                  {!text && <NumberField label="Spread" value={effect.shadow.spread} disabled={disabled} onCommit={(v) => write(effects.map((e, j) => (j === i && 'shadow' in e ? { ...e, shadow: { ...e.shadow, spread: Number(v) } } : e)))} />}
                </div>
                <ColorRow label="Shadow" value={asHex(effect.shadow.color)} disabled={disabled} onChange={(v) => write(effects.map((e, j) => (j === i && 'shadow' in e ? { ...e, shadow: { ...e.shadow, color: v } } : e)))} />
              </div>
            ) : (
              <div className="effect-settings">
                <NumberField label="Blur" value={effect.radius} min={0} disabled={disabled} onCommit={(v) => write(effects.map((e, j) => (j === i && 'radius' in e ? { ...e, radius: Number(v) } : e)))} />
              </div>
            ))}
        </div>
      ))}
      {(hiddenShadows.get(key) ?? []).map((shadow, i) => (
        <div key={`h${i}`} className="paint-row hidden-paint">
          <span>{shadow.inset ? 'Inner shadow' : 'Drop shadow'}</span>
          <IconButton label="Show effect" onClick={() => {
            hiddenShadows.set(key, (hiddenShadows.get(key) ?? []).filter((_, j) => j !== i));
            write([...effects, { kind: shadow.inset ? 'inner' : 'drop', shadow }]);
          }}>
            <EyeOff size={13} />
          </IconButton>
        </div>
      ))}
    </Section>
  );
}

/** Every color used in the selection, editable in one place, as Figma's Selection colors. */
export function SelectionColors({ info }: { info: Inspected }) {
  const colors = useMemo(() => {
    const found = new Map<string, { keys: Set<string>; props: Set<string> }>();
    const frame = info.frame;
    let count = 0;
    for (const root of info.nodes)
      walkRender([root], (node) => {
        if (++count > 400 || node.kind === 'instance') return;
        const c = computedOf(frame, node.key);
        if (!c) return;
        for (const [prop, cssProp] of [['color', 'color'], ['backgroundColor', 'background-color'], ['borderColor', 'border-top-color']] as const) {
          const value = c.getPropertyValue(cssProp);
          const color = parseColor(value);
          if (!color || color.a === 0) continue;
          if (prop === 'borderColor' && !(parseFloat(c.borderTopWidth) > 0)) continue;
          if (prop === 'color' && node.text === undefined && node.kind !== 'text') continue;
          const hex = toHex(color);
          const entry = found.get(hex) ?? { keys: new Set(), props: new Set() };
          entry.keys.add(node.key);
          entry.props.add(`${node.key}|${prop}`);
          found.set(hex, entry);
        }
      });
    return [...found.entries()].slice(0, 12);
  }, [info]);
  if (colors.length < 2) return null;
  return (
    <Section title="Selection colors" id="selection-colors">
      {colors.map(([hex, entry]) => (
        <div key={hex} className="paint-row">
          <ColorRow
            label="Selection"
            value={hex}
            onChange={(next) => {
              const byKey = new Map<string, Record<string, string>>();
              for (const item of entry.props) {
                const [key, prop] = item.split('|');
                byKey.set(key, { ...(byKey.get(key) ?? {}), [prop]: next });
              }
              for (const [key, change] of byKey) {
                const node = findRender(get(), key)?.node;
                if (node) setStyle(change, [key], 'selection-colors');
              }
            }}
          />
        </div>
      ))}
    </Section>
  );
}

export function ExportSection({ info }: { info: Inspected }) {
  const [rows, setRows] = useState<{ scale: number; format: 'png' | 'jpg' | 'svg' }[]>([]);
  return (
    <Section title="Export" id="export" empty={!rows.length} onAdd={() => setRows([...rows, { scale: 1, format: 'png' }])}>
      {rows.map((row, i) => (
        <div key={i} className="field-grid export-row">
          <Select name="Export scale" value={`${row.scale}`} options={[['0.5', '0.5x'], ['1', '1x'], ['2', '2x'], ['3', '3x'], ['4', '4x']]} onChange={(v) => setRows(rows.map((r, j) => (j === i ? { ...r, scale: Number(v) } : r)))} />
          <Select name="Export format" value={row.format} options={[['png', 'PNG'], ['jpg', 'JPG'], ['svg', 'SVG']]} onChange={(v) => setRows(rows.map((r, j) => (j === i ? { ...r, format: v as 'png' } : r)))} />
          <RemoveButton label="Remove export setting" onClick={() => setRows(rows.filter((_, j) => j !== i))} />
        </div>
      ))}
      {rows.length > 0 && (
        <button className="secondary-button wide" onClick={async () => {
          for (const node of info.nodes) for (const row of rows) await exportLayer(node.key, row.format, row.scale);
        }}>
          Export {info.nodes.length === 1 ? info.primary.name : `${info.nodes.length} layers`}
        </button>
      )}
    </Section>
  );
}
