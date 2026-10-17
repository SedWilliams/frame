/*
 * The left panel: the main menu and project name on top, then two tabs. File
 * holds Pages, every route in the app plus a Components page, and the layer
 * tree. Assets holds the project's components and basic elements, which a
 * click inserts at the selection and a drag places on the canvas.
 */

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Component, Diamond, FileText, Plus, Search, Square, Type, Heading, MousePointer2, Link, Image, TextCursorInput, List, Minus, LayoutTemplate, Pilcrow } from 'lucide-react';
import { COMPONENTS_PAGE, pagesOf, set, setUI, useEditor, workspace } from '../app/state';
import { insertComponent, insertElement } from '../app/actions';
import { openPage } from '../canvas/Canvas';
import type { InsertType } from '../core/model';
import type { ComponentEntry } from '../core/workspace';
import { IconButton } from '../ui/controls';
import { Menu, mainMenuItems } from '../ui/Menu';
import { Layers } from './Layers';

export function LeftPanel() {
  const tab = useEditor((s) => s.ui.leftTab);
  const name = useEditor((s) => s.config.name);
  const mode = useEditor((s) => s.backend?.label);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  return (
    <aside className="left-panel" aria-label="Pages and layers">
      <header className="panel-header">
        <button
          className="logo-button"
          aria-label="Main menu"
          onClick={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            setMenu({ x: box.left, y: box.bottom + 4 });
          }}
        >
          <span className="logo-mark" aria-hidden>
            <i />
            <i />
          </span>
          <ChevronDown size={12} />
        </button>
        <div className="project-title">
          <strong title={name}>{name}</strong>
          {mode && <span className="mode-chip">{mode}</span>}
        </div>
      </header>
      <nav className="panel-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'file'} className={tab === 'file' ? 'active' : ''} onClick={() => setUI({ leftTab: 'file' })}>
          File
        </button>
        <button role="tab" aria-selected={tab === 'assets'} className={tab === 'assets' ? 'active' : ''} onClick={() => setUI({ leftTab: 'assets' })}>
          Assets
        </button>
      </nav>
      {tab === 'file' ? <FileTab /> : <Assets />}
      {menu && <Menu items={mainMenuItems()} x={menu.x} y={menu.y} onClose={() => setMenu(null)} className="main-menu" />}
    </aside>
  );
}

function FileTab() {
  const pages = useEditor((s) => pagesOf(s));
  const pageId = useEditor((s) => s.pageId);
  const [pagesOpen, setPagesOpen] = useState(true);
  const [query, setQuery] = useState('');
  return (
    <div className="file-tab">
      <section className="pages">
        <header>
          <button className="section-title" onClick={() => setPagesOpen(!pagesOpen)} aria-expanded={pagesOpen}>
            {pagesOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Pages
          </button>
          <IconButton label="Add page" onClick={() => set({ dialog: { kind: 'new-page' } })}>
            <Plus size={14} />
          </IconButton>
        </header>
        {pagesOpen && (
          <ul role="listbox" aria-label="Pages">
            {pages.map((page) => (
              <li key={page.id}>
                <button role="option" aria-selected={page.id === pageId} className={page.id === pageId ? 'active' : ''} onClick={() => openPage(page.id)} title={page.file}>
                  <FileText size={13} />
                  <span>{page.name}</span>
                  <small>{page.route}</small>
                </button>
              </li>
            ))}
            <li>
              <button role="option" aria-selected={pageId === COMPONENTS_PAGE} className={`components-page${pageId === COMPONENTS_PAGE ? ' active' : ''}`} onClick={() => openPage(COMPONENTS_PAGE)}>
                <Component size={13} />
                <span>Components</span>
              </button>
            </li>
          </ul>
        )}
      </section>
      <section className="layers">
        <header>
          <h3 className="section-title">Layers</h3>
        </header>
        <label className="search">
          <Search size={13} />
          <input aria-label="Search layers" placeholder="Find layer" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        </label>
        <Layers query={query} />
      </section>
    </div>
  );
}

const elements: { type: InsertType; label: string; icon: React.ReactNode }[] = [
  { type: 'frame', label: 'Frame', icon: <Square size={18} /> },
  { type: 'section', label: 'Section', icon: <LayoutTemplate size={18} /> },
  { type: 'heading', label: 'Heading', icon: <Heading size={18} /> },
  { type: 'paragraph', label: 'Paragraph', icon: <Pilcrow size={18} /> },
  { type: 'text', label: 'Text', icon: <Type size={18} /> },
  { type: 'button', label: 'Button', icon: <MousePointer2 size={18} /> },
  { type: 'link', label: 'Link', icon: <Link size={18} /> },
  { type: 'image', label: 'Image', icon: <Image size={18} /> },
  { type: 'input', label: 'Input', icon: <TextCursorInput size={18} /> },
  { type: 'list', label: 'List', icon: <List size={18} /> },
  { type: 'divider', label: 'Divider', icon: <Minus size={18} /> },
];

function Assets() {
  const components = useEditor((s) => workspace(s).components());
  const [query, setQuery] = useState('');
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const map = new Map<string, ComponentEntry[]>();
    for (const entry of components) {
      if (q && !`${entry.name} ${entry.file}`.toLowerCase().includes(q)) continue;
      const folder = entry.file.includes('/') ? entry.file.slice(0, entry.file.lastIndexOf('/')) : '/';
      map.set(folder, [...(map.get(folder) ?? []), entry]);
    }
    return [...map.entries()];
  }, [components, query]);

  return (
    <div className="assets">
      <label className="search">
        <Search size={13} />
        <input aria-label="Search assets" placeholder="Search assets" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      </label>
      <section>
        <h3 className="section-title">Elements</h3>
        <div className="element-grid">
          {elements
            .filter((el) => !query || el.label.toLowerCase().includes(query.toLowerCase()))
            .map((el) => (
              <button
                key={el.type}
                className="element-card"
                draggable
                onDragStart={(e) => e.dataTransfer.setData('application/frame-element', el.type)}
                onClick={() => insertElement(el.type)}
                title={`Insert ${el.label.toLowerCase()}`}
              >
                {el.icon}
                <span>{el.label}</span>
              </button>
            ))}
        </div>
      </section>
      <section>
        <h3 className="section-title">Local components</h3>
        {groups.length ? (
          groups.map(([folder, entries]) => (
            <div key={folder} className="component-group">
              <div className="component-folder">{folder}</div>
              {entries.map((entry) => (
                <button
                  key={entry.id}
                  className="component-row"
                  draggable={!!entry.exportName}
                  onDragStart={(e) => e.dataTransfer.setData('application/frame-component', entry.id)}
                  onClick={() => insertComponent(entry)}
                  title={entry.exportName ? `Insert ${entry.name}` : `${entry.name} isn't exported`}
                >
                  <Diamond size={13} className="icon-component" />
                  <span>{entry.name}</span>
                  {entry.props.some((p) => p.type === 'enum') && <small>Variants</small>}
                </button>
              ))}
            </div>
          ))
        ) : (
          <p className="panel-empty">{query ? 'No components match.' : 'No components found. Components are capitalized functions that return JSX.'}</p>
        )}
      </section>
    </div>
  );
}
