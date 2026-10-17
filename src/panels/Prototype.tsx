/*
 * The Prototype tab.
 *
 * Figma's interactions, mapped to what a site has: a link's destination (a page,
 * a section on this page, or a URL), whether it opens in a new tab, how a layer
 * behaves when the page scrolls (fixed or sticky), and whether it scrolls its
 * own overflow. Present (▶) follows these links between pages.
 */

import { ArrowRight, Link2, Play } from 'lucide-react';
import { selectedNodes, setAttr, setStyle, wrapSelection } from '../app/actions';
import { pagesOf, set, useEditor } from '../app/state';
import { computedOf } from '../canvas/registry';
import { Checkbox, NumberField, Section, Select, TextField } from '../ui/controls';
import { useInspect } from './inspect';

export function PrototypePanel() {
  const info = useInspect();
  const pages = useEditor((s) => pagesOf(s));
  if (!info) return null;
  const node = info.primary;
  const link = node.tag === 'a' ? node : undefined;
  const href = link ? String(link.props.href ?? '') : '';
  const linkTarget = info.tree?.dyn?.attrs?.href !== undefined ? 'dynamic' : href;
  const pageMatch = pages.find((p) => p.route === href);
  const destination = !link ? 'none' : linkTarget === 'dynamic' ? 'dynamic' : pageMatch ? `page:${pageMatch.route}` : href.startsWith('#') ? 'anchor' : 'url';
  const c = computedOf(info.frame, node.key);
  const position = c?.position ?? 'static';
  const overflow = c?.overflowY === 'auto' || c?.overflowY === 'scroll' ? (c?.overflowX === 'auto' || c?.overflowX === 'scroll' ? 'both' : 'vertical') : c?.overflowX === 'auto' || c?.overflowX === 'scroll' ? 'horizontal' : 'none';
  const keys = info.nodes.map((n) => n.key);
  return (
    <div className="prototype-tab">
      <Section title="Interactions" id="interactions">
        {link ? (
          <>
            <div className="interaction">
              <span className="trigger">On click</span>
              <ArrowRight size={12} />
              <span>Navigate to</span>
            </div>
            {destination === 'dynamic' ? (
              <p className="hint">This link's destination is computed in code.</p>
            ) : (
              <>
                <Select
                  name="Link destination"
                  value={destination}
                  options={[...pages.map((p) => [`page:${p.route}`, `${p.name} (${p.route})`] as [string, string]), ['anchor', 'Section on this page'], ['url', 'URL']]}
                  onChange={(v) => {
                    if (v.startsWith('page:')) setAttr('href', v.slice(5), [node.key]);
                    else if (v === 'anchor') setAttr('href', '#', [node.key]);
                    else setAttr('href', 'https://', [node.key]);
                  }}
                />
                {(destination === 'url' || destination === 'anchor') && <TextField name="Link URL" value={href} onCommit={(v) => setAttr('href', v || '#', [node.key])} />}
                <Checkbox label="Open in new tab" checked={link.props.target === '_blank'} onChange={(on) => {
                  setAttr('target', on ? '_blank' : null, [node.key]);
                  setAttr('rel', on ? 'noreferrer' : null, [node.key]);
                }} />
              </>
            )}
          </>
        ) : (
          <>
            <p className="hint">Links are how a site's pages connect. Wrap this layer in a link to make it navigate.</p>
            <button className="secondary-button wide" disabled={!selectedNodes().some((n) => n.source && !n.repeated)} onClick={() => wrapSelection('link')}>
              <Link2 size={13} /> Wrap in link
            </button>
          </>
        )}
      </Section>
      <Section title="Scroll behavior" id="scroll">
        <Select
          name="Position when scrolling"
          value={position === 'fixed' ? 'fixed' : position === 'sticky' ? 'sticky' : 'scroll'}
          disabled={!info.stylable}
          options={[['scroll', 'Scroll with parent'], ['sticky', 'Sticky'], ['fixed', 'Fixed']]}
          onChange={(v) => setStyle(v === 'scroll' ? { position: null, top: null } : { position: v, top: 0 }, keys, 'scroll-position')}
        />
        {(position === 'sticky' || position === 'fixed') && (
          <NumberField label="Top" value={parseFloat(c?.top ?? '0') || 0} disabled={!info.stylable} onCommit={(v) => setStyle({ top: v === '' ? null : v }, keys, 'scroll-top')} />
        )}
        <Select
          name="Overflow scrolling"
          value={overflow}
          disabled={!info.stylable}
          options={[['none', 'No scrolling'], ['vertical', 'Vertical'], ['horizontal', 'Horizontal'], ['both', 'Both directions']]}
          onChange={(v) =>
            setStyle(
              v === 'none' ? { overflow: null, overflowX: null, overflowY: null } : v === 'vertical' ? { overflowY: 'auto', overflowX: null, overflow: null } : v === 'horizontal' ? { overflowX: 'auto', overflowY: null, overflow: null } : { overflow: 'auto', overflowX: null, overflowY: null },
              keys,
              'overflow',
            )
          }
        />
      </Section>
      <button className="secondary-button wide" onClick={() => set({ presenting: true, presentRoute: null })}>
        <Play size={13} /> Present
      </button>
    </div>
  );
}
