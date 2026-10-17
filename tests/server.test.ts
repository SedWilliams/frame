/*
 * Tests for the local server in server/index.mjs: access checks, the file API,
 * live change events, and the Done summary. Each test runs the server on a
 * temporary copy of a tiny project.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startFrame } from '../server/index.mjs';

let root: string;
let dist: string;
let server: Awaited<ReturnType<typeof startFrame>>;
let summaries: unknown[];

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'frame-project-'));
  dist = await fs.mkdtemp(path.join(os.tmpdir(), 'frame-dist-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.mkdir(path.join(root, 'public/images'), { recursive: true });
  await fs.mkdir(path.join(root, 'node_modules/pkg'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'demo-site' }));
  await fs.writeFile(path.join(root, 'src/App.tsx'), 'export default () => <h1>Hi</h1>;\n');
  await fs.writeFile(path.join(root, 'public/images/a.png'), 'png');
  await fs.writeFile(path.join(root, 'node_modules/pkg/index.js'), 'secret');
  await fs.writeFile(path.join(dist, 'index.html'), '<!doctype html><html><head><title>Frame</title></head><body></body></html>');
  summaries = [];
  server = await startFrame({ root, distDir: dist, port: 0, onDone: (summary) => summaries.push(summary) });
});

afterEach(async () => {
  await server.close();
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(dist, { recursive: true, force: true });
});

function api(name: string, init: RequestInit = {}, token = server.token) {
  return fetch(`${server.url}__frame/api/${name}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-frame-token': token, ...(init.headers ?? {}) },
  });
}

describe('access', () => {
  it('serves the editor with the session token in it', async () => {
    const html = await (await fetch(server.url)).text();
    expect(html).toContain(`<meta name="frame-token" content="${server.token}" />`);
  });

  it('refuses requests without the token, from other hosts, or from other origins', async () => {
    expect((await api('project', {}, 'wrong')).status).toBe(401);
    // fetch won't send a forged Host header, so ask the http module, as a rebinding page would.
    const http = await import('node:http');
    const status = await new Promise<number>((resolve) => {
      http.get({ host: '127.0.0.1', port: server.port, path: '/', headers: { host: `evil.example:${server.port}` } }, (res) => resolve(res.statusCode ?? 0));
    });
    expect(status).toBe(403);
    const crossOrigin = await api('file', { method: 'PUT', headers: { origin: 'https://evil.example' }, body: JSON.stringify({ path: 'src/App.tsx', contents: 'x' }) });
    expect(crossOrigin.status).toBe(403);
  });
});

describe('files', () => {
  it('lists project files without dependencies', async () => {
    const project = await (await api('project')).json();
    expect(project.name).toBe('demo-site');
    expect(project.files.map((f: { path: string }) => f.path)).toEqual(['package.json', 'public/images/a.png', 'src/App.tsx']);
    expect(project.publicDir).toBe('public');
  });

  it('reads text files and refuses paths outside the project', async () => {
    const { files } = await (await api('read', { method: 'POST', body: JSON.stringify({ paths: ['src/App.tsx', '../etc/passwd', 'node_modules/pkg/index.js', 'public/images/a.png'] }) })).json();
    expect(Object.keys(files)).toEqual(['src/App.tsx']);
  });

  it('writes only when the file still holds what the editor saw', async () => {
    const original = await fs.readFile(path.join(root, 'src/App.tsx'), 'utf8');
    const ok = await api('file', { method: 'PUT', body: JSON.stringify({ path: 'src/App.tsx', contents: 'v2', expected: original }) });
    expect(ok.status).toBe(200);
    expect(await fs.readFile(path.join(root, 'src/App.tsx'), 'utf8')).toBe('v2');
    const stale = await api('file', { method: 'PUT', body: JSON.stringify({ path: 'src/App.tsx', contents: 'v3', expected: original }) });
    expect(stale.status).toBe(409);
    expect((await stale.json()).current).toBe('v2');
    expect(await fs.readFile(path.join(root, 'src/App.tsx'), 'utf8')).toBe('v2');
  });

  it('refuses to write outside the project or to non-source files', async () => {
    for (const target of ['../escape.tsx', 'node_modules/pkg/index.js', 'package.json', '.env']) {
      const res = await api('file', { method: 'PUT', body: JSON.stringify({ path: target, contents: 'x' }) });
      expect(res.status, target).toBe(400);
    }
  });

  it('creates new files once', async () => {
    const created = await api('create', { method: 'POST', body: JSON.stringify({ path: 'src/components/Card.tsx', contents: 'export {}' }) });
    expect(created.status).toBe(201);
    const again = await api('create', { method: 'POST', body: JSON.stringify({ path: 'src/components/Card.tsx', contents: 'x' }) });
    expect(again.status).toBe(409);
  });

  it('serves public files at the root and media through the token', async () => {
    expect(await (await fetch(`${server.url}images/a.png`)).text()).toBe('png');
    expect((await fetch(`${server.url}__frame/fs/public/images/a.png`)).status).toBe(401);
    expect(await (await fetch(`${server.url}__frame/fs/public/images/a.png?token=${server.token}`)).text()).toBe('png');
    expect((await fetch(`${server.url}__frame/fs/src/App.tsx?token=${server.token}`)).status).toBe(404);
  });

  it('saves images into public/images under a free name', async () => {
    const first = await (await api('asset?name=a.png', { method: 'POST', body: 'x', headers: { 'content-type': 'application/octet-stream' } })).json();
    expect(first).toEqual({ path: 'public/images/a-2.png', url: '/images/a-2.png' });
  });
});

describe('session', () => {
  it('streams changes made on disk', async () => {
    const controller = new AbortController();
    const res = await fetch(`${server.url}__frame/api/events?token=${server.token}`, { signal: controller.signal });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (!text.includes('event: hello')) text += decoder.decode((await reader.read()).value);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await fs.writeFile(path.join(root, 'src/App.tsx'), 'changed by an agent');
    const deadline = Date.now() + 5000;
    while (!text.includes('src/App.tsx') && Date.now() < deadline) text += decoder.decode((await reader.read()).value);
    controller.abort();
    // The watcher may also report the files the test created a moment earlier.
    const paths = [...text.matchAll(/data: (\{"paths".*\})/g)].flatMap((m) => JSON.parse(m[1]).paths);
    expect(paths).toContain('src/App.tsx');
    expect(paths.some((p: string) => p.startsWith('node_modules'))).toBe(false);
  });

  it('summarizes changed files and open comments on Done, and can revert', async () => {
    const original = await fs.readFile(path.join(root, 'src/App.tsx'), 'utf8');
    await api('file', { method: 'PUT', body: JSON.stringify({ path: 'src/App.tsx', contents: 'export default () => <h1>Hello</h1>;\n', expected: original }) });
    await api('comments', {
      method: 'PUT',
      body: JSON.stringify({ comments: [
        { id: '1', text: 'Make the heading bolder', file: 'src/App.tsx', line: 1, element: '<h1>', createdAt: 'now' },
        { id: '2', text: 'done already', resolved: true, createdAt: 'now' },
      ] }),
    });
    const changes = (await (await api('changes')).json()).changes;
    expect(changes).toEqual([{ path: 'src/App.tsx', status: 'modified', additions: 1, deletions: 1 }]);
    const { summary } = await (await api('done', { method: 'POST', body: JSON.stringify({ note: 'Looks good' }) })).json();
    expect(summary.changedFiles).toEqual(changes);
    expect(summary.comments.map((c: { text: string }) => c.text)).toEqual(['Make the heading bolder']);
    expect(summary.note).toBe('Looks good');
    expect(summary.diff).toContain('-export default () => <h1>Hi</h1>;\n+export default () => <h1>Hello</h1>;');
    expect(summaries).toHaveLength(1);
    await api('revert', { method: 'POST', body: JSON.stringify({ path: 'src/App.tsx' }) });
    expect(await fs.readFile(path.join(root, 'src/App.tsx'), 'utf8')).toBe(original);
  });
});
