/*
 * Panel controls.
 *
 * Figma's property fields: a number field whose label you drag to scrub the
 * value, that takes arithmetic such as `12*2`, steps with the arrow keys, and
 * shows Mixed for a mixed selection. Plus text fields, selects, segmented
 * buttons, icon buttons, and collapsible sections. Fields keep a local draft and
 * commit on Enter or blur, so an edit is one undo step.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Minus, Plus } from 'lucide-react';

export const MIXED = Symbol('mixed');
export type FieldValue = string | number | typeof MIXED | undefined;

/** Evaluates arithmetic typed into a number field, such as `24 / 2` or `(8 + 4) * 2`. */
export function evaluateNumber(text: string): number | undefined {
  const s = text.replace(/px$/i, '').replace(/\s+/g, '');
  let i = 0;
  const expr = (): number => {
    let v = term();
    while (s[i] === '+' || s[i] === '-') {
      const op = s[i++];
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  const term = (): number => {
    let v = factor();
    while (s[i] === '*' || s[i] === '/') {
      const op = s[i++];
      const r = factor();
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  const factor = (): number => {
    if (s[i] === '-') return i++, -factor();
    if (s[i] === '+') return i++, factor();
    if (s[i] === '(') {
      i++;
      const v = expr();
      if (s[i++] !== ')') throw new Error('unbalanced');
      return v;
    }
    const m = /^\d*\.?\d+/.exec(s.slice(i));
    if (!m) throw new Error('not a number');
    i += m[0].length;
    return Number(m[0]);
  };
  try {
    const value = expr();
    return i === s.length && Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

const display = (value: FieldValue, digits = 2) =>
  value === MIXED ? 'Mixed' : value === undefined ? '' : typeof value === 'number' ? String(Math.round(value * 10 ** digits) / 10 ** digits) : value;

interface NumberFieldProps {
  label: ReactNode;
  /** Accessible name. Defaults to the label when it's text. */
  name?: string;
  value: FieldValue;
  onCommit: (value: number | string) => void;
  /** Called while scrubbing, for live preview. Commits still go through onCommit. */
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  /** Words the field accepts besides numbers, such as `auto`. */
  keywords?: string[];
  disabled?: boolean;
  title?: string;
  className?: string;
}

/** A number field. Drag its label sideways to scrub; Shift scrubs by 10. */
export function NumberField({ label, name, value, onCommit, min, max, step = 1, suffix, keywords = [], disabled, title, className }: NumberFieldProps) {
  const [draft, setDraft] = useState(display(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(display(value));
  }, [value]);
  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  const commit = (text: string) => {
    const trimmed = text.trim();
    if (trimmed === display(value)) return;
    if (!trimmed) return onCommit('');
    if (keywords.includes(trimmed.toLowerCase())) return onCommit(trimmed.toLowerCase());
    const n = evaluateNumber(trimmed);
    if (n !== undefined) onCommit(clamp(n));
    else if (/^-?\d*\.?\d+(px|%|rem|em|vh|vw|fr|deg|ch)$/.test(trimmed) || keywords.length === 0) onCommit(trimmed);
    else setDraft(display(value));
  };
  const scrub = (event: React.PointerEvent) => {
    if (disabled || value === MIXED) return;
    event.preventDefault();
    const start = event.clientX;
    const base = typeof value === 'number' ? value : (parseFloat(String(value ?? '0')) || 0);
    let last = base;
    const move = (e: PointerEvent) => {
      const delta = Math.round((e.clientX - start) / 2) * step * (e.shiftKey ? 10 : 1);
      const next = clamp(Math.round((base + delta) * 100) / 100);
      if (next !== last) {
        last = next;
        setDraft(display(next));
        onCommit(next);
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('scrubbing');
    };
    document.body.classList.add('scrubbing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const accessible = name ?? (typeof label === 'string' ? label : undefined);
  return (
    <label className={`field number${disabled ? ' disabled' : ''}${className ? ` ${className}` : ''}`} title={title ?? accessible}>
      <span className="field-label" onPointerDown={scrub}>
        {label}
      </span>
      <input
        aria-label={accessible}
        value={draft}
        disabled={disabled}
        placeholder={value === MIXED ? 'Mixed' : undefined}
        onFocus={(e) => {
          focused.current = true;
          e.currentTarget.select();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => {
          focused.current = false;
          commit(e.currentTarget.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          else if (e.key === 'Escape') {
            setDraft(display(value));
            focused.current = false;
            requestAnimationFrame(() => e.currentTarget?.blur());
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const current = evaluateNumber(draft) ?? (typeof value === 'number' ? value : 0);
            const next = clamp(Math.round((current + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)) * 100) / 100);
            setDraft(display(next));
            onCommit(next);
          }
          e.stopPropagation();
        }}
      />
      {suffix && <small>{suffix}</small>}
    </label>
  );
}

/** A text field that commits on Enter or blur. */
export function TextField({ label, value, onCommit, placeholder, disabled, multiline, name, className }: {
  label?: ReactNode;
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  multiline?: boolean;
  name?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  const props = {
    'aria-label': name ?? (typeof label === 'string' ? label : placeholder),
    value: draft,
    placeholder,
    disabled,
    onFocus: () => (focused.current = true),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: () => {
      focused.current = false;
      if (draft !== value) onCommit(draft);
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      e.stopPropagation();
      if (e.key === 'Enter' && (!multiline || !e.shiftKey)) {
        e.preventDefault();
        e.currentTarget.blur();
      }
      if (e.key === 'Escape') {
        setDraft(value);
        focused.current = false;
        requestAnimationFrame(() => (e.target as HTMLElement)?.blur());
      }
    },
  };
  return (
    <label className={`field text${multiline ? ' multiline' : ''}${className ? ` ${className}` : ''}`}>
      {label !== undefined && <span className="field-label">{label}</span>}
      {multiline ? <textarea {...props} rows={3} /> : <input {...props} />}
    </label>
  );
}

export function Select({ value, options, onChange, name, disabled, className }: {
  value: string;
  options: (string | [string, string])[];
  onChange: (value: string) => void;
  name: string;
  disabled?: boolean;
  className?: string;
}) {
  const list = options.map((o) => (typeof o === 'string' ? [o, o] : o));
  const known = list.some(([v]) => v === value);
  return (
    <label className={`select${className ? ` ${className}` : ''}`}>
      <select aria-label={name} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {!known && <option value={value}>{value || '—'}</option>}
        {list.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
      <ChevronDown size={12} />
    </label>
  );
}

export function IconButton({ label, children, active, className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button type="button" className={`icon-button${active ? ' active' : ''}${className ? ` ${className}` : ''}`} aria-label={label} title={label} aria-pressed={active} {...props}>
      {children}
    </button>
  );
}

/** A row of icon buttons where one is chosen. */
export function Segmented<T extends string>({ value, options, onChange, name, disabled }: {
  value: T | undefined;
  options: { value: T; label: string; icon: ReactNode }[];
  onChange: (value: T) => void;
  name: string;
  disabled?: boolean;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={name}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          aria-label={option.label}
          title={option.label}
          disabled={disabled}
          className={value === option.value ? 'active' : ''}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
        </button>
      ))}
    </div>
  );
}

/** A panel section. `onAdd` shows a + button, as Fill and Effects have in Figma. */
export function Section({ title, children, onAdd, addLabel, actions, collapsible = false, empty, id }: {
  title: string;
  children?: ReactNode;
  onAdd?: () => void;
  addLabel?: string;
  actions?: ReactNode;
  collapsible?: boolean;
  /** Rendered with a dimmed title when there's nothing in it yet. */
  empty?: boolean;
  id?: string;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className={`panel-section${empty ? ' empty' : ''}`} data-section={id ?? title}>
      <header>
        {collapsible ? (
          <button className="section-title" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {title}
          </button>
        ) : (
          <h3 className="section-title">{title}</h3>
        )}
        <div className="section-actions">
          {actions}
          {onAdd && (
            <IconButton label={addLabel ?? `Add ${title.toLowerCase()}`} onClick={onAdd}>
              <Plus size={14} />
            </IconButton>
          )}
        </div>
      </header>
      {open && children && <div className="section-body">{children}</div>}
    </section>
  );
}

/** The remove button at the end of a fill, stroke, or effect row. */
export function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <IconButton label={label} onClick={onClick} className="remove">
      <Minus size={14} />
    </IconButton>
  );
}

export function Checkbox({ checked, onChange, label, disabled }: { checked: boolean; onChange: (checked: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className="checkbox">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
