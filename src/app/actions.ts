/*
 * Editor actions.
 *
 * What the toolbar, menus, shortcuts, panels, and canvas call. Each action reads
 * the selection, turns layers into tree targets, applies edits from edit.ts as
 * one undo step, and puts the selection where the user expects it afterwards.
 */

import type { EditorNode } from '../core/model';
import { createInstance, createNode, findParent, uid, type InsertType } from '../core/model';
import type { RNode } from '../core/render';
import type { ComponentEntry } from '../core/workspace';
import { parseFile } from '../core/parse';
import { printFile } from '../core/print';
import { canWriteTailwind } from '../core/tailwind';
import * as edit from './edit';
import type { StyleChange, Target } from './edit';
import {
  activeIndex,
  commit,
  currentPage,
  currentView,
  editor,
  findRender,
  frameById,
  get,
  select,
  set,
  toast,
  workspace,
  type EditorState,
} from './state';
import { childrenOf, clickTarget, instanceScope, keysFor, parentOf, selectable } from './selection';
import { computedOf, localRect, union, type Rect } from '../canvas/registry';

/* Reading the selection. */

export function selectedNodes(state: EditorState = get()): RNode[] {
  return state.selection.map((key) => findRender(state, key)?.node).filter((node): node is RNode => !!node);
}

/** Whether layers' source can be restructured: moved, deleted, wrapped. */
export function structural(node: RNode) {
  return !!node.source && !node.repeated && !node.locked;
}

/** Where style edits for a layer go. Instances take them at the call site when the component accepts them. */
export function styleTarget(node: RNode, state: EditorState = get()): Target | undefined {
  if (!node.source || node.kind === 'placeholder') return;
  if (node.kind === 'instance') {
    const entry = componentOf(node, state);
    return entry?.acceptsClassName ? node.source : undefined;
  }
  return node.source;
}

export function componentOf(node: RNode, state: EditorState = get()): ComponentEntry | undefined {
  if (!node.component) return;
  return workspace(state).components().find((c) => c.file === node.component!.file && (c.name === node.component!.name || c.exportName === node.component!.name));
}

/** Tailwind classes or inline styles, for this project and these properties. */
export function styleMode(state: EditorState = get(), props: string[] = []): 'tailwind' | 'inline' {
  if (state.prefs.styling === 'inline') return 'inline';
  if (!workspace(state).styles().tailwind) return 'inline';
  return !props.length || props.some((prop) => canWriteTailwind([prop])) ? 'tailwind' : 'inline';
}

/** The Tailwind variant to write for the active frame, when responsive editing is on. */
export function breakpointVariant(state: EditorState = get()): string {
  const view = currentView(state);
  if (!state.prefs.responsive || !view || view.frames.length < 2 || styleMode(state) !== 'tailwind') return '';
  const smallest = Math.min(...view.frames.map((f) => f.width));
  const width = frameById(state, state.activeFrame)?.width ?? smallest;
  if (width === smallest) return '';
  return width >= 1536 ? '2xl:' : width >= 1280 ? 'xl:' : width >= 1024 ? 'lg:' : width >= 768 ? 'md:' : width >= 640 ? 'sm:' : '';
}

/* Style, text, and attributes. */

export function setStyle(change: StyleChange, keys: string[] = get().selection, label = `style:${Object.keys(change).join(',')}`) {
  const state = get();
  const mode = styleMode(state, Object.keys(change));
  const variant = breakpointVariant(state);
  const nodes = keys.map((key) => findRender(state, key)?.node).filter((n): n is RNode => !!n);
  return commit(label, (doc) => {
    for (const node of nodes) {
      const target = styleTarget(node, state);
      if (!target || node.locked) continue;
      doc = edit.applyStyle(doc, state.config, target, change, node.kind === 'text' ? 'inline' : mode, variant);
    }
    return doc;
  });
}

export function setText(key: string, text: string) {
  const state = get();
  const node = findRender(state, key)?.node;
  if (!node?.textSource || node.locked) return;
  commit(`text:${key}`, (doc) => edit.applyText(doc, state.config, node.textSource!, text));
}

export function setAttr(name: string, value: string | null, keys: string[] = get().selection) {
  const state = get();
  commit(`attr:${name}`, (doc) => {
    for (const node of selectedNodes({ ...state, selection: keys })) if (node.source && !node.locked) doc = edit.applyAttr(doc, state.config, node.source, name, value);
    return doc;
  });
}

