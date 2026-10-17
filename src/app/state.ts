/*
 * Editor state.
 *
 * One store holds everything: the document (every file's edits), its undo
 * history, what's on disk, the open page and its canvas frames, the selection,
 * the active tool, panels, dialogs, and preferences. Derived data such as the
 * Workspace and each page's render tree is memoized from it, so it's computed
 * once per document change no matter how many components read it.
 */

import type { Doc } from '../core/model';
import { Workspace, type PageDef, type ProjectConfig } from '../core/workspace';
import { indexRender, renderPage, type PageTarget, type RenderResult, type RNode } from '../core/render';
import { createStore, memoLast, useStoreSlice } from './store';
import type { Backend, Comment } from './backend';

export type Tool =
  | 'move'
  | 'hand'
  | 'scale'
  | 'frame'
  | 'section'
  | 'rectangle'
  | 'ellipse'
  | 'line'
  | 'polygon'
  | 'star'
  | 'text'
  | 'pen'
  | 'pencil'
  | 'comment';

export interface LayoutGrid {
  type: 'columns' | 'rows' | 'grid';
  count: number;
  gutter: number;
  margin: number;
  size: number;
  color: string;
  visible: boolean;
}

/** A frame on the canvas: the page at one viewport size, or one component on the Components page. */
export interface CanvasFrame {
  id: string;
  name: string;
  width: number;
  /** Viewport height. vh units resolve against it and the frame is at least this tall. */
  height: number;
  x: number;
  y: number;
  dark?: boolean;
  grids?: LayoutGrid[];
  /** Renders something other than the page, such as one component. */
  target?: PageTarget;
  /** Component frames: the component's id in the workspace. */
  componentId?: string;
}

export interface PageView {
  frames: CanvasFrame[];
  zoom: number;
  panX: number;
  panY: number;
  /** Ruler guides in world coordinates. */
  guides: { axis: 'x' | 'y'; at: number }[];
}

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'error' | 'success';
  action?: { label: string; run: () => void };
}

export type Dialog =
  | { kind: 'shortcuts' }
  | { kind: 'open' }
  | { kind: 'done' }
  | { kind: 'variables' }
  | { kind: 'export' }
  | { kind: 'new-page' }
  | { kind: 'new-component' }
  | { kind: 'changes' }
  | { kind: 'about' };

export interface EditorState {
  status: 'loading' | 'ready' | 'error' | 'ended';
  error?: string;
  backend?: Backend;
  config: ProjectConfig;
  doc: Doc;
  history: { past: Doc[]; future: Doc[]; label?: string; at?: number };
  /** File contents as last read from or written to disk. */
  disk: Record<string, string>;
  pageId: string;
  views: Record<string, PageView>;
  /** Render keys of the selected layers. */
  selection: string[];
  hover: string | null;
  /** The frame the selection was made in. Its handles are the ones you can drag. */
  activeFrame: string;
  /** A frame picked by its label, for frame settings. Layers and a frame aren't selected together. */
  frameSelected: string | null;
  /** An instance the user double-clicked into. Clicks inside it select its layers. */
  scope: string | null;
  tool: Tool;
  editingText: string | null;
  ui: {
    left: boolean;
    right: boolean;
    leftTab: 'file' | 'assets';
    rightTab: 'design' | 'prototype' | 'dev';
    rulers: boolean;
    outline: boolean;
    grids: boolean;
    hidden: boolean;
    commentsVisible: boolean;
    pixelGrid: boolean;
  };
  prefs: {
    autosave: boolean;
    /** How style edits are written: Tailwind classes when the project has Tailwind, or inline styles. */
    styling: 'auto' | 'inline';
    snapping: boolean;
    nudge: number;
    bigNudge: number;
    theme: 'system' | 'light' | 'dark';
    /** Write edits made in a breakpoint frame as that breakpoint's classes, such as md:. */
    responsive: boolean;
  };
  dialog: Dialog | null;
  palette: boolean;
  menu: null | { kind: 'context' | 'main'; x: number; y: number };
  toasts: Toast[];
  saveState: 'saved' | 'saving' | 'unsaved' | 'error';
  /** Files that changed on disk while they had unsaved edits, with what's on disk now. */
  conflicts: Record<string, string>;
  comments: Comment[];
  /** A comment being written, anchored to a layer. */
  draftComment: { key: string; frame: string; x: number; y: number } | null;
  openComment: string | null;
  presenting: boolean;
  presentRoute: string | null;
}

export const emptyConfig: ProjectConfig = {
  name: 'Untitled',
  paths: [],
  fileUrl: () => undefined,
  publicUrl: () => undefined,
};

const savedPrefs = (() => {
  try {
    return JSON.parse(localStorage.getItem('frame-prefs') ?? '{}') as Partial<EditorState['prefs']>;
  } catch {
    return {};
  }
})();

export const editor = createStore<EditorState>({
  status: 'loading',
  config: emptyConfig,
  doc: { code: {}, text: {} },
  history: { past: [], future: [] },
  disk: {},
  pageId: '',
  views: {},
  selection: [],
  hover: null,
  activeFrame: '',
  frameSelected: null,
  scope: null,
  tool: 'move',
  editingText: null,
  ui: {
    left: true,
    right: true,
    leftTab: 'file',
    rightTab: 'design',
    rulers: false,
    outline: false,
    grids: true,
    hidden: false,
    commentsVisible: true,
    pixelGrid: true,
  },
  prefs: {
    autosave: true,
    styling: 'auto',
    snapping: true,
    nudge: 1,
    bigNudge: 10,
    theme: 'system',
    responsive: false,
    ...savedPrefs,
  },
  dialog: null,
  palette: false,
  menu: null,
  toasts: [],
  saveState: 'saved',
  conflicts: {},
  comments: [],
  draftComment: null,
  openComment: null,
  presenting: false,
  presentRoute: null,
});

