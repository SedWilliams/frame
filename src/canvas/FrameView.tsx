/*
 * One frame on the canvas.
 *
 * Each frame is an iframe, so the project's CSS can't leak into the editor and
 * media queries see the frame's width instead of the window's. The frame loads
 * the project's stylesheets, Tailwind's in-browser compiler when the project
 * uses Tailwind, and next/font families, then draws the render tree into its
 * body through a React portal. Nothing from the project runs: the tree is plain
 * elements with no handlers.
 *
 * In design mode the iframe ignores the pointer. The canvas hit-tests through
 * the registry instead, and edits text by turning one element contentEditable.
 */

import { createElement, memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import tailwindUrl from '@tailwindcss/browser?url';
import type { RNode } from '../core/render';
import { fixViewportHeight } from '../core/cssfile';
import type { StyleSet } from '../core/workspace';
import { bumpLayout, frameHandles } from './registry';

const voidTags = new Set(['img', 'input', 'br', 'hr', 'area', 'base', 'col', 'embed', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

/** Editor rules inside every frame. */
const baseCSS = `
[data-frame-placeholder] {
  display: inline-flex; align-items: center; max-width: 100%; padding: 2px 6px; border: 1px dashed #9747ff;
  border-radius: 4px; background: rgba(151, 71, 255, 0.06); color: #7a2fe0; font: 500 11px/1.5 Inter, system-ui, sans-serif;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; vertical-align: middle; letter-spacing: 0; text-transform: none;
}
[data-frame-editing] { outline: none !important; cursor: text !important; caret-color: #0d99ff; }
html.frame-design, html.frame-design body { scrollbar-width: none; }
html.frame-design::-webkit-scrollbar { display: none; }
html.frame-design *, html.frame-design *::before, html.frame-design *::after { animation: none !important; transition: none !important; }
html.frame-design { cursor: default; }
html.frame-outline *:not(svg *) { outline: 1px solid rgba(0, 0, 0, 0.35) !important; outline-offset: -1px; background: transparent !important; box-shadow: none !important; color: rgba(0, 0, 0, 0.55) !important; border-color: transparent !important; }
html.frame-outline img, html.frame-outline video, html.frame-outline svg { opacity: 0.2 !important; }
html.frame-outline, html.frame-outline body { background: #ffffff !important; }
`;

let lucide: Record<string, ComponentType<Record<string, unknown>>> | undefined;
let lucideLoading: Promise<void> | undefined;
const lucideListeners = new Set<() => void>();
function loadLucide() {
  lucideLoading ??= import('lucide-react').then((module) => {
    lucide = module as unknown as Record<string, ComponentType<Record<string, unknown>>>;
    lucideListeners.forEach((listener) => listener());
  });
}

export interface FrameViewProps {
  id: string;
  width: number;
  /** Viewport height: vh resolves against it and the frame is at least this tall. */
  height: number;
  nodes: RNode[];
  styles: StyleSet;
  fonts: Map<string, { family: string; variable?: string }>;
  /** Wraps the page in `<div id="...">` as the app's index.html does. */
  mountId?: string;
  dark?: boolean;
  outline?: boolean;
  /** Present mode: real scrolling, animations, and clickable links. */
  present?: boolean;
  editingKey?: string | null;
  onEditDone?: (key: string, text: string | null) => void;
  onNavigate?: (href: string) => void;
  /** Keys pressed while focus is inside the frame. */
  onKeyDown?: (event: KeyboardEvent) => void;
}

export function FrameView(props: FrameViewProps) {
  const { id, width, height, nodes, styles, fonts, mountId, dark, outline, present, editingKey, onEditDone, onNavigate, onKeyDown } = props;
  const iframe = useRef<HTMLIFrameElement>(null);
  const [doc, setDoc] = useState<Document | null>(null);
  const elements = useMemo(() => new Map<string, Element>(), []);
  const nodeMap = useMemo(() => new Map<string, RNode>(), []);
  const [, setLucideReady] = useState(0);

  // Index render nodes by key for measuring boxless layers.
  nodeMap.clear();
  (function index(list: RNode[]) {
    for (const node of list) {
      nodeMap.set(node.key, node);
      index(node.children);
    }
  })(nodes);

  useEffect(() => {
    const frame = iframe.current!;
    // Before the srcdoc loads, the iframe briefly holds an empty about:blank document. Wait for ours.
    const ready = () => {
      const d = frame.contentDocument;
      if (!d || d.URL !== 'about:srcdoc' || !d.body) return;
      if (!d.head.querySelector('style[data-frame="base"]')) {
        const style = d.createElement('style');
        style.dataset.frame = 'base';
        style.textContent = baseCSS;
        d.head.append(style);
      }
      setDoc(d);
    };
    if (frame.contentDocument?.URL === 'about:srcdoc' && frame.contentDocument.readyState === 'complete') ready();
    frame.addEventListener('load', ready);
    return () => frame.removeEventListener('load', ready);
  }, []);

  useEffect(() => {
    if (!doc) return;
    frameHandles.set(id, { id, iframe: iframe.current!, doc, elements, nodes: nodeMap });
    return () => {
      if (frameHandles.get(id)?.doc === doc) frameHandles.delete(id);
    };
  }, [id, doc, elements, nodeMap]);

  // Design and outline classes, and the color scheme for `dark:` classes.
  useEffect(() => {
    if (!doc) return;
    const root = doc.documentElement;
    root.classList.toggle('frame-design', !present);
    root.classList.toggle('frame-outline', !!outline);
    root.classList.toggle('frame-dark', !!dark);
    root.style.colorScheme = dark ? 'dark' : 'light';
    bumpLayout();
  }, [doc, present, outline, dark]);

  // Project stylesheets, fonts, and Tailwind.
  useEffect(() => {
    if (!doc) return;
    const head = doc.head;
    head.querySelectorAll('[data-frame="project"]').forEach((el) => el.remove());
    const add = (el: HTMLElement) => {
      el.dataset.frame = 'project';
      head.append(el);
    };
    const vh = (css: string) => (present ? css : fixViewportHeight(css, height));
    for (const url of styles.links) {
      const link = doc.createElement('link');
      link.rel = 'stylesheet';
      link.href = url;
      add(link);
    }
    const families = [...new Set([...fonts.values()].map((f) => f.family))];
    if (families.length) {
      const link = doc.createElement('link');
      link.rel = 'stylesheet';
      link.href = `https://fonts.googleapis.com/css2?${families.map((f) => `family=${encodeURIComponent(f)}:ital,wght@0,300..800;1,300..800`).join('&')}&display=swap`;
      add(link);
      const style = doc.createElement('style');
      style.textContent = [...fonts.entries()]
        .map(([className, font]) =>
          className.endsWith('-variable') && font.variable
            ? `.${className} { ${font.variable}: '${font.family}'; }`
            : `.${className} { font-family: '${font.family}', system-ui, sans-serif; }`,
        )
        .join('\n');
      add(style);
    }
    for (const sheet of styles.css) {
      const style = doc.createElement('style');
      style.dataset.path = sheet.path;
      style.textContent = vh(sheet.text);
      add(style);
    }
    if (styles.tailwind) {
      const source = doc.createElement('style');
      source.setAttribute('type', 'text/tailwindcss');
      // `dark:` follows the frame's mode whether the project uses the media query or a .dark class.
      source.textContent = `${styles.tailwind}\n${/@custom-variant\s+dark/.test(styles.tailwind) ? '' : '@custom-variant dark (&:where(.frame-dark, .frame-dark *));'}`;
      add(source);
      if (!head.querySelector('script[data-frame="tailwind"]')) {
        const script = doc.createElement('script');
        script.dataset.frame = 'tailwind';
        script.src = new URL(tailwindUrl, location.href).href;
        head.append(script);
      }
    }
    bumpLayout();
  }, [doc, styles, fonts, height, present]);

  // Tailwind writes its output into a style element of its own. Keep vh out of it too.
  useEffect(() => {
    if (!doc || present) return;
    const fix = () => {
      for (const style of doc.head.querySelectorAll('style:not([data-frame]):not([type])')) {
        const text = style.textContent ?? '';
        if (/\d(d|s|l)?vh\b/.test(text)) style.textContent = fixViewportHeight(text, height);
      }
      bumpLayout();
    };
    const observer = new MutationObserver(fix);
    observer.observe(doc.head, { childList: true, subtree: true, characterData: true });
    fix();
    return () => observer.disconnect();
  }, [doc, height, present]);

  // Grow the iframe to its content, at least the viewport height.
  useEffect(() => {
    if (!doc || present) return;
    const frame = iframe.current!;
    let history: number[] = [];
    const measure = () => {
      const content = Math.ceil(Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0));
      const next = Math.max(height, content);
      if (Math.abs(frame.offsetHeight - next) < 1) return;
      // A page sized from its own height would grow forever. Stop after a run of growth.
      history = [...history.filter((t) => Date.now() - t < 2000), Date.now()];
      if (history.length > 8 && next > frame.offsetHeight) return;
      frame.style.height = `${next}px`;
      bumpLayout();
    };
    const observer = new ResizeObserver(measure);
    observer.observe(doc.documentElement);
    if (doc.body) observer.observe(doc.body);
    const onLoad = () => {
      measure();
      bumpLayout();
    };
    doc.addEventListener('load', onLoad, true);
    doc.fonts?.addEventListener?.('loadingdone', onLoad);
    measure();
    return () => {
      observer.disconnect();
      doc.removeEventListener('load', onLoad, true);
    };
  }, [doc, height, present]);

  // Present mode: links to pages navigate inside Frame. Nothing leaves the editor.
  useEffect(() => {
    if (!doc || !present) return;
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element).closest?.('a[href]');
      if (!link) return;
      event.preventDefault();
      onNavigate?.(link.getAttribute('href') ?? '');
    };
    doc.addEventListener('click', onClick, true);
    const onSubmit = (event: Event) => event.preventDefault();
    doc.addEventListener('submit', onSubmit, true);
    return () => {
      doc.removeEventListener('click', onClick, true);
      doc.removeEventListener('submit', onSubmit, true);
    };
  }, [doc, present, onNavigate]);

  useEffect(() => {
    if (!doc || !onKeyDown) return;
    doc.addEventListener('keydown', onKeyDown);
    return () => doc.removeEventListener('keydown', onKeyDown);
  }, [doc, onKeyDown]);

  // Lucide icons render for real once the icon set has loaded.
  const hasIcons = useMemo(() => [...nodeMap.values()].some((n) => n.icon?.library === 'lucide'), [nodeMap, nodes]);
  useEffect(() => {
    if (!hasIcons || lucide) return;
    const listener = () => setLucideReady((n) => n + 1);
    lucideListeners.add(listener);
    loadLucide();
    return () => void lucideListeners.delete(listener);
  }, [hasIcons]);

  // Text editing: focus the element and select its text. Commits on blur or Enter.
  useEffect(() => {
    if (!doc || !editingKey) return;
    const element = elements.get(editingKey) as HTMLElement | undefined;
    if (!element) return;
    const original = element.textContent ?? '';
    element.focus();
    const range = doc.createRange();
    range.selectNodeContents(element);
    const selection = doc.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    let done = false;
    const finish = (commit: boolean) => {
      if (done) return;
      done = true;
      const text = element.textContent ?? '';
      onEditDone?.(editingKey, commit && text !== original ? text : null);
    };
    const onKey = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === 'Escape' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault();
        element.blur();
      }
    };
    const onBlur = () => finish(true);
    element.addEventListener('keydown', onKey);
    element.addEventListener('blur', onBlur);
    return () => {
      element.removeEventListener('keydown', onKey);
      element.removeEventListener('blur', onBlur);
      finish(true);
    };
  }, [doc, editingKey, elements, onEditDone]);

  useLayoutEffect(() => {
    bumpLayout();
  });

  // The page's <html> and <body> props go on the frame's own elements.
  const htmlNode = nodes.find((n) => n.tag === 'html');
  const bodyNode = htmlNode ? htmlNode.children.find((n) => n.tag === 'body') : nodes.find((n) => n.tag === 'body');
  useApplyRoot(doc?.documentElement, htmlNode, elements, height, present);
  useApplyRoot(doc?.body, bodyNode, elements, height, present);
  const content = bodyNode ? bodyNode.children : htmlNode ? htmlNode.children.filter((n) => n.tag !== 'head') : nodes;

  const mount = useMemo(() => {
    if (!doc) return null;
    if (!mountId) return doc.body;
    let root = doc.getElementById(mountId);
    if (!root) {
      root = doc.createElement('div');
      root.id = mountId;
      doc.body.append(root);
    }
    return root;
  }, [doc, mountId]);

  const ctx = useMemo(() => ({ elements, height, present: !!present }), [elements, height, present]);

  return (
    <>
      <iframe
        ref={iframe}
        title={`Frame ${id}`}
        className="frame-iframe"
        srcDoc="<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'></head><body></body></html>"
        style={{ width, height, pointerEvents: present || editingKey ? 'auto' : 'none' }}
        data-frame-id={id}
      />
      {mount && createPortal(<Nodes nodes={content} ctx={ctx} editingKey={editingKey ?? null} />, mount)}
    </>
  );
}

