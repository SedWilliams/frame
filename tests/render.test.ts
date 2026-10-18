/*
 * Unit tests for whole-site rendering: page detection, import resolution, the
 * evaluator, and render trees. Each project is a handful of in-memory files.
 */

import { describe, expect, it } from 'vitest';
import { docFromFiles, Workspace, type ProjectConfig } from '../src/core/workspace';
import { renderPage, walkRender, type RNode } from '../src/core/render';
import { applyStyle } from '../src/app/edit';

function workspace(files: Record<string, string>) {
  const config: ProjectConfig = {
    name: 'test',
    paths: Object.keys(files),
    fileUrl: (path) => `/__frame/fs/${path}`,
    publicUrl: (path) => `/__frame/public${path}`,
  };
  return new Workspace(docFromFiles(files), config);
}

function render(ws: Workspace, route = '/') {
  const page = ws.pages().find((p) => p.route === route);
  if (!page) throw new Error(`no page at ${route}: ${ws.pages().map((p) => p.route).join(', ')}`);
  const result = renderPage(ws.at(route), page.target);
  if (result.error) throw new Error(result.error);
  return result;
}

function all(nodes: RNode[]) {
  const list: RNode[] = [];
  walkRender(nodes, (node) => list.push(node));
  return list;
}
const byTag = (nodes: RNode[], tag: string) => all(nodes).filter((n) => n.tag === tag);
const texts = (nodes: RNode[]) => all(nodes).flatMap((n) => (n.text !== undefined ? [n.text] : []));

const next = {
  'package.json': JSON.stringify({ dependencies: { next: '15.0.0', react: '19.0.0' } }),
  'tsconfig.json': `{
    // comments are allowed
    "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"] }, },
  }`,
  'src/app/globals.css': '@import "tailwindcss";\n:root { --brand: #e86b47; }\n',
  'src/app/layout.tsx': `import './globals.css';
import { Inter } from 'next/font/google';
import { Nav } from '@/components/nav';
const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Nav />
        {children}
      </body>
    </html>
  );
}`,
  'src/app/page.tsx': `import Link from 'next/link';
import Image from 'next/image';
import { Hero } from '@/components/hero';
import { Button } from '@/components/ui/button';
const features = [
  { title: 'Fast', body: 'Ships quickly.' },
  { title: 'Safe', body: 'Never breaks.' },
];
export default function Home() {
  const [open] = useState(false);
  return (
    <main className="p-8">
      <Hero title="Hello there" />
      <ul>
        {features.map((f) => (
          <li key={f.title} className="feature">{f.title}</li>
        ))}
      </ul>
      {open && <div className="modal">Modal</div>}
      <Link href="/about" className="link">About us</Link>
      <Image src="/hero.png" alt="Hero" width={400} height={300} />
      <Button variant="outline" size="lg">Get started</Button>
      <Button asChild><a href="/docs">Docs</a></Button>
    </main>
  );
}
import { useState } from 'react';`,
  'src/app/about/page.tsx': `export default function About() { return <section><h1>About</h1></section>; }`,
  'src/app/(marketing)/pricing/page.tsx': `export default function Pricing() { return <h1>Pricing</h1>; }`,
  'src/components/nav.tsx': `import { usePathname } from 'next/navigation';
export function Nav() {
  const pathname = usePathname();
  return <nav className={pathname === '/' ? 'nav home' : 'nav'}><a href="/">Home</a></nav>;
}`,
  'src/components/hero.tsx': `import { cn } from '@/lib/utils';
interface HeroProps { title: string; subtitle?: string; tone?: 'light' | 'dark' }
export function Hero({ title, subtitle = 'Default subtitle', tone = 'light' }: HeroProps) {
  return (
    <section className={cn('p-4 text-lg', tone === 'dark' && 'bg-black', 'p-8')}>
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </section>
  );
}`,
  'src/lib/utils.ts': `import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }`,
  'src/components/ui/button.tsx': `import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
const buttonVariants = cva('inline-flex items-center', {
  variants: {
    variant: { default: 'bg-primary text-white', outline: 'border bg-white' },
    size: { default: 'h-9 px-4', lg: 'h-10 px-8' },
  },
  defaultVariants: { variant: 'default', size: 'default' },
});
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
});
Button.displayName = 'Button';
export { Button, buttonVariants };`,
};

