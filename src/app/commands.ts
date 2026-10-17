/*
 * Commands.
 *
 * Every action with a name: what the main menu, the context menu, Quick actions
 * (Cmd+K), and the keyboard share. Shortcuts follow Figma's. `Mod` is Cmd on a
 * Mac and Ctrl elsewhere. A command's `when` decides whether it's enabled.
 */

import {
  addAutoLayout,
  align,
  copyProperties,
  copySelection,
  createComponentFromSelection,
  deleteSelection,
  detachSelection,
  distribute,
  duplicateSelection,
  flip,
  goToMainComponent,
  paste,
  pasteProperties,
  removeAutoLayout,
  reorderSelection,
  rotateBy,
  selectAll,
  selectChildren,
  selectedNodes,
  selectParent,
  selectSibling,
  setStyle,
  structural,
  toggleHidden,
  toggleLocked,
  ungroupSelection,
  wrapSelection,
} from './actions';
import { COMPONENTS_PAGE, get, pagesOf, redo, set, setPrefs, setUI, undo, type Tool } from './state';
import { finishSession, saveAll } from './session';
import { computedOf } from '../canvas/registry';
import { addFrame, framePresets, openPage, zoomAround, zoomBy, zoomToFit, zoomToSelection } from '../canvas/Canvas';
import { copyAsPng, exportSelection } from './exporting';

export interface Command {
  id: string;
  label: string;
  group: 'File' | 'Edit' | 'View' | 'Object' | 'Text' | 'Arrange' | 'Tools' | 'Preferences' | 'Help';
  keys?: string[];
  run: () => void;
  when?: () => boolean;
  checked?: () => boolean;
}

const hasSelection = () => get().selection.length > 0;
const canRestructure = () => selectedNodes().some(structural);
const single = () => get().selection.length === 1;
const instanceSelected = () => selectedNodes()[0]?.kind === 'instance';
const textSelected = () => selectedNodes().some((n) => n.text !== undefined || n.kind === 'text');
const server = () => get().backend?.kind === 'server';

/** Nudges absolute layers, and reorders layers in flow, as arrow keys do in Figma's auto layout. */
function nudge(dx: number, dy: number) {
  const state = get();
  const nodes = selectedNodes(state);
  if (!nodes.length) return;
  const frame = state.activeFrame;
  const free = nodes.every((n) => /absolute|fixed/.test(computedOf(frame, n.key)?.position ?? ''));
  if (free) {
    const changes = nodes.map((n) => {
      const c = computedOf(frame, n.key)!;
      return { key: n.key, change: { ...(dx ? { left: Math.round((parseFloat(c.left) || 0) + dx) } : {}), ...(dy ? { top: Math.round((parseFloat(c.top) || 0) + dy) } : {}) } };
    });
    for (const { key, change } of changes) setStyle(change, [key], 'nudge');
    return;
  }
  reorderSelection(dx + dy > 0 ? 1 : -1);
}

/** Opacity from number keys: 1 is 10%, 0 is 100%, and two quick digits like 4 then 5 make 45%. */
let digit: { value: string; at: number } | undefined;
function opacityKey(n: string) {
  const now = Date.now();
  const value = digit && now - digit.at < 600 ? digit.value + n : n;
  digit = { value, at: now };
  const percent = value.length === 2 ? Number(value) : n === '0' ? 100 : Number(n) * 10;
  setStyle({ opacity: percent >= 100 ? null : percent / 100 }, get().selection, 'opacity');
}

const tool = (id: Tool) => () => set({ tool: id, hover: null });

function textStyle(change: Record<string, string | number | null>) {
  return () => setStyle(change, get().selection, `text:${Object.keys(change)[0]}`);
}

function toggleWeight() {
  const node = selectedNodes()[0];
  const weight = node ? Number(computedOf(get().activeFrame, node.key)?.fontWeight ?? 400) : 400;
  setStyle({ fontWeight: weight >= 600 ? 400 : 700 }, get().selection, 'text:fontWeight');
}

