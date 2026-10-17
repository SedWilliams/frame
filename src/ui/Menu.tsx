/*
 * Menus: the main menu behind the Frame logo, the canvas and layer context menu,
 * and dropdowns. Items come from the command list, so labels, shortcuts, checked
 * states, and enabled states always match what the keyboard does.
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronRight } from 'lucide-react';
import { commandById, displayKeys, runCommand, type Command } from '../app/commands';

export type MenuItem =
  | { kind: 'command'; id: string; label?: string }
  | { kind: 'action'; label: string; run: () => void; keys?: string; disabled?: boolean; checked?: boolean; icon?: ReactNode }
  | { kind: 'submenu'; label: string; items: MenuItem[] }
  | { kind: 'separator' }
  | { kind: 'heading'; label: string };

export const cmd = (id: string, label?: string): MenuItem => ({ kind: 'command', id, label });
export const sep: MenuItem = { kind: 'separator' };

export function Menu({ items, x, y, onClose, className }: { items: MenuItem[]; x: number; y: number; onClose: () => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });
  const [open, setOpen] = useState<number | null>(null);

  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setPosition({
      x: Math.max(4, Math.min(x, window.innerWidth - box.width - 4)),
      y: Math.max(4, Math.min(y, window.innerHeight - box.height - 4)),
    });
  }, [x, y]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('.menu')) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [onClose]);

  return createPortal(
    <div ref={ref} className={`menu${className ? ` ${className}` : ''}`} role="menu" style={{ left: position.x, top: position.y }}>
      {items.map((item, i) => {
        if (item.kind === 'separator') return <hr key={i} />;
        if (item.kind === 'heading') return <div key={i} className="menu-heading">{item.label}</div>;
        if (item.kind === 'submenu')
          return (
            <div key={i} className="menu-sub" onPointerEnter={() => setOpen(i)} onPointerLeave={() => setOpen((o) => (o === i ? null : o))}>
              <button role="menuitem" className="menu-item" aria-haspopup="menu" onClick={() => setOpen(i)}>
                <span className="menu-check" />
                <span className="menu-label">{item.label}</span>
                <ChevronRight size={12} />
              </button>
              {open === i && <SubMenu items={item.items} onClose={onClose} />}
            </div>
          );
        return <MenuRow key={i} item={item} onClose={onClose} />;
      })}
    </div>,
    document.body,
  );
}

function SubMenu({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  return (
    <div className="menu submenu" role="menu">
      {items.map((item, i) =>
        item.kind === 'separator' ? <hr key={i} /> : item.kind === 'heading' ? <div key={i} className="menu-heading">{item.label}</div> : item.kind === 'submenu' ? null : <MenuRow key={i} item={item} onClose={onClose} />,
      )}
    </div>
  );
}

function MenuRow({ item, onClose }: { item: Exclude<MenuItem, { kind: 'separator' | 'submenu' | 'heading' }>; onClose: () => void }) {
  let label: string;
  let keys: string | undefined;
  let disabled = false;
  let checked: boolean | undefined;
  let run: () => void;
  let icon: ReactNode = null;
  if (item.kind === 'command') {
    const command = commandById.get(item.id) as Command | undefined;
    if (!command) return null;
    label = item.label ?? command.label;
    keys = command.keys?.[0];
    disabled = !!command.when && !command.when();
    checked = command.checked?.();
    run = () => runCommand(item.id);
  } else {
    ({ label, disabled = false, checked, run, icon = null } = item);
    keys = item.keys;
  }
  return (
    <button
      role="menuitem"
      className="menu-item"
      disabled={disabled}
      onClick={() => {
        onClose();
        run();
      }}
    >
      <span className="menu-check">{checked ? <Check size={12} /> : icon}</span>
      <span className="menu-label">{label}</span>
      {keys && <kbd>{displayKeys(keys)}</kbd>}
    </button>
  );
}

/** Figma's main menu, grouped as Figma groups it. */
export function mainMenuItems(): MenuItem[] {
  return [
    { kind: 'submenu', label: 'File', items: [cmd('save'), cmd('done'), cmd('changes'), sep, cmd('new-page'), cmd('open'), sep, cmd('export'), cmd('copy-png')] },
    {
      kind: 'submenu',
      label: 'Edit',
      items: [cmd('undo'), cmd('redo'), sep, cmd('copy'), cmd('cut'), cmd('paste'), cmd('duplicate'), cmd('delete'), sep, cmd('select-all'), cmd('select-none'), cmd('find'), sep, cmd('copy-properties'), cmd('paste-properties'), sep, cmd('variables')],
    },
    {
      kind: 'submenu',
      label: 'View',
      items: [cmd('rulers'), cmd('outline'), cmd('grids'), cmd('comments'), sep, cmd('left-panel'), cmd('right-panel'), cmd('hide-ui'), sep, cmd('zoom-in'), cmd('zoom-out'), cmd('zoom-100'), cmd('zoom-fit'), cmd('zoom-selection'), sep, cmd('add-desktop'), cmd('add-tablet'), cmd('add-mobile'), sep, cmd('previous-page'), cmd('next-page'), cmd('present')],
    },
    {
      kind: 'submenu',
      label: 'Object',
      items: [
        cmd('frame-selection'), cmd('group'), cmd('ungroup'), sep, cmd('add-auto-layout'), cmd('remove-auto-layout'), sep,
        cmd('create-component'), cmd('main-component'), cmd('detach'), sep, cmd('bring-front'), cmd('bring-forward'), cmd('send-backward'), cmd('send-back'),
        sep, cmd('flip-h'), cmd('flip-v'), cmd('rotate-90'), cmd('rotate-180'), sep, cmd('wrap-link'), cmd('hide'), cmd('lock'), cmd('rename'),
      ],
    },
    {
      kind: 'submenu',
      label: 'Text',
      items: [cmd('bold'), cmd('italic'), cmd('underline'), cmd('strikethrough'), sep, cmd('align-text-left'), cmd('align-text-center'), cmd('align-text-right'), cmd('align-text-justify'), sep, cmd('uppercase'), cmd('lowercase'), cmd('titlecase'), sep, cmd('font-bigger'), cmd('font-smaller')],
    },
    {
      kind: 'submenu',
      label: 'Arrange',
      items: [cmd('align-left'), cmd('align-hcenter'), cmd('align-right'), sep, cmd('align-top'), cmd('align-vcenter'), cmd('align-bottom'), sep, cmd('distribute-h'), cmd('distribute-v')],
    },
    {
      kind: 'submenu',
      label: 'Preferences',
      items: [cmd('pref-autosave'), cmd('pref-snapping'), cmd('pref-inline'), cmd('pref-responsive'), sep, cmd('theme-light'), cmd('theme-dark'), cmd('theme-system')],
    },
    sep,
    cmd('quick-actions'),
    cmd('shortcuts'),
  ];
}

/** The context menu for a canvas or layer right-click. */
export function contextMenuItems(): MenuItem[] {
  return [
    cmd('copy'), cmd('cut'), cmd('paste', 'Paste here'), cmd('duplicate'), cmd('delete'), sep,
    { kind: 'submenu', label: 'Copy/Paste as', items: [cmd('copy-png'), cmd('copy-properties'), cmd('paste-properties')] }, sep,
    cmd('select-parent'), cmd('select-children'), sep,
    cmd('bring-front'), cmd('bring-forward'), cmd('send-backward'), cmd('send-back'), sep,
    cmd('frame-selection'), cmd('group'), cmd('ungroup'), cmd('add-auto-layout'), cmd('remove-auto-layout'), sep,
    cmd('create-component'), cmd('main-component'), cmd('detach'), sep,
    cmd('flip-h'), cmd('flip-v'), sep,
    cmd('hide'), cmd('lock'), cmd('rename'), sep,
    cmd('tool-comment', 'Add comment'),
  ];
}
