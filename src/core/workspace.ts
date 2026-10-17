/*
 * The workspace.
 *
 * A Workspace wraps one Doc, the editable state of every file, and answers the
 * questions the rest of Frame asks about the project: how an import resolves,
 * which files are pages and which layouts wrap them, what components exist, and
 * which stylesheets the canvas should load. It also implements the evaluator's
 * Program interface, so rendering a page goes through it.
 *
 * Workspaces are cheap. The editor makes a new one for every Doc, and parse
 * results are cached by file text, so only edited files are parsed again.
 */

import * as t from '@babel/types';
import type { Doc, EditorNode, FileDoc } from './model';
import { allNodes } from './model';
import { parseFile, walk, type ComponentInfo, type FileInfo, type PropInfo } from './parse';
import { printFile } from './print';
import type { Framework, Program } from './evaluate';
import { isRecord, prim, type Value } from './values';
import { Renderer, type PageTarget } from './render';
import {
  dirname,
  forceColorScheme,
  inlineImports,
  joinTailwindSources,
  joinPath,
  moduleClasses,
  moduleClassName,
  needsTailwind,
  rewriteUrls,
  scopeModule,
  tailwindSource,
} from './cssfile';

/** What the backend tells Frame about the project, beyond file contents. */
export interface ProjectConfig {
  name: string;
  /** Absolute path on disk, for "open in editor" links. Unset in the browser. */
  root?: string;
  /** Every file path in the project, including images and fonts. */
  paths: string[];
  /** A URL the canvas can load for a project file such as an imported image. */
  fileUrl(path: string): string | undefined;
  /** A URL for a root-relative path such as /images/a.jpg, served from the public folder. */
  publicUrl(path: string): string | undefined;
}

export interface PageDef {
  id: string;
  name: string;
  route: string;
  /** The file that defines the page's own content. */
  file: string;
  target: PageTarget;
}

export interface ComponentEntry {
  id: string;
  file: string;
  /** Local name in its file. */
  name: string;
  /** How other files import it: `default` or the export name. Undefined if not exported. */
  exportName?: string;
  props: PropInfo[];
  acceptsClassName: boolean;
}

export interface StyleSet {
  /** Plain stylesheets in load order. */
  css: { path: string; text: string }[];
  /** Source for Tailwind's browser compiler, when the project uses Tailwind. */
  tailwind?: string;
  /** Remote stylesheets, such as Google Fonts, from index.html. */
  links: string[];
}

const codeFile = /\.(tsx|jsx|ts|js|mjs|cjs|mts|cts)$/i;
const extensions = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs'];
const imageFile = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)$/i;
const mediaFile = /\.(mp4|webm|ogg|mp3|wav|woff2?|ttf|otf|eot)$/i;

/** Parse results by path, reused while the file's text doesn't change. */
const parseCache = new Map<string, { source: string; info: FileInfo }>();
export function parsed(path: string, source: string): FileInfo {
  const hit = parseCache.get(path);
  if (hit && hit.source === source) return hit.info;
  const info = parseFile(path, source);
  parseCache.set(path, { source, info });
  return info;
}

/** Current nodes by origin, per FileDoc. */
const nodeCache = new WeakMap<FileDoc, Map<number, EditorNode>>();
function nodeIndex(file: FileDoc, info: FileInfo) {
  let map = nodeCache.get(file);
  if (!map) {
    map = new Map();
    for (const [offset, pristine] of info.roots)
      for (const node of allNodes(file.roots[offset] ?? pristine))
        if (node.origin !== undefined && !map.has(node.origin)) map.set(node.origin, node);
    nodeCache.set(file, map);
  }
  return map;
}

/** JSON with comments and trailing commas, as tsconfig allows. */
export function parseJSONC(text: string): unknown {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 1;
    } else out += c;
  }
  try {
    return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
  } catch {
    return undefined;
  }
}

interface Alias {
  /** `@/` for `@/*`, or the whole specifier for exact aliases. */
  prefix: string;
  exact: boolean;
  targets: string[];
}

