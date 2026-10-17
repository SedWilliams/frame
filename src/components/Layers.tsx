import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Type,
  Image,
  Square,
  MousePointer2,
  Eye,
  EyeOff,
  LockKeyhole,
  UnlockKeyhole,
  Plus,
  Search,
  Layers2,
  Component,
  LayoutGrid,
  Grip,
  Minus,
  FileCode2,
  ArrowUpRight,
} from 'lucide-react';
import type { EditorNode, InsertType } from '../model';
import type { Editor } from '../useEditor';
import { IconButton } from './Controls';

export function NodeIcon({ node, size = 14 }: { node: EditorNode; size?: number }) {
  const Icon = node.opaque
    ? FileCode2
    : node.tag === 'img'
      ? Image
      : /^h[1-6]$/.test(node.tag) || ['p', 'span'].includes(node.tag)
        ? Type
        : ['button', 'a'].includes(node.tag)
          ? MousePointer2
          : ['main', 'section', 'nav'].includes(node.tag)
            ? LayoutGrid
            : Square;
  return <Icon size={size} strokeWidth={1.6} />;
}
const assets: { type: InsertType; label: string; icon: typeof Type; hint: string }[] = [
  { type: 'frame', label: 'Frame', icon: LayoutGrid, hint: 'A flexible container' },
  { type: 'heading', label: 'Heading', icon: Type, hint: 'Make a statement' },
  { type: 'text', label: 'Text', icon: Type, hint: 'A little more detail' },
  { type: 'button', label: 'Button', icon: MousePointer2, hint: 'Give it an action' },
  { type: 'image', label: 'Image', icon: Image, hint: 'Add a visual' },
  { type: 'divider', label: 'Divider', icon: Minus, hint: 'Room to breathe' },
];

