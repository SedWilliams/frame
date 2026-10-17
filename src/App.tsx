import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Download,
  FolderOpen,
  GitBranch,
  Laptop,
  Monitor,
  MoreHorizontal,
  Play,
  Redo2,
  Save,
  Smartphone,
  Tablet,
  Undo2,
  X,
  CircleHelp,
  AlertCircle,
  RotateCcw,
  Keyboard,
  MousePointer2,
} from 'lucide-react';
import { useEditor } from './useEditor';
import { Layers } from './components/Layers';
import { Inspector } from './components/Inspector';
import { Canvas } from './components/Canvas';
import { IconButton, Modal } from './components/Controls';
import { ProjectModal } from './components/ProjectModal';
import { CodeModal } from './components/CodeModal';
import { downloadSource, writeLocalFile, type LocalFile } from './files';
import { exportSource } from './source';
import type { Project } from './model';
import { countNodes } from './model';
import { makeDemo } from './demo';

export default function App() {
  const editor = useEditor();
  const [leftTab, setLeftTab] = useState('layers');
  const [modal, setModal] = useState<'project' | 'code' | 'help' | 'reset' | null>(null);
  const [menu, setMenu] = useState(false);
  const [preview, setPreview] = useState(false);
  const [viewport, setViewport] = useState(960);
  const [zoom, setZoom] = useState(0.8);
  const [fitKey, setFitKey] = useState(0);
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const file = useRef<{ handle: LocalFile; expected: string } | null>(null);
  const savingRef = useRef(false);
  const closeModal = useCallback(() => setModal(null), []);
  const notify = useCallback((message: string, error = false) => setToast({ message, error }), []);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), toast.error ? 10000 : 3500);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  function openProject(project: Project, handle?: LocalFile) {
    file.current = handle ? { handle, expected: project.source } : null;
    editor.open(project);
    closeModal();
    setLeftTab('layers');
    notify(
      handle
        ? 'Component connected. Save changes to update your source file.'
        : 'Component opened. Export your changes when you’re ready.',
    );
  }

  const save = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const source = exportSource(editor.project);
      if (file.current) {
        await writeLocalFile(file.current.handle, file.current.expected, source);
        file.current.expected = source;
        notify('Saved to your source file. Your dev server can pick up the change.');
      } else {
        downloadSource(source, editor.project.fileName.split('/').pop()!);
        notify('Component exported. Image paths still point to your project assets.');
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not save the component.', true);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [editor.project, notify]);

  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      const isInput = target.closest('input, textarea, select, [contenteditable="true"]');
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (!modal) {
          if (isInput) {
            target.blur();
            requestAnimationFrame(() => void saveRef.current());
          } else void save();
        }
        return;
      }
      if (modal || isInput) return;
      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setLeftTab('layers');
        setTimeout(
          () => document.querySelector<HTMLInputElement>('[aria-label="Search layers"]')?.focus(),
          0,
        );
      } else if (event.key === 'Escape') {
        setPreview(false);
        setMenu(false);
      } else if (!preview && mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        event.shiftKey ? editor.redo() : editor.undo();
      } else if (!preview && mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        editor.redo();
      } else if (!preview && mod && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        editor.duplicate();
      } else if (!preview && ['Backspace', 'Delete'].includes(event.key)) {
        event.preventDefault();
        editor.remove();
      } else if (event.key === '?') setModal('help');
    }
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [editor, save, modal, preview]);

  useEffect(() => {
    setFitKey((key) => key + 1);
  }, [preview]);
  const nodeCount = countNodes(editor.project.root);
  return (
    <div className={`app ${preview ? 'is-preview' : ''}`}>
      <header className="topbar">
        <button className="brand" aria-label="Frame project menu" onClick={() => setMenu(!menu)}>
          <span className="brand-mark">
            <i />
            <i />
          </span>
          <span>frame</span>
          <ChevronDown size={12} />
        </button>
        <div className="topbar-divider" />
        <div className="project-breadcrumb">
          <button onClick={() => setMenu(!menu)}>
            {editor.project.name}
            <ChevronDown size={12} />
          </button>
          <ChevronRight size={12} />
          <span>Home page</span>
          <span className="draft-badge">Draft</span>
        </div>
        <div className="topbar-actions">
          <span className="saved-label">
            <span className="live-dot" />
            {file.current ? 'File connected' : 'Local workspace'}
          </span>
          <IconButton label="Open keyboard shortcuts" onClick={() => setModal('help')}>
            <CircleHelp size={17} />
          </IconButton>
          <button
            className={`secondary-button preview-button ${preview ? 'is-active' : ''}`}
            onClick={() => setPreview(!preview)}
          >
            {preview ? <X size={14} /> : <Play size={13} />}
            <span>{preview ? 'Exit preview' : 'Preview'}</span>
          </button>
          <button className="primary-button" disabled={saving} onClick={() => void save()}>
            {file.current ? <Save size={14} /> : <Download size={14} />}
            <span>{saving ? 'Saving...' : file.current ? 'Save to file' : 'Export code'}</span>
            <ChevronDown size={12} />
          </button>
        </div>
        {menu && (
          <>
            <button
              aria-label="Close project menu"
              className="menu-scrim"
              onClick={() => setMenu(false)}
            />
            <div className="project-menu">
              <span>YOUR WORKSPACE</span>
              <button
                onClick={() => {
                  setModal('project');
                  setMenu(false);
                }}
              >
                <FolderOpen size={15} />
                Open a React project
                <ArrowUpRight size={13} />
              </button>
              <button
                onClick={() => {
                  setModal('code');
                  setMenu(false);
                }}
              >
                <Code2 size={15} />
                View generated code
              </button>
              <button
                onClick={() => {
                  setModal('reset');
                  setMenu(false);
                }}
              >
                <RotateCcw size={15} />
                Reset to demo
              </button>
              <hr />
              <button
                onClick={() => {
                  setModal('help');
                  setMenu(false);
                }}
              >
                <Keyboard size={15} />
                Keyboard shortcuts
              </button>
            </div>
          </>
        )}
      </header>
      <div className="workspace-toolbar">
        <div className="workspace-tab">
          <span className="tab-icon">
            <Monitor size={14} />
          </span>
          <span>Home page</span>
          <span className="tab-dot" />
        </div>
        <div className="history-tools">
          <IconButton label="Undo (⌘Z)" disabled={!editor.canUndo || preview} onClick={editor.undo}>
            <Undo2 size={16} />
          </IconButton>
          <IconButton
            label="Redo (⌘⇧Z)"
            disabled={!editor.canRedo || preview}
            onClick={editor.redo}
          >
            <Redo2 size={16} />
          </IconButton>
          <i />
          <button onClick={() => setModal('project')}>
            <FolderOpen size={14} />
            <span>Open project</span>
          </button>
        </div>
        <div className="device-switch">
          {[
            { width: 960, label: 'Desktop', Icon: Monitor },
            { width: 768, label: 'Tablet', Icon: Tablet },
            { width: 390, label: 'Mobile', Icon: Smartphone },
          ].map(({ width, label, Icon }) => (
            <button
              key={width}
              aria-label={`${label} viewport`}
              className={viewport === width ? 'active' : ''}
              onClick={() => setViewport(width)}
            >
              <Icon size={14} />
              {viewport === width && <span>{label}</span>}
            </button>
          ))}
        </div>
        <div className="toolbar-end">
          <span>{viewport} px</span>
          <i />
          <button onClick={() => setModal('code')}>
            <Code2 size={15} />
            Code
          </button>
          <IconButton label="More workspace actions" onClick={() => setMenu(!menu)}>
            <MoreHorizontal size={17} />
          </IconButton>
        </div>
      </div>
      <div className="editor-layout">
        {!preview && (
          <Layers
            editor={editor}
            tab={leftTab}
            setTab={setLeftTab}
            onConnect={() => setModal('project')}
          />
        )}
        <Canvas
          editor={editor}
          viewport={viewport}
          zoom={zoom}
          setZoom={setZoom}
          preview={preview}
          fitKey={fitKey}
          onCode={() => setModal('code')}
        />
        {!preview && <Inspector editor={editor} onCode={() => setModal('code')} />}
      </div>
      <footer className="statusbar">
        <div>
          <span className={`status-dot ${editor.storageStatus === 'error' ? 'warning' : ''}`} />
          <span>
            {editor.storageStatus === 'error'
              ? 'Browser storage unavailable. Export to keep edits.'
              : editor.storageStatus === 'saving'
                ? 'Saving draft...'
                : 'Draft saved in this browser'}
          </span>
        </div>
        <div className="status-center">
          <MousePointer2 size={11} />
          <span>
            {preview
              ? 'Static preview · Application logic is not executed'
              : 'Double-click to edit text · Drag layers to rearrange'}
          </span>
        </div>
        <div>
          <span>{nodeCount} layers</span>
          <span className="status-divider" />
          <GitBranch size={12} />
          <span>No cloud sync</span>
          <button aria-label="Help and shortcuts" onClick={() => setModal('help')}>
            <CircleHelp size={13} />
          </button>
        </div>
      </footer>
      {toast && (
        <div
          className={`toast ${toast.error ? 'error' : ''}`}
          role={toast.error ? 'alert' : 'status'}
        >
          {toast.error ? <AlertCircle size={17} /> : <Check size={16} />}
          <span>{toast.message}</span>
          <button aria-label="Dismiss notification" onClick={() => setToast(null)}>
            <X size={14} />
          </button>
        </div>
      )}
      {modal === 'project' && <ProjectModal onClose={closeModal} onOpen={openProject} />}
      {modal === 'code' && (
        <CodeModal
          project={editor.project}
          onClose={closeModal}
          onSave={() => void save()}
          connected={!!file.current}
        />
      )}
      {modal === 'reset' && (
        <Modal
          title="Start fresh?"
          subtitle="This replaces your current canvas with the North Studio demo."
          onClose={closeModal}
        >
          <div className="modal-body">
            <p className="reset-copy">
              Export any changes you want to keep. Files on your computer won't be changed.
            </p>
            <div className="modal-buttons">
              <button className="secondary-button" onClick={closeModal}>
                Keep editing
              </button>
              <button
                className="primary-button"
                onClick={() => {
                  file.current = null;
                  editor.open(makeDemo());
                  closeModal();
                  notify('Demo restored.');
                }}
              >
                Reset demo
                <RotateCcw size={14} />
              </button>
            </div>
          </div>
        </Modal>
      )}
      {modal === 'help' && (
        <Modal
          title="A few handy shortcuts."
          subtitle="Less clicking. More making."
          onClose={closeModal}
        >
          <div className="modal-body">
            <div className="shortcut-list">
              {[
                ['Undo', '⌘ / Ctrl + Z'],
                ['Redo', '⌘ / Ctrl + Shift + Z'],
                ['Duplicate layer', '⌘ / Ctrl + D'],
                ['Delete layer', 'Delete'],
                ['Find a layer', '⌘ / Ctrl + K'],
                ['Save or export code', '⌘ / Ctrl + S'],
                ['Exit preview / close dialog', 'Esc'],
              ].map(([label, key]) => (
                <div key={label}>
                  <span>{label}</span>
                  <kbd>{key}</kbd>
                </div>
              ))}
            </div>
            <div className="help-note">
              <Laptop size={21} />
              <p>
                Drag layers to reorder. Hold Shift while dropping a layer to nest it. Drag the
                bottom-right selection handle to resize. Double-click text on the canvas to edit it.
              </p>
            </div>
            <p className="replace-note">
              This editor previews static JSX and inline styles, not a running application. External
              stylesheets and custom component implementations stay in your codebase.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
