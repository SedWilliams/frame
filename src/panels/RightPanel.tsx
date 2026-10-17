/*
 * The right panel.
 *
 * The header shows the save state, Present, the zoom menu, and, when an agent
 * started Frame, the Done button that hands the session back. Below it are
 * Figma's three tabs: Design, Prototype, and Dev. With nothing selected the
 * panel shows the page's settings, and with a frame label selected, the frame's.
 */

import { useState } from 'react';
import { ChevronDown, Code2, Component, LayoutGrid, Moon, Play, Plus, Sun, Trash2, CheckCircle2, Loader2, AlertTriangle, CircleDot } from 'lucide-react';
import { COMPONENTS_PAGE, currentPage, currentView, get, set, setPrefs, updateView, useEditor, workspace, type LayoutGrid as Grid } from '../app/state';
import { runCommand } from '../app/commands';
import { saveAll } from '../app/session';
import { addFrame, framePresets, zoomAround, zoomBy, zoomToFit, zoomToSelection } from '../canvas/Canvas';
import { IconButton, NumberField, RemoveButton, Section, Select, TextField } from '../ui/controls';
import { ColorSwatch } from '../ui/ColorPicker';
import { Menu, cmd, sep } from '../ui/Menu';
import { useInspect } from './inspect';
import { AlignSection, InstanceSection, LayoutSection, MarginSection, PositionSection } from './design/LayoutSections';
import { AppearanceSection, EffectsSection, ExportSection, FillSection, SelectionColors, StrokeSection, TypographySection } from './design/StyleSections';
import { PrototypePanel } from './Prototype';
import { DevPanel } from './Dev';
import { LayerIcon } from './Layers';

export function RightPanel() {
  const tab = useEditor((s) => s.ui.rightTab);
  const frameSelected = useEditor((s) => s.frameSelected);
  const hasSelection = useEditor((s) => s.selection.length > 0);
  return (
    <aside className="right-panel" aria-label="Properties">
      <PanelHeader />
      <nav className="panel-tabs" role="tablist">
        {(['design', 'prototype', 'dev'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => set((s) => ({ ui: { ...s.ui, rightTab: t } }))}>
            {t === 'dev' ? (
              <>
                <Code2 size={12} /> Dev
              </>
            ) : (
              t[0].toUpperCase() + t.slice(1)
            )}
          </button>
        ))}
      </nav>
      <div className="panel-scroll">
        {frameSelected ? <FrameSettings id={frameSelected} /> : !hasSelection ? <PageSettings /> : tab === 'design' ? <DesignTab /> : tab === 'prototype' ? <PrototypePanel /> : <DevPanel />}
      </div>
    </aside>
  );
}

