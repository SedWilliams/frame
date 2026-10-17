/*
 * The North Studio demo site.
 *
 * A small Next.js app, held in memory: a root layout with a shared nav and
 * footer, three pages, and components with props and variants. It loads
 * through the same code as a real project, so it exercises pages, layouts,
 * instances, `.map` over data, CSS variables, and next/link and next/image.
 * Its photos live in public/__frame/demo.
 */

const layout = `import './globals.css';
import { Nav } from '@/components/Nav';
import { Footer } from '@/components/Footer';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        {children}
        <Footer />
      </body>
    </html>
  );
}
`;

const home = `import Image from 'next/image';
import { Button } from '@/components/Button';
import { ProjectCard } from '@/components/ProjectCard';
import { projects } from '@/lib/projects';

const services = [
  { title: 'Interiors', body: 'Rooms planned around the way you actually live.' },
  { title: 'Renovation', body: 'Quiet, careful rebuilds that keep what works.' },
  { title: 'Furniture', body: 'Pieces made for the space, not the showroom.' },
];

export default function HomePage() {
  return (
    <main>
      <section data-layer="Hero" className="hero">
        <div data-layer="Hero content" style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 22 }}>
          <span className="eyebrow">Thoughtful spaces, everyday living</span>
          <h1 data-layer="Hero heading" className="display" style={{ fontSize: 64, lineHeight: 1.04, maxWidth: 440 }}>Good spaces. Better living.</h1>
          <p data-layer="Hero description" style={{ fontSize: 14, lineHeight: 1.8, color: 'var(--muted)', maxWidth: 300, margin: 0 }}>We create warm, considered interiors that feel like you. Beautiful by design. Better by nature.</p>
          <Button href="/work">Explore our projects ↗</Button>
        </div>
        <div data-layer="Hero image" style={{ position: 'relative', flex: '1 1 360px', minHeight: 420, overflow: 'hidden', borderRadius: 'var(--radius)' }}>
          <Image src="/images/interior.jpg" alt="Sunlit living room with natural textures and warm wood" fill style={{ objectFit: 'cover' }} />
          <div data-layer="Image caption" className="caption">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <strong style={{ fontSize: 12 }}>The quiet house</strong>
              <span className="eyebrow" style={{ letterSpacing: 1.2 }}>Residential · 2025</span>
            </div>
            <span style={{ fontSize: 20 }}>↗</span>
          </div>
        </div>
      </section>
      <section data-layer="Selected work" className="section">
        <div className="section-title">
          <h2 className="display" style={{ fontSize: 30 }}>A few places we've made home.</h2>
          <Button href="/work" variant="outline">All projects</Button>
        </div>
        <div data-layer="Project grid" style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          {projects.slice(0, 2).map((project) => (
            <ProjectCard key={project.title} {...project} />
          ))}
        </div>
      </section>
      <section data-layer="Services" className="section" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 32 }}>
        {services.map((service) => (
          <article key={service.title} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h3 style={{ fontSize: 15, margin: 0 }}>{service.title}</h3>
            <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--muted)', margin: 0 }}>{service.body}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
`;

const work = `import { ProjectCard } from '@/components/ProjectCard';
import { projects } from '@/lib/projects';

export default function WorkPage() {
  return (
    <main className="section" style={{ borderTop: 'none' }}>
      <span className="eyebrow">Selected work, 2021–25</span>
      <h1 className="display" style={{ fontSize: 48, margin: '16px 0 40px', maxWidth: 560 }}>Homes, studios, and the odd bakery.</h1>
      <div data-layer="All projects" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 32 }}>
        {projects.map((project) => (
          <ProjectCard key={project.title} {...project} />
        ))}
      </div>
    </main>
  );
}
`;

const studio = `import { Button } from '@/components/Button';

const team = [
  { name: 'Mara Lind', role: 'Founder, interiors' },
  { name: 'Jonah Reyes', role: 'Architecture' },
  { name: 'Ines Okafor', role: 'Furniture and objects' },
];

export default function StudioPage() {
  return (
    <main>
      <section className="section" style={{ borderTop: 'none', display: 'flex', gap: 48, flexWrap: 'wrap' }}>
        <h1 className="display" style={{ fontSize: 48, flex: '1 1 320px', margin: 0 }}>A small studio with a long view.</h1>
        <p style={{ flex: '1 1 320px', fontSize: 15, lineHeight: 1.8, color: 'var(--muted)', margin: 0 }}>
          North Studio started in a garage in Portland in 2014. We still take on a handful of homes a year, so every one gets our full attention.
        </p>
      </section>
      <section data-layer="Team" className="section">
        <h2 className="display" style={{ fontSize: 28, marginBottom: 24 }}>The people</h2>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 24 }}>
          {team.map((person) => (
            <li key={person.name} style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }}>
              <strong style={{ display: 'block', fontSize: 15 }}>{person.name}</strong>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>{person.role}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="section" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 className="display" style={{ fontSize: 28, margin: 0 }}>Have a space in mind?</h2>
        <Button href="mailto:hello@example.com">Let's talk ↗</Button>
      </section>
    </main>
  );
}
`;

