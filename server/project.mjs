// @ts-check
/*
 * Project files on disk.
 *
 * Scans a project folder for the files the editor needs, and decides which paths
 * may be read, served, or written. Every path that comes from the browser passes
 * through `resolveInside` first, so nothing outside the project root, and nothing
 * in dependency or build folders, can be read or written.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

/** Folders never scanned, served, or written. */
export const ignoredDirs = new Set([
  'node_modules', '.git', '.hg', '.svn', '.next', '.nuxt', '.svelte-kit', '.turbo', '.vercel', '.netlify',
  '.cache', '.parcel-cache', '.output', 'dist', 'build', 'out', 'coverage', 'storybook-static',
  'playwright-report', 'test-results', '__pycache__', '.venv', 'venv', 'target', '.idea', '.vscode', '.frame',
]);

/** Files the editor reads as text: source, styles, configs, and data. */
export const textFile = /\.(tsx|jsx|ts|js|mjs|cjs|mts|cts|css|scss|json|html)$/i;
/** Files the editor may write. */
export const writableFile = /\.(tsx|jsx|ts|js|mjs|cjs|css)$/i;
/** Files served to the canvas as-is, such as imported images and fonts. */
export const mediaFile = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp|mp4|webm|ogg|mp3|wav|woff2?|ttf|otf|eot)$/i;

export const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
  '.webmanifest': 'application/manifest+json',
  '.xml': 'application/xml',
};

/** @param {string} file */
export const mimeType = (file) => /** @type {Record<string, string>} */ (mimeTypes)[path.extname(file).toLowerCase()] ?? 'application/octet-stream';

/**
 * Lists project files, skipping ignored and hidden folders. Stops at 20,000
 * entries so a huge repo can't stall the editor.
 * @param {string} root
 * @returns {Promise<{ path: string, size: number }[]>}
 */
export async function scanProject(root) {
  /** @type {{ path: string, size: number }[]} */
  const files = [];
  let visited = 0;
  /** @param {string} dir @param {number} depth */
  async function scan(dir, depth) {
    if (depth > 20 || visited > 20000) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (++visited > 20000) return;
      if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirs.has(entry.name)) await scan(full, depth + 1);
      } else if (entry.isFile()) {
        const rel = toPosix(path.relative(root, full));
        let size = 0;
        try {
          size = (await fs.stat(full)).size;
        } catch {
          continue;
        }
        files.push({ path: rel, size });
      }
    }
  }
  await scan(root, 0);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** @param {string} p */
export const toPosix = (p) => p.split(path.sep).join('/');

/**
 * The absolute path for a project-relative path, or undefined when it escapes
 * the root or passes through an ignored or hidden folder.
 * @param {string} root
 * @param {string} rel
 */
export function resolveInside(root, rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0')) return;
  const normalized = path.posix.normalize(rel.replace(/\\/g, '/')).replace(/^\/+/, '');
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) return;
  const parts = normalized.split('/');
  if (parts.some((part) => ignoredDirs.has(part) || (part.startsWith('.') && part !== '.'))) return;
  const full = path.resolve(root, normalized);
  if (full !== root && !full.startsWith(root + path.sep)) return;
  return full;
}

/**
 * Whether a resolved path is a real file inside the root, following symlinks.
 * A symlink that points out of the project doesn't count.
 * @param {string} root
 * @param {string} full
 */
export async function isRealFileInside(root, full) {
  try {
    const real = await fs.realpath(full);
    const realRoot = await fs.realpath(root);
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return false;
    return (await fs.stat(real)).isFile();
  } catch {
    return false;
  }
}

/**
 * The project's public folder, served at the site root as Next.js and Vite do.
 * @param {string} root
 */
export async function publicDir(root) {
  const dir = path.join(root, 'public');
  try {
    return (await fs.stat(dir)).isDirectory() ? dir : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The project's display name: package.json's name, else the folder name.
 * @param {string} root
 */
export async function projectName(root) {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
    if (typeof pkg.name === 'string' && pkg.name) return pkg.name;
  } catch {
    /* no package.json */
  }
  return path.basename(root);
}
