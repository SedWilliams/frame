/*
 * Where files come from and go to.
 *
 * ServerBackend talks to Frame's local server, which the `frame` command and the
 * agent skill start. It has the whole project, live change events, and a Done
 * button that hands the session back to the agent. FolderBackend reads and
 * writes a folder the user picks through Chrome's File System Access API.
 * MemoryBackend holds the demo site, or one pasted or uploaded file, and keeps
 * edits as a draft in localStorage.
 */

export interface Comment {
  id: string;
  text: string;
  /** Source file and line of the layer the comment is on. */
  file?: string;
  line?: number;
  column?: number;
  /** A short description of the layer, such as `<h1> Hero heading`. */
  element?: string;
  /** Render key of the layer, so the pin can follow it. */
  key?: string;
  page?: string;
  frame?: string;
  /** Pin position as a fraction of the layer's box. */
  x?: number;
  y?: number;
  resolved?: boolean;
  createdAt: string;
}

export interface FileChange {
  path: string;
  status: 'modified' | 'added';
  additions: number;
  deletions: number;
}

export interface Summary {
  changedFiles: FileChange[];
  comments: Comment[];
  note?: string;
  diff: string;
}

export type WriteResult = { ok: true; contents: string } | { ok: false; error: string; current?: string };

export interface LoadedProject {
  name: string;
  /** Absolute path on disk, for editor links. */
  root?: string;
  /** Every project file path, including images. */
  paths: string[];
  /** Text of the files the editor works with: source, styles, configs. */
  files: Record<string, string>;
  /** Page to open first, such as a route from the URL. */
  startRoute?: string;
}

export interface Backend {
  kind: 'server' | 'folder' | 'memory';
  /** Shown in the status bar. */
  label: string;
  load(): Promise<LoadedProject>;
  read(paths: string[]): Promise<Record<string, string>>;
  /** Writes only if the file still holds `expected`. */
  write(path: string, contents: string, expected: string | undefined): Promise<WriteResult>;
  create(path: string, contents: string): Promise<WriteResult>;
  fileUrl(path: string): string | undefined;
  publicUrl(path: string): string | undefined;
  /** Calls back with paths that changed on disk. Returns an unsubscribe function. */
  watch?(onChange: (paths: string[]) => void, onEnd: () => void): () => void;
  /** Adds an image to the project and returns the URL pages use for it. */
  addImage?(file: File): Promise<string>;
  loadComments?(): Promise<Comment[]>;
  saveComments?(comments: Comment[]): Promise<void>;
  changes?(): Promise<FileChange[]>;
  revert?(path: string): Promise<string | null>;
  /** Ends the session and hands the summary to whoever started Frame. */
  done?(note?: string): Promise<Summary>;
}

/** Files the editor reads as text. Others are listed but only loaded as URLs. */
export const isTextPath = (path: string, size = 0) =>
  size < 2 * 1024 * 1024 &&
  (/\.(tsx|jsx|ts|js|mjs|cjs|mts|cts|css)$/i.test(path) ||
    /(^|\/)(package|tsconfig[\w.]*|jsconfig|components)\.json$/.test(path) ||
    /^(src\/)?(data|content|lib)\/.+\.json$/.test(path) ||
    path === 'index.html');

export class ServerBackend implements Backend {
  kind = 'server' as const;
  label = 'Local project';
  constructor(private token: string) {}

