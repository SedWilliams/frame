/*
 * Design panel: Instance, Alignment, Position, and Layout.
 *
 * Layout maps Figma's auto layout onto CSS: direction is flex-direction (or wrap
 * or grid), the 3x3 alignment grid is justify-content and align-items, a gap of
 * Auto is space-between, and each dimension is Fixed, Hug, or Fill.
 */

import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  ArrowDown,
  ArrowRight,
  Ban,
  Diamond,
  ExternalLink,
  Grid3x3,
  Maximize2,
  RotateCw,
  Unlink,
  WrapText,
} from 'lucide-react';
import { align, componentOf, detachSelection, distribute, goToMainComponent, setAttr, setStyle } from '../../app/actions';
import { IconButton, MIXED, NumberField, Section, Segmented, Select, TextField, Checkbox } from '../../ui/controls';
import { sizingChange, sizingMode, type Inspected } from '../inspect';

const set = (info: Inspected, change: Record<string, string | number | null>, label?: string) =>
  setStyle(change, info.nodes.map((n) => n.key), label);

export function InstanceSection({ info }: { info: Inspected }) {
  const node = info.primary;
  if (node.kind !== 'instance') return null;
  const entry = componentOf(node);
  const attrs = info.tree?.attrs ?? {};
  const dynamic = info.tree?.dyn?.attrs ?? {};
  return (
    <Section title="Instance" id="instance">
      <div className="instance-row">
        <Diamond size={14} className="icon-component" />
        <strong>{node.component?.name ?? node.tag}</strong>
        <IconButton label="Go to main component" onClick={goToMainComponent}>
          <ExternalLink size={13} />
        </IconButton>
        <IconButton label="Detach instance" onClick={detachSelection}>
          <Unlink size={13} />
        </IconButton>
      </div>
      {entry?.props.filter((p) => p.name !== 'children' && p.name !== 'className' && p.name !== 'style' && p.name !== 'asChild').map((prop) => {
        const isDynamic = dynamic[prop.name] !== undefined;
        const current = attrs[prop.name] ?? (prop.default !== undefined ? String(prop.default) : '');
        if (isDynamic)
          return (
            <div key={prop.name} className="prop-row">
              <span>{prop.name}</span>
              <code title="Set in code">{'{…}'}</code>
            </div>
          );
        if (prop.type === 'enum' && prop.options)
          return (
            <div key={prop.name} className="prop-row">
              <span>{prop.name}</span>
              <Select name={prop.name} value={current} options={prop.options} onChange={(v) => setAttr(prop.name, v === String(prop.default) ? null : v, [node.key])} />
            </div>
          );
        if (prop.type === 'boolean')
          return (
            <div key={prop.name} className="prop-row">
              <Checkbox label={prop.name} checked={current === 'true'} onChange={(v) => setAttr(prop.name, v ? 'true' : null, [node.key])} />
            </div>
          );
        return (
          <div key={prop.name} className="prop-row">
            <span>{prop.name}</span>
            <TextField name={prop.name} value={current} placeholder={prop.type === 'node' ? 'Content' : prop.type} onCommit={(v) => setAttr(prop.name, v || null, [node.key])} />
          </div>
        );
      })}
      {!entry?.acceptsClassName && (
        <p className="hint">{node.tag} doesn't accept className or style, so its look is set inside the component. Double-click to edit it.</p>
      )}
    </Section>
  );
}

export function AlignSection({ info }: { info: Inspected }) {
  const disabled = !info.stylable;
  return (
    <div className="align-row" role="group" aria-label="Alignment">
      <IconButton label="Align left" disabled={disabled} onClick={() => align('left')}>
        <AlignStartVertical size={15} />
      </IconButton>
      <IconButton label="Align horizontal centers" disabled={disabled} onClick={() => align('hcenter')}>
        <AlignCenterVertical size={15} />
      </IconButton>
      <IconButton label="Align right" disabled={disabled} onClick={() => align('right')}>
        <AlignEndVertical size={15} />
      </IconButton>
      <IconButton label="Align top" disabled={disabled} onClick={() => align('top')}>
        <AlignStartHorizontal size={15} />
      </IconButton>
      <IconButton label="Align vertical centers" disabled={disabled} onClick={() => align('vcenter')}>
        <AlignCenterHorizontal size={15} />
      </IconButton>
      <IconButton label="Align bottom" disabled={disabled} onClick={() => align('bottom')}>
        <AlignEndHorizontal size={15} />
      </IconButton>
      {info.nodes.length > 2 && (
        <>
          <IconButton label="Distribute horizontal spacing" onClick={() => distribute('x')}>
            <AlignHorizontalSpaceAround size={15} />
          </IconButton>
          <IconButton label="Distribute vertical spacing" onClick={() => distribute('y')}>
            <AlignVerticalSpaceAround size={15} />
          </IconButton>
        </>
      )}
    </div>
  );
}