describe('Next.js app router', () => {
  const ws = workspace(next);

  it('finds pages, route groups, and their layouts', () => {
    const pages = ws.pages();
    expect(pages.map((p) => [p.name, p.route])).toEqual([
      ['Home', '/'],
      ['About', '/about'],
      ['Pricing', '/pricing'],
    ]);
    expect(pages[0].target.layouts).toEqual(['src/app/layout.tsx']);
  });

  it('renders the page inside its layout with html and body', () => {
    const { nodes, fonts } = render(ws);
    expect(nodes[0].tag).toBe('html');
    const body = byTag(nodes, 'body')[0];
    expect(body.props.className).toBe('frame-font-inter');
    expect(fonts.get('frame-font-inter')).toEqual({ family: 'Inter', variable: '--font-inter' });
    expect(body.source?.file).toBe('src/app/layout.tsx');
    // The nav comes from the layout, the main from the page.
    expect(byTag(nodes, 'nav')[0].props.className).toBe('nav home');
    expect(byTag(nodes, 'main')[0].source?.file).toBe('src/app/page.tsx');
  });

  it('renders components as instances with their props and defaults', () => {
    const { nodes } = render(ws);
    const hero = all(nodes).find((n) => n.kind === 'instance' && n.tag === 'Hero')!;
    expect(hero.component).toEqual({ file: 'src/components/hero.tsx', name: 'Hero' });
    expect(hero.source?.file).toBe('src/app/page.tsx');
    const [section] = hero.children;
    // twMerge drops the earlier p-4.
    expect(section.props.className).toBe('text-lg p-8');
    const h1 = byTag(hero.children, 'h1')[0];
    expect(h1.children[0].text).toBe('Hello there');
    // Text from a prop edits the prop at the call site.
    expect(h1.children[0].textSource).toMatchObject({ kind: 'attr', file: 'src/app/page.tsx', attr: 'title' });
    const p = byTag(hero.children, 'p')[0];
    expect(p.children[0].text).toBe('Default subtitle');
    expect(p.children[0].textSource).toMatchObject({ kind: 'literal', file: 'src/components/hero.tsx' });
  });

  it('renders .map output as repeated items whose text edits the data', () => {
    const { nodes } = render(ws);
    const items = byTag(nodes, 'li');
    expect(items.map((li) => li.children[0]?.text ?? li.text)).toEqual(['Fast', 'Safe']);
    expect(items.every((li) => li.repeated)).toBe(true);
    expect(new Set(items.map((li) => li.key)).size).toBe(2);
    const source = items[0].children[0].textSource;
    expect(source).toMatchObject({ kind: 'literal', file: 'src/app/page.tsx', start: next['src/app/page.tsx'].indexOf("'Fast'") });
  });

  it('uses initial hook state and known components', () => {
    const { nodes } = render(ws);
    expect(all(nodes).some((n) => n.props.className === 'modal')).toBe(false);
    const link = all(nodes).find((n) => n.tag === 'a' && n.props.className === 'link')!;
    expect(link.props.href).toBe('/about');
    expect(link.text).toBe('About us');
    expect(link.textSource).toMatchObject({ kind: 'text', file: 'src/app/page.tsx' });
    const img = byTag(nodes, 'img')[0];
    expect(img.props).toMatchObject({ src: '/__frame/public/hero.png', alt: 'Hero', width: 400, height: 300 });
  });

  it('renders shadcn buttons with cva variants and Slot', () => {
    const { nodes } = render(ws);
    const buttons = byTag(nodes, 'button');
    expect(buttons[0].props.className).toBe('inline-flex items-center border bg-white h-10 px-8');
    expect(buttons[0].text).toBe('Get started');
    // asChild merges the button classes into the anchor.
    const docs = all(nodes).find((n) => n.tag === 'a' && n.props.href === '/docs')!;
    expect(docs.props.className).toBe('inline-flex items-center bg-primary text-white h-9 px-4');
    expect(docs.source?.file).toBe('src/app/page.tsx');
  });

  it('reads cva variants as enum props', () => {
    const button = ws.components().find((c) => c.name === 'Button')!;
    expect(button.exportName).toBe('Button');
    expect(button.props.find((p) => p.name === 'variant')).toMatchObject({ type: 'enum', options: ['default', 'outline'], default: 'default' });
    expect(button.acceptsClassName).toBe(true);
    const hero = ws.components().find((c) => c.name === 'Hero')!;
    expect(hero.props.find((p) => p.name === 'tone')).toMatchObject({ type: 'enum', options: ['light', 'dark'], default: 'light' });
    expect(ws.sampleProps(hero)).toMatchObject({ title: 'Hello there' });
  });

  it('previews a component with the props a page passes it from data', () => {
    const ws = workspace({
      'package.json': JSON.stringify({ dependencies: { next: '15.0.0', react: '19.0.0' } }),
      'app/page.tsx': `import { Card } from '../components/card';
const projects = [{ title: 'Quiet house', image: '/house.jpg', tags: ['Residential'] }, { title: 'Loft', image: '/loft.jpg', tags: [] }];
export default function Home() {
  return <main>{projects.map((project) => <Card key={project.title} {...project} icon={<span />} />)}</main>;
}`,
      'components/card.tsx': `export function Card({ title, image, tags, icon }: { title: string; image: string; tags: string[]; icon: React.ReactNode }) {
  return <article><img src={image} alt={title} /><h3>{title}</h3>{icon}</article>;
}`,
    });
    const card = ws.components().find((c) => c.name === 'Card')!;
    // Plain data only: the JSX icon belongs to the page's render.
    expect(ws.sampleProps(card)).toEqual({ title: 'Quiet house', image: '/house.jpg', tags: ['Residential'] });
  });

  it('collects Tailwind sources for the canvas', () => {
    const styles = ws.styles();
    expect(styles.tailwind).toContain('@import "tailwindcss"');
    expect(styles.tailwind).toContain('--brand');
  });

  it('resolves aliases, relative paths, and index files', () => {
    expect(ws.resolve('src/app/page.tsx', '@/components/hero')).toBe('src/components/hero.tsx');
    expect(ws.resolve('src/app/page.tsx', '../lib/utils')).toBe('src/lib/utils.ts');
    expect(ws.resolve('src/app/page.tsx', 'react')).toBeUndefined();
  });
});

