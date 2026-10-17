/*
 * Stylesheet processing.
 *
 * The canvas loads the project's own CSS so pages look the way they do in the
 * app. Before it does, these helpers inline local @imports, point url()s at
 * files the canvas can load, scope CSS modules, and prepare Tailwind entry files
 * for Tailwind's in-browser compiler. They also read and edit CSS custom
 * properties, which the Variables panel shows as design tokens.
 *
 * None of this needs a full CSS parser. Each helper walks the text once, skipping
 * strings and comments, and only rewrites the parts it understands.
 */

/** Calls `visit` for each run of CSS text outside strings and comments. */
function scan(css: string, visit: (start: number, end: number) => void) {
  let i = 0;
  let start = 0;
  while (i < css.length) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') {
      visit(start, i);
      const end = css.indexOf('*/', i + 2);
      i = end < 0 ? css.length : end + 2;
      start = i;
    } else if (c === '"' || c === "'") {
      visit(start, i);
      let j = i + 1;
      while (j < css.length && css[j] !== c) j += css[j] === '\\' ? 2 : 1;
      i = j + 1;
      start = i;
    } else i++;
  }
  visit(start, css.length);
}

/**
 * Selector preludes: the text before each `{` that starts a style rule, as
 * [start, end) spans. At-rule preludes such as `@media (...)` are left out.
 */
function selectorSpans(css: string): [number, number][] {
  const spans: [number, number][] = [];
  const code = maskStringsAndComments(css);
  let preludeStart = 0;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === '{') {
      const prelude = code.slice(preludeStart, i);
      const trimmed = prelude.trim();
      if (trimmed && !trimmed.startsWith('@') && !/^(from|to|\d+%)$/.test(trimmed)) spans.push([preludeStart, i]);
      preludeStart = i + 1;
    } else if (c === '}' || c === ';') preludeStart = i + 1;
  }
  return spans;
}

/** The text with strings and comments replaced by spaces, so offsets still line up. */
function maskStringsAndComments(css: string) {
  const chars = css.split('');
  let last = 0;
  scan(css, (start, end) => {
    for (let i = last; i < start; i++) if (chars[i] !== '\n') chars[i] = ' ';
    last = end;
  });
  for (let i = last; i < css.length; i++) if (chars[i] !== '\n') chars[i] = ' ';
  return chars.join('');
}

const classPattern = /\.(-?[_a-zA-Z][\w-]*)/g;

/** Class names a CSS module defines, in order. */
export function moduleClasses(css: string): string[] {
  const names = new Set<string>();
  for (const [start, end] of selectorSpans(css))
    for (const match of css.slice(start, end).replace(/:global\([^)]*\)/g, '').matchAll(classPattern)) names.add(match[1]);
  return [...names];
}

/** The class name a CSS module class gets on the canvas. */
export const moduleClassName = (path: string, name: string) =>
  `${path.replace(/^.*\//, '').replace(/\.module\.\w+$/, '').replace(/[^\w-]/g, '_')}_m__${name}`;

/** A CSS module with its classes renamed to the names moduleClassName gives them. `:global(...)` is kept as is. */
export function scopeModule(css: string, path: string): string {
  let out = '';
  let at = 0;
  for (const [start, end] of selectorSpans(css)) {
    const prelude = css.slice(start, end);
    const globals: string[] = [];
    const masked = prelude.replace(/:global\(([^)]*)\)/g, (_, inner: string) => {
      globals.push(inner);
      return `\u0000${globals.length - 1}\u0000`;
    });
    const renamed = masked
      .replace(classPattern, (_, name: string) => `.${moduleClassName(path, name)}`)
      .replace(/\u0000(\d+)\u0000/g, (_, i: string) => globals[Number(i)]);
    out += css.slice(at, start) + renamed;
    at = end;
  }
  return out + css.slice(at);
}

/**
 * Replaces `@import "./file.css"` with the file's text, recursively. Remote
 * imports such as Google Fonts move to the top so they stay valid. Package
 * imports are dropped, except Tailwind's own, which its compiler understands.
 */
