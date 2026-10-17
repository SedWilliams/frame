import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, X } from 'lucide-react';

export function IconButton({
  label,
  children,
  active,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? 'active' : ''} ${className}`}
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  value,
  onCommit,
  suffix,
  type = 'text',
  ...props
}: {
  label: string;
  value: string | number;
  onCommit: (value: string) => void;
  suffix?: string;
  type?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <label className="field">
      <span>{label}</span>
      <input
        aria-label={label}
        value={draft}
        type={type}
        {...props}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => {
          if (event.currentTarget.value !== String(value)) onCommit(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            event.currentTarget.value = String(value);
            setDraft(String(value));
            event.currentTarget.blur();
          }
        }}
      />
      {suffix && <small>{suffix}</small>}
    </label>
  );
}

export function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
}) {
  return (
    <label className="select-field">
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
      <ChevronDown size={12} />
    </label>
  );
}

export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    dialog?.focus();
    function handle(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab' && dialog) {
        const elements = [
          ...dialog.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), textarea, select, [tabindex="0"]',
          ),
        ];
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first || document.activeElement === dialog)
        ) {
          event.preventDefault();
          last?.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last || document.activeElement === dialog)
        ) {
          event.preventDefault();
          first?.focus();
        }
      }
    }
    document.addEventListener('keydown', handle);
    return () => {
      document.removeEventListener('keydown', handle);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`modal ${wide ? 'wide' : ''}`}
      >
        <header className="modal-header">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <IconButton label="Close dialog" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </header>
        {children}
      </section>
    </div>
  );
}