export function rename(key: string, name: string) {
  const state = get();
  const node = findRender(state, key)?.node;
  if (!node?.source) return;
  commit('rename', (doc) => edit.applyNode(doc, state.config, node.source!, { name: name.trim() }), { merge: false });
}

export function toggleHidden(keys: string[] = get().selection) {
  const state = get();
  const nodes = selectedNodes({ ...state, selection: keys }).filter((n) => n.source);
  const hide = nodes.some((n) => !n.hidden);
  commit('visibility', (doc) => nodes.reduce((d, n) => edit.applyNode(d, state.config, n.source!, { hidden: hide }), doc), { merge: false });
}

export function toggleLocked(keys: string[] = get().selection) {
  const state = get();
  const nodes = selectedNodes({ ...state, selection: keys }).filter((n) => n.source);
  const lock = nodes.some((n) => !n.locked);
  commit('lock', (doc) => nodes.reduce((d, n) => edit.applyNode(d, state.config, n.source!, { locked: lock }), doc), { merge: false });
}

/* Structure. */

/** The page's own outermost element, where new layers go when nothing is selected. */
export function pageRoot(state: EditorState = get()): RNode | undefined {
  const index = activeIndex(state);
  const page = currentPage(state);
  if (!index) return;
  const nodes = [...index.byKey.values()];
  return (
    nodes.find((n) => n.kind === 'element' && n.source?.file === page?.file && !n.repeated) ??
    nodes.find((n) => n.kind === 'element' && n.tag === 'body') ??
    nodes.find((n) => n.kind === 'element' && !!n.source)
  );
}

/** Where a new layer goes: inside a selected container, else after the selected layer, else at the end of the page. */
export function insertionPoint(state: EditorState = get()): { parent: Target; index: number; near?: string } | undefined {
  const index = activeIndex(state);
  const selected = selectedNodes(state)[0];
  const ws = workspace(state);
  if (selected?.source && index) {
    const found = edit.locate(state.doc, state.config, selected.source);
    if (found && edit.takesChildren(found.node) && selected.kind !== 'instance' && !selected.repeated)
      return { parent: selected.source, index: found.node.children.length, near: selected.key };
    const parent = found && findParent(found.root, selected.source.id);
    if (found && parent && parent.kind !== 'expression' && edit.takesChildren(parent))
      return { parent: { file: selected.source.file, id: parent.id }, index: parent.children.findIndex((c) => c.id === selected.source!.id) + 1, near: selected.key };
  }
  const root = pageRoot(state);
  if (!root?.source) return;
  const found = edit.locate(state.doc, state.config, root.source);
  void ws;
  return found ? { parent: root.source, index: found.node.children.length, near: root.key } : undefined;
}

/** The insertion point before the render child at `index` of a container. */
export function pointIn(parent: RNode, index: number): ReturnType<typeof insertionPoint> {
  const state = get();
  if (!parent.source) return;
  const found = edit.locate(state.doc, state.config, parent.source);
  if (!found) return;
  const before = parent.children[index]?.source?.id;
  const at = before ? found.node.children.findIndex((c) => c.id === before) : -1;
  return { parent: parent.source, index: at >= 0 ? at : found.node.children.length, near: `${parent.key}/x` };
}

/** Inserts a node and selects it. */
export function insertNode(node: EditorNode, at = insertionPoint(), imports?: ComponentEntry) {
  const state = get();
  if (!at) {
    toast('Select a layer to insert into first.', 'error');
    return;
  }
  const changed = commit(
    'insert',
    (doc) => {
      let next = edit.insertInto(doc, state.config, at.parent, at.index, node);
      if (imports) next = edit.ensureImport(next, state.config, at.parent.file, imports, node.tag);
      return next;
    },
    { merge: false },
  );
  if (!changed) return;
  const index = activeIndex(get());
  if (index) select(keysFor(index, [{ file: at.parent.file, id: node.id }], at.near));
}

