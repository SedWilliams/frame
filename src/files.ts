/*
 * Local file access through the File System Access API.
 *
 * Chrome and Edge let a page scan a folder and write back to a file the user
 * picked. In other browsers these pickers don't exist. ProjectModal falls back to
 * a plain upload, and App exports with a download instead of saving.
 */

/** The parts of a FileSystemFileHandle that Frame calls. Tests implement it with a fake. */
export interface LocalFile {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{
    write(contents: string): Promise<void>;
    close(): Promise<void>;
    abort(): Promise<void>;
  }>;
}
/** The parts of a FileSystemDirectoryHandle that the folder scan calls. */
interface Directory {
  name: string;
  kind: 'directory';
  values(): AsyncIterable<Directory | (LocalFile & { kind: 'file' })>;
}
/** A component found in a connected folder. `path` is relative to that folder. */
export interface WorkspaceFile {
  path: string;
  handle: LocalFile;
}
/** The browser's picker functions, undefined outside Chromium. Check before calling. */
export const pickers = globalThis as unknown as {
  showOpenFilePicker?: (options: object) => Promise<LocalFile[]>;
  showDirectoryPicker?: (options: object) => Promise<Directory>;
};

/**
 * Asks for a folder and lists the .jsx and .tsx files in it. Skips hidden and build
 * folders, and stops at 8 levels, 300 files, or 10,000 entries so a large repo
 * can't stall the dialog.
 */
export async function chooseWorkspace(): Promise<{ name: string; files: WorkspaceFile[] }> {
  if (!pickers.showDirectoryPicker)
    throw new Error(
      'Folder access needs Chrome or Edge. Use Open a file or Paste JSX in this browser.',
    );
  const directory = await pickers.showDirectoryPicker({ mode: 'readwrite' });
  const files: WorkspaceFile[] = [];
  const excluded = new Set(['node_modules', 'dist', 'build', 'coverage', 'vendor']);
  let visited = 0;
  async function scan(dir: Directory, prefix = '', depth = 0): Promise<void> {
    if (depth > 7 || files.length >= 300 || visited > 10000) return;
    for await (const entry of dir.values()) {
      if (++visited > 10000 || files.length >= 300) break;
      if (entry.name.startsWith('.') || excluded.has(entry.name)) continue;
      const path = `${prefix}${entry.name}`;
      if (entry.kind === 'directory') await scan(entry, `${path}/`, depth + 1);
      else if (/\.(jsx|tsx)$/i.test(entry.name)) files.push({ path, handle: entry });
    }
  }
  await scan(directory);
  return { name: directory.name, files: files.sort((a, b) => a.path.localeCompare(b.path)) };
}

/**
 * Saves only if the file still holds `expected`, the text Frame last read or wrote.
 * A failed write is aborted, which leaves the file on disk as it was.
 */
export async function writeLocalFile(handle: LocalFile, expected: string, source: string) {
  const current = await (await handle.getFile()).text();
  if (current !== expected)
    throw new Error(
      'This file changed outside Frame. Reopen it before saving, or download your edits to merge them. Nothing was overwritten.',
    );
  const stream = await handle.createWritable();
  try {
    await stream.write(source);
    await stream.close();
  } catch (error) {
    await stream.abort().catch(() => {});
    throw error;
  }
}

/** Downloads `source` as a file named after the last segment of `path`. */
export function downloadSource(source: string, path: string) {
  const url = URL.createObjectURL(new Blob([source], { type: 'text/plain' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = path.split('/').pop()!;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