const constraintOptions: Record<'x' | 'y', [string, string][]> = {
  x: [['left', 'Left'], ['right', 'Right'], ['both', 'Left and right'], ['center', 'Center'], ['scale', 'Scale']],
  y: [['top', 'Top'], ['bottom', 'Bottom'], ['both', 'Top and bottom'], ['center', 'Center'], ['scale', 'Scale']],
};

/** Figma constraint from declared insets, for an absolutely positioned layer. */
function constraintOf(info: Inspected, axis: 'x' | 'y') {
  const tree = info.tree;
  const style = tree?.style ?? {};
  const classes = tree?.attrs.className ?? '';
  const [a, b] = axis === 'x' ? ['left', 'right'] : ['top', 'bottom'];
  const has = (side: string) => side in style || new RegExp(`(^|\\s)-?${side}-`).test(classes);
  const start = style[a];
  if (typeof start === 'string' && start.endsWith('%') && start !== '50%') return 'scale';
  if (start === '50%') return 'center';
  if (has(a) && has(b)) return 'both';
  if (has(b) && !has(a)) return axis === 'x' ? 'right' : 'bottom';
  return axis === 'x' ? 'left' : 'top';
}

/** Style edits for a constraint, keeping the layer where it is. */
function constraintChange(info: Inspected, axis: 'x' | 'y', constraint: string): Record<string, string | number | null> {
  const c = info.computed[0]!;
  const parent = info.parentComputed;
  const [a, b, size] = axis === 'x' ? ['left', 'right', 'width'] : ['top', 'bottom', 'height'];
  const start = parseFloat(c.getPropertyValue(a)) || 0;
  const end = parseFloat(c.getPropertyValue(b)) || 0;
  const length = parseFloat(c.getPropertyValue(size)) || 0;
  const parentLength = parseFloat(parent?.getPropertyValue(size) ?? '0') || 1;
  const translate = axis === 'x' ? '-50% 0' : '0 -50%';
  switch (constraint) {
    case 'left':
    case 'top':
      return { [a]: Math.round(start), [b]: null, translate: null };
    case 'right':
    case 'bottom':
      return { [b]: Math.round(end), [a]: null, translate: null };
    case 'both':
      return { [a]: Math.round(start), [b]: Math.round(end), [size]: null, translate: null };
    case 'center':
      return { [a]: '50%', [b]: null, translate };
    default:
      return { [a]: `${Math.round((start / parentLength) * 1000) / 10}%`, [size]: `${Math.round((length / parentLength) * 1000) / 10}%`, [b]: null };
  }
}