/** Adds an image file to the project and places it at the selection, at its natural size up to 640 wide. */
export async function placeImageFile(file: File, at = insertionPoint()) {
  const backend = get().backend;
  if (!backend?.addImage) {
    toast("This project can't take new images. Open it with the frame command or as a folder.", 'error');
    return;
  }
  try {
    const url = await backend.addImage(file);
    const size = await new Promise<{ width: number; height: number }>((resolve) => {
      const image = new window.Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => resolve({ width: 320, height: 200 });
      image.src = URL.createObjectURL(file);
    });
    const scale = Math.min(1, 640 / size.width);
    const node = createNode('image', { width: size.width * scale, height: size.height * scale });
    node.attrs = { src: url, alt: file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ') };
    insertNode(node, at);
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), 'error');
  }
}

export function insertElement(type: InsertType, at?: ReturnType<typeof insertionPoint>) {
  insertNode(createNode(type), at ?? insertionPoint());
}

export function insertComponent(entry: ComponentEntry, at?: ReturnType<typeof insertionPoint>) {
  const point = at ?? insertionPoint();
  if (!entry.exportName && point?.parent.file !== entry.file) {
    toast(`${entry.name} isn't exported from ${entry.file}, so other files can't use it.`, 'error');
    return;
  }
  const state = get();
  const props: Record<string, string> = {};
  for (const prop of entry.props) {
    if (prop.type === 'string' && prop.default === undefined && /title|label|name|heading|text/i.test(prop.name)) props[prop.name] = prop.name.replace(/^\w/, (c) => c.toUpperCase());
  }
  void state;
  insertNode(createInstance(entry.name, props), point, entry);
}

export function deleteSelection() {
  const state = get();
  const nodes = selectedNodes(state).filter(structural);
  if (!nodes.length) {
    if (selectedNodes(state).some((n) => n.repeated)) toast('This layer repeats for each item in a list. Delete the item from the data, or edit the code.', 'error');
    return;
  }
  const index = activeIndex(state);
  const parent = index ? parentOf(index, nodes[0].key) : undefined;
  if (commit('delete', (doc) => edit.removeTargets(doc, state.config, nodes.map((n) => n.source!)), { merge: false }))
    select(parent ? [parent] : []);
}

export function duplicateSelection() {
  const state = get();
  const nodes = selectedNodes(state).filter(structural);
  let copies: Target[] = [];
  const changed = commit(
    'duplicate',
    (doc) => {
      const result = edit.duplicateTargets(doc, state.config, nodes.map((n) => n.source!));
      copies = result.copies;
      return result.doc;
    },
    { merge: false },
  );
  const index = activeIndex(get());
  if (changed && index) select(keysFor(index, copies, nodes[0]?.key));
}

/** Wraps the selection: a group adds no box, a frame adds a plain box, and auto layout adds a flex box. */
export function wrapSelection(kind: 'group' | 'frame' | 'autolayout' | 'link') {
  const state = get();
  const nodes = selectedNodes(state).filter(structural);
  if (!nodes.length) return;
  const direction = kind === 'autolayout' ? arrangement(nodes, state.activeFrame) : 'column';
  const wrapper: EditorNode = {
    id: uid(),
    kind: 'element',
    tag: kind === 'link' ? 'a' : 'div',
    attrs: kind === 'link' ? { href: '/' } : {},
    style:
      kind === 'group'
        ? { display: 'contents' }
        : kind === 'autolayout'
          ? { display: 'flex', flexDirection: direction, gap: averageGap(nodes, state.activeFrame, direction) }
          : {},
    children: [],
    ...(kind === 'group' ? { name: 'Group' } : {}),
  };
  let created: Target | undefined;
  const changed = commit(
    kind,
    (doc) => {
      const result = edit.wrapTargets(doc, state.config, nodes.map((n) => n.source!), wrapper);
      created = result.wrapper;
      return result.doc;
    },
    { merge: false },
  );
  if (!changed) toast('Only layers next to each other in the same file can be grouped.', 'error');
  const index = activeIndex(get());
  if (created && index) select(keysFor(index, [created], nodes[0].key));
}

export function ungroupSelection() {
  const state = get();
  const nodes = selectedNodes(state).filter((n) => structural(n) && n.kind === 'element');
  const children = nodes.flatMap((n) => n.children.filter(selectable).map((c) => c.source!).filter(Boolean));
  if (commit('ungroup', (doc) => nodes.reduce((d, n) => edit.unwrapTarget(d, state.config, n.source!), doc), { merge: false })) {
    const index = activeIndex(get());
    if (index) select(keysFor(index, children));
  }
}

