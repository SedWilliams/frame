/*
 * Quick actions (Cmd+K). One search box over every command, every page, every
 * layer on the current page, and every component to insert.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Component, FileText, Layers, Search, Zap } from 'lucide-react';
import { commands, displayKeys } from '../app/commands';
import { activeIndex, COMPONENTS_PAGE, get, pagesOf, select, set, workspace } from '../app/state';
import { insertComponent } from '../app/actions';
import { selectable } from '../app/selection';
import { openPage } from '../canvas/Canvas';

interface Entry {
  id: string;
  label: string;
  detail?: string;
  icon: ReactNode;
  run: () => void;
  disabled?: boolean;
}

export function Palette() {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const close = () => set({ palette: false });

  const entries = useMemo<Entry[]>(() => {
    const state = get();
    const list: Entry[] = commands.map((command) => ({
      id: `cmd:${command.id}`,
      label: command.label,
      detail: command.keys?.[0] ? displayKeys(command.keys[0]) : command.group,
      icon: <Zap size={14} />,
      run: command.run,
      disabled: !!command.when && !command.when(),
    }));
    for (const page of pagesOf(state))
      list.push({ id: `page:${page.id}`, label: `Go to ${page.name}`, detail: page.route, icon: <FileText size={14} />, run: () => openPage(page.id) });
    list.push({ id: 'page:components', label: 'Go to Components', detail: 'Every component', icon: <Component size={14} />, run: () => openPage(COMPONENTS_PAGE) });
    for (const entry of workspace(state).components())
      list.push({ id: `insert:${entry.id}`, label: `Insert ${entry.name}`, detail: entry.file, icon: <Component size={14} />, run: () => insertComponent(entry) });
    const index = activeIndex(state);
    if (index)
      for (const node of index.byKey.values())
        if (selectable(node) && node.kind !== 'text')
          list.push({ id: `layer:${node.key}`, label: node.name, detail: `Layer · ${node.tag}`, icon: <Layers size={14} />, run: () => select([node.key]) });
    return list;
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries.filter((e) => e.id.startsWith('cmd:') && !e.disabled).slice(0, 60);
    const words = q.split(/\s+/);
    return entries
      .map((entry) => {
        const text = `${entry.label} ${entry.detail ?? ''}`.toLowerCase();
        if (!words.every((w) => text.includes(w))) return undefined;
        const score = (entry.label.toLowerCase().startsWith(q) ? 0 : 1) + (entry.disabled ? 2 : 0) + (entry.id.startsWith('layer:') ? 1 : 0);
        return { entry, score };
      })
      .filter((r): r is { entry: Entry; score: number } => !!r)
      .sort((a, b) => a.score - b.score)
      .slice(0, 60)
      .map((r) => r.entry);
  }, [entries, query]);

  const run = (entry: Entry | undefined) => {
    if (!entry || entry.disabled) return;
    close();
    entry.run();
  };

  return (
    <div className="palette-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-label="Quick actions">
        <label className="palette-search">
          <Search size={15} />
          <input
            ref={input}
            aria-label="Search actions, pages, layers, and components"
            placeholder="Search actions, pages, layers, components…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') close();
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(results.length - 1, a + 1));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              }
              if (e.key === 'Enter') run(results[active]);
            }}
          />
        </label>
        <div className="palette-results" role="listbox">
          {results.map((entry, i) => (
            <button
              key={entry.id}
              role="option"
              aria-selected={i === active}
              className={`${i === active ? 'active' : ''}${entry.disabled ? ' disabled' : ''}`}
              onPointerEnter={() => setActive(i)}
              onClick={() => run(entry)}
            >
              {entry.icon}
              <span>{entry.label}</span>
              <small>{entry.detail}</small>
            </button>
          ))}
          {!results.length && <p className="muted">Nothing matches “{query}”.</p>}
        </div>
      </div>
    </div>
  );
}