export function PositionSection({ info }: { info: Inspected }) {
  const c = info.computed[0];
  const rotation = info.value('rotate');
  const rotateValue = rotation === MIXED ? MIXED : rotation && rotation !== 'none' ? parseFloat(String(rotation)) : 0;
  const x = info.isAbsolute ? info.number('left') : undefined;
  const y = info.isAbsolute ? info.number('top') : undefined;
  return (
    <Section title="Position" id="position">
      <div className="field-grid">
        <NumberField label="X" value={info.isAbsolute ? x : '—'} disabled={!info.isAbsolute || !info.stylable} title={info.isAbsolute ? 'X' : 'Set by layout. Turn on absolute position to place it freely.'} onCommit={(v) => set(info, { left: v === '' ? null : v }, 'position')} />
        <NumberField label="Y" value={info.isAbsolute ? y : '—'} disabled={!info.isAbsolute || !info.stylable} title={info.isAbsolute ? 'Y' : 'Set by layout.'} onCommit={(v) => set(info, { top: v === '' ? null : v }, 'position')} />
      </div>
      <div className="field-grid">
        <NumberField label={<RotateCw size={12} />} name="Rotation" value={rotateValue} suffix="°" disabled={!info.stylable} onCommit={(v) => set(info, { rotate: Number(v) ? `${Number(v)}deg` : null }, 'rotate')} />
        <button
          className={`toggle-button${info.isAbsolute ? ' active' : ''}`}
          disabled={!info.stylable}
          aria-pressed={info.isAbsolute}
          title="Absolute position: take the layer out of the layout and place it freely"
          onClick={() => {
            if (info.isAbsolute) set(info, { position: null, left: null, top: null, right: null, bottom: null }, 'absolute');
            else {
              // Keep the layer where it is: its offset inside the parent becomes left and top.
              const parentPosition = info.parentComputed?.position;
              set(info, { position: 'absolute', left: Math.round(info.primaryOffset?.x ?? 0), top: Math.round(info.primaryOffset?.y ?? 0) }, 'absolute');
              if (info.parentNode && parentPosition === 'static') setStyle({ position: 'relative' }, [info.parentNode.key], 'absolute');
            }
          }}
        >
          <Maximize2 size={13} />
          Absolute
        </button>
      </div>
      {info.isAbsolute && info.nodes.length === 1 && (
        <div className="constraints">
          <span className="label">Constraints</span>
          <div className="field-grid">
            <Select name="Horizontal constraint" value={constraintOf(info, 'x')} options={constraintOptions.x} disabled={!info.stylable} onChange={(v) => set(info, constraintChange(info, 'x', v), 'constraint')} />
            <Select name="Vertical constraint" value={constraintOf(info, 'y')} options={constraintOptions.y} disabled={!info.stylable} onChange={(v) => set(info, constraintChange(info, 'y', v), 'constraint')} />
          </div>
        </div>
      )}
    </Section>
  );
}

/** Direction for the layout picker: none, vertical, horizontal, wrap, or grid. */
function directionOf(info: Inspected): 'none' | 'column' | 'row' | 'wrap' | 'grid' | undefined {
  if (info.isGrid) return 'grid';
  if (!info.isFlex) return 'none';
  const c = info.computed[0];
  if (c?.flexWrap === 'wrap') return 'wrap';
  return c?.flexDirection.startsWith('row') ? 'row' : 'column';
}

const justifyFor = ['flex-start', 'center', 'flex-end'];