/** Shift+A: turns the selected box into auto layout, or wraps several layers in one. */
export function addAutoLayout() {
  const state = get();
  const nodes = selectedNodes(state);
  if (nodes.length === 1 && nodes[0].kind === 'element' && nodes[0].children.length) {
    const node = nodes[0];
    const direction = arrangement(node.children.filter(selectable), state.activeFrame);
    setStyle({ display: 'flex', flexDirection: direction, gap: averageGap(node.children.filter(selectable), state.activeFrame, direction) }, [node.key], 'autolayout');
  } else wrapSelection('autolayout');
}

export function removeAutoLayout() {
  setStyle({ display: 'block', flexDirection: null, gap: null, alignItems: null, justifyContent: null, flexWrap: null }, get().selection, 'autolayout-off');
}

/** Whether children sit side by side or stacked, from where they are now. */
function arrangement(nodes: RNode[], frame: string): 'row' | 'column' {
  const rects = nodes.map((n) => localRect(frame, n.key)).filter((r): r is Rect => !!r);
  if (rects.length < 2) return 'column';
  const xs = rects.map((r) => r.x + r.width / 2);
  const ys = rects.map((r) => r.y + r.height / 2);
  return Math.max(...xs) - Math.min(...xs) > Math.max(...ys) - Math.min(...ys) ? 'row' : 'column';
}

function averageGap(nodes: RNode[], frame: string, direction: 'row' | 'column') {
  const rects = nodes.map((n) => localRect(frame, n.key)).filter((r): r is Rect => !!r);
  rects.sort((a, b) => (direction === 'row' ? a.x - b.x : a.y - b.y));
  const gaps = rects.slice(1).map((r, i) => (direction === 'row' ? r.x - (rects[i].x + rects[i].width) : r.y - (rects[i].y + rects[i].height)));
  const positive = gaps.filter((g) => g > 0);
  return positive.length ? Math.round(positive.reduce((a, b) => a + b, 0) / positive.length) : 16;
}

export function reorderSelection(to: number | 'first' | 'last') {
  const state = get();
  const nodes = selectedNodes(state).filter(structural);
  if (!nodes.length) return;
  const ordered = to === 'last' || (typeof to === 'number' && to > 0) ? [...nodes].reverse() : nodes;
  if (commit('reorder', (doc) => ordered.reduce((d, n) => edit.reorderTarget(d, state.config, n.source!, to), doc))) {
    const index = activeIndex(get());
    if (index) select(keysFor(index, nodes.map((n) => n.source!), nodes[0].key));
  }
}

/** Moves layers into a container at an index, as a drag and drop does. */
export function moveLayers(keys: string[], parent: RNode, index: number) {
  const state = get();
  const nodes = selectedNodes({ ...state, selection: keys }).filter(structural);
  const parentTarget = parent.source;
  if (!nodes.length || !parentTarget) return false;
  const found = edit.locate(state.doc, state.config, parentTarget);
  if (!found) return false;
  // `index` counts render children. Find the tree child it lands before.
  const before = parent.children[index]?.source?.id;
  const treeIndex = before ? found.node.children.findIndex((c) => c.id === before) : -1;
  const at = treeIndex >= 0 ? treeIndex : found.node.children.length;
  const changed = commit('move', (doc) => edit.moveInto(doc, state.config, nodes.map((n) => n.source!), parentTarget, at), { merge: false });
  const indexNow = activeIndex(get());
  if (changed && indexNow) select(keysFor(indexNow, nodes.map((n) => n.source!), parent.key + '/x'));
  return changed;
}

export function canDropInto(keys: string[], parent: RNode) {
  const state = get();
  const nodes = selectedNodes({ ...state, selection: keys });
  if (!parent.source || !nodes.every(structural)) return false;
  return edit.canMoveInto(state.doc, state.config, nodes.map((n) => n.source!), parent.source);
}

/* Components. */

export function createComponentFromSelection(name: string) {
  const state = get();
  const node = selectedNodes(state)[0];
  if (!node?.source || !structural(node)) return;
  const clean = name.replace(/[^A-Za-z0-9]/g, '');
  const component = /^[A-Z]/.test(clean) ? clean : `C${clean}`;
  let result: ReturnType<typeof edit.createComponent>;
  const changed = commit(
    'component',
    (doc) => {
      result = edit.createComponent(doc, state.config, node.source!, component, (tree) => printJSX(tree));
      return result?.doc ?? doc;
    },
    { merge: false },
  );
  if (!changed || !result) {
    toast('Create component works on plain JSX. This layer has handlers or expressions, so ask your agent to extract it.', 'error');
    return;
  }
  const index = activeIndex(get());
  if (index) select(keysFor(index, [result.instance]));
  toast(`Created ${component} in ${result.file}.`, 'success');
}