export function Layers({
  editor,
  tab,
  setTab,
  onConnect,
}: {
  editor: Editor;
  tab: string;
  setTab: (tab: string) => void;
  onConnect: () => void;
}) {
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const ids = new Set<string>();
    const visit = (node: EditorNode) => {
      if (
        ['Navigation', 'Eyebrow', 'Studio location', 'Hero image frame', 'Selected work'].includes(
          node.name,
        )
      )
        ids.add(node.id);
      node.children.forEach(visit);
    };
    visit(editor.project.root);
    return ids;
  });
  const [over, setOver] = useState<string | null>(null);
  function toggle(id: string) {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function matches(node: EditorNode): boolean {
    return node.name.toLowerCase().includes(search.toLowerCase()) || node.children.some(matches);
  }
  function renderNode(node: EditorNode, depth = 0) {
    if (search && !matches(node)) return null;
    const expanded = !collapsed.has(node.id) || !!search;
    return (
      <div
        key={node.id}
        role="treeitem"
        aria-selected={editor.selectedId === node.id}
        aria-expanded={node.children.length ? expanded : undefined}
      >
        <div
          className={`layer-row ${editor.selectedId === node.id ? 'selected' : ''} ${node.hidden ? 'hidden-layer' : ''} ${over === node.id ? 'drop-target' : ''}`}
          style={{ paddingLeft: 10 + depth * 13 }}
          draggable={!node.locked && node.id !== editor.project.root.id}
          onDragStart={(event) => {
            event.dataTransfer.setData('application/frame-node', node.id);
            event.dataTransfer.effectAllowed = 'move';
          }}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes('application/frame-node')) return;
            event.preventDefault();
            setOver(node.id);
          }}
          onDragLeave={() => setOver(null)}
          onDrop={(event) => {
            event.preventDefault();
            setOver(null);
            const id = event.dataTransfer.getData('application/frame-node');
            if (id) editor.move(id, node.id, event.shiftKey || node.id === editor.project.root.id);
          }}
        >
          <button
            className="tree-toggle"
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${node.name}`}
            onClick={() => toggle(node.id)}
            style={{ visibility: node.children.length ? 'visible' : 'hidden' }}
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          <button className="layer-select" onClick={() => editor.select(node.id)}>
            <NodeIcon node={node} />
            <span>{node.name}</span>
          </button>
          <div className="layer-actions">
            <button
              title={node.locked ? 'Unlock layer' : 'Lock layer'}
              aria-label={`${node.locked ? 'Unlock' : 'Lock'} ${node.name}`}
              onClick={() => editor.patch(node.id, { locked: !node.locked })}
            >
              {node.locked ? <LockKeyhole size={11} /> : <UnlockKeyhole size={11} />}
            </button>
            <button
              disabled={node.opaque || node.tag === 'fragment'}
              title={node.hidden ? 'Show layer' : 'Hide layer'}
              aria-label={`${node.hidden ? 'Show' : 'Hide'} ${node.name}`}
              onClick={() => editor.patch(node.id, { hidden: !node.hidden })}
            >
              {node.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
          </div>
        </div>
        {expanded && node.children.length > 0 && (
          <div role="group">{node.children.map((child) => renderNode(child, depth + 1))}</div>
        )}
      </div>
    );
  }
  return (
    <aside className="left-panel">
      <div className="panel-tabs">
        <button className={tab === 'layers' ? 'active' : ''} onClick={() => setTab('layers')}>
          <Layers2 size={14} />
          Layers
        </button>
        <button className={tab === 'assets' ? 'active' : ''} onClick={() => setTab('assets')}>
          <Component size={14} />
          Insert
        </button>
        <IconButton label="Add an element" onClick={() => setTab('assets')}>
          <Plus size={15} />
        </IconButton>
      </div>
      {tab === 'layers' ? (
        <>
          <div className="search-wrap">
            <Search size={14} />
            <input
              aria-label="Search layers"
              placeholder="Search layers..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <kbd>⌘ K</kbd>
          </div>
          <div className="section-heading">
            <span>PAGES</span>
            <span className="small-count">1</span>
          </div>
          <button className="page-row" onClick={() => editor.select(editor.project.root.id)}>
            <LayoutGrid size={15} />
            Home page
            <span className="page-dot" />
          </button>
          <div className="section-heading layers-heading">
            <span>LAYERS</span>
            <IconButton
              label="Collapse all layers"
              onClick={() => setCollapsed(new Set(editor.project.root.children.map((n) => n.id)))}
            >
              <Layers2 size={12} />
            </IconButton>
          </div>
          <div className="layer-tree" role="tree" aria-label="Page layers">
            {renderNode(editor.project.root)}
          </div>
          <div className="layer-hint">
            <Grip size={12} />
            <span>Drag to reorder · Shift-drop to nest</span>
          </div>
        </>
      ) : (
        <div className="assets-panel">
          <div className="asset-heading">A good place to start.</div>
          <p>Click to insert, or drag onto the canvas.</p>
          <div className="asset-grid">
            {assets.map(({ type, label, icon: Icon, hint }) => (
              <button
                key={type}
                className="asset-card"
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData('application/frame-asset', type);
                  event.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => editor.insert(type)}
                title={hint}
              >
                <Icon size={24} strokeWidth={1.4} />
                <span>{label}</span>
              </button>
            ))}
          </div>
          <div className="insert-note">
            <Component size={15} />
            <span>Elements export as real JSX, ready for your codebase.</span>
          </div>
        </div>
      )}
      <div className="project-card">
        <div className="project-card-icon">
          <FileCode2 size={18} />
        </div>
        <div>
          <strong>Your code. Your canvas.</strong>
          <p>Bring an existing React UI.</p>
        </div>
        <button aria-label="Connect a project" onClick={onConnect}>
          <ArrowUpRight size={17} />
        </button>
      </div>
      <div className="left-footer">
        <span className="avatar">Y</span>
        <span>Personal workspace</span>
        <span className="local-badge">LOCAL</span>
      </div>
    </aside>
  );
}
