export interface LocalFile {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{
    write(contents: string): Promise<void>;
    close(): Promise<void>;
    abort(): Promise<void>;
  }>;
}
interface Directory {
  name: string;
  kind: 'directory';
  values(): AsyncIterable<Directory | (LocalFile & { kind: 'file' })>;
}
export interface WorkspaceFile {
  path: string;
  handle: LocalFile;
}
export const pickers = globalThis as unknown as {
  showOpenFilePicker?: (options: object) => Promise<LocalFile[]>;
  showDirectoryPicker?: (options: object) => Promise<Directory>;
};

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

export function downloadSource(source: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([source], { type: 'text/plain' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