/** A tree as JSX source, printed from scratch. */
export function printJSX(tree: EditorNode): string {
  const wrapper = `const __frame = (\n  <>\n  </>\n);\n`;
  const info = parseFile('Clipboard.tsx', wrapper);
  const [offset, root] = [...info.roots.entries()][0];
  const printed = printFile(info, { path: 'Clipboard.tsx', base: wrapper, roots: { [offset]: { ...root, children: [stripOrigins(tree)] } }, literals: {} });
  const body = printed.slice(printed.indexOf('<>') + 2, printed.lastIndexOf('</>'));
  return body
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => line.replace(/^ {4}/, ''))
    .join('\n');
}

/** A copy of a tree with no ties to its source, printed from scratch. Dynamic parts are dropped. */
export function stripOrigins(node: EditorNode): EditorNode {
  return {
    id: uid(),
    kind: node.kind === 'expression' ? 'fragment' : node.kind,
    tag: node.tag,
    ...(node.name ? { name: node.name } : {}),
    ...(node.text !== undefined ? { text: node.text } : {}),
    style: { ...node.style },
    attrs: { ...node.attrs },
    children: node.kind === 'expression' ? [] : node.children.filter((c) => !c.comment).map(stripOrigins),
    ...(node.hidden ? { hidden: true } : {}),
  };
}

export function detachSelection() {
  const state = get();
  const node = selectedNodes(state)[0];
  if (node?.kind !== 'instance' || !structural(node)) return;
  if (commit('detach', (doc) => edit.detachInstance(doc, state.config, node), { merge: false }))
    toast(`Detached ${node.tag}. Its markup is now inline. Its logic stays in ${node.component?.file}.`, 'success');
}

/** Opens the Components page at a component's main definition. */
export function goToMainComponent() {
  const node = selectedNodes()[0];
  if (!node?.component) return;
  const entry = componentOf(node);
  if (!entry) return;
  editor.set({ pageId: 'page:components', selection: [], scope: null });
  requestAnimationFrame(() => {
    const frame = currentView()?.frames.find((f) => f.componentId === entry.id);
    if (frame) editor.set({ activeFrame: frame.id });
  });
}

/* Transforms and alignment. */

export function flip(axis: 'x' | 'y') {
  const state = get();
  const node = selectedNodes(state)[0];
  if (!node) return;
  const computed = computedOf(state.activeFrame, node.key);
  const [sx = '1', sy = sx] = (computed?.scale && computed.scale !== 'none' ? computed.scale : '1 1').split(' ');
  const x = axis === 'x' ? -Number(sx) : Number(sx);
  const y = axis === 'y' ? -Number(sy) : Number(sy);
  setStyle({ scale: x === 1 && y === 1 ? null : `${x} ${y}` }, state.selection, 'flip');
}

export function rotateBy(degrees: number) {
  const state = get();
  const node = selectedNodes(state)[0];
  if (!node) return;
  const computed = computedOf(state.activeFrame, node.key);
  const current = computed?.rotate && computed.rotate !== 'none' ? parseFloat(computed.rotate) : 0;
  const next = (((current + degrees) % 360) + 360) % 360;
  setStyle({ rotate: next ? `${next}deg` : null }, state.selection, 'rotate');
}

/**
 * Aligns the selection. Several absolutely positioned layers align to their
 * shared box. A single layer aligns inside its parent: with align-self or auto
 * margins in flow, or with left and top when absolutely positioned.
 */
