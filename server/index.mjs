// @ts-check
/*
 * Frame's local server.
 *
 * Serves the built editor and a small JSON API that gives it read and write
 * access to one project folder. The API is the only way the browser touches
 * disk, so it's strict:
 *
 * - It listens on 127.0.0.1 and refuses requests whose Host header isn't the
 *   address it listens on, which stops DNS rebinding.
 * - Every API call needs the session token, which the server writes into the
 *   editor page it serves. Other sites can't read that page, so they never see it.
 * - Paths are resolved inside the project root, skipping dependency, build, and
 *   hidden folders, and only source and stylesheet files can be written.
 * - A write only lands if the file still holds what the editor last saw.
 *
 * The same handler runs inside Vite's dev server while developing Frame itself.
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream, watch as watchFs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  ignoredDirs,
  isRealFileInside,
  mediaFile,
  mimeType,
  projectName,
  publicDir,
  resolveInside,
  scanProject,
  textFile,
  toPosix,
  writableFile,
} from './project.mjs';
import { Session } from './session.mjs';

/**
 * @typedef {import('node:http').IncomingMessage} Request
 * @typedef {import('node:http').ServerResponse} Response
 * @typedef {import('./session.mjs').Summary} Summary
 */

const MAX_BODY = 25 * 1024 * 1024;

/** @param {Response} res @param {number} status @param {unknown} body */
function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** Sends JSON and reports the request handled. @param {Response} res @param {number} status @param {unknown} body */
function reply(res, status, body) {
  json(res, status, body);
  return true;
}