export function LayoutSection({ info }: { info: Inspected }) {
  const c = info.computed[0];
  const direction = directionOf(info);
  const disabled = !info.stylable;
  const widthMode = sizingMode(info, 'width');
  const heightMode = sizingMode(info, 'height');
  const width = info.number('width');
  const height = info.number('height');
  const gap = info.value('rowGap');
  const spaceBetween = c?.justifyContent === 'space-between';
  const row = direction === 'row' || direction === 'wrap';

  const setDirection = (next: string) => {
    if (next === 'none') set(info, { display: info.primary.tag === 'span' ? 'inline' : 'block', flexDirection: null, flexWrap: null, gap: null, alignItems: null, justifyContent: null, gridTemplateColumns: null }, 'layout');
    else if (next === 'grid') set(info, { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: typeof gap === 'string' && parseFloat(gap) ? parseFloat(gap) : 16, flexDirection: null, flexWrap: null }, 'layout');
    else set(info, { display: 'flex', flexDirection: next === 'column' ? 'column' : 'row', flexWrap: next === 'wrap' ? 'wrap' : null, gridTemplateColumns: null, ...(typeof gap === 'string' && parseFloat(gap) ? {} : { gap: 16 }) }, 'layout');
  };

  // The 3x3 grid: rows are vertical alignment, columns horizontal, whichever axis is main.
  const cell = (r: number, col: number) => {
    const main = row ? col : r;
    const cross = row ? r : col;
    return { justifyContent: spaceBetween ? 'space-between' : justifyFor[main], alignItems: justifyFor[cross] };
  };
  const activeCell = (() => {
    const j = justifyFor.indexOf(c?.justifyContent === 'normal' || c?.justifyContent === 'start' ? 'flex-start' : (c?.justifyContent ?? ''));
    const a = justifyFor.indexOf(c?.alignItems === 'normal' || c?.alignItems === 'stretch' || c?.alignItems === 'start' ? 'flex-start' : (c?.alignItems ?? ''));
    return row ? { r: a, col: j } : { r: j, col: a };
  })();

  return (
    <Section title={info.isFlex || info.isGrid ? 'Auto layout' : 'Layout'} id="layout">
      {info.isContainer && (
        <Segmented
          name="Layout direction"
          value={direction}
          disabled={disabled}
          onChange={setDirection}
          options={[
            { value: 'none', label: 'No auto layout', icon: <Ban size={14} /> },
            { value: 'column', label: 'Vertical layout', icon: <ArrowDown size={14} /> },
            { value: 'row', label: 'Horizontal layout', icon: <ArrowRight size={14} /> },
            { value: 'wrap', label: 'Wrap', icon: <WrapText size={14} /> },
            { value: 'grid', label: 'Grid', icon: <Grid3x3 size={14} /> },
          ]}
        />
      )}
      <div className="field-grid dims">
        <NumberField label="W" value={width} disabled={disabled} keywords={['auto', 'fill', 'hug']} onCommit={(v) => set(info, typeof v === 'number' ? sizingChange(info, 'width', 'fixed', v) : v === 'fill' || v === 'hug' ? sizingChange(info, 'width', v, 0) : { width: v || null }, 'width')} />
        <NumberField label="H" value={height} disabled={disabled} keywords={['auto', 'fill', 'hug']} onCommit={(v) => set(info, typeof v === 'number' ? sizingChange(info, 'height', 'fixed', v) : v === 'fill' || v === 'hug' ? sizingChange(info, 'height', v, 0) : { height: v || null }, 'height')} />
      </div>
      <div className="field-grid">
        <Select name="Width sizing" value={widthMode} disabled={disabled} options={[['fixed', 'Fixed width'], ['hug', 'Hug contents'], ['fill', 'Fill container']]} onChange={(v) => set(info, sizingChange(info, 'width', v as 'fixed', typeof width === 'number' ? width : 100), 'width')} />
        <Select name="Height sizing" value={heightMode} disabled={disabled} options={[['fixed', 'Fixed height'], ['hug', 'Hug contents'], ['fill', 'Fill container']]} onChange={(v) => set(info, sizingChange(info, 'height', v as 'fixed', typeof height === 'number' ? height : 100), 'height')} />
      </div>
      <MinMax info={info} />
      {(info.isFlex || info.isGrid) && (
        <div className="auto-layout">
          {info.isFlex && (
            <div className="align-grid" role="group" aria-label="Alignment in auto layout">
              {[0, 1, 2].map((r) =>
                [0, 1, 2].map((col) => (
                  <button
                    key={`${r}${col}`}
                    aria-label={`Align ${['top', 'middle', 'bottom'][r]} ${['left', 'center', 'right'][col]}`}
                    disabled={disabled}
                    className={activeCell.r === r && activeCell.col === col ? 'active' : ''}
                    onClick={() => set(info, cell(r, col), 'align-items')}
                  >
                    <i />
                  </button>
                )),
              )}
            </div>
          )}
          <div className="auto-fields">
            {info.isGrid && (
              <div className="field-grid">
                <NumberField label="Cols" value={gridCount(c?.gridTemplateColumns)} min={1} disabled={disabled} onCommit={(v) => set(info, { gridTemplateColumns: `repeat(${Math.max(1, Math.round(Number(v)))}, minmax(0, 1fr))` }, 'grid')} />
                <NumberField label="Rows" value={gridCount(c?.gridTemplateRows) || '—'} min={0} disabled={disabled} onCommit={(v) => set(info, { gridTemplateRows: Number(v) ? `repeat(${Math.round(Number(v))}, minmax(0, 1fr))` : null }, 'grid')} />
              </div>
            )}
            <NumberField
              label={row ? '↔' : '↕'}
              name="Gap between items"
              value={spaceBetween ? 'Auto' : gap === MIXED ? MIXED : parseFloat(String(gap)) || 0}
              keywords={['auto']}
              min={0}
              disabled={disabled}
              onCommit={(v) => set(info, v === 'auto' ? { justifyContent: 'space-between' } : { gap: v === '' ? null : v, ...(spaceBetween ? { justifyContent: null } : {}) }, 'gap')}
            />
          </div>
        </div>
      )}
      {info.isContainer && <Padding info={info} />}
      {info.isContainer && (
        <Checkbox label="Clip content" disabled={disabled} checked={c?.overflow === 'hidden' || c?.overflow === 'clip'} onChange={(on) => set(info, { overflow: on ? 'hidden' : null }, 'clip')} />
      )}
    </Section>
  );
}

function gridCount(template: string | undefined) {
  if (!template || template === 'none') return 0;
  return template.split(/\s+(?![^(]*\))/).length;
}