export class Workspace implements Program {
  route = '/';
  private pathSet: Set<string>;

  constructor(
    readonly doc: Doc,
    readonly config: ProjectConfig,
  ) {
    this.pathSet = new Set([...config.paths, ...Object.keys(doc.code), ...Object.keys(doc.text)]);
  }

  /** The same workspace, rendering at a route. */
  at(route: string): Workspace {
    const workspace = new Workspace(this.doc, this.config);
    workspace.route = route;
    workspace.pathSet = this.pathSet;
    workspace.memo = this.memo;
    return workspace;
  }

  private memo = new Map<string, unknown>();
  private cached<T>(key: string, make: () => T): T {
    if (!this.memo.has(key)) this.memo.set(key, make());
    return this.memo.get(key) as T;
  }

  has(path: string) {
    return this.pathSet.has(path);
  }

  info(path: string): FileInfo | undefined {
    const file = this.doc.code[path];
    return file ? parsed(path, file.base) : undefined;
  }

  literal(path: string, start: number) {
    return this.doc.code[path]?.literals[start];
  }

  node(path: string, origin: number) {
    const file = this.doc.code[path];
    const info = this.info(path);
    return file && info ? nodeIndex(file, info).get(origin) : undefined;
  }

  /** The current tree of a root, edits included. */
  root(path: string, origin: number): EditorNode | undefined {
    return this.doc.code[path]?.roots[origin] ?? this.info(path)?.roots.get(origin);
  }

  /** The file's text with edits applied. */
  print(path: string): string {
    const file = this.doc.code[path];
    if (!file) return this.doc.text[path] ?? '';
    return printFile(this.info(path)!, file);
  }