function toggleDecoration(value: 'underline' | 'line-through') {
  const node = selectedNodes()[0];
  const current = node ? computedOf(get().activeFrame, node.key)?.textDecorationLine ?? '' : '';
  setStyle({ textDecorationLine: current.includes(value) ? 'none' : value }, get().selection, 'text:decoration');
}

function stepFontSize(delta: number) {
  const node = selectedNodes()[0];
  const size = node ? parseFloat(computedOf(get().activeFrame, node.key)?.fontSize ?? '16') : 16;
  setStyle({ fontSize: Math.max(1, Math.round(size + delta)) }, get().selection, 'text:fontSize');
}

function nextPage(step: number) {
  const pages = [...pagesOf().map((p) => p.id), COMPONENTS_PAGE];
  const at = pages.indexOf(get().pageId);
  openPage(pages[(at + step + pages.length) % pages.length]);
}

export const commands: Command[] = [
  // File
  { id: 'save', label: 'Save', group: 'File', keys: ['Mod+S'], run: () => void saveAll() },
  { id: 'done', label: 'Done: hand back to agent', group: 'File', keys: ['Mod+Enter'], run: () => set({ dialog: { kind: 'done' } }), when: server },
  { id: 'changes', label: 'Changed files…', group: 'File', run: () => set({ dialog: { kind: 'changes' } }) },
  { id: 'open', label: 'Open project…', group: 'File', keys: ['Mod+O'], run: () => set({ dialog: { kind: 'open' } }), when: () => !server() },
  { id: 'export', label: 'Export selection…', group: 'File', keys: ['Mod+Shift+E'], run: () => void exportSelection('png', 2), when: hasSelection },
  { id: 'new-page', label: 'New page…', group: 'File', run: () => set({ dialog: { kind: 'new-page' } }) },
  // Edit
  { id: 'undo', label: 'Undo', group: 'Edit', keys: ['Mod+Z'], run: undo, when: () => get().history.past.length > 0 },
  { id: 'redo', label: 'Redo', group: 'Edit', keys: ['Mod+Shift+Z', 'Mod+Y'], run: redo, when: () => get().history.future.length > 0 },
  { id: 'copy', label: 'Copy', group: 'Edit', keys: ['Mod+C'], run: () => void copySelection(), when: hasSelection },
  { id: 'cut', label: 'Cut', group: 'Edit', keys: ['Mod+X'], run: () => void copySelection(true), when: canRestructure },
  { id: 'paste', label: 'Paste', group: 'Edit', keys: ['Mod+V'], run: paste },
  { id: 'duplicate', label: 'Duplicate', group: 'Edit', keys: ['Mod+D'], run: duplicateSelection, when: canRestructure },
  { id: 'delete', label: 'Delete', group: 'Edit', keys: ['Delete', 'Backspace'], run: deleteSelection, when: hasSelection },
  { id: 'select-all', label: 'Select all', group: 'Edit', keys: ['Mod+A'], run: selectAll },
  { id: 'select-none', label: 'Select none', group: 'Edit', keys: ['Escape'], run: () => set({ selection: [], scope: null, frameSelected: null, draftComment: null, openComment: null, tool: 'move' }) },
  { id: 'copy-properties', label: 'Copy properties', group: 'Edit', keys: ['Mod+Alt+C'], run: copyProperties, when: single },
  { id: 'paste-properties', label: 'Paste properties', group: 'Edit', keys: ['Mod+Alt+V'], run: pasteProperties, when: hasSelection },
  { id: 'find', label: 'Find layer…', group: 'Edit', keys: ['Mod+F'], run: () => {
      setUI({ leftTab: 'file', left: true });
      setTimeout(() => document.querySelector<HTMLInputElement>('[aria-label="Search layers"]')?.focus(), 0);
    } },
  // Selection navigation
  { id: 'select-children', label: 'Select child', group: 'Edit', keys: ['Enter'], run: selectChildren, when: hasSelection },
  { id: 'select-parent', label: 'Select parent', group: 'Edit', keys: ['Shift+Enter', '\\'], run: selectParent, when: hasSelection },
  { id: 'select-next', label: 'Select next sibling', group: 'Edit', keys: ['Tab'], run: () => selectSibling(1), when: hasSelection },
  { id: 'select-previous', label: 'Select previous sibling', group: 'Edit', keys: ['Shift+Tab'], run: () => selectSibling(-1), when: hasSelection },
  // Tools
  { id: 'tool-move', label: 'Move', group: 'Tools', keys: ['V'], run: tool('move') },
  { id: 'tool-scale', label: 'Scale', group: 'Tools', keys: ['K'], run: tool('scale') },
  { id: 'tool-hand', label: 'Hand', group: 'Tools', keys: ['H'], run: tool('hand') },
  { id: 'tool-frame', label: 'Frame', group: 'Tools', keys: ['F', 'A'], run: tool('frame') },
  { id: 'tool-section', label: 'Section', group: 'Tools', keys: ['Shift+S'], run: tool('section') },
  { id: 'tool-rectangle', label: 'Rectangle', group: 'Tools', keys: ['R'], run: tool('rectangle') },
  { id: 'tool-line', label: 'Line', group: 'Tools', keys: ['L'], run: tool('line') },
  { id: 'tool-ellipse', label: 'Ellipse', group: 'Tools', keys: ['O'], run: tool('ellipse') },
  { id: 'tool-polygon', label: 'Polygon', group: 'Tools', run: tool('polygon') },
  { id: 'tool-star', label: 'Star', group: 'Tools', run: tool('star') },
  { id: 'tool-pen', label: 'Pen', group: 'Tools', keys: ['P'], run: tool('pen') },
  { id: 'tool-pencil', label: 'Pencil', group: 'Tools', keys: ['Shift+P'], run: tool('pencil') },
  { id: 'tool-text', label: 'Text', group: 'Tools', keys: ['T'], run: tool('text') },
  { id: 'tool-comment', label: 'Comment', group: 'Tools', keys: ['C'], run: tool('comment') },
  { id: 'place-image', label: 'Place image…', group: 'Tools', keys: ['Mod+Shift+K'], run: () => document.querySelector<HTMLInputElement>('#frame-image-input')?.click() },
  { id: 'quick-actions', label: 'Quick actions…', group: 'Tools', keys: ['Mod+K', 'Mod+/'], run: () => set({ palette: true }) },
  // View
  { id: 'zoom-in', label: 'Zoom in', group: 'View', keys: ['Mod+=', 'Mod++', '='], run: () => zoomBy(1.25) },
  { id: 'zoom-out', label: 'Zoom out', group: 'View', keys: ['Mod+-', '-'], run: () => zoomBy(0.8) },
  { id: 'zoom-100', label: 'Zoom to 100%', group: 'View', keys: ['Shift+0'], run: () => zoomAround(1) },
  { id: 'zoom-fit', label: 'Zoom to fit', group: 'View', keys: ['Shift+1'], run: zoomToFit },
  { id: 'zoom-selection', label: 'Zoom to selection', group: 'View', keys: ['Shift+2'], run: zoomToSelection },
  { id: 'rulers', label: 'Rulers', group: 'View', keys: ['Shift+R'], run: () => setUI({ rulers: !get().ui.rulers }), checked: () => get().ui.rulers },
  { id: 'outline', label: 'Outline mode', group: 'View', keys: ['Mod+Y'], run: () => setUI({ outline: !get().ui.outline }), checked: () => get().ui.outline },
  { id: 'grids', label: 'Layout grids', group: 'View', keys: ['Ctrl+G'], run: () => setUI({ grids: !get().ui.grids }), checked: () => get().ui.grids },
  { id: 'comments', label: 'Comments', group: 'View', keys: ['Shift+C'], run: () => setUI({ commentsVisible: !get().ui.commentsVisible }), checked: () => get().ui.commentsVisible },
  { id: 'hide-ui', label: 'Show/hide UI', group: 'View', keys: ['Mod+\\'], run: () => setUI({ hidden: !get().ui.hidden }), checked: () => get().ui.hidden },
  { id: 'left-panel', label: 'Left panel', group: 'View', keys: ['Mod+Alt+1'], run: () => setUI({ left: !get().ui.left }), checked: () => get().ui.left },
  { id: 'right-panel', label: 'Right panel', group: 'View', keys: ['Mod+Alt+2'], run: () => setUI({ right: !get().ui.right }), checked: () => get().ui.right },
  { id: 'present', label: 'Present', group: 'View', keys: ['Mod+Alt+Enter'], run: () => set({ presenting: true, presentRoute: null }) },
  { id: 'next-page', label: 'Next page', group: 'View', keys: ['PageDown'], run: () => nextPage(1) },
  { id: 'previous-page', label: 'Previous page', group: 'View', keys: ['PageUp'], run: () => nextPage(-1) },
  { id: 'add-tablet', label: 'Add Tablet frame', group: 'View', run: () => addFrame(framePresets[2]) },
  { id: 'add-mobile', label: 'Add Mobile frame', group: 'View', run: () => addFrame(framePresets[3]) },
  { id: 'add-desktop', label: 'Add Desktop frame', group: 'View', run: () => addFrame(framePresets[0]) },
  // Object
  { id: 'group', label: 'Group selection', group: 'Object', keys: ['Mod+G'], run: () => wrapSelection('group'), when: canRestructure },
  { id: 'ungroup', label: 'Ungroup selection', group: 'Object', keys: ['Mod+Shift+G'], run: ungroupSelection, when: canRestructure },
  { id: 'frame-selection', label: 'Frame selection', group: 'Object', keys: ['Mod+Alt+G'], run: () => wrapSelection('frame'), when: canRestructure },
  { id: 'add-auto-layout', label: 'Add auto layout', group: 'Object', keys: ['Shift+A'], run: addAutoLayout, when: hasSelection },
  { id: 'remove-auto-layout', label: 'Remove auto layout', group: 'Object', keys: ['Alt+Shift+A'], run: removeAutoLayout, when: hasSelection },
  { id: 'create-component', label: 'Create component', group: 'Object', keys: ['Mod+Alt+K'], run: () => set({ dialog: { kind: 'new-component' } }), when: () => single() && canRestructure() },
  { id: 'detach', label: 'Detach instance', group: 'Object', keys: ['Mod+Alt+B'], run: detachSelection, when: instanceSelected },
  { id: 'main-component', label: 'Go to main component', group: 'Object', run: goToMainComponent, when: instanceSelected },
  { id: 'wrap-link', label: 'Wrap in link', group: 'Object', run: () => wrapSelection('link'), when: canRestructure },
  { id: 'bring-front', label: 'Bring to front', group: 'Object', keys: ['Mod+Alt+]'], run: () => reorderSelection('last'), when: canRestructure },
  { id: 'bring-forward', label: 'Bring forward', group: 'Object', keys: ['Mod+]'], run: () => reorderSelection(1), when: canRestructure },
  { id: 'send-backward', label: 'Send backward', group: 'Object', keys: ['Mod+['], run: () => reorderSelection(-1), when: canRestructure },
  { id: 'send-back', label: 'Send to back', group: 'Object', keys: ['Mod+Alt+['], run: () => reorderSelection('first'), when: canRestructure },
  { id: 'flip-h', label: 'Flip horizontal', group: 'Object', keys: ['Shift+H'], run: () => flip('x'), when: hasSelection },
  { id: 'flip-v', label: 'Flip vertical', group: 'Object', keys: ['Shift+V'], run: () => flip('y'), when: hasSelection },
  { id: 'rotate-90', label: 'Rotate 90°', group: 'Object', run: () => rotateBy(90), when: hasSelection },
  { id: 'rotate-180', label: 'Rotate 180°', group: 'Object', run: () => rotateBy(180), when: hasSelection },
  { id: 'hide', label: 'Show/hide', group: 'Object', keys: ['Mod+Shift+H'], run: () => toggleHidden(), when: hasSelection },
  { id: 'lock', label: 'Lock/unlock', group: 'Object', keys: ['Mod+Shift+L'], run: () => toggleLocked(), when: hasSelection },
  { id: 'rename', label: 'Rename', group: 'Object', keys: ['Mod+R'], run: () => window.dispatchEvent(new CustomEvent('frame:rename')), when: single },
  // Text
  { id: 'bold', label: 'Bold', group: 'Text', keys: ['Mod+B'], run: toggleWeight, when: textSelected },
  { id: 'italic', label: 'Italic', group: 'Text', keys: ['Mod+I'], run: () => {
      const node = selectedNodes()[0];
      const italic = node && computedOf(get().activeFrame, node.key)?.fontStyle === 'italic';
      setStyle({ fontStyle: italic ? 'normal' : 'italic' }, get().selection, 'text:fontStyle');
    }, when: textSelected },
  { id: 'underline', label: 'Underline', group: 'Text', keys: ['Mod+U'], run: () => toggleDecoration('underline'), when: textSelected },
  { id: 'strikethrough', label: 'Strikethrough', group: 'Text', keys: ['Mod+Shift+X'], run: () => toggleDecoration('line-through'), when: textSelected },
  { id: 'align-text-left', label: 'Text align left', group: 'Text', keys: ['Mod+Alt+L'], run: textStyle({ textAlign: 'left' }), when: textSelected },
  { id: 'align-text-center', label: 'Text align center', group: 'Text', keys: ['Mod+Alt+T'], run: textStyle({ textAlign: 'center' }), when: textSelected },
  { id: 'align-text-right', label: 'Text align right', group: 'Text', keys: ['Mod+Alt+R'], run: textStyle({ textAlign: 'right' }), when: textSelected },
  { id: 'align-text-justify', label: 'Text align justified', group: 'Text', keys: ['Mod+Alt+J'], run: textStyle({ textAlign: 'justify' }), when: textSelected },
  { id: 'uppercase', label: 'Uppercase', group: 'Text', run: textStyle({ textTransform: 'uppercase' }), when: textSelected },
  { id: 'lowercase', label: 'Lowercase', group: 'Text', run: textStyle({ textTransform: 'lowercase' }), when: textSelected },
  { id: 'titlecase', label: 'Title case', group: 'Text', run: textStyle({ textTransform: 'capitalize' }), when: textSelected },
  { id: 'font-bigger', label: 'Increase font size', group: 'Text', keys: ['Mod+Shift+>', 'Mod+Shift+.'], run: () => stepFontSize(1), when: textSelected },
  { id: 'font-smaller', label: 'Decrease font size', group: 'Text', keys: ['Mod+Shift+<', 'Mod+Shift+,'], run: () => stepFontSize(-1), when: textSelected },
  // Arrange
  { id: 'align-left', label: 'Align left', group: 'Arrange', keys: ['Alt+A'], run: () => align('left'), when: hasSelection },
  { id: 'align-hcenter', label: 'Align horizontal centers', group: 'Arrange', keys: ['Alt+H'], run: () => align('hcenter'), when: hasSelection },
  { id: 'align-right', label: 'Align right', group: 'Arrange', keys: ['Alt+D'], run: () => align('right'), when: hasSelection },
  { id: 'align-top', label: 'Align top', group: 'Arrange', keys: ['Alt+W'], run: () => align('top'), when: hasSelection },
  { id: 'align-vcenter', label: 'Align vertical centers', group: 'Arrange', keys: ['Alt+V'], run: () => align('vcenter'), when: hasSelection },
  { id: 'align-bottom', label: 'Align bottom', group: 'Arrange', keys: ['Alt+S'], run: () => align('bottom'), when: hasSelection },
  { id: 'distribute-h', label: 'Distribute horizontal spacing', group: 'Arrange', keys: ['Ctrl+Alt+H'], run: () => distribute('x'), when: () => get().selection.length > 2 },
  { id: 'distribute-v', label: 'Distribute vertical spacing', group: 'Arrange', keys: ['Ctrl+Alt+V'], run: () => distribute('y'), when: () => get().selection.length > 2 },
  { id: 'nudge-left', label: 'Nudge left', group: 'Arrange', keys: ['ArrowLeft'], run: () => nudge(-get().prefs.nudge, 0), when: hasSelection },
  { id: 'nudge-right', label: 'Nudge right', group: 'Arrange', keys: ['ArrowRight'], run: () => nudge(get().prefs.nudge, 0), when: hasSelection },
  { id: 'nudge-up', label: 'Nudge up', group: 'Arrange', keys: ['ArrowUp'], run: () => nudge(0, -get().prefs.nudge), when: hasSelection },
  { id: 'nudge-down', label: 'Nudge down', group: 'Arrange', keys: ['ArrowDown'], run: () => nudge(0, get().prefs.nudge), when: hasSelection },
  { id: 'nudge-left-big', label: 'Big nudge left', group: 'Arrange', keys: ['Shift+ArrowLeft'], run: () => nudge(-get().prefs.bigNudge, 0), when: hasSelection },
  { id: 'nudge-right-big', label: 'Big nudge right', group: 'Arrange', keys: ['Shift+ArrowRight'], run: () => nudge(get().prefs.bigNudge, 0), when: hasSelection },
  { id: 'nudge-up-big', label: 'Big nudge up', group: 'Arrange', keys: ['Shift+ArrowUp'], run: () => nudge(0, -get().prefs.bigNudge), when: hasSelection },
  { id: 'nudge-down-big', label: 'Big nudge down', group: 'Arrange', keys: ['Shift+ArrowDown'], run: () => nudge(0, get().prefs.bigNudge), when: hasSelection },
  ...['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map(
    (n): Command => ({ id: `opacity-${n}`, label: `Opacity ${n === '0' ? 100 : Number(n) * 10}%`, group: 'Object', keys: [n], run: () => opacityKey(n), when: hasSelection }),
  ),
  // Preferences
  { id: 'pref-autosave', label: 'Save changes automatically', group: 'Preferences', run: () => setPrefs({ autosave: !get().prefs.autosave }), checked: () => get().prefs.autosave },
  { id: 'pref-snapping', label: 'Snap to geometry', group: 'Preferences', run: () => setPrefs({ snapping: !get().prefs.snapping }), checked: () => get().prefs.snapping },
  { id: 'pref-inline', label: 'Write inline styles instead of classes', group: 'Preferences', run: () => setPrefs({ styling: get().prefs.styling === 'inline' ? 'auto' : 'inline' }), checked: () => get().prefs.styling === 'inline' },
  { id: 'pref-responsive', label: 'Edit breakpoint frames as breakpoint classes', group: 'Preferences', run: () => setPrefs({ responsive: !get().prefs.responsive }), checked: () => get().prefs.responsive },
  { id: 'theme-light', label: 'Theme: light', group: 'Preferences', run: () => setPrefs({ theme: 'light' }), checked: () => get().prefs.theme === 'light' },
  { id: 'theme-dark', label: 'Theme: dark', group: 'Preferences', run: () => setPrefs({ theme: 'dark' }), checked: () => get().prefs.theme === 'dark' },
  { id: 'theme-system', label: 'Theme: match system', group: 'Preferences', run: () => setPrefs({ theme: 'system' }), checked: () => get().prefs.theme === 'system' },
  // Help
  { id: 'shortcuts', label: 'Keyboard shortcuts', group: 'Help', keys: ['Ctrl+Shift+?', 'Shift+?'], run: () => set({ dialog: { kind: 'shortcuts' } }) },
  { id: 'variables', label: 'Local variables…', group: 'Edit', run: () => set({ dialog: { kind: 'variables' } }) },
  { id: 'copy-png', label: 'Copy as PNG', group: 'Edit', keys: ['Mod+Shift+C'], run: () => void copyAsPng(), when: hasSelection },
];

