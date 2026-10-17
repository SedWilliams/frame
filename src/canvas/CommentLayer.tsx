/*
 * Comments on the canvas.
 *
 * With the comment tool, a click on a layer opens a composer pinned to that
 * spot. Each comment records the layer's file and line, so when the user clicks
 * Done, the agent that opened Frame gets a list of requests it can act on, each
 * tied to the code it's about. Pins follow their layer as the page changes.
 */

import { useState } from 'react';
import { Check, Trash2, X } from 'lucide-react';
import { currentPage, findRender, get, set, useEditor } from '../app/state';
import { setComments } from '../app/session';
import type { Comment } from '../app/backend';
import { lineColumn } from '../core/parse';
import { screenRect } from './Canvas';

/** File, line, and a short description of the layer a comment is pinned to. */
function describe(key: string): Pick<Comment, 'file' | 'line' | 'column' | 'element'> {
  const state = get();
  const node = findRender(state, key)?.node;
  if (!node) return {};
  const source = node.source ?? (node.textSource ? { file: node.textSource.file, id: '' } : undefined);
  const offset = source?.id.includes(':') ? Number(source.id.slice(source.id.lastIndexOf(':') + 1)) : undefined;
  const base = source ? state.doc.code[source.file]?.base : undefined;
  const position = base !== undefined && offset !== undefined && Number.isFinite(offset) ? lineColumn(base, offset) : undefined;
  const tag = node.kind === 'instance' ? `<${node.tag} />` : node.kind === 'text' ? 'text' : `<${node.tag}>`;
  return {
    file: source?.file,
    line: position?.line,
    column: position?.column,
    element: `${tag} ${node.name}`.trim(),
  };
}

export function CommentLayer() {
  const comments = useEditor((s) => s.comments);
  const draft = useEditor((s) => s.draftComment);
  const open = useEditor((s) => s.openComment);
  const visible = useEditor((s) => s.ui.commentsVisible || s.tool === 'comment');
  const pageRoute = useEditor((s) => currentPage(s)?.route ?? s.pageId);
  const [text, setText] = useState('');
  useEditor((s) => s.views[s.pageId]);

  const pins = visible
    ? comments
        .filter((c) => !c.resolved && c.page === pageRoute && c.key)
        .map((comment, i) => {
          const rect = screenRect(comment.frame ?? get().activeFrame, comment.key!) ?? screenRect(get().activeFrame, comment.key!);
          return rect ? { comment, n: i + 1, x: rect.x + (comment.x ?? 0) * rect.width, y: rect.y + (comment.y ?? 0) * rect.height } : undefined;
        })
        .filter((p): p is NonNullable<typeof p> => !!p)
    : [];

  const draftRect = draft ? screenRect(draft.frame, draft.key) : undefined;
  const draftPoint = draft && draftRect ? { x: draftRect.x + draft.x * draftRect.width, y: draftRect.y + draft.y * draftRect.height } : undefined;

  const post = () => {
    if (!draft || !text.trim()) return;
    const comment: Comment = {
      id: `c-${Date.now().toString(36)}`,
      text: text.trim(),
      key: draft.key,
      frame: draft.frame,
      x: draft.x,
      y: draft.y,
      page: pageRoute,
      createdAt: new Date().toISOString(),
      ...describe(draft.key),
    };
    setComments((list) => [...list, comment]);
    setText('');
    set({ draftComment: null });
  };

  const openPin = pins.find((p) => p.comment.id === open);
  return (
    <>
      {pins.map(({ comment, n, x, y }) => (
        <button
          key={comment.id}
          data-overlay-control
          className={`comment-pin${open === comment.id ? ' open' : ''}`}
          style={{ left: x, top: y }}
          aria-label={`Comment ${n}: ${comment.text}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => set({ openComment: open === comment.id ? null : comment.id, draftComment: null })}
        >
          {n}
        </button>
      ))}
      {openPin && (
        <div data-overlay-control className="comment-popover" style={{ left: openPin.x + 18, top: openPin.y - 8 }} onPointerDown={(e) => e.stopPropagation()}>
          <p>{openPin.comment.text}</p>
          <small>
            {openPin.comment.element}
            {openPin.comment.file ? ` · ${openPin.comment.file}${openPin.comment.line ? `:${openPin.comment.line}` : ''}` : ''}
          </small>
          <div className="comment-actions">
            <button onClick={() => setComments((list) => list.map((c) => (c.id === openPin.comment.id ? { ...c, resolved: true } : c)))}>
              <Check size={13} /> Resolve
            </button>
            <button onClick={() => setComments((list) => list.filter((c) => c.id !== openPin.comment.id))}>
              <Trash2 size={13} /> Delete
            </button>
          </div>
        </div>
      )}
      {draft && draftPoint && (
        <div data-overlay-control className="comment-composer" style={{ left: draftPoint.x, top: draftPoint.y }} onPointerDown={(e) => e.stopPropagation()}>
          <span className="comment-pin draft" />
          <div className="comment-box">
            <textarea
              autoFocus
              aria-label="Comment"
              placeholder="Ask for a change. Your agent gets it when you click Done."
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  post();
                }
                if (e.key === 'Escape') set({ draftComment: null });
              }}
            />
            <div className="comment-actions">
              <small>{describe(draft.key).element}</small>
              <button aria-label="Cancel comment" onClick={() => set({ draftComment: null })}>
                <X size={13} />
              </button>
              <button className="primary" disabled={!text.trim()} onClick={post}>
                Post
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