/** @param {Request} req @returns {Promise<Buffer>} */
function readBody(req) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('Request body too large.'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** @param {Request} req */
async function readJSON(req) {
  const body = await readBody(req);
  return body.length ? JSON.parse(body.toString('utf8')) : {};
}

/** Constant-time token comparison. @param {string} a @param {string} b */
function sameToken(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * Creates the request handler for one project.
 * @param {{ root: string, distDir?: string, token?: string, onDone?: (summary: Summary) => void }} options
 */
export function createFrameHandler(options) {
  const root = path.resolve(options.root);
  const token = options.token ?? crypto.randomBytes(24).toString('hex');
  const session = new Session(root);
  /** @type {Set<Response>} */
  const clients = new Set();
  let ended = false;

  // Watch the project and tell open editors which files changed, in batches.
  /** @type {Set<string>} */
  let pending = new Set();
  /** @type {NodeJS.Timeout | undefined} */
  let flush;
  /** @type {import('node:fs').FSWatcher | undefined} */
  let watcher;
  try {
    watcher = watchFs(root, { recursive: true }, (_event, name) => {
      if (!name) return;
      const rel = toPosix(name.toString());
      if (rel.split('/').some((part) => ignoredDirs.has(part) || part.startsWith('.'))) return;
      pending.add(rel);
      clearTimeout(flush);
      flush = setTimeout(() => {
        const paths = [...pending];
        pending = new Set();
        for (const client of clients) client.write(`event: change\ndata: ${JSON.stringify({ paths })}\n\n`);
      }, 120);
    });
  } catch {
    // Recursive watching isn't available everywhere. The editor still works without live reload.
  }
  const ping = setInterval(() => {
    for (const client of clients) client.write(': ping\n\n');
  }, 25000);

  /** @param {Request} req @param {URL} url */
  function authorized(req, url) {
    const given = String(req.headers['x-frame-token'] ?? url.searchParams.get('token') ?? '');
    return sameToken(given, token);
  }

  /**
   * Handles a request. Returns false when the path isn't Frame's, so a dev server
   * can pass it on.
   * @param {Request} req @param {Response} res
   */
  async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);

    if (pathname.startsWith('/__frame/api/')) {
      if (!authorized(req, url)) return reply(res, 401, { error: 'Missing or wrong session token. Reopen Frame from its terminal link.' });
      // Writes must come from Frame's own page.
      const origin = req.headers.origin;
      if (req.method !== 'GET' && origin && new URL(origin).host !== req.headers.host)
        return reply(res, 403, { error: 'Cross-origin request refused.' });
      try {
        await api(pathname.slice('/__frame/api/'.length), req, res, url);
      } catch (error) {
        json(res, 500, { error: error instanceof Error ? error.message : String(error) });
      }
      return true;
    }

    if (pathname.startsWith('/__frame/fs/')) {
      if (!authorized(req, url)) return reply(res, 401, { error: 'Missing token.' });
      const rel = pathname.slice('/__frame/fs/'.length);
      const full = resolveInside(root, rel);
      if (!full || !mediaFile.test(full) || !(await isRealFileInside(root, full))) return reply(res, 404, { error: 'Not found.' });
      return sendFile(res, full);
    }

    // The editor itself.
    if (options.distDir) {
      if (pathname === '/' || pathname === '/index.html') {
        const html = await fs.readFile(path.join(options.distDir, 'index.html'), 'utf8');
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(injectToken(html));
        return true;
      }
      if (pathname.startsWith('/__frame/')) {
        const full = path.resolve(options.distDir, `.${pathname}`);
        if (full.startsWith(options.distDir + path.sep) && (await isRealFileInside(options.distDir, full))) return sendFile(res, full);
        return reply(res, 404, { error: 'Not found.' });
      }
    }

    // Anything else comes from the project's public folder, as the app's own dev server would serve it.
    const pub = await publicDir(root);
    if (pub && req.method === 'GET') {
      const full = resolveInside(pub, pathname.replace(/^\//, ''));
      if (full && (await isRealFileInside(pub, full))) return sendFile(res, full);
    }
    if (options.distDir) return reply(res, 404, { error: 'Not found.' });
    return false;
  }

  /** Adds the token to the editor page so its scripts can call the API. @param {string} html */
  function injectToken(html) {
    return html.replace('<head>', `<head>\n    <meta name="frame-token" content="${token}" />`);
  }

  /** Sends a file and reports the request handled. @param {Response} res @param {string} file */
  function sendFile(res, file) {
    res.writeHead(200, { 'content-type': mimeType(file), 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
    createReadStream(file).pipe(res);
    return true;
  }

  /** @param {string} name @param {Request} req @param {Response} res @param {URL} url */
  async function api(name, req, res, url) {
    if (name === 'project' && req.method === 'GET') {
      const files = await scanProject(root);
      const pub = await publicDir(root);
      return json(res, 200, {
        name: await projectName(root),
        root,
        files,
        publicDir: pub ? toPosix(path.relative(root, pub)) : null,
        session: { id: session.id, startedAt: session.startedAt },
      });
    }

    if (name === 'read' && req.method === 'POST') {
      const { paths } = await readJSON(req);
      if (!Array.isArray(paths)) return json(res, 400, { error: 'Expected { paths: string[] }.' });
      /** @type {Record<string, string>} */
      const files = {};
      let total = 0;
      for (const rel of paths) {
        const full = typeof rel === 'string' ? resolveInside(root, rel) : undefined;
        if (!full || !textFile.test(full) || !(await isRealFileInside(root, full))) continue;
        const stat = await fs.stat(full);
        if (stat.size > 2 * 1024 * 1024 || (total += stat.size) > 60 * 1024 * 1024) continue;
        const text = await fs.readFile(full, 'utf8');
        files[rel] = text;
        if (writableFile.test(full)) session.remember(rel, text);
      }
      return json(res, 200, { files });
    }

    if (name === 'file' && req.method === 'PUT') {
      const { path: rel, contents, expected } = await readJSON(req);
      const full = typeof rel === 'string' ? resolveInside(root, rel) : undefined;
      if (!full || !writableFile.test(full) || typeof contents !== 'string')
        return json(res, 400, { error: `Frame can't write ${rel}.` });
      if (!(await isRealFileInside(root, full))) return json(res, 404, { error: `${rel} doesn't exist. Reopen the project.` });
      const current = await fs.readFile(full, 'utf8');
      session.remember(rel, current);
      if (typeof expected === 'string' && current !== expected)
        return json(res, 409, { error: `${rel} changed outside Frame. Nothing was overwritten.`, current });
      await fs.writeFile(full, contents);
      session.wrote(rel);
      return json(res, 200, { contents });
    }

    if (name === 'create' && req.method === 'POST') {
      const { path: rel, contents } = await readJSON(req);
      const full = typeof rel === 'string' ? resolveInside(root, rel) : undefined;
      if (!full || !writableFile.test(full) || typeof contents !== 'string')
        return json(res, 400, { error: `Frame can't create ${rel}.` });
      await fs.mkdir(path.dirname(full), { recursive: true });
      try {
        await fs.writeFile(full, contents, { flag: 'wx' });
      } catch {
        return json(res, 409, { error: `${rel} already exists.` });
      }
      session.remember(rel, null);
      session.wrote(rel);
      return json(res, 201, { contents });
    }

    if (name === 'asset' && req.method === 'POST') {
      // Saves an image into public/, under a name that doesn't clash, and returns its URL.
      const requested = path.basename(url.searchParams.get('name') ?? 'image.png').replace(/[^\w.-]+/g, '-');
      if (!/\.(png|jpe?g|gif|webp|avif|svg)$/i.test(requested)) return json(res, 400, { error: 'Only images can be added.' });
      const body = await readBody(req);
      const dir = path.join(root, 'public', 'images');
      await fs.mkdir(dir, { recursive: true });
      const ext = path.extname(requested);
      let fileName = requested;
      for (let n = 2; await fs.stat(path.join(dir, fileName)).then(() => true, () => false); n++)
        fileName = `${path.basename(requested, ext)}-${n}${ext}`;
      await fs.writeFile(path.join(dir, fileName), body);
      return json(res, 201, { path: `public/images/${fileName}`, url: `/images/${fileName}` });
    }

    if (name === 'events' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(`event: hello\ndata: ${JSON.stringify({ session: session.id })}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (name === 'changes' && req.method === 'GET') return json(res, 200, { changes: await session.changes() });

    if (name === 'revert' && req.method === 'POST') {
      const { path: rel } = await readJSON(req);
      const full = typeof rel === 'string' ? resolveInside(root, rel) : undefined;
      if (!full || !session.baseline.has(rel)) return json(res, 400, { error: `Nothing to revert in ${rel}.` });
      const baseline = session.baseline.get(rel);
      if (baseline === null || baseline === undefined) await fs.rm(full, { force: true });
      else await fs.writeFile(full, baseline);
      return json(res, 200, { contents: baseline ?? null });
    }

    if (name === 'comments') {
      if (req.method === 'GET') return json(res, 200, { comments: await session.loadComments() });
      if (req.method === 'PUT') {
        const { comments } = await readJSON(req);
        if (!Array.isArray(comments)) return json(res, 400, { error: 'Expected { comments: [] }.' });
        await session.saveComments(comments);
        return json(res, 200, { ok: true });
      }
    }

    if (name === 'done' && req.method === 'POST') {
      const { note } = await readJSON(req);
      const summary = await session.summary(typeof note === 'string' && note.trim() ? note.trim() : undefined);
      json(res, 200, { summary });
      if (!ended) {
        ended = true;
        for (const client of clients) client.write(`event: ended\ndata: {}\n\n`);
        options.onDone?.(summary);
      }
      return;
    }

    json(res, 404, { error: `Unknown endpoint ${name}.` });
  }

  function close() {
    clearInterval(ping);
    clearTimeout(flush);
    watcher?.close();
    for (const client of clients) client.end();
    clients.clear();
  }

  return { handle, token, session, close, injectToken };
}

/**
 * Starts Frame for a project and resolves once it's listening.
 * @param {{ root: string, distDir: string, port?: number, host?: string, onDone?: (summary: Summary) => void }} options
 */
export async function startFrame(options) {
  const host = options.host ?? '127.0.0.1';
  const frame = createFrameHandler(options);
  /** @type {number} */
  let port = options.port ?? 0;
  const server = http.createServer(async (req, res) => {
    // Only answer to the address we listen on. A page that rebinds its own domain to
    // 127.0.0.1 still sends its own Host header and gets refused here.
    const hostHeader = req.headers.host ?? '';
    if (![`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(hostHeader)) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('Frame only answers on its own address.');
      return;
    }
    try {
      if (!(await frame.handle(req, res))) {
        res.writeHead(404);
        res.end();
      }
    } catch (error) {
      if (!res.headersSent) json(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(undefined));
  });
  const address = server.address();
  port = typeof address === 'object' && address ? address.port : port;
  return {
    url: `http://${host}:${port}/`,
    port,
    token: frame.token,
    session: frame.session,
    close: () =>
      new Promise((resolve) => {
        frame.close();
        server.closeAllConnections?.();
        server.close(() => resolve(undefined));
      }),
  };
}