export function align(edge: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') {
  const state = get();
  const nodes = selectedNodes(state).filter((n) => styleTarget(n));
  if (!nodes.length) return;
  const frame = state.activeFrame;
  const horizontal = edge === 'left' || edge === 'hcenter' || edge === 'right';
  const absolute = nodes.every((n) => /absolute|fixed/.test(computedOf(frame, n.key)?.position ?? ''));
  const index = activeIndex(state);
  if (absolute) {
    const rects = nodes.map((n) => localRect(frame, n.key));
    const box = nodes.length > 1 ? union(rects) : (() => {
      const parent = index && parentOf(index, nodes[0].key);
      return parent ? localRect(frame, parent) : undefined;
    })();
    if (!box) return;
    commit('align', (doc) => {
      nodes.forEach((node, i) => {
        const rect = rects[i];
        const computed = computedOf(frame, node.key);
        if (!rect || !computed) return;
        const delta = horizontal
          ? edge === 'left' ? box.x - rect.x : edge === 'right' ? box.x + box.width - rect.x - rect.width : box.x + box.width / 2 - rect.x - rect.width / 2
          : edge === 'top' ? box.y - rect.y : edge === 'bottom' ? box.y + box.height - rect.y - rect.height : box.y + box.height / 2 - rect.y - rect.height / 2;
        const prop = horizontal ? 'left' : 'top';
        const current = parseFloat(computed[prop]) || 0;
        doc = edit.applyStyle(doc, state.config, styleTarget(node, state)!, { [prop]: Math.round(current + delta) }, styleMode(state, [prop]));
      });
      return doc;
    });
    return;
  }
  // In flow, alignment depends on the parent's layout direction.
  const parentKey = index && parentOf(index, nodes[0].key);
  const parentStyle = parentKey ? computedOf(frame, parentKey) : undefined;
  const flex = parentStyle && /flex/.test(parentStyle.display);
  const row = flex && parentStyle!.flexDirection.startsWith('row');
  const crossAxis = flex && (row ? !horizontal : horizontal);
  if (crossAxis) {
    const self = { left: 'flex-start', top: 'flex-start', hcenter: 'center', vcenter: 'center', right: 'flex-end', bottom: 'flex-end' }[edge];
    setStyle({ alignSelf: self }, nodes.map((n) => n.key), 'align');
  } else if (horizontal) {
    const margins = { left: { marginLeft: 0, marginRight: 'auto' }, hcenter: { marginLeft: 'auto', marginRight: 'auto' }, right: { marginLeft: 'auto', marginRight: 0 } }[edge as 'left' | 'hcenter' | 'right'];
    setStyle(margins, nodes.map((n) => n.key), 'align');
  } else {
    const margins = { top: { marginTop: 0, marginBottom: 'auto' }, vcenter: { marginTop: 'auto', marginBottom: 'auto' }, bottom: { marginTop: 'auto', marginBottom: 0 } }[edge as 'top' | 'vcenter' | 'bottom'];
    setStyle(margins, nodes.map((n) => n.key), 'align');
  }
}

/** Spaces three or more absolutely positioned layers evenly. */
export function distribute(axis: 'x' | 'y') {
  const state = get();
  const frame = state.activeFrame;
  const nodes = selectedNodes(state).filter((n) => styleTarget(n) && /absolute|fixed/.test(computedOf(frame, n.key)?.position ?? ''));
  if (nodes.length < 3) {
    toast('Distribute needs three or more layers with absolute position.', 'error');
    return;
  }
  const items = nodes.map((n) => ({ n, r: localRect(frame, n.key)! })).filter((i) => i.r);
  items.sort((a, b) => (axis === 'x' ? a.r.x - b.r.x : a.r.y - b.r.y));
  const start = axis === 'x' ? items[0].r.x : items[0].r.y;
  const last = items[items.length - 1].r;
  const end = axis === 'x' ? last.x + last.width : last.y + last.height;
  const total = items.reduce((sum, i) => sum + (axis === 'x' ? i.r.width : i.r.height), 0);
  const gap = (end - start - total) / (items.length - 1);
  let at = start;
  commit('distribute', (doc) => {
    for (const { n, r } of items) {
      const prop = axis === 'x' ? 'left' : 'top';
      const computed = computedOf(frame, n.key)!;
      const current = parseFloat(computed[prop]) || 0;
      const delta = at - (axis === 'x' ? r.x : r.y);
      doc = edit.applyStyle(doc, state.config, styleTarget(n, state)!, { [prop]: Math.round(current + delta) }, styleMode(state, [prop]));
      at += (axis === 'x' ? r.width : r.height) + gap;
    }
    return doc;
  });
}

/* Selection navigation. */

