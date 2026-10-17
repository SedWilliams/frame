import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  ArrowDown,
  ArrowRight,
  ChevronDown,
  Copy,
  Trash2,
  Maximize,
  Link2,
  FileCode2,
  SlidersHorizontal,
  Scan,
  Rows3,
  Columns3,
  LockKeyhole,
  CircleHelp,
} from 'lucide-react';
import type { Editor } from '../useEditor';
import type { Style } from '../model';
import { Field, IconButton, Select } from './Controls';
import { NodeIcon } from './Layers';
import { useEffect, useState } from 'react';

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="color-field">
      <input
        type="color"
        aria-label={`${label} picker`}
        value={/^#[\da-f]{6}$/i.test(value) ? value : '#293d32'}
        onChange={(event) => onChange(event.target.value)}
      />
      <Field label={label} value={value} onCommit={onChange} />
      <span className="color-opacity">100%</span>
    </div>
  );
}

function TextContent({ text, onChange }: { text: string; onChange: (text: string) => void }) {
  const [draft, setDraft] = useState(text);
  useEffect(() => setDraft(text), [text]);
  return (
    <textarea
      className="content-input"
      aria-label="Text content"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== text) onChange(draft);
      }}
    />
  );
}

export function Inspector({ editor, onCode }: { editor: Editor; onCode: () => void }) {
  const node = editor.selected;
  const style = node.style;
  const set = (values: Style) => editor.style(node.id, values);
  function setValue(key: string, value: string) {
    const trimmed = value.trim();
    if (!trimmed) return set({ [key]: '' });
    const numeric = /^-?\d+(\.\d+)?$/.test(trimmed);
    set({ [key]: numeric ? Number(trimmed) : trimmed });
  }
  const textNode = node.text !== undefined;
  const isRoot = node.id === editor.project.root.id;
  return (
    <aside className="right-panel">
      <div className="inspector-tabs">
        <button className="active">Design</button>
        <button onClick={onCode}>
          Code <span>↗</span>
        </button>
        <SlidersHorizontal size={14} />
      </div>
      <div className="selection-heading">
        <div className="selection-icon">
          <NodeIcon node={node} size={17} />
        </div>
        <div>
          <strong>{node.name}</strong>
          <span>{node.opaque ? 'Preserved source' : `<${node.tag}> element`}</span>
        </div>
        <span className="tag-badge">{node.opaque ? 'JSX' : node.tag.toUpperCase()}</span>
      </div>
      <div className="inspector-scroll">
        {node.opaque || node.tag === 'fragment' ? (
          <div className="readonly-note">
            <FileCode2 size={22} />
            <h3>{node.opaque ? 'Keep the logic intact.' : 'A group without a box.'}</h3>
            <p>
              {node.opaque
                ? 'This dynamic expression or custom component stays in your source unchanged. Edit its implementation in your code editor.'
                : 'Fragments have no styles of their own. Select a child to change its appearance, or drag layers to reorder them.'}
            </p>
          </div>
        ) : (
          <fieldset className="inspector-fields" disabled={node.locked}>
            {node.locked && (
              <div className="lock-note">
                <LockKeyhole size={13} />
                Unlock this layer to edit it.
              </div>
            )}
            <section className="inspector-section">
              <h3>
                Layout <Scan size={13} />
              </h3>
              <div className="align-tools">
                <IconButton
                  label="Align children left"
                  active={style.alignItems === 'flex-start'}
                  onClick={() => set({ display: 'flex', alignItems: 'flex-start' })}
                >
                  <AlignLeft size={16} />
                </IconButton>
                <IconButton
                  label="Align children center"
                  active={style.alignItems === 'center'}
                  onClick={() => set({ display: 'flex', alignItems: 'center' })}
                >
                  <AlignCenter size={16} />
                </IconButton>
                <IconButton
                  label="Align children right"
                  active={style.alignItems === 'flex-end'}
                  onClick={() => set({ display: 'flex', alignItems: 'flex-end' })}
                >
                  <AlignRight size={16} />
                </IconButton>
                <i />
                <IconButton
                  label="Stack vertically"
                  active={style.flexDirection === 'column'}
                  onClick={() => set({ display: 'flex', flexDirection: 'column' })}
                >
                  <Rows3 size={16} />
                </IconButton>
                <IconButton
                  label="Stack horizontally"
                  active={style.flexDirection === 'row'}
                  onClick={() => set({ display: 'flex', flexDirection: 'row' })}
                >
                  <Columns3 size={16} />
                </IconButton>
                <IconButton label="Fill available width" onClick={() => set({ width: '100%' })}>
                  <Maximize size={14} />
                </IconButton>
              </div>
              <div className="field-grid">
                <Field
                  label="W"
                  value={style.width ?? 'auto'}
                  onCommit={(v) => setValue('width', v)}
                />
                <Field
                  label="H"
                  value={style.height ?? 'auto'}
                  onCommit={(v) => setValue('height', v)}
                />
              </div>
              <div className="field-grid">
                <Field
                  label="Min W"
                  value={style.minWidth ?? 0}
                  onCommit={(v) => setValue('minWidth', v)}
                />
                <Field
                  label="Min H"
                  value={style.minHeight ?? 0}
                  onCommit={(v) => setValue('minHeight', v)}
                />
              </div>
            </section>
            {textNode && (
              <section className="inspector-section">
                <h3>
                  Typography <span className="section-symbol">Tt</span>
                </h3>
                <Select
                  label="Font family"
                  value={String(style.fontFamily || 'inherit')}
                  onChange={(value) => set({ fontFamily: value })}
                  options={
                    [
                      [
                        String(style.fontFamily || 'inherit'),
                        style.fontFamily
                          ? String(style.fontFamily).split(',')[0].replace(/'/g, '')
                          : 'Inherited',
                      ],
                      ['Georgia, serif', 'Georgia'],
                      ['Arial, sans-serif', 'Arial'],
                      ['Manrope, sans-serif', 'Manrope'],
                      ['monospace', 'Monospace'],
                    ].filter(
                      (item, index, all) => all.findIndex((x) => x[0] === item[0]) === index,
                    ) as [string, string][]
                  }
                />
                <div className="field-grid">
                  <Select
                    label="Font weight"
                    value={String(style.fontWeight || 400)}
                    onChange={(value) => set({ fontWeight: Number(value) })}
                    options={[
                      ['400', 'Regular'],
                      ['500', 'Medium'],
                      ['600', 'Semibold'],
                      ['700', 'Bold'],
                      ['800', 'Extra bold'],
                    ]}
                  />
                  <Field
                    label="Size"
                    value={style.fontSize ?? 16}
                    onCommit={(v) => setValue('fontSize', v)}
                  />
                </div>
                <div className="field-grid">
                  <Field
                    label="↕"
                    value={style.lineHeight ?? 'normal'}
                    onCommit={(v) => setValue('lineHeight', v)}
                  />
                  <Field
                    label="↔"
                    value={style.letterSpacing ?? 0}
                    onCommit={(v) => setValue('letterSpacing', v)}
                    suffix="px"
                  />
                </div>
                <div className="text-alignment">
                  {(['left', 'center', 'right'] as const).map((align, i) => {
                    const Icon = [AlignLeft, AlignCenter, AlignRight][i];
                    return (
                      <IconButton
                        key={align}
                        label={`Text align ${align}`}
                        active={(style.textAlign || 'left') === align}
                        onClick={() => set({ textAlign: align })}
                      >
                        <Icon size={16} />
                      </IconButton>
                    );
                  })}
                  <span>Alignment</span>
                </div>
                <TextContent
                  text={node.text!}
                  onChange={(value) => editor.patch(node.id, { text: value })}
                />
              </section>
            )}
            <section className="inspector-section">
              <h3>
                {textNode ? 'Fill' : 'Appearance'} <span className="section-symbol">◈</span>
              </h3>
              <ColorField
                label={textNode ? 'Text color' : 'Background'}
                value={String(
                  style[textNode ? 'color' : 'backgroundColor'] ||
                    (textNode ? '#293d32' : '#ffffff'),
                )}
                onChange={(value) => set({ [textNode ? 'color' : 'backgroundColor']: value })}
              />
              <div className="field-grid">
                <Field
                  label="Opacity"
                  value={Math.round(Number(style.opacity ?? 1) * 100)}
                  suffix="%"
                  onCommit={(v) => {
                    const n = Number(v);
                    if (Number.isFinite(n)) set({ opacity: Math.min(1, Math.max(0, n / 100)) });
                  }}
                />
                <Field
                  label="Radius"
                  value={style.borderRadius ?? 0}
                  onCommit={(v) => setValue('borderRadius', v)}
                />
              </div>
            </section>
            <section className="inspector-section">
              <h3>
                Spacing <ChevronDown size={13} />
              </h3>
              <div className="spacing-diagram">
                <span className="spacing-label">PADDING</span>
                <Field
                  label="Padding"
                  value={style.padding ?? 0}
                  onCommit={(v) => setValue('padding', v)}
                />
                <div className="spacing-center">
                  <div />
                  <div />
                  <div />
                </div>
              </div>
              <div className="field-grid">
                <Field label="Gap" value={style.gap ?? 0} onCommit={(v) => setValue('gap', v)} />
                <Field
                  label="Margin"
                  value={style.margin ?? 0}
                  onCommit={(v) => setValue('margin', v)}
                />
              </div>
              {!textNode && (
                <div className="field-grid">
                  <Select
                    label="Display"
                    value={String(style.display || 'block')}
                    onChange={(value) => set({ display: value })}
                    options={[
                      ['block', 'Block'],
                      ['flex', 'Flex'],
                      ['grid', 'Grid'],
                      ['inline-flex', 'Inline flex'],
                    ]}
                  />
                  <div className="direction-tools">
                    <IconButton
                      label="Row direction"
                      active={style.flexDirection === 'row'}
                      onClick={() => set({ flexDirection: 'row' })}
                    >
                      <ArrowRight size={15} />
                    </IconButton>
                    <IconButton
                      label="Column direction"
                      active={style.flexDirection === 'column'}
                      onClick={() => set({ flexDirection: 'column' })}
                    >
                      <ArrowDown size={15} />
                    </IconButton>
                  </div>
                </div>
              )}
            </section>
            {node.tag === 'img' && (
              <section className="inspector-section">
                <h3>
                  Image <Link2 size={13} />
                </h3>
                <Field
                  label="URL"
                  value={node.attrs.src || ''}
                  onCommit={(v) => editor.patch(node.id, { attrs: { ...node.attrs, src: v } })}
                />
                <Field
                  label="Alt"
                  value={node.attrs.alt || ''}
                  onCommit={(v) => editor.patch(node.id, { attrs: { ...node.attrs, alt: v } })}
                />
                <Select
                  label="Image fit"
                  value={String(style.objectFit || 'cover')}
                  onChange={(value) => set({ objectFit: value })}
                  options={[
                    ['cover', 'Cover'],
                    ['contain', 'Contain'],
                    ['fill', 'Fill'],
                  ]}
                />
              </section>
            )}
          </fieldset>
        )}
        <section className="inspector-section layer-options">
          <h3>Layer</h3>
          <Field
            label="Name"
            value={node.name}
            onCommit={(name) => editor.patch(node.id, { name })}
          />
          <div className="layer-option-buttons">
            <button disabled={isRoot || node.locked} onClick={editor.duplicate}>
              <Copy size={13} />
              Duplicate
            </button>
            <button disabled={isRoot || node.locked} onClick={editor.remove}>
              <Trash2 size={13} />
              Delete
            </button>
          </div>
        </section>
      </div>
      <button className="source-link" onClick={onCode}>
        <FileCode2 size={14} />
        <span>{editor.project.fileName}</span>
        <span>↗</span>
      </button>
      <div className="inspector-footer">
        <CircleHelp size={13} />
        <span>Changes stay local until you save.</span>
      </div>
    </aside>
  );
}