function PanelHeader() {
  const saveState = useEditor((s) => s.saveState);
  const autosave = useEditor((s) => s.prefs.autosave);
  const zoom = useEditor((s) => currentView(s)?.zoom ?? 1);
  const canFinish = useEditor((s) => !!s.backend?.done);
  const conflicts = useEditor((s) => Object.keys(s.conflicts).length);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const status = conflicts
    ? { icon: <AlertTriangle size={13} />, text: `${conflicts} conflict${conflicts > 1 ? 's' : ''}`, className: 'error' }
    : saveState === 'saving'
      ? { icon: <Loader2 size={13} className="spin" />, text: 'Saving', className: '' }
      : saveState === 'unsaved'
        ? { icon: <CircleDot size={13} />, text: autosave ? 'Saving soon' : 'Unsaved', className: 'unsaved' }
        : saveState === 'error'
          ? { icon: <AlertTriangle size={13} />, text: 'Not saved', className: 'error' }
          : { icon: <CheckCircle2 size={13} />, text: 'Saved', className: 'saved' };
  return (
    <header className="panel-header right">
      <button className={`save-state ${status.className}`} title={conflicts ? 'Some files changed on disk while you edited them' : autosave ? 'Changes save automatically' : 'Save with ⌘S'} onClick={() => (conflicts ? set({ dialog: { kind: 'changes' } }) : void saveAll())}>
        {status.icon}
        <span>{status.text}</span>
      </button>
      <IconButton label="Present" onClick={() => runCommand('present')}>
        <Play size={14} />
      </IconButton>
      <button
        className="zoom-button"
        aria-label="Zoom and view options"
        onClick={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          setMenu({ x: box.right - 220, y: box.bottom + 4 });
        }}
      >
        {Math.round(zoom * 100)}%
        <ChevronDown size={11} />
      </button>
      {canFinish && (
        <button className="primary-button done-button" onClick={() => set({ dialog: { kind: 'done' } })} title="Save everything and hand the session back to your agent">
          Done
        </button>
      )}
      {menu && (
        <Menu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { kind: 'action', label: 'Zoom in', keys: 'Mod+=', run: () => zoomBy(1.25) },
            { kind: 'action', label: 'Zoom out', keys: 'Mod+-', run: () => zoomBy(0.8) },
            { kind: 'action', label: 'Zoom to fit', keys: 'Shift+1', run: zoomToFit },
            { kind: 'action', label: 'Zoom to selection', keys: 'Shift+2', run: zoomToSelection },
            sep,
            { kind: 'action', label: 'Zoom to 50%', run: () => zoomAround(0.5) },
            { kind: 'action', label: 'Zoom to 100%', keys: 'Shift+0', run: () => zoomAround(1) },
            { kind: 'action', label: 'Zoom to 200%', run: () => zoomAround(2) },
            sep,
            cmd('rulers'),
            cmd('outline'),
            cmd('grids'),
            cmd('comments'),
            sep,
            { kind: 'action', label: 'Save changes automatically', checked: autosave, run: () => setPrefs({ autosave: !autosave }) },
          ]}
        />
      )}
    </header>
  );
}

function DesignTab() {
  const info = useInspect();
  if (!info) return null;
  const { primary } = info;
  const isSvgChild = /^(path|circle|rect|line|polyline|polygon|ellipse|g)$/.test(primary.tag);
  return (
    <div className="design-tab">
      <div className="selection-header">
        <span className={`selection-icon${primary.kind === 'instance' || info.insideInstance ? ' component' : ''}`}>
          <LayerIcon node={primary} frame={info.frame} />
        </span>
        <div>
          <strong>{info.nodes.length > 1 ? `${info.nodes.length} layers` : primary.name}</strong>
          <small>{primary.kind === 'instance' ? `Instance of ${primary.component?.name}` : primary.kind === 'text' ? 'Text' : primary.kind === 'placeholder' ? 'Dynamic content' : `<${primary.tag}>`}</small>
        </div>
      </div>
      {info.insideInstance && (
        <div className="banner component">
          <Component size={13} />
          <span>
            Editing <strong>{info.sharedFile}</strong>. Changes apply to every instance.
          </span>
        </div>
      )}
      {!info.insideInstance && info.sharedFile && (
        <div className="banner">
          <LayoutGrid size={13} />
          <span>
            From <strong>{info.sharedFile}</strong>, shared by other pages.
          </span>
        </div>
      )}
      {primary.repeated && <div className="banner">This layer repeats for each item in a list. Style changes apply to every item.</div>}
      {primary.kind === 'placeholder' ? (
        <p className="hint">This comes from code Frame can't evaluate, such as fetched data. Edit it in code, or leave a comment for your agent.</p>
      ) : (
        <>
          <InstanceSection info={info} />
          {!info.stylable && primary.kind !== 'instance' && <p className="hint">{primary.locked ? 'Unlock this layer to edit it.' : 'This layer can only be changed in code.'}</p>}
          <AlignSection info={info} />
          <PositionSection info={info} />
          {!isSvgChild && <LayoutSection info={info} />}
          <AppearanceSection info={info} />
          {info.isText && <TypographySection info={info} />}
          <FillSection info={info} />
          <StrokeSection info={info} />
          <EffectsSection info={info} />
          {info.isContainer && <MarginSection info={info} />}
          {info.isContainer && <SelectionColors info={info} />}
          <ExportSection info={info} />
        </>
      )}
    </div>
  );
}