describe('React Router and Vite', () => {
  const files = {
    'package.json': JSON.stringify({ dependencies: { 'react-router-dom': '7', react: '19' }, devDependencies: { vite: '7' } }),
    'index.html': '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"><div id="root"></div>',
    'src/main.tsx': `import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
createRoot(document.getElementById('root')!).render(<BrowserRouter><App /></BrowserRouter>);`,
    'src/index.css': 'body { margin: 0; background: url(/bg.png); }',
    'src/App.tsx': `import { Routes, Route, NavLink, Outlet } from 'react-router-dom';
import Home from './pages/Home';
import Team from './pages/Team';
function Layout() {
  return <div className="shell"><nav><NavLink to="/" className={({ isActive }) => isActive ? 'on' : 'off'}>Home</NavLink></nav><Outlet /></div>;
}
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="team" element={<Team />} />
      </Route>
    </Routes>
  );
}`,
    'src/pages/Home.tsx': `import styles from './Home.module.css';
export default function Home() { return <h1 className={styles.title}>Welcome</h1>; }`,
    'src/pages/Home.module.css': '.title { color: red; } .title:hover { color: blue; }',
    'src/pages/Team.tsx': `const people = ['Ada', 'Grace'];
export default function Team() { return <ul>{people.map((name, i) => <li key={i}>{i + 1}. {name}</li>)}</ul>; }`,
  };
  const ws = workspace(files);

  it('turns routes into pages', () => {
    expect(ws.pages().map((p) => [p.name, p.route, p.file])).toEqual([
      ['Home', '/', 'src/pages/Home.tsx'],
      ['Team', '/team', 'src/pages/Team.tsx'],
    ]);
  });

  it('renders the matching route inside its layout', () => {
    const home = render(ws, '/').nodes;
    expect(home[0].props.className).toBe('shell');
    expect(byTag(home, 'a')[0].props.className).toBe('on');
    const h1 = byTag(home, 'h1')[0];
    expect(h1.props.className).toBe('Home_m__title');
    expect(h1.source?.file).toBe('src/pages/Home.tsx');
    const team = render(ws, '/team').nodes;
    expect(byTag(team, 'a')[0].props.className).toBe('off');
    expect(texts(team)).toEqual(expect.arrayContaining(['1', '. ', 'Ada', '2', 'Grace']));
  });

  it('scopes CSS modules and rewrites root URLs', () => {
    const styles = ws.styles();
    expect(styles.tailwind).toBeUndefined();
    expect(styles.links).toEqual(['https://fonts.googleapis.com/css2?family=Inter']);
    expect(styles.css.find((s) => s.path === 'src/index.css')?.text).toContain('url(/__frame/public/bg.png)');
    expect(styles.css.find((s) => s.path.endsWith('Home.module.css'))?.text).toBe('.Home_m__title { color: red; } .Home_m__title:hover { color: blue; }');
  });
});