export function selectAll() {
  const state = get();
  const index = activeIndex(state);
  if (!index) return;
  const first = state.selection[0];
  const parent = first ? parentOf(index, first) : undefined;
  const root = pageRoot(state);
  select(childrenOf(index, parent ?? root?.key).map((n) => n.key));
}

export function selectParent() {
  const state = get();
  const index = activeIndex(state);
  const parent = index && state.selection[0] ? parentOf(index, state.selection[0]) : undefined;
  if (parent) set({ selection: [parent], scope: instanceScope(index!, index!.parent.get(parent)?.key) });
}

export function selectChildren() {
  const state = get();
  const index = activeIndex(state);
  if (!index) return;
  const children = state.selection.flatMap((key) => childrenOf(index, key).slice(0, 1).map((n) => n.key));
  if (children.length) set({ selection: children, scope: instanceScope(index, state.selection[0]) });
}

export function selectSibling(step: 1 | -1) {
  const state = get();
  const index = activeIndex(state);
  const key = state.selection[0];
  if (!index || !key) return;
  const parent = parentOf(index, key);
  const siblings = childrenOf(index, parent, pageRoot(state) ? [pageRoot(state)!] : []);
  const at = siblings.findIndex((n) => n.key === key);
  const next = siblings[(at + step + siblings.length) % siblings.length];
  if (next) select([next.key]);
}

/** What a click selects at a hit key, honoring instance scope. */
export function targetAt(hit: string | undefined, deep: boolean) {
  const state = get();
  const index = activeIndex(state);
  return index ? clickTarget(index, hit, state.scope, deep) : undefined;
}

/* Clipboard. */

interface Clip {
  file: string;
  /** Source trees, for pasting into the same file with handlers intact. */
  trees: EditorNode[];
  /** Rendered output, for pasting anywhere else as plain markup. */
  rendered: RNode[];
  /** Copied style for Paste properties. */
  style?: Record<string, string | number>;
  className?: string;
}
let clip: Clip | undefined;
let styleClip: { style: Record<string, string | number>; className?: string } | undefined;

export async function copySelection(cut = false) {
  const state = get();
  const nodes = selectedNodes(state).filter((n) => n.source);
  if (!nodes.length) return;
  const trees = nodes.map((n) => edit.locate(state.doc, state.config, n.source!)?.node).filter((n): n is EditorNode => !!n);
  clip = { file: nodes[0].source!.file, trees, rendered: nodes };
  try {
    await navigator.clipboard.writeText(trees.map((tree) => printJSX(tree)).join('\n'));
  } catch {
    /* the in-app clipboard still works */
  }
  if (cut) deleteSelection();
}

export function paste() {
  if (!clip) return;
  const state = get();
  const at = insertionPoint(state);
  if (!at) return;
  const sameFile = at.parent.file === clip.file;
  const nodes: EditorNode[] = sameFile ? clip.trees.map((tree) => cloneTree(tree)) : clip.rendered.flatMap((n) => edit.staticCopy(n));
  const changed = commit(
    'paste',
    (doc) => nodes.reduce((d, node, i) => edit.insertInto(d, state.config, at.parent, at.index + i, node), doc),
    { merge: false },
  );
  const index = activeIndex(get());
  if (changed && index) select(keysFor(index, nodes.map((n) => ({ file: at.parent.file, id: n.id })), at.near));
  if (!sameFile) toast('Pasted as plain markup. Handlers and expressions stay in the original file.');
}

function cloneTree(node: EditorNode): EditorNode {
  return { ...node, id: uid(), children: node.children.map(cloneTree) };
}

export function copyProperties() {
  const state = get();
  const node = selectedNodes(state)[0];
  if (!node?.source) return;
  const tree = edit.locate(state.doc, state.config, node.source)?.node;
  if (!tree) return;
  styleClip = { style: { ...tree.style }, className: tree.attrs.className };
  toast('Copied properties.');
}

export function pasteProperties() {
  if (!styleClip) return;
  const state = get();
  const clipboard = styleClip;
  commit('paste-properties', (doc) => {
    for (const node of selectedNodes(state)) {
      const target = styleTarget(node, state);
      if (!target) continue;
      doc = edit.editNode(doc, state.config, target, (n) => ({
        ...n,
        style: { ...clipboard.style },
        attrs: clipboard.className !== undefined ? { ...n.attrs, className: clipboard.className } : n.attrs,
      }));
    }
    return doc;
  }, { merge: false });
}