  publicUrl(url: string): string | undefined {
    const value = url.trim();
    if (/^(https?:)?\/\//i.test(value) || /^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml)[;,]/i.test(value) || value.startsWith('#'))
      return value;
    if (/^(mailto|tel):/i.test(value)) return value;
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return undefined;
    if (value.startsWith('/')) return this.config.publicUrl(value) ?? value;
    return value;
  }

  get framework(): Framework {
    return this.cached('framework', () => {
      const pkg = parseJSONC(this.doc.text['package.json'] ?? '') as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | undefined;
      const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
      const paths = [...this.pathSet];
      if (deps.next || paths.some((p) => /^(src\/)?app\/(.+\/)?page\.[jt]sx?$/.test(p))) {
        return paths.some((p) => /^(src\/)?app\/(.+\/)?page\.[jt]sx?$/.test(p)) ? 'next-app' : 'next-pages';
      }
      if (deps['react-router-dom'] || deps['react-router']) return 'react-router';
      if (deps.vite || paths.some((p) => /^vite\.config\./.test(p))) return 'vite';
      return 'unknown';
    });
  }

  /** Import aliases from tsconfig or jsconfig paths, and Vite's resolve.alias. */
  private get aliases(): { aliases: Alias[]; baseUrl?: string } {
    return this.cached('aliases', () => {
      const aliases: Alias[] = [];
      let baseUrl: string | undefined;
      for (const name of ['tsconfig.json', 'tsconfig.app.json', 'jsconfig.json']) {
        const config = parseJSONC(this.doc.text[name] ?? '') as { compilerOptions?: { paths?: Record<string, string[]>; baseUrl?: string } } | undefined;
        const options = config?.compilerOptions;
        if (!options) continue;
        const base = joinPath('', options.baseUrl ?? '.');
        if (options.baseUrl !== undefined) baseUrl ??= base;
        for (const [pattern, targets] of Object.entries(options.paths ?? {})) {
          const exact = !pattern.endsWith('*');
          aliases.push({
            prefix: exact ? pattern : pattern.slice(0, -1),
            exact,
            targets: targets.map((target) => {
              const joined = joinPath(base, exact ? target : target.replace(/\*$/, ''));
              return exact ? joined : joined ? `${joined}/` : '';
            }),
          });
        }
      }
      // vite.config: alias: { '@': path.resolve(__dirname, './src') } and the like.
      const viteConfig = Object.keys(this.doc.code).find((p) => /^vite\.config\.[cm]?[jt]s$/.test(p));
      const vite = viteConfig ? this.info(viteConfig)?.ast : undefined;
      if (vite)
        walk(vite.program, (node) => {
          if (!t.isObjectProperty(node) || !t.isIdentifier(node.key, { name: 'alias' })) return;
          const pairs: [string, t.Node][] = [];
          if (t.isObjectExpression(node.value))
            for (const prop of node.value.properties)
              if (t.isObjectProperty(prop)) {
                const key = t.isStringLiteral(prop.key) ? prop.key.value : t.isIdentifier(prop.key) ? prop.key.name : undefined;
                if (key) pairs.push([key, prop.value]);
              }
          if (t.isArrayExpression(node.value))
            for (const entry of node.value.elements)
              if (t.isObjectExpression(entry)) {
                const find = entry.properties.find((p) => t.isObjectProperty(p) && t.isIdentifier(p.key, { name: 'find' })) as t.ObjectProperty | undefined;
                const replacement = entry.properties.find((p) => t.isObjectProperty(p) && t.isIdentifier(p.key, { name: 'replacement' })) as t.ObjectProperty | undefined;
                if (find && replacement && t.isStringLiteral(find.value)) pairs.push([find.value.value, replacement.value]);
              }
          for (const [key, value] of pairs) {
            // The last string literal in the expression is the path, as in path.resolve(__dirname, './src').
            let target: string | undefined;
            walk(value, (inner) => {
              if (t.isStringLiteral(inner)) target = inner.value;
            });
            if (target === undefined) continue;
            const dir = joinPath('', target.replace(/^\//, ''));
            aliases.push({ prefix: `${key}/`, exact: false, targets: [dir ? `${dir}/` : ''] });
            aliases.push({ prefix: key, exact: true, targets: [dir] });
          }
          return false;
        });
      aliases.sort((a, b) => b.prefix.length - a.prefix.length);
      return { aliases, baseUrl };
    });
  }

  /** The project file an import specifier points to. */
  resolve(from: string, spec: string): string | undefined {
    const clean = spec.split('?')[0];
    const bases: string[] = [];
    if (clean.startsWith('.')) bases.push(joinPath(dirname(from), clean));
    else if (clean.startsWith('/')) bases.push(clean.slice(1));
    else {
      const { aliases, baseUrl } = this.aliases;
      for (const alias of aliases) {
        if (alias.exact ? clean === alias.prefix : clean.startsWith(alias.prefix))
          for (const target of alias.targets) bases.push(alias.exact ? target : target + clean.slice(alias.prefix.length));
      }
      // Next.js and shadcn projects lean on `@/` even without a config Frame can read.
      if (clean.startsWith('@/') && !aliases.some((a) => a.prefix === '@/')) bases.push(`src/${clean.slice(2)}`, clean.slice(2));
      if (baseUrl !== undefined) bases.push(joinPath(baseUrl, clean));
    }
    for (const base of bases) {
      if (this.pathSet.has(base) && !this.isDirectoryLike(base)) return base;
      for (const ext of extensions) if (this.pathSet.has(base + ext)) return base + ext;
      for (const ext of extensions) if (this.pathSet.has(`${base}/index${ext}`)) return `${base}/index${ext}`;
    }
  }

  private isDirectoryLike(path: string) {
    return !/\.[a-z0-9]+$/i.test(path);
  }

  assetImport(path: string, imported: string, local: string): Value | undefined {
    if (/\.module\.(css|scss|sass|less)$/i.test(path)) {
      const classes: Record<string, Value> = {};
      for (const name of moduleClasses(this.doc.text[path] ?? '')) classes[name] = moduleClassName(path, name);
      return imported === 'default' || imported === '*' ? classes : classes[imported];
    }
    if (/\.(css|scss|sass|less)$/i.test(path)) return {};
    if (imageFile.test(path) || mediaFile.test(path)) {
      const url = this.config.fileUrl(path) ?? '';
      // An SVG imported under a capitalized name is an SVGR component. Draw it as an image.
      if (/\.svg$/i.test(path) && /^[A-Z]/.test(local)) return { $svg: url };
      if (this.framework.startsWith('next') && imageFile.test(path)) return { src: url, width: undefined, height: undefined };
      return url;
    }
    if (/\.json$/i.test(path)) return toValue(parseJSONC(this.doc.text[path] ?? 'null'));
    if (!codeFile.test(path)) return {};
  }

  /** The pages Frame shows in the Pages panel, in route order. */
  pages(): PageDef[] {
    return this.cached('pages', () => {
      const code = Object.keys(this.doc.code);
      const pages: PageDef[] = [];
      const layoutFor = (dir: string) =>
        extensions.map((ext) => `${dir}/layout${ext}`).find((p) => this.pathSet.has(p));

      // Next.js app router.
      for (const file of code) {
        const m = /^((?:src\/)?app)\/(?:(.+)\/)?page\.[jt]sx?$/.exec(file);
        if (!m) continue;
        const segments = (m[2] ?? '').split('/').filter(Boolean);
        if (segments.some((s) => s.startsWith('_') || s.startsWith('@'))) continue;
        const route = `/${segments.filter((s) => !/^\(.*\)$/.test(s)).join('/')}`;
        const layouts: string[] = [];
        let dir = m[1];
        const rootLayout = layoutFor(dir);
        if (rootLayout) layouts.push(rootLayout);
        for (const segment of segments) {
          dir += `/${segment}`;
          const layout = layoutFor(dir);
          if (layout) layouts.push(layout);
        }
        pages.push({ id: `page:${file}`, name: pageName(route), route, file, target: { kind: 'next-app', file, exportName: 'default', route, layouts } });
      }

      // Next.js pages router.
      const app = code.find((p) => /^(src\/)?pages\/_app\.[jt]sx?$/.test(p));
      for (const file of code) {
        const m = /^(?:src\/)?pages\/(.+)\.[jt]sx?$/.exec(file);
        if (!m || m[1].startsWith('api/') || /(^|\/)_/.test(m[1]) || pages.some((p) => p.file === file)) continue;
        if (this.framework !== 'next-pages' && this.framework !== 'next-app') continue;
        const route = `/${m[1].replace(/(^|\/)index$/, '')}`.replace(/\/$/, '') || '/';
        pages.push({ id: `page:${file}`, name: pageName(route), route, file, target: { kind: 'next-pages', file, exportName: 'default', route, app } });
      }

      // React Router, from <Routes> trees.
      if (!pages.length) pages.push(...this.routerPages());

      // A single-page app: whatever main.tsx renders, else App.
      if (!pages.length) {
        const entry = this.entryComponent();
        if (entry)
          pages.push({ id: `page:${entry.file}`, name: entry.name === 'App' ? 'App' : entry.name, route: '/', file: entry.file, target: { kind: 'component', file: entry.file, exportName: entry.exportName, route: '/' } });
      }
      return pages.sort((a, b) => (a.route === '/' ? -1 : b.route === '/' ? 1 : a.route.localeCompare(b.route)));
    });
  }

  /** The component main.tsx or index.tsx renders, following its import. */
  private entryComponent(): { file: string; exportName: string; name: string } | undefined {
    const entries = ['src/main.tsx', 'src/main.jsx', 'src/index.tsx', 'src/index.jsx', 'src/main.ts', 'src/main.js', 'src/index.js', 'main.tsx', 'index.tsx'];
    for (const entry of entries) {
      const info = this.doc.code[entry] && this.info(entry);
      if (!info?.ast) continue;
      let tag: string | undefined;
      walk(info.ast.program, (node) => {
        if (!tag && t.isCallExpression(node) && t.isMemberExpression(node.callee) && t.isIdentifier(node.callee.property, { name: 'render' })) {
          walk(node, (inner) => {
            if (!tag && t.isJSXElement(inner) && t.isJSXIdentifier(inner.openingElement.name)) {
              const name = inner.openingElement.name.name;
              if (/^[A-Z]/.test(name) && !/^(StrictMode|React|Provider|BrowserRouter|HashRouter)$/.test(name)) tag = name;
            }
          });
        }
      });
      const binding = tag ? info.imports.get(tag) : undefined;
      if (tag && binding) {
        const file = this.resolve(entry, binding.source);
        if (file) return { file, exportName: binding.imported, name: tag };
      }
    }
    const app = ['src/App.tsx', 'src/App.jsx', 'src/app.tsx', 'App.tsx', 'src/App.js'].find((p) => this.doc.code[p]);
    if (app) return { file: app, exportName: this.info(app)?.exports.has('default') ? 'default' : 'App', name: 'App' };
  }

  /** Pages from React Router's <Routes>, with the component that renders them as the shell. */
  private routerPages(): PageDef[] {
    const pages: PageDef[] = [];
    for (const file of Object.keys(this.doc.code)) {
      const source = this.doc.code[file].base;
      if (!source.includes('<Routes') || !source.includes('<Route')) continue;
      const info = this.info(file);
      if (!info) continue;
      for (const root of info.roots.values()) {
        for (const routes of allNodes(root).filter((n) => n.kind === 'element' && n.tag === 'Routes')) {
          const shellName = [...info.components.values()].find((c) => c.fn.start! <= routes.origin! && c.fn.end! >= routes.origin!)?.name;
          const exportName = shellName ? exportNameOf(info, shellName) : undefined;
          if (!shellName || !exportName) continue;
          const visit = (nodes: EditorNode[], base: string) => {
            for (const node of nodes) {
              if (node.kind === 'fragment') visit(node.children, base);
              if (node.kind !== 'element' || node.tag !== 'Route') continue;
              const index = node.dyn?.attrs?.index !== undefined || node.attrs.index !== undefined;
              const path = node.attrs.path ?? '';
              const route = index ? base : path.startsWith('/') ? path : `${base.replace(/\/$/, '')}/${path}`;
              const elementOffset = node.dyn?.attrs?.element;
              const element = elementOffset !== undefined && elementOffset >= 0 ? info.roots.get(elementOffset) : undefined;
              const component = element?.kind === 'element' ? element.tag : undefined;
              const binding = component ? info.imports.get(component) : undefined;
              const pageFile = binding ? this.resolve(file, binding.source) : undefined;
              if (element && (index || path) && !node.children.length && !route.includes('*'))
                pages.push({
                  id: `route:${route}`,
                  name: component && component !== 'Navigate' ? splitWords(component) : pageName(route),
                  route: route || '/',
                  file: pageFile ?? file,
                  target: { kind: 'react-router', file: pageFile ?? file, exportName: binding?.imported ?? 'default', route: route || '/', shell: { file, exportName } },
                });
              visit(node.children, route || base);
            }
          };
          visit(routes.children, '/');
        }
      }
      if (pages.length) break;
    }
    return pages.filter((page, i) => pages.findIndex((p) => p.route === page.route) === i);
  }

  /** Every component defined in the project, for the Assets panel and the Components page. */
  components(): ComponentEntry[] {
    return this.cached('components', () => {
      const entries: ComponentEntry[] = [];
      for (const file of Object.keys(this.doc.code).sort()) {
        if (!/\.(tsx|jsx|js)$/.test(file) || /(^|\/)(node_modules|\.next)\//.test(file)) continue;
        if (/^(src\/)?app\/(.+\/)?(page|layout|template|loading|error|not-found|global-error|default)\.[jt]sx?$/.test(file)) continue;
        if (/^(src\/)?pages\//.test(file) && this.framework.startsWith('next')) continue;
        if (/(^|\/)(main|index)\.[jt]sx?$/.test(file) && /createRoot|ReactDOM/.test(this.doc.code[file].base)) continue;
        const info = this.info(file);
        if (!info) continue;
        for (const component of info.components.values()) {
          if (!returnsJSX(component)) continue;
          entries.push({
            id: `${file}#${component.name}`,
            file,
            name: component.name === 'default' ? fileComponentName(file) : component.name,
            exportName: exportNameOf(info, component.name),
            props: component.props,
            acceptsClassName: component.acceptsClassName,
          });
        }
      }
      return entries;
    });
  }

  /**
   * Props to preview a component with, over its defaults: what the first page
   * that renders it passes, else the literal props at its first call site.
   */
  sampleProps(entry: ComponentEntry): Record<string, Value> {
    const props: Record<string, Value> = {};
    for (const prop of entry.props) {
      if (prop.default !== undefined) props[prop.name] = prop.default;
      else if (prop.type === 'enum' && prop.options?.length) props[prop.name] = prop.options[0];
      else if (prop.type === 'string' && /title|label|name|heading|text/i.test(prop.name)) props[prop.name] = splitWords(prop.name);
    }
    // Entry ids are `file#localName`.
    const fn = this.info(entry.file)?.components.get(entry.id.slice(entry.file.length + 1))?.fn;
    const rendered = fn && this.firstCall(fn);
    if (rendered) {
      for (const [name, value] of Object.entries(rendered)) {
        const plain = plainValue(value);
        if (plain !== undefined) props[name] = plain;
      }
      return props;
    }
    for (const file of Object.keys(this.doc.code)) {
      const info = this.info(file);
      if (!info) continue;
      const local = [...info.imports.values()].find((b) => (b.imported === entry.exportName || (b.imported === 'default' && entry.exportName === 'default')) && this.resolve(file, b.source) === entry.file)?.local;
      if (!local) continue;
      for (const root of info.roots.values()) {
        const call = allNodes(root).find((n) => n.kind === 'element' && n.tag === local);
        if (!call) continue;
        Object.assign(props, call.attrs);
        if (call.text !== undefined) props.children = call.text;
        return props;
      }
    }
    return props;
  }

  /**
   * A component's props at its first call on a page. Renders pages in route
   * order only as far as it needs to, and remembers every call on the way.
   */
  private firstCall(fn: t.Node): Record<string, Value> | undefined {
    const calls = this.cached('calls', () => ({ pages: [...this.pages()], found: new Map<t.Node, Record<string, Value>>() }));
    while (!calls.found.has(fn) && calls.pages.length) {
      const page = calls.pages.shift()!;
      const renderer = new Renderer(this.at(page.route));
      try {
        renderer.page(page.target);
      } catch {
        // A page that fails partway still offers the calls it made first.
      }
      for (const [key, props] of renderer.calls) if (!calls.found.has(key)) calls.found.set(key, props);
    }
    return calls.found.get(fn);
  }

  /** Stylesheets the canvas loads, in the order the app would load them. */
  styles(dark = false): StyleSet {
    return this.cached(`styles:${dark}`, () => {
      const order: string[] = [];
      const seenCode = new Set<string>();
      const queue: string[] = [];
      // Entry points first: root layouts, _app, main.
      const entries = Object.keys(this.doc.code).filter((p) =>
        /^(src\/)?app\/layout\.[jt]sx?$|^(src\/)?pages\/_app\.[jt]sx?$|^src\/(main|index)\.[jt]sx?$|^src\/App\.[jt]sx?$/.test(p),
      );
      queue.push(...entries, ...Object.keys(this.doc.code).sort());
      const modules = new Set<string>();
      while (queue.length) {
        const file = queue.shift()!;
        if (seenCode.has(file)) continue;
        seenCode.add(file);
        const info = this.info(file);
        if (!info) continue;
        for (const spec of info.sideEffectImports) {
          const target = this.resolve(file, spec);
          if (target && /\.css$/i.test(target) && !order.includes(target)) order.push(target);
        }
        for (const binding of info.imports.values()) {
          const target = this.resolve(file, binding.source);
          if (!target) continue;
          if (/\.module\.css$/i.test(target)) modules.add(target);
          else if (codeFile.test(target) && !seenCode.has(target)) queue.unshift(target);
        }
      }
      // index.html <link rel="stylesheet">.
      const links: string[] = [];
      const html = this.doc.text['index.html'] ?? '';
      for (const m of html.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi)) {
        const href = /href=["']([^"']+)["']/.exec(m[0])?.[1];
        if (!href) continue;
        if (/^(https?:)?\/\//.test(href)) links.push(href);
        else if (this.pathSet.has(href.replace(/^\//, '')) && !order.includes(href.replace(/^\//, ''))) order.push(href.replace(/^\//, ''));
      }
      const read = (path: string) => this.doc.text[path];
      const css: StyleSet['css'] = [];
      const tailwind: string[] = [];
      const anyTailwind = order.some((path) => needsTailwind(read(path) ?? ''));
      for (const path of order) {
        const text = read(path);
        if (text === undefined) continue;
        let processed = rewriteUrls(inlineImports(text, path, read), path, (url) => this.publicUrl(url), (p) => this.config.fileUrl(p));
        processed = forceColorScheme(processed, dark);
        if (anyTailwind && needsTailwind(processed)) tailwind.push(tailwindSource(processed));
        else css.push({ path, text: processed });
      }
      for (const path of modules) {
        const text = read(path);
        if (text !== undefined) css.push({ path, text: forceColorScheme(rewriteUrls(scopeModule(text, path), path, (url) => this.publicUrl(url), (p) => this.config.fileUrl(p)), dark) });
      }
      return { css, tailwind: tailwind.length ? joinTailwindSources(tailwind) : undefined, links };
    });
  }

  /** Files that differ from what's on disk, given the disk contents Frame last saw. */
  dirty(disk: Record<string, string>): string[] {
    const paths = new Set([...Object.keys(this.doc.code), ...Object.keys(this.doc.text)]);
    return [...paths].filter((path) => this.print(path) !== disk[path]);
  }
}

function returnsJSX(component: ComponentInfo) {
  let found = false;
  walk(component.fn.body, (node) => {
    if (found) return false;
    if (t.isJSXElement(node) || t.isJSXFragment(node)) found = true;
  });
  return found;
}

/** The name other files import a local binding by: `default`, its export name, or undefined. */
export function exportNameOf(info: FileInfo, local: string): string | undefined {
  for (const [exported, binding] of info.exports) if ('local' in binding && binding.local === local) return exported;
}

/** `components/ui/date-picker.tsx` → `DatePicker`. */
export function fileComponentName(file: string) {
  const base = file.replace(/^.*\//, '').replace(/\.[^.]+$/, '');
  const name = base === 'index' || base === 'page' ? file.split('/').slice(-2, -1)[0] ?? base : base;
  return name.replace(/(^|[-_ ])(\w)/g, (_, __, c: string) => c.toUpperCase());
}

function pageName(route: string) {
  if (route === '/') return 'Home';
  const last = route.split('/').filter(Boolean).at(-1)!;
  return /^[[:]/.test(last) ? last : splitWords(last);
}

function splitWords(name: string) {
  const words = name.replace(/[-_]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A prop value as plain data, which stays valid after later edits. JSX,
 * functions, and unknown values become undefined.
 */
function plainValue(value: Value): Value {
  const v = prim(value);
  if (Array.isArray(v)) return v.map(plainValue);
  if (isRecord(v)) return Object.fromEntries(Object.entries(v).map(([key, item]) => [key, plainValue(item)]));
  return v !== null && typeof v === 'object' ? undefined : v;
}

function toValue(data: unknown): Value {
  if (Array.isArray(data)) return data.map(toValue);
  if (data && typeof data === 'object') return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, toValue(v)]));
  return data as Value;
}

/** A Doc for a set of files: code files get trees, everything else is kept as text. */
export function docFromFiles(files: Record<string, string>): Doc {
  const doc: Doc = { code: {}, text: {} };
  for (const [path, content] of Object.entries(files)) {
    if (codeFile.test(path) && !/\.d\.ts$/.test(path)) doc.code[path] = { path, base: content, roots: {}, literals: {} };
    else doc.text[path] = content;
  }
  return doc;
}
