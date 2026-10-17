/*
 * The Open dialog.
 *
 * Three ways in: connect a folder and pick a component from it, open one file, or
 * paste source. The pickers keep a file handle, which turns on Save to file.
 * Uploads and pastes can only be exported as a download.
 */

import { useRef, useState } from 'react';
import {
  ArrowRight,
  FileCode2,
  FolderOpen,
  Upload,
  Code2,
  AlertCircle,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { Modal } from './Controls';
import { chooseWorkspace, pickers, type LocalFile, type WorkspaceFile } from '../files';
import { importSource } from '../source';
import type { Project } from '../model';

export function ProjectModal({
  onClose,
  onOpen,
}: {
  onClose: () => void;
  onOpen: (project: Project, handle?: LocalFile) => void;
}) {
  const [tab, setTab] = useState('file');
  const [source, setSource] = useState('');
  const [fileName, setFileName] = useState('Component.tsx');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [workspace, setWorkspace] = useState<{ name: string; files: WorkspaceFile[] } | null>(null);
  const [search, setSearch] = useState('');
  const input = useRef<HTMLInputElement>(null);
  /** Shows an error unless it came from the user cancelling a picker. */
  function report(error: unknown) {
    if (error instanceof Error && error.name !== 'AbortError') setError(error.message);
  }
  /** Reads and imports a file. `path` is the folder-relative name for files from a connected folder. */
  async function openFile(file: File, handle?: LocalFile, path?: string) {
    try {
      if (!/\.(jsx|tsx)$/i.test(file.name))
        throw new Error('Choose a React .jsx or .tsx source file.');
      const text = await file.text();
      onOpen(importSource(text, path || file.name), handle);
    } catch (error) {
      report(error);
    }
  }
  /**
   * Uses the native file picker where it exists, so Save can write back to the file.
   * Elsewhere it falls back to the hidden upload input.
   */
  async function pickFile() {
    setError('');
    if (!pickers.showOpenFilePicker) {
      input.current?.click();
      return;
    }
    try {
      const [handle] = await pickers.showOpenFilePicker({
        types: [{ description: 'React components', accept: { 'text/plain': ['.jsx', '.tsx'] } }],
        multiple: false,
      });
      await openFile(await handle.getFile(), handle);
    } catch (error) {
      report(error);
    }
  }
  /** Scans a chosen folder for components to list. */
  async function pickFolder() {
    setError('');
    setBusy(true);
    try {
      setWorkspace(await chooseWorkspace());
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Bring your code to the canvas."
      subtitle="Open a React component and make it your own."
      onClose={onClose}
    >
      <div className="modal-tabs">
        <button className={tab === 'file' ? 'active' : ''} onClick={() => setTab('file')}>
          <FolderOpen size={15} />
          Local files
        </button>
        <button className={tab === 'paste' ? 'active' : ''} onClick={() => setTab('paste')}>
          <Code2 size={15} />
          Paste JSX
        </button>
      </div>
      <div className="modal-body">
        {/* Local files tab: a connected folder's components, or the pickers. */}
        {tab === 'file' ? (
          workspace ? (
            <>
              <div className="workspace-title">
                <FolderOpen size={18} />
                <strong>{workspace.name}</strong>
                <span>{workspace.files.length} components</span>
              </div>
              <label className="workspace-search">
                <Search size={14} />
                <input
                  placeholder="Find a component..."
                  aria-label="Find a component"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <div className="workspace-files">
                {workspace.files
                  .filter((file) => file.path.toLowerCase().includes(search.toLowerCase()))
                  .map((file) => (
                    <button
                      key={file.path}
                      onClick={async () => {
                        try {
                          await openFile(await file.handle.getFile(), file.handle, file.path);
                        } catch (error) {
                          report(error);
                        }
                      }}
                    >
                      <FileCode2 size={16} />
                      <span>{file.path}</span>
                      <ArrowRight size={14} />
                    </button>
                  ))}
                {!workspace.files.length && (
                  <p>No .jsx or .tsx components found within the first 8 folder levels.</p>
                )}
              </div>
              <button className="text-button" onClick={() => setWorkspace(null)}>
                Choose a different folder
              </button>
            </>
          ) : (
            <>
              <button className="folder-drop" disabled={busy} onClick={pickFolder}>
                <span className="folder-icon">
                  <FolderOpen size={30} strokeWidth={1.4} />
                </span>
                <strong>{busy ? 'Finding React components...' : 'Connect a local project'}</strong>
                <span>Select a folder. Your code never leaves your browser.</span>
                <span className="folder-cta">
                  Choose folder <ArrowRight size={14} />
                </span>
              </button>
              <div className="import-divider">
                <span />
                or start with a component
                <span />
              </div>
              <button className="open-file-button" onClick={pickFile}>
                <Upload size={16} />
                Open a .jsx or .tsx file <ArrowRight size={14} />
              </button>
              <input
                hidden
                ref={input}
                type="file"
                accept=".jsx,.tsx"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void openFile(file);
                }}
              />
            </>
          )
        ) : (
          <>
            {/* Paste tab. The file name becomes the project name and the download name. */}
            <label className="filename-label">
              File name
              <input value={fileName} onChange={(event) => setFileName(event.target.value)} />
            </label>
            <textarea
              className="paste-source"
              spellCheck={false}
              aria-label="React source"
              placeholder={
                'export default function Card() {\n  return (\n    <div style={{ padding: 24 }}>\n      <h1>Hello, canvas.</h1>\n    </div>\n  );\n}'
              }
              value={source}
              onChange={(event) => setSource(event.target.value)}
            />
            <button
              className="primary-button import-submit"
              disabled={!source.trim()}
              onClick={() => {
                try {
                  onOpen(importSource(source, fileName || 'Component.tsx'));
                } catch (error) {
                  report(error);
                }
              }}
            >
              Open in canvas <ArrowRight size={15} />
            </button>
          </>
        )}
        {error && (
          <div className="error-message" role="alert">
            <AlertCircle size={16} />
            {error}
          </div>
        )}
        <div className="import-explainer">
          <ShieldCheck size={18} />
          <div>
            <strong>A static preview. Your logic stays yours.</strong>
            <p>
              Inline styles are editable. Class names, imports, event handlers, and dynamic
              expressions are preserved. External CSS and custom components aren't rendered. Folder
              access and direct saving need Chrome or Edge.
            </p>
          </div>
        </div>
        <p className="replace-note">
          Opening a component replaces this canvas. Export current edits first if you want to keep
          them.
        </p>
      </div>
    </Modal>
  );
}