function PageSettings() {
  const page = useEditor((s) => currentPage(s));
  const pageId = useEditor((s) => s.pageId);
  const view = useEditor((s) => currentView(s));
  const frames = view?.frames ?? [];
  const tailwind = useEditor((s) => !!workspace(s).styles().tailwind);
  const framework = useEditor((s) => workspace(s).framework);
  const styling = useEditor((s) => s.prefs.styling);
  const responsive = useEditor((s) => s.prefs.responsive);
  const allComments = useEditor((s) => s.comments);
  const comments = allComments.filter((c) => !c.resolved);
  return (
    <div className="page-settings">
      <Section title={pageId === COMPONENTS_PAGE ? 'Components' : 'Page'} id="page">
        {page ? (
          <dl className="facts">
            <dt>Route</dt>
            <dd>{page.route}</dd>
            <dt>File</dt>
            <dd title={page.file}>{page.file}</dd>
            {page.target.layouts?.length ? (
              <>
                <dt>Layouts</dt>
                <dd>{page.target.layouts.join(', ')}</dd>
              </>
            ) : null}
          </dl>
        ) : (
          <p className="hint">Every component in the project, each in its own frame. Edits here change the component everywhere it's used.</p>
        )}
      </Section>
      {pageId !== COMPONENTS_PAGE && (
        <Section title="Frames" id="frames">
          <p className="hint">Each frame shows this page at one width. Add more to edit every breakpoint side by side.</p>
          <div className="frame-presets">
            {framePresets.map((preset) => (
              <button key={preset.name} className="secondary-button" onClick={() => addFrame(preset)} disabled={frames.some((f) => f.width === preset.width)}>
                <Plus size={12} /> {preset.name} <small>{preset.width}</small>
              </button>
            ))}
          </div>
        </Section>
      )}
      <Section title="Styles" id="styles">
        <dl className="facts">
          <dt>Framework</dt>
          <dd>{{ 'next-app': 'Next.js app router', 'next-pages': 'Next.js pages router', 'react-router': 'React Router', vite: 'Vite', unknown: 'React' }[framework]}</dd>
          <dt>Styling</dt>
          <dd>{tailwind && styling !== 'inline' ? 'Tailwind classes' : 'Inline styles'}</dd>
        </dl>
        {tailwind && (
          <>
            <label className="checkbox">
              <input type="checkbox" checked={styling === 'inline'} onChange={(e) => setPrefs({ styling: e.target.checked ? 'inline' : 'auto' })} />
              <span>Write inline styles instead of classes</span>
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={responsive} onChange={(e) => setPrefs({ responsive: e.target.checked })} />
              <span>Edits in wider frames write breakpoint classes (md:, lg:)</span>
            </label>
          </>
        )}
        <button className="secondary-button wide" onClick={() => set({ dialog: { kind: 'variables' } })}>
          Local variables
        </button>
      </Section>
      {comments.length > 0 && (
        <Section title={`Comments · ${comments.length}`} id="comments">
          <ul className="comment-list">
            {comments.map((comment) => (
              <li key={comment.id}>
                <button onClick={() => set({ openComment: comment.id, ui: { ...get().ui, commentsVisible: true } })}>
                  <p>{comment.text}</p>
                  <small>
                    {comment.element} {comment.file ? `· ${comment.file}${comment.line ? `:${comment.line}` : ''}` : ''}
                  </small>
                </button>
              </li>
            ))}
          </ul>
          <p className="hint">Your agent gets these when you click Done.</p>
        </Section>
      )}
    </div>
  );
}