describe('the evaluator', () => {
  it('handles defaults, conditionals, templates, and early returns', () => {
    const ws = workspace({
      'src/App.tsx': `const TONES = { warm: 'bg-orange', cool: 'bg-blue' } as const;
function Badge({ label, tone = 'warm', count }: { label: string; tone?: keyof typeof TONES; count?: number }) {
  if (count === undefined && label === 'skip') return null;
  return <span className={\`badge \${TONES[tone]}\`}>{label}{count ? \` (\${count})\` : ''}</span>;
}
export default function App() {
  const { data } = useQuery();
  if (data.loading) return <p>Loading…</p>;
  const year = new Date().getFullYear();
  return (
    <div>
      <Badge label="New" />
      <Badge label="Hot" tone="cool" count={3} />
      <footer>© {year} Studio</footer>
      {data.items.map((item) => <i>{item}</i>)}
    </div>
  );
}`,
    });
    const { nodes } = render(ws);
    const spans = byTag(nodes, 'span').filter((n) => String(n.props.className).startsWith('badge'));
    expect(spans.map((s) => s.props.className)).toEqual(['badge bg-orange', 'badge bg-blue']);
    expect(texts(spans[1].children)).toEqual(['Hot', ' (3)']);
    expect(texts(byTag(nodes, 'footer'))).toEqual(['© ', String(new Date().getFullYear()), ' Studio']);
    // Unknown data shows as a placeholder rather than disappearing.
    expect(all(nodes).some((n) => n.kind === 'placeholder' && n.name.includes('data.items.map'))).toBe(true);
  });

  it('stops runaway recursion and loops', () => {
    const ws = workspace({
      'src/App.tsx': `function Tree({ depth }: { depth: number }) { return <div><Tree depth={depth + 1} /></div>; }
function loop() { for (;;) {} }
export default function App() { loop(); return <main><Tree depth={0} /></main>; }`,
    });
    const { nodes } = render(ws);
    expect(all(nodes).some((n) => n.name === 'Recursive component')).toBe(true);
  });
});

describe('edited renders', () => {
  it('previews a style set on a run of mixed text, which exports as a span', () => {
    const ws = workspace({
      'package.json': JSON.stringify({ dependencies: { react: '19' }, devDependencies: { vite: '7' } }),
      'src/main.tsx': `import { createRoot } from 'react-dom/client';
import App from './App';
createRoot(document.getElementById('root')!).render(<App />);`,
      'src/App.tsx': 'export default function App() { return <h2 className="italic">Before <strong>bold</strong></h2>; }',
    });
    const run = all(render(ws).nodes).find((n) => n.kind === 'text' && n.text === 'Before ')!;
    expect(run.props.style).toBeUndefined();
    const doc = applyStyle(ws.doc, ws.config, run.source!, { fontStyle: 'normal' }, 'inline');
    const edited = all(render(new Workspace(doc, ws.config)).nodes).find((n) => n.text === 'Before ');
    expect(edited?.props.style).toEqual({ fontStyle: 'normal' });
  });
});
