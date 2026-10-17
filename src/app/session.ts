/*
 * Opening, saving, and syncing a project.
 *
 * openProject loads every file through a backend and builds the document.
 * After that, edits save themselves: a short pause after the last change, each
 * file whose printed text differs from disk is written, and only if disk still
 * holds what Frame last saw. Changes made on disk by someone else, such as the
 * agent that opened Frame, flow back in. A file with no unsaved edits reloads
 * quietly; a file with edits on both sides becomes a conflict for the user to
 * settle.
 */

import type { Doc } from '../core/model';
import { docFromFiles, Workspace, type ProjectConfig } from '../core/workspace';
import { MemoryBackend, type Backend, type Comment } from './backend';
import { COMPONENTS_PAGE, editor, get, set, toast, workspace, type CanvasFrame, type PageView } from './state';
import { demoAssets, demoFiles } from '../demo';

let stopWatching: (() => void) | undefined;

export function defaultView(frames?: CanvasFrame[]): PageView {
  return {
    frames: frames ?? [{ id: 'desktop', name: 'Desktop', width: 1280, height: 800, x: 0, y: 0 }],
    zoom: 0,
    panX: 0,
    panY: 0,
    guides: [],
  };
}

export async function openProject(backend: Backend) {
  stopWatching?.();
  set({ status: 'loading', backend, error: undefined });
  try {
    const project = await backend.load();
    const config: ProjectConfig = {
      name: project.name,
      root: project.root,
      paths: project.paths,
      fileUrl: (path) => backend.fileUrl(path),
      publicUrl: (path) => backend.publicUrl(path),
    };
    const doc = docFromFiles(project.files);
    const pages = new Workspace(doc, config).pages();
    const start = pages.find((page) => page.route === project.startRoute) ?? pages[0];
    const pageId = start?.id ?? COMPONENTS_PAGE;
    set({
      status: 'ready',
      config,
      doc,
      disk: { ...project.files },
      history: { past: [], future: [] },
      pageId,
      views: { [pageId]: pageId === COMPONENTS_PAGE ? defaultView([]) : defaultView() },
      selection: [],
      hover: null,
      scope: null,
      activeFrame: 'desktop',
      editingText: null,
      conflicts: {},
      saveState: 'saved',
      comments: (await backend.loadComments?.().catch(() => [])) ?? loadLocalComments(config.name),
      dialog: null,
    });
    stopWatching = backend.watch?.(
      (paths) => void pullChanges(paths),
      () => set({ status: 'ended' }),
    );
    document.title = `${project.name} · Frame`;
  } catch (error) {
    set({ status: 'error', error: error instanceof Error ? error.message : String(error) });
  }
}

/** The demo, with its draft restored from a previous visit. */
export function demoBackend() {
  const assets = Object.fromEntries(Object.entries(demoAssets).map(([path, url]) => [path, new URL(url, location.href).href]));
  return new MemoryBackend('North Studio', demoFiles, 'Demo', assets, 'frame-demo-draft-v2');
}

/* Saving. */

let saving = false;
let again = false;
let timer: ReturnType<typeof setTimeout> | undefined;

/** Saves every changed file. Concurrent calls queue one more pass. */
export async function saveAll(): Promise<boolean> {
  clearTimeout(timer);
  if (saving) {
    again = true;
    return false;
  }
  const backend = get().backend;
  if (!backend || get().status !== 'ready') return false;
  saving = true;
  set({ saveState: 'saving' });
  let failed = false;
  try {
    const state = get();
    const ws = workspace(state);
    const disk = { ...state.disk };
    const conflicts = { ...state.conflicts };
    for (const path of ws.dirty(state.disk)) {
      if (path in conflicts) continue;
      const contents = ws.print(path);
      const result = disk[path] === undefined ? await backend.create(path, contents) : await backend.write(path, contents, disk[path]);
      if (result.ok) disk[path] = result.contents;
      else if (result.current !== undefined) {
        conflicts[path] = result.current;
        failed = true;
      } else {
        toast(result.error, 'error');
        failed = true;
      }
    }
    set({ disk, conflicts, saveState: failed ? 'error' : workspace(get()).dirty(disk).length ? 'unsaved' : 'saved' });
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), 'error');
    set({ saveState: 'error' });
    failed = true;
  } finally {
    saving = false;
  }
  if (again) {
    again = false;
    return saveAll();
  }
  return !failed;
}