export function inlineImports(
  css: string,
  path: string,
  read: (path: string) => string | undefined,
  seen = new Set<string>(),
): string {
  seen.add(path);
  const remote: string[] = [];
  const body = css.replace(
    /@import\s+(?:url\()?\s*(['"]?)([^'")\s;]+)\1\s*\)?([^;]*);/g,
    (match, _quote: string, url: string, rest: string) => {
      if (/^(https?:)?\/\//.test(url)) {
        remote.push(match);
        return '';
      }
      if (/^tailwindcss(\/|$)/.test(url)) return match;
      if (!url.startsWith('.') && !url.startsWith('/')) return '';
      const target = url.startsWith('/') ? url.slice(1) : joinPath(dirname(path), url);
      if (seen.has(target)) return '';
      const text = read(target);
      if (text === undefined) return '';
      const inner = inlineImports(text, target, read, seen);
      // `@import "x.css" layer(base)` and media conditions wrap the inlined text.
      const condition = rest.trim();
      if (/^layer\(/.test(condition)) return `@layer ${condition.slice(6, -1)} {\n${inner}\n}`;
      if (condition) return `@media ${condition} {\n${inner}\n}`;
      return inner;
    },
  );
  return remote.join('\n') + (remote.length ? '\n' : '') + body;
}

/** Points url()s at loadable URLs: root paths through `publicUrl`, relative paths through `fileUrl`. */
export function rewriteUrls(
  css: string,
  path: string,
  publicUrl: (url: string) => string | undefined,
  fileUrl: (path: string) => string | undefined,
): string {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, quote: string, url: string) => {
    if (/^(data:|https?:|#)/.test(url)) return match;
    const resolved = url.startsWith('/') ? publicUrl(url) : fileUrl(joinPath(dirname(path), url.split(/[?#]/)[0]));
    return resolved ? `url(${quote}${resolved}${quote})` : match;
  });
}

/** Whether a stylesheet is a Tailwind entry point or needs Tailwind's compiler. */
export function isTailwindEntry(css: string) {
  return /@import\s+(url\()?['"]tailwindcss['"/]/.test(css) || /@tailwind\s+(base|components|utilities)/.test(css);
}
export function needsTailwind(css: string) {
  return isTailwindEntry(css) || /@(apply|theme|utility|custom-variant|variant|reference)\b/.test(css);
}

/**
 * Prepares a stylesheet for Tailwind's browser compiler. Version 3 directives
 * become one `@import "tailwindcss"`. Plugins, configs, and sources are dropped
 * because the browser build can't load them.
 */
export function tailwindSource(css: string): string {
  const imported = /@import\s+['"]tailwindcss['"]/.test(css);
  let converted = false;
  return css
    .replace(/@tailwind\s+(base|components|utilities|variants|screens)\s*;/g, () => {
      if (imported || converted) return '';
      converted = true;
      return '@import "tailwindcss";';
    })
    .replace(/@(plugin|config|source)\s+[^;]+;/g, '');
}

/** Joins Tailwind sources from several files, keeping only the first import of Tailwind itself. */
export function joinTailwindSources(sources: string[]): string {
  let seen = false;
  return sources
    .join('\n')
    .replace(/@import\s+['"]tailwindcss['"][^;]*;/g, (match) => {
      if (seen) return '';
      seen = true;
      return match;
    });
}

/** Rewrites `prefers-color-scheme` queries so a frame shows its chosen mode whatever the OS says. */
export function forceColorScheme(css: string, dark: boolean): string {
  return css.replace(/\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)/g, (_, scheme: string) =>
    (scheme === 'dark') === dark ? '(min-width: 0px)' : '(max-width: -1px)',
  );
}

/** Replaces viewport-height units with pixels, so a frame can grow to fit its page without feeding back into vh. */
export function fixViewportHeight(css: string, height: number): string {
  return css.replace(/(-?\d*\.?\d+)(d|s|l)?vh\b/g, (_, n: string) => `${Math.round((Number(n) * height) / 100 * 100) / 100}px`);
}

/** One custom property declaration in a stylesheet. */
export interface CssVariable {
  name: string;
  value: string;
  /** The rule's selector, such as `:root`, `.dark`, or `@theme`. */
  selector: string;
  /** `light`, `dark`, or `theme` for Tailwind's @theme block. */
  mode: 'light' | 'dark' | 'theme';
  file: string;
  /** Span of the value in the file. */
  start: number;
  end: number;
}

/** Custom properties declared at the top of a stylesheet's token rules: :root, html, .dark, @theme, and so on. */
export function cssVariables(css: string, file: string): CssVariable[] {
  const vars: CssVariable[] = [];
  const code = maskStringsAndComments(css);
  // Open blocks, each with the prelude that opened it.
  const stack: string[] = [];
  let statementStart = 0;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === '{') {
      stack.push(code.slice(statementStart, i).trim());
      statementStart = i + 1;
      continue;
    }
    if (c === '}') {
      stack.pop();
      statementStart = i + 1;
      continue;
    }
    if (c === ';') {
      statementStart = i + 1;
      continue;
    }
    // A declaration of a custom property starts a statement with `--`.
    if (c !== '-' || code[i + 1] !== '-' || code.slice(statementStart, i).trim() || !stack.length) continue;
    const m = /^--([\w-]+)\s*:/.exec(code.slice(i));
    if (!m) continue;
    let end = i + m[0].length;
    let depth = 0;
    while (end < code.length && !(depth === 0 && (code[end] === ';' || code[end] === '}'))) {
      if (code[end] === '(') depth++;
      if (code[end] === ')') depth--;
      end++;
    }
    const valueStart = i + m[0].length + (/^\s*/.exec(css.slice(i + m[0].length))?.[0].length ?? 0);
    const value = css.slice(valueStart, end).trimEnd();
    const context = stack.join(' ');
    const mode = /@theme/.test(context)
      ? 'theme'
      : /\.dark\b|\[data-theme=["']?dark|prefers-color-scheme:\s*dark/.test(context)
        ? 'dark'
        : 'light';
    vars.push({ name: `--${m[1]}`, value, selector: stack.at(-1)!, mode, file, start: valueStart, end: valueStart + value.length });
    i = end - 1;
  }
  return vars;
}

/** Sets a custom property's value in place, or adds it to the first :root rule (or a new one). */
export function setVariable(css: string, file: string, name: string, value: string, mode: CssVariable['mode']): string {
  const existing = cssVariables(css, file).find((v) => v.name === name && v.mode === mode);
  if (existing) return css.slice(0, existing.start) + value + css.slice(existing.end);
  const selector = mode === 'theme' ? '@theme' : mode === 'dark' ? '.dark' : ':root';
  const code = maskStringsAndComments(css);
  const pattern = mode === 'theme' ? /@theme\b[^{]*\{/ : mode === 'dark' ? /\.dark\s*\{/ : /:root\s*\{/;
  const m = pattern.exec(code);
  if (m) {
    const at = m.index + m[0].length;
    return `${css.slice(0, at)}\n  ${name}: ${value};${css.slice(at)}`;
  }
  return `${css.replace(/\s*$/, '')}\n\n${selector} {\n  ${name}: ${value};\n}\n`;
}

/** Removes a custom property declaration. */
export function removeVariable(css: string, file: string, name: string, mode: CssVariable['mode']): string {
  const existing = cssVariables(css, file).find((v) => v.name === name && v.mode === mode);
  if (!existing) return css;
  const lineStart = css.lastIndexOf('\n', existing.start) + 1;
  let end = css.indexOf(';', existing.end);
  end = end < 0 ? existing.end : end + 1;
  const lineEnd = css[end] === '\n' ? end + 1 : end;
  const before = css.slice(lineStart, existing.start);
  return /^\s*--[\w-]+\s*:\s*$/.test(before) ? css.slice(0, lineStart) + css.slice(lineEnd) : css;
}

export function dirname(path: string) {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

/** Joins and normalizes a relative path. The result has no leading `./` or `/`. */
export function joinPath(base: string, relative: string) {
  const parts = (base ? `${base}/${relative}` : relative).split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}
