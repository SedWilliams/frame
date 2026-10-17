/*
 * The layer tree.
 *
 * Lists what's on the page, as rendered: a layout's layers, the page's own, and
 * each instance with the component's layers inside it. Rows select, rename on
 * double-click, hide, lock, and drag to reorder. Dropping on the middle of a row
 * nests inside it. Layers from inside a component show in purple, and layers
 * that repeat for each item of a list carry a ↻.
 */

import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Component,
  Diamond,
  Eye,
  EyeOff,
  Frame,
  Image,
  Lock,
  Unlock,
  Minus,
  MousePointer2,
  Repeat2,
  Rows3,
  Columns3,
  Square,
  Type,
  Braces,
  Shapes,
  Link,
  List,
} from 'lucide-react';
import type { RNode } from '../core/render';
import { activeIndex, currentPage, get, select, set, useEditor } from '../app/state';
import { canDropInto, moveLayers, rename, toggleHidden, toggleLocked } from '../app/actions';
import { chainOf, instanceScope, isInside, selectable } from '../app/selection';
import { computedOf } from '../canvas/registry';

/** The icon Figma would show for a layer. */
export function LayerIcon({ node, frame }: { node: RNode; frame?: string }) {
  if (node.kind === 'instance') return <Diamond size={13} className="icon-component" />;
  if (node.kind === 'placeholder') return <Braces size={13} />;
  if (node.kind === 'icon') return <Shapes size={13} />;
  if (node.kind === 'text' || (node.text !== undefined && node.kind === 'element' && !/^(button|a)$/.test(node.tag))) return <Type size={13} />;
  if (node.tag === 'img' || node.tag === 'video' || node.tag === 'picture') return <Image size={13} />;
  if (node.tag === 'svg' || node.tag === 'path') return <Shapes size={13} />;
  if (node.tag === 'hr') return <Minus size={13} />;
  if (node.tag === 'a') return <Link size={13} />;
  if (node.tag === 'button') return <MousePointer2 size={13} />;
  if (node.tag === 'ul' || node.tag === 'ol') return <List size={13} />;
  const computed = frame ? computedOf(frame, node.key) : undefined;
  if (computed && /flex/.test(computed.display)) return computed.flexDirection.startsWith('row') ? <Columns3 size={13} /> : <Rows3 size={13} />;
  if (node.children.length) return <Frame size={13} />;
  return <Square size={13} />;
}

interface Row {
  node: RNode;
  depth: number;
  hasChildren: boolean;
  /** Inside an instance: drawn in purple. */
  internal: boolean;
}

/** Selectable children, looking through layers that can't be selected. */
function visibleChildren(node: RNode): RNode[] {
  return node.children.flatMap((child) => (selectable(child) ? [child] : visibleChildren(child)));
}