function MinMax({ info }: { info: Inspected }) {
  const tree = info.tree;
  const style = tree?.style ?? {};
  const classes = tree?.attrs.className ?? '';
  const declared = (prop: string, cls: string) => prop in style || new RegExp(`(^|\\s)${cls}-`).test(classes);
  const show = declared('minWidth', 'min-w') || declared('maxWidth', 'max-w') || declared('minHeight', 'min-h') || declared('maxHeight', 'max-h');
  const disabled = !info.stylable;
  const value = (prop: string) => {
    const v = info.value(prop);
    return v === MIXED ? MIXED : v === 'none' || v === 'auto' || v === '0px' ? '' : parseFloat(String(v)) || '';
  };
  if (!show)
    return (
      <button className="link-button" disabled={disabled} onClick={() => set(info, { maxWidth: Math.round(Number(info.number('width')) || 640) }, 'max')}>
        + Min / max
      </button>
    );
  return (
    <div className="field-grid quad">
      <NumberField label="Min W" value={value('minWidth')} disabled={disabled} min={0} onCommit={(v) => set(info, { minWidth: v === '' ? null : v }, 'min')} />
      <NumberField label="Max W" value={value('maxWidth')} disabled={disabled} min={0} onCommit={(v) => set(info, { maxWidth: v === '' ? null : v }, 'max')} />
      <NumberField label="Min H" value={value('minHeight')} disabled={disabled} min={0} onCommit={(v) => set(info, { minHeight: v === '' ? null : v }, 'min')} />
      <NumberField label="Max H" value={value('maxHeight')} disabled={disabled} min={0} onCommit={(v) => set(info, { maxHeight: v === '' ? null : v }, 'max')} />
    </div>
  );
}

function Padding({ info }: { info: Inspected }) {
  const disabled = !info.stylable;
  const side = (p: string) => info.number(p);
  const t = side('paddingTop');
  const r = side('paddingRight');
  const b = side('paddingBottom');
  const l = side('paddingLeft');
  const uniformX = r === l;
  const uniformY = t === b;
  const individual = !uniformX || !uniformY;
  const v = (n: number | typeof MIXED | undefined) => (n === undefined ? 0 : n);
  return individual ? (
    <div className="field-grid quad padding">
      <NumberField label="T" name="Top padding" value={v(t)} min={0} disabled={disabled} onCommit={(x) => set(info, { paddingTop: x === '' ? null : x }, 'padding')} />
      <NumberField label="R" name="Right padding" value={v(r)} min={0} disabled={disabled} onCommit={(x) => set(info, { paddingRight: x === '' ? null : x }, 'padding')} />
      <NumberField label="B" name="Bottom padding" value={v(b)} min={0} disabled={disabled} onCommit={(x) => set(info, { paddingBottom: x === '' ? null : x }, 'padding')} />
      <NumberField label="L" name="Left padding" value={v(l)} min={0} disabled={disabled} onCommit={(x) => set(info, { paddingLeft: x === '' ? null : x }, 'padding')} />
    </div>
  ) : (
    <div className="field-grid padding">
      <NumberField label="⇹" name="Horizontal padding" value={v(l)} min={0} disabled={disabled} onCommit={(x) => set(info, x === '' ? { paddingLeft: null, paddingRight: null } : { paddingLeft: x, paddingRight: x }, 'padding')} />
      <NumberField label="⇵" name="Vertical padding" value={v(t)} min={0} disabled={disabled} onCommit={(x) => set(info, x === '' ? { paddingTop: null, paddingBottom: null } : { paddingTop: x, paddingBottom: x }, 'padding')} />
    </div>
  );
}

export function MarginSection({ info }: { info: Inspected }) {
  const disabled = !info.stylable;
  const m = (p: string) => {
    const v = info.value(p);
    return v === MIXED ? MIXED : v === 'auto' ? 'auto' : parseFloat(String(v)) || 0;
  };
  return (
    <Section title="Margin" id="margin" collapsible>
      <div className="field-grid quad">
        {(['Top', 'Right', 'Bottom', 'Left'] as const).map((s) => (
          <NumberField key={s} label={s[0]} name={`${s} margin`} value={m(`margin${s}`)} keywords={['auto']} disabled={disabled} onCommit={(v) => set(info, { [`margin${s}`]: v === '' ? null : v }, 'margin')} />
        ))}
      </div>
    </Section>
  );
}

