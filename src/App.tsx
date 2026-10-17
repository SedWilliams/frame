/*
 * App shell.
 *
 * Picks the backend: Frame's local server when the page was served by `frame`
 * (the server writes a session token into the page), otherwise the in-memory
 * demo. Then it lays out Figma's workspace: layers on the left, the canvas and
 * floating toolbar in the middle, properties on the right, with dialogs, menus,
 * Quick actions, Present, and notices on top.
 */

import { useEffect } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, Loader2, X } from 'lucide-react';
import { editor, get, set, useEditor } from './app/state';
import { handleShortcut } from './app/commands';
import { ServerBackend } from './app/backend';
import { demoBackend, keepMyVersion, openProject, takeDiskVersion } from './app/session';
import { placeImageFile } from './app/actions';
import { Canvas } from './canvas/Canvas';
import { LeftPanel } from './panels/LeftPanel';
import { RightPanel } from './panels/RightPanel';
import { Toolbar } from './ui/Toolbar';
import { Palette } from './ui/Palette';
import { Dialogs } from './ui/Dialogs';
import { Present } from './ui/Present';
import { Menu, contextMenuItems } from './ui/Menu';

/** The token the local server put in the page, if Frame was opened by `frame`. */
function serverToken() {
  return document.querySelector<HTMLMetaElement>('meta[name="frame-token"]')?.content;
}

export default function App() {
  const status = useEditor((s) => s.status);
  const error = useEditor((s) => s.error);
  const ui = useEditor((s) => s.ui);
  const theme = useEditor((s) => s.prefs.theme);
  const palette = useEditor((s) => s.palette);
  const menu = useEditor((s) => s.menu);
  const presenting = useEditor((s) => s.presenting);

  useEffect(() => {
    const token = serverToken();
    void openProject(token ? new ServerBackend(token) : demoBackend());
  }, []);

  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (get().palette || get().menu || get().presenting) return;
      handleShortcut(event);
    };
    window.addEventListener('keydown', onKey);
    // Images pasted from the clipboard go into the page.
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('input, textarea')) return;
      const file = [...(event.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
      if (file) {
        event.preventDefault();
        void placeImageFile(file);
      }
    };
    window.addEventListener('paste', onPaste);
    // Leaving with unsaved edits asks first.
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const state = get();
      if (state.status === 'ready' && state.saveState !== 'saved') event.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, []);

  if (status === 'loading')
    return (
      <div className="screen">
        <Loader2 className="spin" size={22} />
        <p>Reading your project…</p>
      </div>
    );
  if (status === 'error')
    return (
      <div className="screen">
        <AlertTriangle size={24} />
        <h1>Frame couldn't open this project.</h1>
        <p>{error}</p>
        <button className="secondary-button" onClick={() => void openProject(demoBackend())}>
          Open the demo instead
        </button>
      </div>
    );
  if (status === 'ended')
    return (
      <div className="screen">
        <CheckCircle2 size={26} className="ok" />
        <h1>Handed back to your agent.</h1>
        <p>Your changes are saved, and your agent has the summary and your comments. You can close this tab.</p>
      </div>
    );

  return (
    <div className={`app${ui.hidden ? ' ui-hidden' : ''}`}>
      {ui.left && !ui.hidden && <LeftPanel />}
      <div className="center">
        <ConflictBanner />
        <Canvas />
        {!ui.hidden && <Toolbar />}
      </div>
      {ui.right && !ui.hidden && <RightPanel />}
      <Dialogs />
      {palette && <Palette />}
      {menu?.kind === 'context' && <Menu items={contextMenuItems()} x={menu.x} y={menu.y} onClose={() => set({ menu: null })} className="context-menu" />}
      {presenting && <Present />}
      <Toasts />
      <input
        id="frame-image-input"
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void placeImageFile(file);
          event.target.value = '';
        }}
      />
    </div>
  );
}

function ConflictBanner() {
  const conflictMap = useEditor((s) => s.conflicts);
  const conflicts = Object.keys(conflictMap);
  if (!conflicts.length) return null;
  const path = conflicts[0];
  return (
    <div className="conflict-banner" role="alert">
      <AlertTriangle size={14} />
      <span>
        <code>{path}</code> changed on disk while you were editing it.
      </span>
      <button onClick={() => takeDiskVersion(path)}>Use disk version</button>
      <button onClick={() => keepMyVersion(path)}>Keep mine</button>
      {conflicts.length > 1 && <small>+{conflicts.length - 1} more</small>}
    </div>
  );
}

function Toasts() {
  const toasts = useEditor((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
          {t.kind === 'error' ? <AlertCircle size={15} /> : t.kind === 'success' ? <CheckCircle2 size={15} /> : <Info size={15} />}
          <span>{t.message}</span>
          {t.action && <button onClick={t.action.run}>{t.action.label}</button>}
          <button aria-label="Dismiss" onClick={() => editor.set((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) }))}>
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
