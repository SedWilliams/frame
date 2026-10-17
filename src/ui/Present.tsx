/*
 * Present mode (▶). The page at a device size, scrolling for real, with hover
 * styles and animations on. Links to the app's own pages navigate between them,
 * the way Figma prototypes follow their connections. Esc closes.
 */

import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { currentPage, pagesOf, renderTarget, set, useEditor, workspace } from '../app/state';
import { matchesRoute } from '../core/render';
import { FrameView } from '../canvas/FrameView';
import { framePresets, mountIdOf } from '../canvas/Canvas';
import { Select } from './controls';

export function Present() {
  const route = useEditor((s) => s.presentRoute ?? currentPage(s)?.route ?? '/');
  const pages = useEditor((s) => pagesOf(s));
  const page = pages.find((p) => p.route === route) ?? pages.find((p) => matchesRoute(p.route, route)) ?? pages[0];
  const target = page ? { ...page.target, route } : undefined;
  const render = useEditor((s) => (target ? renderTarget(s, target) : undefined));
  const styles = useEditor((s) => workspace(s).styles(false));
  const mountId = useEditor((s) => mountIdOf(s.doc.text['index.html'], workspace(s).framework));
  const [device, setDevice] = useState(framePresets[1]);

  const onNavigate = useCallback(
    (href: string) => {
      if (!href || href.startsWith('#')) return;
      if (/^(https?:|mailto:|tel:)/.test(href)) {
        window.open(href, '_blank', 'noopener');
        return;
      }
      const path = href.split(/[?#]/)[0] || '/';
      const match = pages.find((p) => p.route === path) ?? pages.find((p) => matchesRoute(p.route, path));
      if (match) set({ presentRoute: path });
    },
    [pages],
  );

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        set({ presenting: false, presentRoute: null });
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, []);

  return (
    <div className="present" role="dialog" aria-label="Present">
      <header>
        <strong>{page?.name ?? 'Page'}</strong>
        <span className="route">{route}</span>
        <Select
          name="Device"
          value={device.name}
          options={framePresets.map((p) => [p.name, `${p.name} · ${p.width}×${p.height}`] as [string, string])}
          onChange={(name) => setDevice(framePresets.find((p) => p.name === name) ?? device)}
        />
        <button className="icon-button" aria-label="Close presentation" onClick={() => set({ presenting: false, presentRoute: null })}>
          <X size={16} />
        </button>
      </header>
      <div className="present-stage">
        <div className="present-device" style={{ width: device.width, height: device.height }}>
          {render && (
            <FrameView
              key={`${route}-${device.name}`}
              id="present"
              width={device.width}
              height={device.height}
              nodes={render.result.nodes}
              styles={styles}
              fonts={render.result.fonts}
              mountId={mountId}
              present
              onNavigate={onNavigate}
            />
          )}
        </div>
      </div>
    </div>
  );
}
