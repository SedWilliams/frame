/*
 * The Dev tab, after Figma's Dev Mode: where the selected layer lives in code,
 * with links that open the exact line in VS Code or Cursor, its classes and
 * inline styles, and the CSS the browser computed for it.
 */

import { useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { get, useEditor } from '../app/state';
import { lineColumn } from '../core/parse';
import { useInspect } from './inspect';
import { Section } from '../ui/controls';

const cssProps = [
  'display', 'position', 'width', 'height', 'padding', 'margin', 'gap', 'flex-direction', 'justify-content', 'align-items',
  'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'color', 'background-color', 'background-image',
  'border', 'border-radius', 'box-shadow', 'opacity',
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="copy-button"
      aria-label="Copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

export function DevPanel() {
  const info = useInspect();
  const root = useEditor((s) => s.config.root);
  if (!info) return null;
  const node = info.primary;
  const source = node.source;
  const offset = source?.id.includes(':') ? Number(source.id.slice(source.id.lastIndexOf(':') + 1)) : undefined;
  const base = source ? get().doc.code[source.file]?.base : undefined;
  const position = base !== undefined && offset !== undefined && Number.isFinite(offset) ? lineColumn(base, offset) : undefined;
  const snippet = base !== undefined && offset !== undefined ? base.slice(offset, base.indexOf('>', offset) + 1) : undefined;
  const absolute = root && source ? `${root.replace(/\/$/, '')}/${source.file}` : undefined;
  const location = position ? `:${position.line}:${position.column}` : '';
  const c = info.computed[0];
  const css = c
    ? cssProps
        .map((prop) => [prop, c.getPropertyValue(prop)] as const)
        .filter(([prop, value]) => value && value !== 'none' && value !== 'normal' && value !== '0px' && !(prop === 'background-color' && value === 'rgba(0, 0, 0, 0)') && !(prop === 'position' && value === 'static'))
        .map(([prop, value]) => `${prop}: ${value};`)
        .join('\n')
    : '';
  const classes = info.tree?.attrs.className ?? (typeof node.props.className === 'string' ? node.props.className : '');
  const inline = info.tree && Object.keys(info.tree.style).length ? JSON.stringify(info.tree.style, null, 2) : '';
  return (
    <div className="dev-tab">
      <Section title="Code" id="code">
        {source ? (
          <>
            <div className="code-location">
              <code>
                {source.file}
                {location}
              </code>
              <CopyButton text={`${source.file}${location}`} />
            </div>
            {absolute && (
              <div className="open-links">
                <a href={`vscode://file/${absolute}${location}`}>
                  <ExternalLink size={12} /> VS Code
                </a>
                <a href={`cursor://file/${absolute}${location}`}>
                  <ExternalLink size={12} /> Cursor
                </a>
              </div>
            )}
            {snippet && (
              <pre className="code-block">
                <code>{snippet}</code>
              </pre>
            )}
          </>
        ) : (
          <p className="hint">This layer has no source of its own.</p>
        )}
      </Section>
      {classes && (
        <Section title="Classes" id="classes" actions={<CopyButton text={classes} />}>
          <div className="class-list">
            {classes.split(/\s+/).filter(Boolean).map((cls, i) => (
              <code key={`${cls}${i}`}>{cls}</code>
            ))}
          </div>
        </Section>
      )}
      {inline && (
        <Section title="Inline style" id="inline" actions={<CopyButton text={inline} />}>
          <pre className="code-block">
            <code>{inline}</code>
          </pre>
        </Section>
      )}
      <Section title="CSS" id="css" actions={<CopyButton text={css} />}>
        <pre className="code-block">
          <code>{css}</code>
        </pre>
      </Section>
    </div>
  );
}