function FrameSettings({ id }: { id: string }) {
  const frame = useEditor((s) => currentView(s)?.frames.find((f) => f.id === id));
  const count = useEditor((s) => currentView(s)?.frames.length ?? 0);
  if (!frame) return null;
  const update = (patch: Partial<typeof frame>) => updateView((view) => ({ ...view, frames: view.frames.map((f) => (f.id === id ? { ...f, ...patch } : f)) }));
  const grids = frame.grids ?? [];
  const setGrids = (next: Grid[]) => update({ grids: next });
  return (
    <div className="frame-settings">
      <Section title="Frame" id="frame">
        <TextField label="Name" value={frame.name} onCommit={(name) => update({ name: name || frame.name })} />
        {!frame.componentId && (
          <Select
            name="Frame size preset"
            value={framePresets.find((p) => p.width === frame.width)?.name ?? 'Custom'}
            options={[...framePresets.map((p) => [p.name, `${p.name} · ${p.width}×${p.height}`] as [string, string]), ['Custom', 'Custom']]}
            onChange={(name) => {
              const preset = framePresets.find((p) => p.name === name);
              if (preset) update({ width: preset.width, height: preset.height, name: preset.name });
            }}
          />
        )}
        <div className="field-grid">
          <NumberField label="W" value={frame.width} min={120} onCommit={(v) => update({ width: Math.max(120, Math.round(Number(v)) || frame.width) })} />
          <NumberField label="H" value={frame.height} min={120} title="Viewport height: vh units and min-h-screen use it" onCommit={(v) => update({ height: Math.max(120, Math.round(Number(v)) || frame.height) })} />
        </div>
        <div className="field-grid">
          <button className={`toggle-button${!frame.dark ? ' active' : ''}`} onClick={() => update({ dark: false })}>
            <Sun size={13} /> Light
          </button>
          <button className={`toggle-button${frame.dark ? ' active' : ''}`} onClick={() => update({ dark: true })}>
            <Moon size={13} /> Dark
          </button>
        </div>
      </Section>
      <Section title="Layout grid" id="layout-grid" empty={!grids.length} onAdd={() => setGrids([...grids, { type: 'columns', count: 12, gutter: 24, margin: 48, size: 8, color: 'rgba(255, 0, 0, 0.1)', visible: true }])}>
        {grids.map((grid, i) => (
          <div key={i} className="grid-row">
            <div className="paint-row">
              <Select name="Grid type" value={grid.type} options={[['columns', 'Columns'], ['rows', 'Rows'], ['grid', 'Grid']]} onChange={(v) => setGrids(grids.map((g, j) => (j === i ? { ...g, type: v as Grid['type'] } : g)))} />
              <ColorSwatch value={grid.color} label="Grid" onChange={(v) => setGrids(grids.map((g, j) => (j === i ? { ...g, color: v } : g)))} />
              <IconButton label={grid.visible ? 'Hide grid' : 'Show grid'} onClick={() => setGrids(grids.map((g, j) => (j === i ? { ...g, visible: !g.visible } : g)))}>
                <LayoutGrid size={13} />
              </IconButton>
              <RemoveButton label="Remove grid" onClick={() => setGrids(grids.filter((_, j) => j !== i))} />
            </div>
            {grid.type === 'grid' ? (
              <NumberField label="Size" value={grid.size} min={1} onCommit={(v) => setGrids(grids.map((g, j) => (j === i ? { ...g, size: Number(v) || 8 } : g)))} />
            ) : (
              <div className="field-grid three">
                <NumberField label="Count" value={grid.count} min={1} onCommit={(v) => setGrids(grids.map((g, j) => (j === i ? { ...g, count: Math.max(1, Number(v)) } : g)))} />
                <NumberField label="Gutter" value={grid.gutter} min={0} onCommit={(v) => setGrids(grids.map((g, j) => (j === i ? { ...g, gutter: Number(v) } : g)))} />
                <NumberField label="Margin" value={grid.margin} min={0} onCommit={(v) => setGrids(grids.map((g, j) => (j === i ? { ...g, margin: Number(v) } : g)))} />
              </div>
            )}
          </div>
        ))}
      </Section>
      {count > 1 && !frame.componentId && (
        <button
          className="secondary-button wide danger"
          onClick={() => {
            updateView((view) => ({ ...view, frames: view.frames.filter((f) => f.id !== id) }));
            set({ frameSelected: null, activeFrame: currentView()?.frames[0]?.id ?? '' });
          }}
        >
          <Trash2 size={13} /> Remove frame
        </button>
      )}
    </div>
  );
}