export function Layers({ query }: { query: string }) {
  const selection = useEditor((s) => s.selection);
  const hover = useEditor((s) => s.hover);
  const activeFrame = useEditor((s) => s.activeFrame);
  const index = useEditor((s) => activeIndex(s));
  const pageFile = useEditor((s) => currentPage(s)?.file);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ key: string; where: 'before' | 'after' | 'inside' } | null>(null);
  const list = useRef<HTMLDivElement>(null);

  const roots = useMemo(() => {
    if (!index) return [];
    const tops = [...index.byKey.values()].filter((n) => !index.parent.get(n.key));
    return tops.flatMap((n) => (selectable(n) ? [n] : visibleChildren(n)));
  }, [index]);

  // Reveal the selection: expand its ancestors and scroll it into view.
  useEffect(() => {
    if (!index || !selection.length) return;
    setExpanded((current) => {
      const next = new Set(current);
      for (const key of selection) for (const node of chainOf(index, key).slice(0, -1)) next.add(node.key);
      return next.size === current.size ? current : next;
    });
    requestAnimationFrame(() => list.current?.querySelector('.layer-row.selected')?.scrollIntoView({ block: 'nearest' }));
  }, [selection, index]);

  // Start with the first two levels open.
  useEffect(() => {
    setExpanded((current) => {
      if (current.size) return current;
      const next = new Set<string>();
      for (const root of roots) {
        next.add(root.key);
        for (const child of visibleChildren(root)) if (child.kind !== 'instance') next.add(child.key);
      }
      return next;
    });
  }, [roots]);

  // Rename from Cmd+R.
  useEffect(() => {
    const onRename = () => setRenaming(get().selection[0] ?? null);
    window.addEventListener('frame:rename', onRename);
    return () => window.removeEventListener('frame:rename', onRename);
  }, []);

  const rows = useMemo(() => {
    const out: Row[] = [];
    const q = query.trim().toLowerCase();
    const matches = (node: RNode): boolean => node.name.toLowerCase().includes(q) || visibleChildren(node).some(matches);
    const visit = (node: RNode, depth: number, internal: boolean) => {
      if (q && !matches(node)) return;
      const children = visibleChildren(node);
      out.push({ node, depth, hasChildren: children.length > 0, internal });
      if (children.length && (expanded.has(node.key) || !!q))
        for (const child of children) visit(child, depth + 1, internal || node.kind === 'instance');
    };
    for (const root of roots) visit(root, 0, false);
    return out;
  }, [roots, expanded, query]);

  if (!index) return <p className="panel-empty">This page didn't render.</p>;

  const toggle = (key: string, all = false) => {
    setExpanded((current) => {
      const next = new Set(current);
      const open = !next.has(key);
      const apply = (k: string) => (open ? next.add(k) : next.delete(k));
      apply(key);
      if (all) {
        const walk = (n: RNode) => visibleChildren(n).forEach((c) => (apply(c.key), walk(c)));
        const node = index.byKey.get(key);
        if (node) walk(node);
      }
      return next;
    });
  };

  const onRowClick = (event: React.MouseEvent, node: RNode) => {
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      select(selection.includes(node.key) ? selection.filter((k) => k !== node.key) : [...selection, node.key]);
      return;
    }
    select([node.key]);
    set({ scope: instanceScope(index, index.parent.get(node.key)?.key) });
  };

  const onDragStart = (event: DragEvent, node: RNode) => {
    const keys = selection.includes(node.key) ? selection : [node.key];
    if (!selection.includes(node.key)) select([node.key]);
    event.dataTransfer.setData('application/frame-layers', JSON.stringify(keys));
    event.dataTransfer.effectAllowed = 'move';
  };

  const where = (event: DragEvent, row: Row): 'before' | 'after' | 'inside' => {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const y = (event.clientY - box.top) / box.height;
    if (row.node.kind === 'element' && y > 0.25 && y < 0.75) return 'inside';
    return y < 0.5 ? 'before' : 'after';
  };

  const dropTarget = (keys: string[], row: Row, place: 'before' | 'after' | 'inside') => {
    if (place === 'inside') return canDropInto(keys, row.node) ? { parent: row.node, index: row.node.children.length } : undefined;
    const parent = index.parent.get(row.node.key);
    if (!parent || !canDropInto(keys, parent)) return undefined;
    const at = parent.children.findIndex((c) => c.key === row.node.key);
    return { parent, index: place === 'before' ? at : at + 1 };
  };

  return (
    <div className="layer-tree" role="tree" aria-label="Layers" ref={list} onPointerLeave={() => get().hover && set({ hover: null })}>
      {rows.map((row) => {
        const { node } = row;
        const selected = selection.includes(node.key);
        const inScope = selection.some((key) => isInside(node.key, key) && key !== node.key);
        const ownedElsewhere = !row.internal && node.source && pageFile && node.source.file !== pageFile;
        return (
          <div
            key={node.key}
            role="treeitem"
            aria-selected={selected}
            aria-expanded={row.hasChildren ? expanded.has(node.key) : undefined}
            aria-level={row.depth + 1}
            className={`layer-row${selected ? ' selected' : ''}${inScope ? ' in-selection' : ''}${hover === node.key ? ' hovered' : ''}${node.hidden ? ' hidden-layer' : ''}${row.internal || node.kind === 'instance' ? ' component' : ''}${drop?.key === node.key ? ` drop-${drop.where}` : ''}`}
            style={{ paddingLeft: 8 + row.depth * 14 }}
            draggable={!node.locked && !node.repeated && renaming !== node.key}
            onDragStart={(e) => onDragStart(e, node)}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes('application/frame-layers')) return;
              e.preventDefault();
              setDrop({ key: node.key, where: where(e, row) });
            }}
            onDragLeave={() => setDrop((d) => (d?.key === node.key ? null : d))}
            onDrop={(e) => {
              e.preventDefault();
              setDrop(null);
              const keys = JSON.parse(e.dataTransfer.getData('application/frame-layers') || '[]') as string[];
              const target = dropTarget(keys, row, where(e, row));
              if (target) moveLayers(keys, target.parent, target.index);
            }}
            onPointerEnter={() => set({ hover: node.key })}
            onClick={(e) => onRowClick(e, node)}
            onDoubleClick={() => setRenaming(node.key)}
            onContextMenu={(e) => {
              e.preventDefault();
              if (!selected) select([node.key]);
              set({ menu: { kind: 'context', x: e.clientX, y: e.clientY } });
            }}
          >
            <button
              className="layer-caret"
              tabIndex={-1}
              aria-label={`${expanded.has(node.key) ? 'Collapse' : 'Expand'} ${node.name}`}
              style={{ visibility: row.hasChildren ? 'visible' : 'hidden' }}
              onClick={(e) => {
                e.stopPropagation();
                toggle(node.key, e.altKey);
              }}
            >
              {expanded.has(node.key) ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            </button>
            <span className="layer-icon">
              <LayerIcon node={node} frame={activeFrame} />
            </span>
            {renaming === node.key ? (
              <input
                className="layer-rename"
                autoFocus
                defaultValue={node.name}
                aria-label="Layer name"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') e.currentTarget.blur();
                  if (e.key === 'Escape') setRenaming(null);
                }}
                onBlur={(e) => {
                  if (renaming === node.key && e.currentTarget.value !== node.name) rename(node.key, e.currentTarget.value);
                  setRenaming(null);
                }}
              />
            ) : (
              <span className="layer-name">{node.name}</span>
            )}
            {node.repeated && <Repeat2 size={11} className="layer-badge" aria-label="Repeats for each item" />}
            {ownedElsewhere && <Component size={11} className="layer-badge shared" aria-label={`From ${node.source!.file}`} />}
            <span className="layer-actions">
              <button
                aria-label={`${node.locked ? 'Unlock' : 'Lock'} ${node.name}`}
                className={node.locked ? 'on' : ''}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleLocked([node.key]);
                }}
              >
                {node.locked ? <Lock size={12} /> : <Unlock size={12} />}
              </button>
              <button
                aria-label={`${node.hidden ? 'Show' : 'Hide'} ${node.name}`}
                className={node.hidden ? 'on' : ''}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleHidden([node.key]);
                }}
              >
                {node.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}