export const commandById = new Map(commands.map((c) => [c.id, c]));

export function runCommand(id: string) {
  const command = commandById.get(id);
  if (command && (!command.when || command.when())) command.run();
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** A shortcut for display: ⌘⇧Z on a Mac, Ctrl+Shift+Z elsewhere. */
export function displayKeys(keys: string) {
  const parts = keys.split('+').filter(Boolean);
  if (keys.endsWith('++')) parts.push('+');
  const names: Record<string, [string, string]> = {
    Mod: ['⌘', 'Ctrl'],
    Ctrl: ['⌃', 'Ctrl'],
    Alt: ['⌥', 'Alt'],
    Shift: ['⇧', 'Shift'],
    Enter: ['↩', 'Enter'],
    Escape: ['Esc', 'Esc'],
    Delete: ['⌫', 'Del'],
    Backspace: ['⌫', 'Backspace'],
    ArrowLeft: ['←', '←'],
    ArrowRight: ['→', '→'],
    ArrowUp: ['↑', '↑'],
    ArrowDown: ['↓', '↓'],
    Tab: ['⇥', 'Tab'],
    PageDown: ['PgDn', 'PgDn'],
    PageUp: ['PgUp', 'PgUp'],
  };
  const mapped = parts.map((p) => names[p]?.[isMac ? 0 : 1] ?? p.toUpperCase());
  return isMac ? mapped.join('') : mapped.join('+');
}

/** Whether a keyboard event matches a shortcut such as `Mod+Shift+Z`. */
export function matches(event: KeyboardEvent, keys: string) {
  const parts = keys.split('+');
  let key = parts.pop()!;
  if (key === '' && keys.endsWith('++')) key = '+';
  const want = new Set(parts);
  const mod = isMac ? event.metaKey : event.ctrlKey;
  if (want.has('Mod') !== mod) return false;
  const ctrl = want.has('Ctrl') || (!isMac && want.has('Mod'));
  if (ctrl !== event.ctrlKey) return false;
  if (isMac && !want.has('Mod') && event.metaKey) return false;
  if (want.has('Alt') !== event.altKey) return false;
  // Shifted punctuation such as ? or > already implies Shift.
  const shiftImplied = /^[?<>:"{}|~!@#$%^&*()_+]$/.test(key);
  if (!shiftImplied && want.has('Shift') !== event.shiftKey) return false;
  const pressed = event.key.length === 1 ? event.key : event.key;
  if (key.length === 1) {
    if (pressed.toLowerCase() === key.toLowerCase()) return true;
    // With Alt or Shift, macOS changes event.key. Fall back to the physical key.
    const code = event.code;
    if (/^Key[A-Z]$/.test(code) && code.slice(3).toLowerCase() === key.toLowerCase()) return true;
    if (/^Digit\d$/.test(code) && code.slice(5) === key) return true;
    const punctuation: Record<string, string> = { BracketLeft: '[', BracketRight: ']', Backslash: '\\', Slash: '/', Minus: '-', Equal: '=', Period: '.', Comma: ',' };
    return punctuation[code] === key;
  }
  return pressed === key;
}

/** Handles a keydown anywhere in the editor. Returns true when a command ran. */
export function handleShortcut(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  const typing = !!target?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]');
  const state = get();
  if (state.editingText) return false;
  for (const command of commands) {
    if (!command.keys) continue;
    for (const keys of command.keys) {
      if (!matches(event, keys)) continue;
      // While typing, only commands with a modifier run, and Save always does.
      const modifier = /Mod|Ctrl|Alt/.test(keys);
      if (typing && !(modifier && !/^(Mod\+[AZCVXY]|Mod\+Shift\+Z)$/.test(keys))) continue;
      if (state.dialog && command.id !== 'save') return false;
      if (command.when && !command.when()) continue;
      event.preventDefault();
      command.run();
      return true;
    }
  }
  return false;
}

