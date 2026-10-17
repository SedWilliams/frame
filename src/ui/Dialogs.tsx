/*
 * Dialogs: keyboard shortcuts, Done, changed files and conflicts, new page, new
 * component, open project, and local variables.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FileCode2, FolderOpen, Plus, RotateCcw, Sparkles, Trash2, X, ClipboardPaste } from 'lucide-react';
import { commands, displayKeys } from '../app/commands';
import { commit, get, set, toast, useEditor, workspace } from '../app/state';
import { createComponentFromSelection, selectedNodes } from '../app/actions';
import { finishSession, keepMyVersion, openProject, saveAll, takeDiskVersion, demoBackend } from '../app/session';
import { FolderBackend, MemoryBackend, pickers, type FileChange } from '../app/backend';
import { newPageFile } from '../app/edit';
import { cssVariables, removeVariable, setVariable, type CssVariable } from '../core/cssfile';
import { parseColor, toHex } from '../core/color';
import { openPage } from '../canvas/Canvas';
import { ColorSwatch } from './ColorPicker';
import { IconButton, TextField } from './controls';

export function Modal({ title, children, onClose, wide, footer }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean; footer?: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab' && ref.current) {
        const focusable = [...ref.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea, select, a[href]')];
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('keydown', key, true);
      previous?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <section ref={ref} className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <header>
          <h2>{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </section>
    </div>
  );
}

const close = () => set({ dialog: null });

export function Dialogs() {
  const dialog = useEditor((s) => s.dialog);
  switch (dialog?.kind) {
    case 'shortcuts':
      return <Shortcuts />;
    case 'done':
      return <Done />;
    case 'changes':
      return <Changes />;
    case 'new-page':
      return <NewPage />;
    case 'new-component':
      return <NewComponent />;
    case 'open':
      return <OpenProject />;
    case 'variables':
      return <Variables />;
    default:
      return null;
  }
}

function Shortcuts() {
  const groups = useMemo(() => {
    const map = new Map<string, typeof commands>();
    for (const command of commands) {
      if (!command.keys || command.id.startsWith('opacity-') || command.id.startsWith('nudge-')) continue;
      map.set(command.group, [...(map.get(command.group) ?? []), command]);
    }
    return [...map.entries()];
  }, []);
  return (
    <Modal title="Keyboard shortcuts" onClose={close} wide>
      <div className="shortcut-groups">
        {groups.map(([group, list]) => (
          <section key={group}>
            <h3>{group}</h3>
            {list.map((command) => (
              <div key={command.id} className="shortcut">
                <span>{command.label}</span>
                <kbd>{displayKeys(command.keys![0])}</kbd>
              </div>
            ))}
          </section>
        ))}
        <section>
          <h3>Canvas</h3>
          <div className="shortcut"><span>Pan</span><kbd>Space + drag</kbd></div>
          <div className="shortcut"><span>Zoom</span><kbd>{displayKeys('Mod')} + scroll</kbd></div>
          <div className="shortcut"><span>Select deep</span><kbd>{displayKeys('Mod')} + click</kbd></div>
          <div className="shortcut"><span>Duplicate while dragging</span><kbd>{displayKeys('Alt')} + drag</kbd></div>
          <div className="shortcut"><span>Measure distances</span><kbd>{displayKeys('Alt')} + hover</kbd></div>
          <div className="shortcut"><span>Opacity</span><kbd>0–9</kbd></div>
          <div className="shortcut"><span>Nudge, or reorder in auto layout</span><kbd>Arrows</kbd></div>
        </section>
      </div>
    </Modal>
  );
}

function Done() {
  const [note, setNote] = useState('');
  const [changes, setChanges] = useState<FileChange[] | null>(null);
  const [busy, setBusy] = useState(false);
  const allComments = useEditor((s) => s.comments);
  const comments = allComments.filter((c) => !c.resolved);
  useEffect(() => {
    void (async () => {
      await saveAll();
      setChanges((await get().backend?.changes?.()) ?? []);
    })();
  }, []);
  return (
    <Modal
      title="Hand back to your agent"
      onClose={close}
      footer={
        <>
          <button className="secondary-button" onClick={close}>
            Keep editing
          </button>
          <button
            className="primary-button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await finishSession(note);
              setBusy(false);
            }}
          >
            {busy ? 'Finishing…' : 'Done'}
          </button>
        </>
      }
    >
      <p>Frame saves your work and sends your agent the list of changed files and your comments. You can close this tab afterwards.</p>
      <div className="summary-list">
        <h3>Changed files</h3>
        {changes === null ? (
          <p className="muted">Checking…</p>
        ) : changes.length ? (
          <ul>
            {changes.map((change) => (
              <li key={change.path}>
                <FileCode2 size={13} />
                <code>{change.path}</code>
                <small className="additions">+{change.additions}</small>
                <small className="deletions">−{change.deletions}</small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No files changed.</p>
        )}
        <h3>Requests for your agent</h3>
        {comments.length ? (
          <ul>
            {comments.map((c) => (
              <li key={c.id}>
                <span>{c.text}</span>
                <small>{c.element}</small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No comments. Use the comment tool (C) to ask for changes you'd rather not make by hand.</p>
        )}
      </div>
      <TextField multiline name="Note for your agent" placeholder="Anything else your agent should know (optional)" value={note} onCommit={setNote} />
    </Modal>
  );
}

function Changes() {
  const conflicts = useEditor((s) => s.conflicts);
  const doc = useEditor((s) => s.doc);
  const disk = useEditor((s) => s.disk);
  const dirty = useMemo(() => workspace({ ...get(), doc, disk }).dirty(disk), [doc, disk]);
  const [changes, setChanges] = useState<FileChange[] | null>(null);
  const backend = useEditor((s) => s.backend);
  const load = async () => setChanges((await backend?.changes?.()) ?? null);
  useEffect(() => {
    void load();
  }, []);
  return (
    <Modal title="Changed files" onClose={close} wide>
      {Object.keys(conflicts).length > 0 && (
        <div className="summary-list">
          <h3>Changed on disk while you edited</h3>
          <ul>
            {Object.keys(conflicts).map((path) => (
              <li key={path}>
                <code>{path}</code>
                <button className="secondary-button" onClick={() => takeDiskVersion(path)}>
                  Use disk version
                </button>
                <button className="secondary-button" onClick={() => keepMyVersion(path)}>
                  Keep mine
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="summary-list">
        <h3>Unsaved</h3>
        {dirty.length ? (
          <ul>
            {dirty.map((path) => (
              <li key={path}>
                <code>{path}</code>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Everything is saved.</p>
        )}
        {changes && (
          <>
            <h3>Saved this session</h3>
            {changes.length ? (
              <ul>
                {changes.map((change) => (
                  <li key={change.path}>
                    <code>{change.path}</code>
                    <small className="additions">+{change.additions}</small>
                    <small className="deletions">−{change.deletions}</small>
                    {backend?.revert && (
                      <button
                        className="secondary-button"
                        onClick={async () => {
                          const content = await backend.revert!(change.path);
                          toast(content === null ? `Removed ${change.path}.` : `Reverted ${change.path}.`, 'success');
                          void load();
                        }}
                      >
                        <RotateCcw size={12} /> Revert
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No files saved yet.</p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function NewPage() {
  const [name, setName] = useState('About');
  const [route, setRoute] = useState('/about');
  const framework = useEditor((s) => workspace(s).framework);
  const create = () => {
    const state = get();
    const { path, source } = newPageFile(state.doc, framework, route, name);
    if (state.doc.code[path]) return toast(`${path} already exists.`, 'error');
    commit('new-page', (doc) => ({ ...doc, code: { ...doc.code, [path]: { path, base: source, roots: {}, literals: {} } } }), { merge: false });
    set((s) => ({ config: { ...s.config, paths: [...s.config.paths, path] }, dialog: null }));
    void saveAll();
    const page = workspace().pages().find((p) => p.file === path);
    if (page) openPage(page.id);
    toast(framework === 'react-router' || framework === 'vite' ? `Created ${path}. Add a route for it in your router.` : `Created ${path}.`, 'success');
  };
  return (
    <Modal
      title="New page"
      onClose={close}
      footer={
        <>
          <button className="secondary-button" onClick={close}>
            Cancel
          </button>
          <button className="primary-button" onClick={create} disabled={!name.trim() || !route.startsWith('/')}>
            Create page
          </button>
        </>
      }
    >
      <TextField
        label="Name"
        value={name}
        onCommit={(v) => {
          setName(v);
          if (route === `/${name.toLowerCase().replace(/\s+/g, '-')}`) setRoute(`/${v.toLowerCase().trim().replace(/\s+/g, '-')}`);
        }}
      />
      <TextField label="Route" value={route} onCommit={(v) => setRoute(v.startsWith('/') ? v : `/${v}`)} />
      <p className="hint">Frame adds a page file to your app's router folder. Next.js picks it up at that route right away.</p>
    </Modal>
  );
}

function NewComponent() {
  const node = selectedNodes()[0];
  const [name, setName] = useState(node ? node.name.replace(/[^A-Za-z0-9 ]/g, '').replace(/(^|\s)(\w)/g, (_, __, c: string) => c.toUpperCase()).replace(/\s/g, '') || 'NewComponent' : 'NewComponent');
  return (
    <Modal
      title="Create component"
      onClose={close}
      footer={
        <>
          <button className="secondary-button" onClick={close}>
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={!/^[A-Za-z][A-Za-z0-9]*$/.test(name)}
            onClick={() => {
              close();
              createComponentFromSelection(name);
            }}
          >
            Create
          </button>
        </>
      }
    >
      <TextField label="Name" value={name} onCommit={setName} />
      <p className="hint">The layer moves into its own file in your components folder, and an instance takes its place.</p>
    </Modal>
  );
}

function OpenProject() {
  const [tab, setTab] = useState<'folder' | 'paste'>('folder');
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const folder = async () => {
    if (!pickers.showDirectoryPicker) return toast('Folder access needs Chrome or Edge. Paste a component instead, or run Frame from your terminal with `frame`.', 'error');
    try {
      setBusy(true);
      const dir = await pickers.showDirectoryPicker({ mode: 'readwrite' });
      close();
      await openProject(new FolderBackend(dir));
    } catch (error) {
      if ((error as Error).name !== 'AbortError') toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Open a project" onClose={close}>
      <div className="modal-tabs">
        <button className={tab === 'folder' ? 'active' : ''} onClick={() => setTab('folder')}>
          <FolderOpen size={14} /> Folder
        </button>
        <button className={tab === 'paste' ? 'active' : ''} onClick={() => setTab('paste')}>
          <ClipboardPaste size={14} /> Paste a component
        </button>
      </div>
      {tab === 'folder' ? (
        <>
          <button className="open-folder" onClick={folder} disabled={busy}>
            <FolderOpen size={28} />
            <strong>{busy ? 'Reading your project…' : 'Choose your project folder'}</strong>
            <span>Frame finds every page and component. Your code stays on your computer.</span>
          </button>
          <p className="hint">
            For the best experience, run <code>frame</code> in your project from a terminal, or ask your agent to open Frame. That adds live reload and hands your changes back when you're done.
          </p>
          <button
            className="secondary-button wide"
            onClick={() => {
              close();
              void openProject(demoBackend());
            }}
          >
            <Sparkles size={13} /> Open the demo site
          </button>
        </>
      ) : (
        <>
          <textarea
            className="paste-source"
            aria-label="React source"
            spellCheck={false}
            placeholder={'export default function Card() {\n  return <div style={{ padding: 24 }}><h1>Hello</h1></div>;\n}'}
            value={source}
            onChange={(e) => setSource(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <button
            className="primary-button wide"
            disabled={!source.trim()}
            onClick={() => {
              close();
              void openProject(new MemoryBackend('Pasted component', { 'src/App.tsx': source }, 'Pasted'));
            }}
          >
            Open in canvas
          </button>
        </>
      )}
    </Modal>
  );
}

function Variables() {
  const text = useEditor((s) => s.doc.text);
  const files = Object.keys(text).filter((path) => path.endsWith('.css'));
  const all = files.flatMap((file) => cssVariables(text[file], file));
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('--color-brand');
  const [newValue, setNewValue] = useState('#e86b47');
  const update = (file: string, change: (css: string) => string) =>
    commit(`variables:${file}`, (doc) => ({ ...doc, text: { ...doc.text, [file]: change(doc.text[file]) } }));
  const names = [...new Set(all.map((v) => `${v.file}|${v.name}`))];
  const find = (file: string, name: string, mode: CssVariable['mode']) => all.find((v) => v.file === file && v.name === name && v.mode === mode);
  const valueCell = (file: string, name: string, mode: CssVariable['mode']) => {
    const variable = find(file, name, mode);
    const color = variable ? parseColor(variable.value) : undefined;
    return (
      <td>
        <div className="variable-value">
          {color && <ColorSwatch value={toHex(color)} label={name} onChange={(v) => update(file, (css) => setVariable(css, file, name, v, mode))} />}
          <TextField name={`${name} ${mode}`} value={variable?.value ?? ''} placeholder="—" onCommit={(v) => update(file, (css) => (v ? setVariable(css, file, name, v, mode) : removeVariable(css, file, name, mode)))} />
        </div>
      </td>
    );
  };
  return (
    <Modal title="Local variables" onClose={close} wide>
      {!files.length ? (
        <p className="muted">This project has no stylesheets. Variables are CSS custom properties, such as --color-brand.</p>
      ) : (
        <>
          <p className="hint">These are the CSS custom properties in your stylesheets. Light is :root, Dark is .dark or the dark color scheme, and Theme is Tailwind's @theme.</p>
          <table className="variables">
            <thead>
              <tr>
                <th>Name</th>
                <th>Light</th>
                <th>Dark</th>
                <th>Theme</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {names.map((id) => {
                const [file, name] = id.split('|');
                return (
                  <tr key={id}>
                    <td>
                      <code>{name}</code>
                      <small>{file}</small>
                    </td>
                    {valueCell(file, name, 'light')}
                    {valueCell(file, name, 'dark')}
                    {valueCell(file, name, 'theme')}
                    <td>
                      <IconButton label={`Delete ${name}`} onClick={() => update(file, (css) => ['light', 'dark', 'theme'].reduce((c, mode) => removeVariable(c, file, name, mode as CssVariable['mode']), css))}>
                        <Trash2 size={13} />
                      </IconButton>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {adding ? (
            <div className="add-variable">
              <TextField name="Variable name" value={newName} onCommit={setNewName} />
              <TextField name="Variable value" value={newValue} onCommit={setNewValue} />
              <button
                className="primary-button"
                onClick={() => {
                  const name = newName.startsWith('--') ? newName : `--${newName}`;
                  update(files[0], (css) => setVariable(css, files[0], name, newValue, 'light'));
                  setAdding(false);
                }}
              >
                Add
              </button>
            </div>
          ) : (
            <button className="secondary-button" onClick={() => setAdding(true)}>
              <Plus size={13} /> Create variable
            </button>
          )}
        </>
      )}
    </Modal>
  );
}