interface RenderCtx {
  elements: Map<string, Element>;
  height: number;
  present: boolean;
}

/** Applies a layout's <html> or <body> props to the frame's own element. */
function useApplyRoot(element: HTMLElement | undefined, node: RNode | undefined, elements: Map<string, Element>, height: number, present?: boolean) {
  const applied = useRef<string[]>([]);
  useLayoutEffect(() => {
    if (!element) return;
    for (const name of applied.current) element.removeAttribute(name);
    element.removeAttribute('style');
    const names: string[] = [];
    if (node) {
      elements.set(node.key, element);
      element.setAttribute('data-fkey', node.key);
      names.push('data-fkey');
      for (const [name, value] of Object.entries(node.props)) {
        if (name === 'style' && value && typeof value === 'object') {
          for (const [prop, v] of Object.entries(value as Record<string, string | number>))
            element.style.setProperty(cssName(prop), cssValue(prop, v, height, present));
          continue;
        }
        const attr = name === 'className' ? 'class' : name;
        if (typeof value === 'string' || typeof value === 'number') {
          element.setAttribute(attr, String(value));
          names.push(attr);
        }
      }
      // Keep Frame's own classes on <html>.
      if (element.tagName === 'HTML') {
        element.classList.toggle('frame-design', !present);
      }
    }
    applied.current = names;
    return () => {
      if (node) elements.delete(node.key);
    };
  });
}

