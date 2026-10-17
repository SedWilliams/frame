/*
 * The canvas.
 *
 * Renders the project tree as real DOM elements inside a scaled artboard, then
 * draws the selection outline on top by measuring the selected element. Also
 * handles in-place text editing, drag and drop, resizing, panning, and zoom.
 */

import {
  createElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  ArrowUpRight,
  Code2,
  Hand,
  Maximize2,
  MousePointer2,
  Plus,
  Type,
  Minus,
  Image,
  Square,
  LockKeyhole,
} from 'lucide-react';
import type { Editor } from '../useEditor';
import { canContain, voidTags, type EditorNode, type InsertType } from '../model';
import { IconButton } from './Controls';

interface CanvasProps {
  editor: Editor;
  viewport: number;
  preview: boolean;
  onCode: () => void;
}
/** Selection box in artboard pixels, before zoom. */
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** Image URLs the preview will load. Anything else, such as a javascript: URL, renders without a src. */
const safeUrl = (url: string) =>
  /^(https?:|\/|\.\.?\/|#|data:image\/(png|jpeg|webp|gif);base64,)/i.test(url) ? url : undefined;

export function Canvas({ editor, viewport, preview, onCode }: CanvasProps) {
  const stage = useRef<HTMLDivElement>(null);
  const artboard = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(0.8);
  const [rect, setRect] = useState<Rect | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [tool, setTool] = useState<'select' | 'hand'>('select');
  const [dropId, setDropId] = useState<string | null>(null);
  // Live dimensions during a resize drag. Release commits them as a style edit.
  const [size, setSize] = useState<{ id: string; width: number; height: number } | null>(null);
  const [height, setHeight] = useState(900);
  // Stops a resize or pan still running when the canvas unmounts.
  const pointerCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => pointerCleanup.current?.(), []);

  // Measure the selected element after every layout change and place the outline
  // over it. Dividing by zoom converts screen pixels back to artboard pixels.
  useLayoutEffect(() => {
    function measure() {
      const board = artboard.current;
      if (!board) return;
      setHeight(board.offsetHeight);
      const el = board.querySelector<HTMLElement>(`[data-node-id="${editor.selectedId}"]`);
      if (!el || el.offsetWidth === 0) {
        setRect(null);
        return;
      }
      const parent = board.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      setRect({
        x: (box.x - parent.x) / zoom,
        y: (box.y - parent.y) / zoom,
        width: box.width / zoom,
        height: box.height / zoom,
      });
    }
    measure();
    const observer = new ResizeObserver(measure);
    if (artboard.current) {
      observer.observe(artboard.current);
      artboard.current.querySelectorAll('[data-node-id]').forEach((el) => observer.observe(el));
    }
    return () => observer.disconnect();
  }, [editor.project.root, editor.selectedId, zoom, viewport, size]);

  // Fit the artboard to the stage width, between 25% and 100%. Runs when the
  // viewport or preview mode changes, and from the Fit button.
  function fit() {
    if (stage.current)
      setZoom(Math.min(1, Math.max(0.25, (stage.current.clientWidth - 100) / viewport)));
  }
  useEffect(fit, [viewport, preview]);

  useEffect(() => {
    // Entering text edit focuses the element and selects all of its text.
    if (editing) {
      const el = artboard.current?.querySelector<HTMLElement>(`[data-node-id="${editing}"]`);
      el?.focus();
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
  }, [editing]);

  /**
   * Drop on a canvas node. A dragged layer lands inside a container, or before any
   * other node. A new element from the Insert tab goes at the end of the container,
   * or at the end of the node's parent.
   */
  function drop(event: DragEvent, node: EditorNode) {
    event.preventDefault();
    event.stopPropagation();
    setDropId(null);
    const asset = event.dataTransfer.getData('application/frame-asset') as InsertType;
    const id = event.dataTransfer.getData('application/frame-node');
    if (asset) editor.insert(asset, node.id);
    if (id) editor.move(id, node.id, canContain(node));
  }

  /** Renders a node as its real HTML tag with the editor's handlers attached. */
  function renderNode(node: EditorNode): React.ReactNode {
    if (node.hidden) return null;
    if (node.opaque)
      return (
        <div
          key={node.id}
          data-node-id={node.id}
          className="opaque-node"
          onClick={(event) => {
            if (!preview) {
              event.stopPropagation();
              editor.select(node.id);
            }
          }}
        >
          <Code2 size={14} />
          {node.name}
        </div>
      );
    const activeEdit = editing === node.id;
    // Pass through only harmless attributes. Links keep in-page anchors and lose any
    // other href, so a click can't leave the editor. Form fields display but take no input.
    const attrs: Record<string, unknown> = {};
    for (const key of ['alt', 'title', 'placeholder', 'id'])
      if (node.attrs[key]) attrs[key] = node.attrs[key];
    if (node.tag === 'img' && node.attrs.src) attrs.src = safeUrl(node.attrs.src);
    if (node.tag === 'a')
      attrs.href = node.attrs.href?.startsWith('#') ? node.attrs.href : undefined;
    if (node.tag === 'input' || node.tag === 'textarea') {
      attrs.readOnly = true;
      attrs.tabIndex = -1;
    }
    // Apply the live resize size and the drop outline on top of the node's style.
    // Fragments render as display: contents so they add no box.
    const style = {
      ...node.style,
      ...(size?.id === node.id
        ? { width: size.width, height: size.height, maxWidth: 'none', flex: 'none' }
        : {}),
      ...(dropId === node.id ? { outline: '2px dashed #ed6743', outlineOffset: 3 } : {}),
      ...(node.tag === 'fragment' ? { display: 'contents' } : {}),
    } as CSSProperties;
    return createElement(
      node.tag === 'fragment' ? 'div' : node.tag,
      {
        ...attrs,
        key: node.id,
        'data-node-id': node.id,
        'data-editable': !preview && !node.locked ? 'true' : undefined,
        style,
        contentEditable: activeEdit,
        suppressContentEditableWarning: true,
        onSubmit: (event: React.FormEvent) => event.preventDefault(),
        draggable:
          !preview &&
          !node.locked &&
          !activeEdit &&
          node.id !== editor.project.root.id &&
          tool !== 'hand',
        onClick: (event: React.MouseEvent) => {
          if (!preview) {
            event.preventDefault();
            event.stopPropagation();
            editor.select(node.id);
          }
        },
        onDoubleClick: (event: React.MouseEvent) => {
          if (!preview && !node.locked && node.text !== undefined) {
            event.preventDefault();
            event.stopPropagation();
            setEditing(node.id);
          }
        },
        onBlur: (event: React.FocusEvent<HTMLElement>) => {
          if (activeEdit) {
            editor.patch(node.id, { text: event.currentTarget.textContent || '' });
            setEditing(null);
          }
        },
        onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
          if (activeEdit) {
            event.stopPropagation();
            if (event.key === 'Escape' || (event.key === 'Enter' && !event.shiftKey)) {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }
        },
        onDragStart: (event: DragEvent) => {
          if (preview || node.locked || activeEdit || tool === 'hand') {
            event.preventDefault();
            return;
          }
          event.stopPropagation();
          event.dataTransfer.setData('application/frame-node', node.id);
          event.dataTransfer.effectAllowed = 'move';
          editor.select(node.id);
        },
        onDragOver: (event: DragEvent) => {
          if (
            !preview &&
            (event.dataTransfer.types.includes('application/frame-node') ||
              event.dataTransfer.types.includes('application/frame-asset'))
          ) {
            event.preventDefault();
            event.stopPropagation();
            setDropId(node.id);
          }
        },
        onDragLeave: () => setDropId(null),
        onDrop: (event: DragEvent) => {
          if (!preview) drop(event, node);
        },
      },
      ...(voidTags.has(node.tag)
        ? []
        : node.text !== undefined
          ? [node.text]
          : node.children.map(renderNode)),
    );
  }

  /** Follows one pointer gesture on window. Starting another drops the first without ending it. */
  function track(onMove: (event: PointerEvent) => void, onEnd: (committed: boolean) => void) {
    function stop() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', cancel);
      pointerCleanup.current = null;
    }
    function end() {
      stop();
      onEnd(true);
    }
    function cancel() {
      stop();
      onEnd(false);
    }
    pointerCleanup.current?.();
    pointerCleanup.current = stop;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', cancel);
  }

  /** Drag on the corner handle. Shows the size live and commits one style edit on release. */
  function resize(event: ReactPointerEvent) {
    if (!rect || editor.selected.locked || editor.selected.opaque) return;
    event.preventDefault();
    event.stopPropagation();
    const start = { x: event.clientX, y: event.clientY, width: rect.width, height: rect.height };
    let final = {
      id: editor.selectedId,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
    track(
      (e) => {
        final = {
          id: editor.selectedId,
          width: Math.max(16, Math.round(start.width + (e.clientX - start.x) / zoom)),
          height: Math.max(16, Math.round(start.height + (e.clientY - start.y) / zoom)),
        };
        setSize(final);
      },
      (committed) => {
        if (committed)
          editor.style(final.id, {
            width: final.width,
            height: final.height,
            maxWidth: 'none',
            flex: 'none',
          });
        setSize(null);
      },
    );
  }

  /** Hand tool. Dragging scrolls the stage. */
  function pan(event: ReactPointerEvent) {
    if (tool !== 'hand' || !stage.current) return;
    event.preventDefault();
    const el = stage.current;
    const start = { x: event.clientX, y: event.clientY, left: el.scrollLeft, top: el.scrollTop };
    track(
      (e) => {
        el.scrollLeft = start.left - (e.clientX - start.x);
        el.scrollTop = start.top - (e.clientY - start.y);
      },
      () => {},
    );
  }

  return (
    <main className={`canvas-region ${preview ? 'preview-mode' : ''}`}>
      {/* Label row above the stage, with a link to the code. */}
      <div className="canvas-topline">
        <div>
          <span className="live-dot" />
          {preview ? 'Responsive preview' : 'Live canvas'}
          <span className="canvas-topline-divider">/</span>
          <span>Home page</span>
        </div>
        <button onClick={onCode}>
          <Code2 size={13} />
          {editor.project.fileName}
          <ArrowUpRight size={12} />
        </button>
      </div>
      <div
        className={`canvas-stage ${tool === 'hand' && !preview ? 'hand-tool' : ''}`}
        ref={stage}
        onPointerDown={pan}
      >
        <div className="canvas-content" style={{ minWidth: viewport * zoom + 104 }}>
          {/* The artboard renders at full viewport width and scales by zoom.
              artboard-space reserves the scaled size so scrolling matches what you see. */}
          <div className="artboard-label" style={{ width: viewport * zoom }}>
            <span>
              <Square size={11} />
              Home page
              <span className="artboard-mode">
                {viewport >= 900 ? 'Desktop' : viewport >= 600 ? 'Tablet' : 'Mobile'}
              </span>
            </span>
            <span>
              {viewport} × {Math.round(height)}
            </span>
          </div>
          <div className="artboard-space" style={{ width: viewport * zoom, height: height * zoom }}>
            <div
              ref={artboard}
              className="artboard"
              style={{
                width: viewport,
                transform: `scale(${zoom})`,
                pointerEvents: tool === 'hand' && !preview ? 'none' : undefined,
              }}
            >
              {renderNode(editor.project.root)}
              {/* Selection outline. --inverse-zoom keeps its lines and labels the same size at any zoom. */}
              {!preview && rect && !editing && (
                <div
                  className="selection-outline"
                  style={
                    {
                      left: rect.x,
                      top: rect.y,
                      width: rect.width,
                      height: rect.height,
                      '--inverse-zoom': 1 / zoom,
                    } as CSSProperties
                  }
                >
                  <span className="selection-label">
                    {editor.selected.locked ? <LockKeyhole size={10} /> : <Type size={10} />}
                    {editor.selected.name}
                  </span>
                  <i className="corner top-left" />
                  <i className="corner top-right" />
                  <i className="corner bottom-left" />
                  <button
                    aria-label="Resize selected element"
                    className="corner bottom-right"
                    disabled={editor.selected.locked || editor.selected.opaque}
                    onPointerDown={resize}
                  />
                  <span className="dimension-label">
                    {Math.round(rect.width)} × {Math.round(rect.height)}
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className="canvas-below-label">
            <span>Made of real components.</span>
            <span>Ready for your next idea.</span>
          </div>
        </div>
      </div>
      {/* Floating tools: select, pan, and quick insert. */}
      {!preview && (
        <div className="canvas-tools">
          <IconButton
            label="Select tool"
            active={tool === 'select'}
            onClick={() => setTool('select')}
          >
            <MousePointer2 size={18} />
          </IconButton>
          <IconButton label="Pan tool" active={tool === 'hand'} onClick={() => setTool('hand')}>
            <Hand size={18} />
          </IconButton>
          <i />
          <IconButton label="Insert frame" onClick={() => editor.insert('frame')}>
            <Square size={18} />
          </IconButton>
          <IconButton label="Insert text" onClick={() => editor.insert('text')}>
            <Type size={19} />
          </IconButton>
          <IconButton label="Insert image" onClick={() => editor.insert('image')}>
            <Image size={18} />
          </IconButton>
          <i />
          <button className="insert-button" onClick={() => editor.insert('button')}>
            <Plus size={18} />
          </button>
        </div>
      )}
      {/* Zoom controls. Manual zoom runs from 25% to 200%. */}
      <div className="zoom-tools">
        <IconButton label="Zoom out" onClick={() => setZoom(Math.max(0.25, zoom - 0.1))}>
          <Minus size={14} />
        </IconButton>
        <span>{Math.round(zoom * 100)}%</span>
        <IconButton label="Zoom in" onClick={() => setZoom(Math.min(2, zoom + 0.1))}>
          <Plus size={14} />
        </IconButton>
        <i />
        <IconButton label="Fit to canvas" onClick={fit}>
          <Maximize2 size={14} />
        </IconButton>
      </div>
    </main>
  );
}
