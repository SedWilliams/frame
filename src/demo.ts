/*
 * The North Studio demo page.
 *
 * The demo is ordinary JSX source that loads through importSource like any user
 * file, so it runs the real import and export path. data-layer attributes give its
 * layers readable names. Its images live in public/images.
 */

import { importSource } from './source';

export const demoSource = `export default function HomePage() {
  return (
    <main data-layer="Home page" style={{ backgroundColor: '#f8f7f2', color: '#293d32', fontFamily: 'Arial, sans-serif', minHeight: 780 }}>
      <nav data-layer="Navigation" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '28px 42px', borderBottom: '1px solid #dedfd6', gap: 24, flexWrap: 'wrap' }}>
        <a data-layer="Studio wordmark" href="#" style={{ fontSize: 19, fontWeight: 700, letterSpacing: -0.8, color: '#293d32', textDecoration: 'none' }}>north<span style={{ color: '#c97449' }}>.</span>studio</a>
        <div data-layer="Navigation links" style={{ display: 'flex', alignItems: 'center', gap: 29, fontSize: 12 }}>
          <a href="#work" style={{ color: '#293d32', textDecoration: 'none' }}>Our work</a>
          <a href="#about" style={{ color: '#293d32', textDecoration: 'none' }}>The studio</a>
          <a href="mailto:hello@example.com" style={{ color: '#293d32', textDecoration: 'none', border: '1px solid #a3ab9c', borderRadius: 30, padding: '10px 19px' }}>Let's talk ↗</a>
        </div>
      </nav>
      <section data-layer="Hero section" style={{ display: 'flex', padding: '48px 42px 42px', gap: 36, alignItems: 'stretch', flexWrap: 'wrap' }}>
        <div data-layer="Hero content" style={{ flex: '1 1 310px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', padding: '20px 0' }}>
          <div data-layer="Eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 23 }}>
            <span style={{ width: 6, height: 6, backgroundColor: '#be7855', borderRadius: 10 }} />
            <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: 2.4, color: '#7e836e' }}>THOUGHTFUL SPACES, EVERYDAY LIVING</span>
          </div>
          <h1 data-layer="Hero heading" style={{ fontFamily: 'Georgia, serif', fontSize: 64, fontWeight: 400, lineHeight: 1.04, letterSpacing: -2.8, color: '#293d32', margin: '0 0 22px', maxWidth: 400 }}>Good spaces. Better living.</h1>
          <p data-layer="Hero description" style={{ fontSize: 13, lineHeight: 1.85, color: '#7a8071', margin: '0 0 28px', maxWidth: 285 }}>We create warm, considered interiors that feel like you. Beautiful by design. Better by nature.</p>
          <a data-layer="Explore projects button" href="#work" style={{ display: 'inline-flex', gap: 32, alignItems: 'center', backgroundColor: '#293d32', color: '#ffffff', textDecoration: 'none', fontSize: 11, padding: '16px 21px', borderRadius: 3 }}>Explore our projects ↗</a>
          <div data-layer="Studio location" style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 36, color: '#8a8f80', fontSize: 10 }}>
            <span style={{ width: 20, height: 1, backgroundColor: '#a1a793' }} />
            <span>Independent design studio · Portland, OR</span>
          </div>
        </div>
        <div data-layer="Hero image frame" style={{ position: 'relative', flex: '1 1 340px', minHeight: 420, overflow: 'hidden', borderRadius: 3 }}>
          <img data-layer="Living room image" src="/images/interior.jpg" alt="Sunlit living room with natural textures and warm wood" style={{ width: '100%', height: 420, objectFit: 'cover', display: 'block' }} />
          <div data-layer="Image caption" style={{ position: 'absolute', bottom: 17, left: 17, right: 17, backgroundColor: '#f8f7f2', padding: '13px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: 2 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 600 }}>The quiet house</span>
              <span style={{ fontSize: 9, color: '#898e80' }}>RESIDENTIAL · 2025</span>
            </div>
            <span style={{ fontSize: 20 }}>↗</span>
          </div>
        </div>
      </section>
      <section data-layer="Selected work" id="work" style={{ padding: '25px 42px 40px', borderTop: '1px solid #dedfd6' }}>
        <div data-layer="Section title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
          <h2 style={{ fontFamily: 'Georgia, serif', fontSize: 28, fontWeight: 400, margin: 0, letterSpacing: -0.7 }}>A few places we've made home.</h2>
          <span style={{ fontSize: 10, color: '#7a8071' }}>SELECTED WORK, 2024–25 ↗</span>
        </div>
        <div data-layer="Project gallery" style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <img data-layer="Kitchen project" src="/images/kitchen.jpg" alt="Natural wood and stone kitchen" style={{ flex: '1 1 240px', width: '46%', height: 180, objectFit: 'cover', borderRadius: 3 }} />
          <img data-layer="Living room project" src="/images/interior.jpg" alt="Thoughtfully furnished living room" style={{ flex: '1 1 240px', width: '46%', height: 180, objectFit: 'cover', objectPosition: 'center 70%', borderRadius: 3 }} />
        </div>
      </section>
    </main>
  );
}
`;

/** A fresh copy of the demo. Used on first load and by Reset to demo. */
export function makeDemo() {
  return { ...importSource(demoSource, 'HomePage.tsx'), name: 'North Studio' };
}