export function useEditor<T>(selector: (state: EditorState) => T): T {
  return useStoreSlice(editor, selector);
}

export const get = () => editor.get();
export const set = editor.set;

/* Derived data. */

export const workspaceOf = memoLast((doc: Doc, config: ProjectConfig) => new Workspace(doc, config));
export const workspace = (state: EditorState = get()) => workspaceOf(state.doc, state.config);

/** The Components page, which lays every component out in its own frame. */
export const COMPONENTS_PAGE = 'page:components';

export function pagesOf(state: EditorState = get()): PageDef[] {
  return workspace(state).pages();
}

export function currentPage(state: EditorState = get()): PageDef | undefined {
  if (state.pageId === COMPONENTS_PAGE) return undefined;
  return pagesOf(state).find((page) => page.id === state.pageId);
}

/** Render results by doc and target. A page's frames all share one render. */
const renderCache = new WeakMap<Doc, Map<string, { result: RenderResult; index: ReturnType<typeof indexRender> }>>();
export function renderTarget(state: EditorState, target: PageTarget) {
  let byTarget = renderCache.get(state.doc);
  if (!byTarget) renderCache.set(state.doc, (byTarget = new Map()));
  const key = JSON.stringify(target);
  let entry = byTarget.get(key);
  // The cache holds the doc, but the project config can change under the same doc on load.
  if (!entry) {
    const result = renderPage(workspace(state).at(target.route), target);
    entry = { result, index: indexRender(result.nodes) };
    byTarget.set(key, entry);
  }
  return entry;
}

/** The target a frame renders: its own, or the page's. */
export function frameTarget(state: EditorState, frame: CanvasFrame | undefined): PageTarget | undefined {
  return frame?.target ?? currentPage(state)?.target;
}

export function currentView(state: EditorState = get()): PageView | undefined {
  return state.views[state.pageId];
}

export function frameById(state: EditorState, id: string): CanvasFrame | undefined {
  return currentView(state)?.frames.find((frame) => frame.id === id);
}

/** The render index for the active frame, where selection keys live. */
export function activeIndex(state: EditorState = get()) {
  const view = currentView(state);
  const frame = view?.frames.find((f) => f.id === state.activeFrame) ?? view?.frames[0];
  const target = frameTarget(state, frame);
  return target ? renderTarget(state, target).index : undefined;
}

/** Looks up a render node by key in any frame of the current page. */
export function findRender(state: EditorState, key: string): { node: RNode; frame: CanvasFrame; parent?: RNode } | undefined {
  const view = currentView(state);
  if (!view) return;
  const ordered = [...view.frames].sort((a, b) => (a.id === state.activeFrame ? -1 : b.id === state.activeFrame ? 1 : 0));
  for (const frame of ordered) {
    const target = frameTarget(state, frame);
    if (!target) continue;
    const { index } = renderTarget(state, target);
    const node = index.byKey.get(key);
    if (node) return { node, frame, parent: index.parent.get(key) };
  }
}

/* History. Every document change goes through commit. */

const HISTORY_LIMIT = 200;

/**
 * Applies a document change as one undo step. Changes with the same `label`
 * within a second merge into one step, so scrubbing a value is one undo.
 */
export function commit(label: string, change: (doc: Doc) => Doc, options: { merge?: boolean } = {}) {
  const state = get();
  const next = change(state.doc);
  if (next === state.doc) return false;
  const now = Date.now();
  const merge = options.merge !== false && state.history.label === label && now - (state.history.at ?? 0) < 1000 && label !== '';
  set({
    doc: next,
    history: {
      past: merge ? state.history.past : [...state.history.past, state.doc].slice(-HISTORY_LIMIT),
      future: [],
      label,
      at: now,
    },
    saveState: 'unsaved',
  });
  return true;
}

export function undo() {
  const { history, doc } = get();
  const previous = history.past.at(-1);
  if (!previous) return;
  set({ doc: previous, history: { past: history.past.slice(0, -1), future: [doc, ...history.future] }, saveState: 'unsaved', editingText: null });
}

export function redo() {
  const { history, doc } = get();
  const next = history.future[0];
  if (!next) return;
  set({ doc: next, history: { past: [...history.past, doc], future: history.future.slice(1) }, saveState: 'unsaved', editingText: null });
}

/* Notices. */

let toastId = 0;
export function toast(message: string, kind: Toast['kind'] = 'info', action?: Toast['action']) {
  const id = ++toastId;
  set((state) => ({ toasts: [...state.toasts.filter((t) => t.message !== message), { id, message, kind, action }].slice(-4) }));
  setTimeout(() => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 9000 : 3800);
}

export function setPrefs(patch: Partial<EditorState['prefs']>) {
  set((state) => {
    const prefs = { ...state.prefs, ...patch };
    try {
      localStorage.setItem('frame-prefs', JSON.stringify(prefs));
    } catch {
      /* preferences just won't persist */
    }
    return { prefs };
  });
}

export function setUI(patch: Partial<EditorState['ui']>) {
  set((state) => ({ ui: { ...state.ui, ...patch } }));
}

export function updateView(change: (view: PageView) => PageView) {
  set((state) => {
    const view = state.views[state.pageId];
    return view ? { views: { ...state.views, [state.pageId]: change(view) } } : {};
  });
}

export function select(keys: string[], frame?: string) {
  set((state) => ({
    selection: keys,
    activeFrame: frame ?? state.activeFrame,
    frameSelected: null,
    editingText: state.editingText && keys.includes(state.editingText) ? state.editingText : null,
    draftComment: null,
  }));
}
