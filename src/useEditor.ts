/*
 * Editor state hook.
 *
 * Holds the open project, its undo history, and the current selection, and
 * exposes every document edit the UI can make. Each edit goes through commit,
 * which pushes a new project onto the history. The current project autosaves to
 * localStorage as a draft 350 ms after the last change.
 */

import { useCallback, useEffect, useState } from 'react';
import { makeDemo } from './demo';
import type { EditorNode, Project, Style } from './model';
import {
  findNode,
  updateNode,
  removeNode,
  findParent,
  cloneNode,
  moveNode,
  insertNode,
  createNode,
  type InsertType,
} from './model';

/** Restores the saved draft, or opens the demo if there is none or it can't be read. */
const STORAGE_KEY = 'frame-project-v1';
function load(): Project {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data.version === 1 && data.project?.root?.id && typeof data.project.source === 'string')
        return data.project;
    }
  } catch {
    /* A blocked storage policy should not prevent opening the editor. */
  }
  return makeDemo();
}

export function useEditor() {
  // History holds whole projects. Undo and redo move the index. A new edit drops
  // anything after the index and keeps the last 60 entries.
  const [history, setHistory] = useState(() => ({ entries: [load()], index: 0 }));
  const project = history.entries[history.index];
  // The demo opens with its hero heading selected so the inspector has something to show.
  const [selectedId, setSelectedId] = useState(() => {
    const heading = (root: EditorNode): EditorNode | undefined =>
      root.name === 'Hero heading' ? root : root.children.map(heading).find(Boolean);
    return heading(project.root)?.id || project.root.id;
  });
  // Falls back to the root when the selected node was deleted or undone away.
  const selected = findNode(project.root, selectedId) || project.root;
  // Debounced draft save. A full or blocked storage quota shows a warning in the status bar.
  const [storageStatus, setStorageStatus] = useState<'saving' | 'saved' | 'error'>('saving');
  useEffect(() => {
    setStorageStatus('saving');
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, project }));
        setStorageStatus('saved');
      } catch {
        setStorageStatus('error');
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [project]);

  // Applies a change to the current project. A change that alters nothing adds no history entry.
  const commit = useCallback((change: (project: Project) => Project) => {
    setHistory((prev) => {
      const current = prev.entries[prev.index];
      const next = change(current);
      if (next === current || JSON.stringify(next) === JSON.stringify(current)) return prev;
      const entries = [...prev.entries.slice(0, prev.index + 1), next].slice(-60);
      return { entries, index: entries.length - 1 };
    });
  }, []);
  // patch sets node fields. style merges CSS values and skips nodes the inspector can't style.
  const patch = useCallback(
    (id: string, values: Partial<EditorNode>) => {
      commit((p) => ({ ...p, root: updateNode(p.root, id, values) }));
    },
    [commit],
  );
  const style = useCallback(
    (id: string, values: Style) => {
      commit((p) => {
        const node = findNode(p.root, id);
        return node && !node.locked && !node.opaque && node.tag !== 'fragment'
          ? { ...p, root: updateNode(p.root, id, { style: { ...node.style, ...values } }) }
          : p;
      });
    },
    [commit],
  );
  const undo = useCallback(
    () => setHistory((h) => ({ ...h, index: Math.max(0, h.index - 1) })),
    [],
  );
  const redo = useCallback(
    () => setHistory((h) => ({ ...h, index: Math.min(h.entries.length - 1, h.index + 1) })),
    [],
  );
  // remove and duplicate act on the selection, then select its parent or the new copy.
  const remove = useCallback(() => {
    if (selected.id === project.root.id || selected.locked) return;
    const parent = findParent(project.root, selected.id);
    commit((p) => ({ ...p, root: removeNode(p.root, selected.id) }));
    if (parent) setSelectedId(parent.id);
  }, [selected, project.root, commit]);
  const duplicate = useCallback(() => {
    const parent = findParent(project.root, selected.id);
    if (!parent || selected.locked) return;
    const copy = cloneNode(selected);
    const children = [...parent.children];
    children.splice(children.findIndex((c) => c.id === selected.id) + 1, 0, copy);
    commit((p) => ({ ...p, root: updateNode(p.root, parent.id, { children }) }));
    setSelectedId(copy.id);
  }, [project.root, selected, commit]);
  // move backs drag and drop. insert adds a new element at the selection or a drop target.
  const move = useCallback(
    (id: string, target: string, inside = false) =>
      commit((p) => ({ ...p, root: moveNode(p.root, id, target, inside) })),
    [commit],
  );
  const insert = useCallback(
    (type: InsertType, target = selected.id) => {
      const node = createNode(type);
      commit((p) => ({ ...p, root: insertNode(p.root, target, node) }));
      setSelectedId(node.id);
    },
    [commit, selected.id],
  );
  // open swaps in another project and starts a new history.
  const open = useCallback((p: Project) => {
    setHistory({ entries: [p], index: 0 });
    setSelectedId(p.root.id);
  }, []);

  return {
    project,
    selected,
    selectedId: selected.id,
    select: setSelectedId,
    patch,
    style,
    undo,
    redo,
    canUndo: history.index > 0,
    canRedo: history.index < history.entries.length - 1,
    remove,
    duplicate,
    move,
    insert,
    open,
    storageStatus,
  };
}
/** The editor API that components receive as the `editor` prop. */
export type Editor = ReturnType<typeof useEditor>;