const cssName = (prop: string) => (prop.startsWith('--') ? prop : prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`));
const unitless = new Set(['opacity', 'zIndex', 'fontWeight', 'lineHeight', 'flex', 'flexGrow', 'flexShrink', 'order', 'zoom', 'scale']);
function cssValue(prop: string, value: string | number, height: number, present?: boolean) {
  if (typeof value === 'number') return unitless.has(prop) ? String(value) : `${value}px`;
  return present ? value : fixViewportHeight(value, height);
}

function Nodes({ nodes, ctx, editingKey }: { nodes: RNode[]; ctx: RenderCtx; editingKey: string | null }) {
  return (
    <>
      {nodes.map((node) => (
        <NodeView key={node.key} node={node} ctx={ctx} editingKey={editingKey} />
      ))}
    </>
  );
}

/** Ref callbacks per key, so React doesn't detach and reattach them on every render. */
const refCache = new WeakMap<Map<string, Element>, Map<string, (el: Element | null) => void>>();
function refFor(elements: Map<string, Element>, key: string) {
  let cache = refCache.get(elements);
  if (!cache) refCache.set(elements, (cache = new Map()));
  let ref = cache.get(key);
  if (!ref) {
    ref = (el: Element | null) => {
      if (el) elements.set(key, el);
      else if (elements.get(key) && !elements.get(key)!.isConnected) elements.delete(key);
    };
    cache.set(key, ref);
  }
  return ref;
}

const NodeView = memo(function NodeView({ node, ctx, editingKey }: { node: RNode; ctx: RenderCtx; editingKey: string | null }): ReactNode {
  if (node.hidden) return null;
  const ref = refFor(ctx.elements, node.key);
  const editing = editingKey === node.key;
  const editable = editing ? { contentEditable: 'plaintext-only' as unknown as boolean, suppressContentEditableWarning: true, 'data-frame-editing': '' } : {};
  switch (node.kind) {
    case 'instance':
      return <Nodes nodes={node.children} ctx={ctx} editingKey={editingKey} />;
    case 'text': {
      const style = node.props.style as Record<string, string | number> | undefined;
      return (
        <span ref={ref} data-fkey={node.key} {...editable} style={style && fixStyle(style, ctx)}>
          {node.text}
        </span>
      );
    }
    case 'placeholder':
      return (
        <span ref={ref} data-fkey={node.key} data-frame-placeholder="">
          {node.name}
        </span>
      );
    case 'icon': {
      const Icon = node.icon?.library === 'lucide' ? (lucide?.[node.icon.name] ?? lucide?.[`${node.icon.name}Icon`]) : undefined;
      const props = { ...node.props, ref, 'data-fkey': node.key };
      if (Icon) return createElement(Icon, props);
      const size = (node.props.size as number | undefined) ?? 24;
      return (
        <svg {...(node.props as object)} ref={ref as never} data-fkey={node.key} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <rect x="4" y="4" width="16" height="16" rx="4" strokeDasharray="3 3" />
        </svg>
      );
    }
    default: {
      const style = node.props.style as Record<string, string | number> | undefined;
      const props: Record<string, unknown> = {
        ...node.props,
        ref,
        'data-fkey': node.key,
        ...editable,
        ...(style ? { style: fixStyle(style, ctx) } : {}),
      };
      if (node.tag === 'input' || node.tag === 'textarea' || node.tag === 'select') {
        props.readOnly = true;
        props.tabIndex = -1;
      }
      if (voidTags.has(node.tag)) return createElement(node.tag, props);
      const children = node.text !== undefined ? node.text : <Nodes nodes={node.children} ctx={ctx} editingKey={editingKey} />;
      return createElement(node.tag === 'html' || node.tag === 'body' ? 'div' : node.tag, props, children);
    }
  }
}, (a, b) => a.node === b.node && a.ctx === b.ctx && a.editingKey === b.editingKey);

function fixStyle(style: Record<string, string | number>, ctx: RenderCtx) {
  if (ctx.present) return style;
  let changed = false;
  const next: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(style)) {
    if (typeof value === 'string' && /\d(d|s|l)?vh\b/.test(value)) {
      next[key] = fixViewportHeight(value, ctx.height);
      changed = true;
    } else next[key] = value;
  }
  return changed ? next : style;
}