const nav = `import Link from 'next/link';
import { Button } from '@/components/Button';

const links = [
  { href: '/work', label: 'Our work' },
  { href: '/studio', label: 'The studio' },
];

export function Nav() {
  return (
    <nav data-layer="Navigation" className="nav">
      <Link href="/" className="wordmark">
        north<span style={{ color: 'var(--accent)' }}>.</span>studio
      </Link>
      <div style={{ display: 'flex', alignItems: 'center', gap: 28, fontSize: 12 }}>
        {links.map((link) => (
          <Link key={link.href} href={link.href}>{link.label}</Link>
        ))}
        <Button href="mailto:hello@example.com" variant="outline">Let's talk ↗</Button>
      </div>
    </nav>
  );
}
`;

const footer = `export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer data-layer="Footer" className="footer">
      <span>© {year} North Studio · Portland, OR</span>
      <span>hello@example.com</span>
    </footer>
  );
}
`;

const button = `import Link from 'next/link';

interface ButtonProps {
  href: string;
  variant?: 'solid' | 'outline';
  children: React.ReactNode;
}

export function Button({ href, variant = 'solid', children }: ButtonProps) {
  return (
    <Link href={href} className={variant === 'solid' ? 'button' : 'button button-outline'}>
      {children}
    </Link>
  );
}
`;

const card = `import Image from 'next/image';

interface ProjectCardProps {
  title: string;
  category: string;
  year: number;
  image: string;
  tone?: 'light' | 'dark';
}

export function ProjectCard({ title, category, year, image, tone = 'light' }: ProjectCardProps) {
  return (
    <article className={tone === 'dark' ? 'card card-dark' : 'card'}>
      <div style={{ position: 'relative', height: 220, overflow: 'hidden', borderRadius: 'var(--radius)' }}>
        <Image src={image} alt={title} fill style={{ objectFit: 'cover' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 14 }}>
        <h3 style={{ fontSize: 15, margin: 0 }}>{title}</h3>
        <span className="eyebrow">{category} · {year}</span>
      </div>
    </article>
  );
}
`;

const data = `export const projects = [
  { title: 'The quiet house', category: 'Residential', year: 2025, image: '/images/interior.jpg' },
  { title: 'Alder kitchen', category: 'Renovation', year: 2024, image: '/images/kitchen.jpg' },
  { title: 'Fern street loft', category: 'Residential', year: 2023, image: '/images/kitchen.jpg', tone: 'dark' as const },
  { title: 'Morning bakery', category: 'Hospitality', year: 2022, image: '/images/interior.jpg' },
];
`;

const css = `:root {
  --ink: #293d32;
  --paper: #f8f7f2;
  --accent: #c97449;
  --muted: #7a8071;
  --line: #dedfd6;
  --radius: 3px;
  --serif: Georgia, 'Times New Roman', serif;
  --sans: Arial, Helvetica, sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: var(--sans);
}

a {
  color: inherit;
  text-decoration: none;
}

.display {
  font-family: var(--serif);
  font-weight: 400;
  letter-spacing: -0.03em;
  margin: 0;
}

.eyebrow {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 2.4px;
  text-transform: uppercase;
  color: #7e836e;
}

.nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 24px;
  padding: 28px 48px;
  border-bottom: 1px solid var(--line);
}

.wordmark {
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -0.8px;
}

.button {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 14px 20px;
  border-radius: var(--radius);
  background: var(--ink);
  color: #ffffff;
  font-size: 12px;
}

.button-outline {
  background: transparent;
  color: var(--ink);
  border: 1px solid #a3ab9c;
  border-radius: 30px;
  padding: 10px 18px;
}

.hero {
  display: flex;
  flex-wrap: wrap;
  gap: 40px;
  padding: 48px;
}

.caption {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 13px 16px;
  background: var(--paper);
  border-radius: 2px;
}

.section {
  padding: 48px;
  border-top: 1px solid var(--line);
}

.section-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.card {
  flex: 1 1 280px;
  display: flex;
  flex-direction: column;
}

.card-dark {
  background: var(--ink);
  color: var(--paper);
  padding: 12px;
  border-radius: var(--radius);
}

.footer {
  display: flex;
  justify-content: space-between;
  padding: 28px 48px;
  border-top: 1px solid var(--line);
  font-size: 11px;
  color: var(--muted);
}
`;

/** The demo's text files by path. */
export const demoFiles: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'north-studio', private: true, dependencies: { next: '15.5.0', react: '19.1.1', 'react-dom': '19.1.1' } }, null, 2),
  'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['./*'] } } }, null, 2),
  'app/globals.css': css,
  'app/layout.tsx': layout,
  'app/page.tsx': home,
  'app/work/page.tsx': work,
  'app/studio/page.tsx': studio,
  'components/Nav.tsx': nav,
  'components/Footer.tsx': footer,
  'components/Button.tsx': button,
  'components/ProjectCard.tsx': card,
  'lib/projects.ts': data,
};

/** The demo's images, by project path, pointing at Frame's own copies. */
export const demoAssets: Record<string, string> = {
  'public/images/interior.jpg': './__frame/demo/interior.jpg',
  'public/images/kitchen.jpg': './__frame/demo/kitchen.jpg',
};