/** Saves a moment after the last edit, when autosave is on. */
let lastDoc: Doc | undefined;
editor.subscribe(() => {
  const state = get();
  if (state.doc === lastDoc || state.status !== 'ready') return;
  const first = lastDoc === undefined;
  lastDoc = state.doc;
  if (first || !state.prefs.autosave) return;
  clearTimeout(timer);
  timer = setTimeout(() => void saveAll(), 600);
});

/* Changes from disk. */

/** Replaces a file in the current doc and every undo step, so undo never brings back the old text. */
function rebase(path: string, content: string | null) {
  const replace = (doc: Doc): Doc => {
    const code = { ...doc.code };
    const text = { ...doc.text };
    delete code[path];
    delete text[path];
    if (content !== null) {
      if (/\.(tsx|jsx|ts|js|mjs|cjs|mts|cts)$/i.test(path)) code[path] = { path, base: content, roots: {}, literals: {} };
      else text[path] = content;
    }
    return { code, text };
  };
  set((state) => {
    const disk = { ...state.disk };
    if (content === null) delete disk[path];
    else disk[path] = content;
    const conflicts = { ...state.conflicts };
    delete conflicts[path];
    const paths = content === null ? state.config.paths.filter((p) => p !== path) : state.config.paths.includes(path) ? state.config.paths : [...state.config.paths, path];
    return {
      doc: replace(state.doc),
      history: { past: state.history.past.map(replace), future: state.history.future.map(replace) },
      disk,
      conflicts,
      config: paths === state.config.paths ? state.config : { ...state.config, paths },
    };
  });
}

async function pullChanges(paths: string[]) {
  const state = get();
  const backend = state.backend;
  if (!backend) return;
  const known = paths.filter((path) => path in state.disk || /\.(tsx|jsx|ts|js|css)$/.test(path) || path === 'package.json');
  if (!known.length) return;
  const contents = await backend.read(known);
  for (const path of known) {
    const now = get();
    const content = contents[path] ?? null;
    if (content === (now.disk[path] ?? null)) continue;
    const ws = workspace(now);
    const local = path in now.doc.code || path in now.doc.text ? ws.print(path) : undefined;
    const clean = local === undefined || local === now.disk[path];
    if (clean) rebase(path, content);
    else set({ conflicts: { ...now.conflicts, [path]: content ?? '' } });
  }
  // Drop selected layers that no longer exist.
  set((s) => ({ selection: s.selection.filter((key) => !key.includes(':') || known.every((path) => !key.includes(`${path}:`) || s.disk[path] !== undefined)) }));
}

/** Settles a conflict by taking the disk version and dropping local edits to the file. */
export function takeDiskVersion(path: string) {
  const content = get().conflicts[path];
  if (content !== undefined) rebase(path, content);
}

/** Settles a conflict by keeping local edits. The next save overwrites the disk version. */
export function keepMyVersion(path: string) {
  set((state) => {
    const conflicts = { ...state.conflicts };
    const disk = { ...state.disk, [path]: conflicts[path] };
    delete conflicts[path];
    return { conflicts, disk };
  });
  void saveAll();
}

/* Comments. */

function loadLocalComments(project: string): Comment[] {
  try {
    return JSON.parse(localStorage.getItem(`frame-comments:${project}`) ?? '[]');
  } catch {
    return [];
  }
}

export function setComments(change: (comments: Comment[]) => Comment[]) {
  const comments = change(get().comments);
  set({ comments });
  const { backend, config } = get();
  if (backend?.saveComments) void backend.saveComments(comments).catch(() => toast('Could not save comments.', 'error'));
  else
    try {
      localStorage.setItem(`frame-comments:${config.name}`, JSON.stringify(comments));
    } catch {
      /* comments stay for this session */
    }
}

/** Saves everything and hands the session back to whoever started Frame. */
export async function finishSession(note?: string) {
  const backend = get().backend;
  if (!backend?.done) return;
  const saved = await saveAll();
  if (!saved && Object.keys(get().conflicts).length) {
    toast('Settle the conflicting files before finishing.', 'error');
    return;
  }
  try {
    await backend.done(note);
    stopWatching?.();
    set({ status: 'ended', dialog: null });
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), 'error');
  }
}