  private async call(name: string, init: RequestInit = {}) {
    const res = await fetch(`/__frame/api/${name}`, {
      ...init,
      headers: { 'content-type': 'application/json', 'x-frame-token': this.token, ...(init.headers ?? {}) },
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  }

  async load(): Promise<LoadedProject> {
    const { status, body } = await this.call('project');
    if (status !== 200) throw new Error(body.error ?? 'Frame could not open the project.');
    const entries = body.files as { path: string; size: number }[];
    const files = await this.read(entries.filter((f) => isTextPath(f.path, f.size)).map((f) => f.path));
    const route = new URLSearchParams(location.hash.slice(1)).get('page') ?? undefined;
    return { name: body.name, root: body.root, paths: entries.map((f) => f.path), files, startRoute: route };
  }

  async read(paths: string[]) {
    const files: Record<string, string> = {};
    // Batches keep each request small for big projects.
    for (let i = 0; i < paths.length; i += 400) {
      const { body } = await this.call('read', { method: 'POST', body: JSON.stringify({ paths: paths.slice(i, i + 400) }) });
      Object.assign(files, body.files ?? {});
    }
    return files;
  }

  async write(path: string, contents: string, expected: string | undefined): Promise<WriteResult> {
    const { status, body } = await this.call('file', { method: 'PUT', body: JSON.stringify({ path, contents, expected }) });
    return status === 200 ? { ok: true, contents: body.contents } : { ok: false, error: body.error ?? `Couldn't save ${path}.`, current: body.current };
  }

  async create(path: string, contents: string): Promise<WriteResult> {
    const { status, body } = await this.call('create', { method: 'POST', body: JSON.stringify({ path, contents }) });
    return status === 201 ? { ok: true, contents } : { ok: false, error: body.error ?? `Couldn't create ${path}.` };
  }

  fileUrl(path: string) {
    return `/__frame/fs/${path.split('/').map(encodeURIComponent).join('/')}?token=${this.token}`;
  }

  publicUrl(path: string) {
    return path;
  }

  watch(onChange: (paths: string[]) => void, onEnd: () => void) {
    const source = new EventSource(`/__frame/api/events?token=${this.token}`);
    source.addEventListener('change', (event) => onChange(JSON.parse((event as MessageEvent).data).paths));
    source.addEventListener('ended', () => onEnd());
    return () => source.close();
  }

  async addImage(file: File) {
    const res = await fetch(`/__frame/api/asset?name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { 'x-frame-token': this.token },
      body: file,
    });
    const body = await res.json();
    if (res.status !== 201) throw new Error(body.error ?? 'Could not add the image.');
    return body.url as string;
  }

  async loadComments() {
    return ((await this.call('comments')).body.comments ?? []) as Comment[];
  }

  async saveComments(comments: Comment[]) {
    await this.call('comments', { method: 'PUT', body: JSON.stringify({ comments }) });
  }

  async changes() {
    return ((await this.call('changes')).body.changes ?? []) as FileChange[];
  }

  async revert(path: string) {
    const { status, body } = await this.call('revert', { method: 'POST', body: JSON.stringify({ path }) });
    if (status !== 200) throw new Error(body.error);
    return body.contents as string | null;
  }

  async done(note?: string) {
    const { status, body } = await this.call('done', { method: 'POST', body: JSON.stringify({ note }) });
    if (status !== 200) throw new Error(body.error ?? 'Could not end the session.');
    return body.summary as Summary;
  }
}

/** The parts of the File System Access API Frame uses. */
interface FileHandle {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string | Blob): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>;
}
interface DirectoryHandle {
  kind: 'directory';
  name: string;
  values(): AsyncIterable<FileHandle | DirectoryHandle>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandle>;
}

export const pickers = globalThis as unknown as {
  showDirectoryPicker?: (options?: object) => Promise<DirectoryHandle>;
  showOpenFilePicker?: (options?: object) => Promise<FileHandle[]>;
};

const skippedDirs = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'out', 'coverage', '.turbo', '.vercel', '.cache']);

/** A folder picked in Chrome or Edge. Reads and writes go straight to disk. */
export class FolderBackend implements Backend {
  kind = 'folder' as const;
  label = 'Folder';
  private handles = new Map<string, FileHandle>();
  private urls = new Map<string, string>();
  constructor(private dir: DirectoryHandle) {}

  async load(): Promise<LoadedProject> {
    const sizes: { path: string; size: number }[] = [];
    let visited = 0;
    const scan = async (dir: DirectoryHandle, prefix: string, depth: number) => {
      if (depth > 12 || visited > 15000) return;
      for await (const entry of dir.values()) {
        if (++visited > 15000) return;
        if (entry.name.startsWith('.') || skippedDirs.has(entry.name)) continue;
        const path = prefix + entry.name;
        if (entry.kind === 'directory') await scan(entry, `${path}/`, depth + 1);
        else {
          this.handles.set(path, entry);
          sizes.push({ path, size: 0 });
        }
      }
    };
    await scan(this.dir, '', 0);
    const textPaths = sizes.filter((f) => isTextPath(f.path)).map((f) => f.path);
    const files = await this.read(textPaths);
    // Public images become blob URLs so pages can show them.
    for (const { path } of sizes) {
      if (!/^public\/.+\.(png|jpe?g|gif|webp|avif|svg|ico)$/i.test(path) || this.urls.size > 300) continue;
      const file = await this.handles.get(path)!.getFile();
      if (file.size < 8 * 1024 * 1024) this.urls.set(path, URL.createObjectURL(file));
    }
    return { name: this.dir.name, paths: sizes.map((f) => f.path), files };
  }

  async read(paths: string[]) {
    const files: Record<string, string> = {};
    for (const path of paths) {
      const handle = this.handles.get(path);
      if (handle) files[path] = await (await handle.getFile()).text();
    }
    return files;
  }

  async write(path: string, contents: string, expected: string | undefined): Promise<WriteResult> {
    const handle = this.handles.get(path);
    if (!handle) return this.create(path, contents);
    const current = await (await handle.getFile()).text();
    if (expected !== undefined && current !== expected)
      return { ok: false, error: `${path} changed outside Frame. Nothing was overwritten.`, current };
    const stream = await handle.createWritable();
    try {
      await stream.write(contents);
      await stream.close();
    } catch (error) {
      await stream.abort().catch(() => {});
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    return { ok: true, contents };
  }

  async create(path: string, contents: string): Promise<WriteResult> {
    const parts = path.split('/');
    let dir = this.dir;
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true });
    const handle = await dir.getFileHandle(parts.at(-1)!, { create: true });
    this.handles.set(path, handle);
    return this.write(path, contents, undefined);
  }

  fileUrl(path: string) {
    return this.urls.get(path);
  }

  publicUrl(path: string) {
    return this.urls.get(`public${path.split(/[?#]/)[0]}`) ?? path;
  }

  async addImage(file: File) {
    const name = file.name.replace(/[^\w.-]+/g, '-');
    const path = `public/images/${name}`;
    const parts = path.split('/');
    let dir = this.dir;
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true });
    const handle = await dir.getFileHandle(name, { create: true });
    const stream = await handle.createWritable();
    await stream.write(file);
    await stream.close();
    this.handles.set(path, handle);
    this.urls.set(path, URL.createObjectURL(file));
    return `/images/${name}`;
  }
}

/**
 * Files held in memory: the demo, or a component opened without folder access.
 * Edits persist as a draft in localStorage, and "saving" updates the draft.
 */
export class MemoryBackend implements Backend {
  kind = 'memory' as const;
  constructor(
    private name: string,
    private files: Record<string, string>,
    readonly label: string,
    private assets: Record<string, string> = {},
    private draftKey?: string,
  ) {
    if (draftKey) {
      try {
        const draft = JSON.parse(localStorage.getItem(draftKey) ?? 'null');
        if (draft && typeof draft === 'object') this.files = { ...this.files, ...draft };
      } catch {
        /* no draft */
      }
    }
  }

  async load(): Promise<LoadedProject> {
    return { name: this.name, paths: [...Object.keys(this.files), ...Object.keys(this.assets)], files: { ...this.files } };
  }

  async read(paths: string[]) {
    return Object.fromEntries(paths.filter((p) => p in this.files).map((p) => [p, this.files[p]]));
  }

  async write(path: string, contents: string, expected: string | undefined): Promise<WriteResult> {
    if (expected !== undefined && this.files[path] !== undefined && this.files[path] !== expected)
      return { ok: false, error: `${path} changed. Nothing was overwritten.`, current: this.files[path] };
    this.files[path] = contents;
    this.persist(path);
    return { ok: true, contents };
  }

  async create(path: string, contents: string): Promise<WriteResult> {
    return this.write(path, contents, undefined);
  }

  private changed = new Set<string>();
  private persist(path: string) {
    if (!this.draftKey) return;
    this.changed.add(path);
    try {
      localStorage.setItem(this.draftKey, JSON.stringify(Object.fromEntries([...this.changed].map((p) => [p, this.files[p]]))));
    } catch {
      /* storage full or blocked: edits stay for this session */
    }
  }

  /** Drops the draft so the next load starts from the original files. */
  reset() {
    if (this.draftKey) localStorage.removeItem(this.draftKey);
  }

  fileUrl(path: string) {
    return this.assets[path];
  }

  publicUrl(path: string) {
    return this.assets[`public${path.split(/[?#]/)[0]}`] ?? path;
  }

  async addImage(file: File) {
    const name = file.name.replace(/[^\w.-]+/g, '-');
    this.assets[`public/images/${name}`] = URL.createObjectURL(file);
    return `/images/${name}`;
  }

  /** The current text of every file, for downloads. */
  snapshot() {
    return { ...this.files };
  }
}

/** Downloads text as a file. */
export function download(contents: string, name: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
