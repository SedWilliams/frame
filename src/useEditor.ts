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
  const [history, setHistory] = useState(() => ({ entries: [load()], index: 0 }));
  const project = history.entries[history.index];
  const [selectedId, setSelectedId] = useState(() => {
    const heading = (root: EditorNode): EditorNode | undefined =>
      root.name === 'Hero heading' ? root : root.children.map(heading).find(Boolean);
    return heading(project.root)?.id || project.root.id;
  });
  const selected = findNode(project.root, selectedId) || project.root;
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

  const commit = useCallback((change: (project: Project) => Project) => {
    setHistory((prev) => {
      const current = prev.entries[prev.index];
      const next = change(current);
      if (next === current || JSON.stringify(next) === JSON.stringify(current)) return prev;
      const entries = [...prev.entries.slice(0, prev.index + 1), next].slice(-60);
      return { entries, index: entries.length - 1 };
    });
  }, []);
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
  const open = useCallback((p: Project) => {
    setHistory({ entries: [p], index: 0 });
    setSelectedId(p.root.id);
  }, []);

  return {
    project,
    selected,
    selectedId: selected.id,
    select: setSelectedId,
    commit,
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
export type Editor = ReturnType<typeof useEditor>;
