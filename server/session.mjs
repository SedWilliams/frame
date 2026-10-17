// @ts-check
/*
 * One editing session.
 *
 * Remembers what each file held the first time Frame read or wrote it, so the
 * session can report what changed, revert a file, and hand the agent a summary
 * when the user clicks Done. Comments the user leaves on the canvas are kept per
 * project in ~/.frame, outside the repo, so they survive a restart without adding
 * files to the project.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * @typedef {{ path: string, status: 'modified' | 'added', additions: number, deletions: number }} FileChange
 * @typedef {{ id: string, text: string, file?: string, line?: number, column?: number, element?: string, page?: string, resolved?: boolean, createdAt: string }} Comment
 * @typedef {{ project: string, changedFiles: FileChange[], comments: Comment[], note?: string, diff: string, endedAt: string }} Summary
 */

export class Session {
  /** @param {string} root */
  constructor(root) {
    this.root = root;
    this.id = crypto.randomBytes(6).toString('hex');
    this.startedAt = new Date().toISOString();
    /** Content at first contact, or null for files Frame created. @type {Map<string, string | null>} */
    this.baseline = new Map();
    /** Files Frame wrote this session. @type {Set<string>} */
    this.written = new Set();
    this.dir = path.join(os.homedir(), '.frame', 'projects', crypto.createHash('sha1').update(root).digest('hex').slice(0, 12));
  }

  /** @param {string} rel @param {string | null} content */
  remember(rel, content) {
    if (!this.baseline.has(rel)) this.baseline.set(rel, content);
  }

  /** @param {string} rel */
  wrote(rel) {
    this.written.add(rel);
  }

  /** @param {string} rel */
  async current(rel) {
    try {
      return await fs.readFile(path.join(this.root, rel), 'utf8');
    } catch {
      return null;
    }
  }

  /** Files Frame wrote whose content now differs from the baseline. @returns {Promise<FileChange[]>} */
  async changes() {
    /** @type {FileChange[]} */
    const list = [];
    for (const rel of [...this.written].sort()) {
      const before = this.baseline.get(rel) ?? null;
      const after = await this.current(rel);
      if (after === null || after === before) continue;
      const { additions, deletions } = lineStats(before ?? '', after);
      list.push({ path: rel, status: before === null ? 'added' : 'modified', additions, deletions });
    }
    return list;
  }

  /** A unified diff of every changed file, cut off after `limit` lines. */
  async diff(limit = 600) {
    const out = [];
    for (const change of await this.changes()) {
      const before = this.baseline.get(change.path) ?? '';
      const after = (await this.current(change.path)) ?? '';
      out.push(unifiedDiff(change.path, before, after));
    }
    const lines = out.join('\n').split('\n');
    return lines.length > limit ? `${lines.slice(0, limit).join('\n')}\n… diff truncated, run git diff for the rest` : lines.join('\n');
  }

  async commentsFile() {
    await fs.mkdir(this.dir, { recursive: true });
    return path.join(this.dir, 'comments.json');
  }

  /** @returns {Promise<Comment[]>} */
  async loadComments() {
    try {
      const data = JSON.parse(await fs.readFile(await this.commentsFile(), 'utf8'));
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  /** @param {Comment[]} comments */
  async saveComments(comments) {
    await fs.writeFile(await this.commentsFile(), JSON.stringify(comments, null, 2));
  }

  /** @param {string | undefined} note @returns {Promise<Summary>} */
  async summary(note) {
    const summary = {
      project: this.root,
      changedFiles: await this.changes(),
      comments: (await this.loadComments()).filter((c) => !c.resolved),
      ...(note ? { note } : {}),
      diff: await this.diff(),
      endedAt: new Date().toISOString(),
    };
    try {
      await fs.mkdir(this.dir, { recursive: true });
      await fs.writeFile(path.join(this.dir, 'last-session.json'), JSON.stringify(summary, null, 2));
    } catch {
      /* the summary still goes to stdout */
    }
    return summary;
  }
}

/**
 * Myers diff over lines. Returns the edit script as [op, line] pairs, or null
 * when the texts are too different to be worth it.
 * @param {string[]} a @param {string[]} b
 * @returns {[' ' | '-' | '+', string][] | null}
 */
function diffLines(a, b) {
  const n = a.length;
  const m = b.length;
  const offset = n + m;
  let v = new Array(2 * offset + 2).fill(0);
  /** @type {number[][]} */
  const trace = [];
  search: for (let d = 0; d <= n + m; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) break search;
    }
    if (d > 3000) return null;
  }
  /** @type {[' ' | '-' | '+', string][]} */
  const ops = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vd = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && vd[offset + k - 1] < vd[offset + k + 1]) ? k + 1 : k - 1;
    const prevX = vd[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push([' ', a[x - 1]]);
      x--;
      y--;
    }
    if (d > 0) {
      if (x === prevX) {
        ops.push(['+', b[y - 1]]);
        y--;
      } else {
        ops.push(['-', a[x - 1]]);
        x--;
      }
    }
  }
  return ops.reverse();
}

/** Lines added and removed between two texts. @param {string} before @param {string} after */
export function lineStats(before, after) {
  const ops = diffLines(before.split('\n'), after.split('\n'));
  if (!ops) return { additions: after.split('\n').length, deletions: before.split('\n').length };
  return { additions: ops.filter(([op]) => op === '+').length, deletions: ops.filter(([op]) => op === '-').length };
}

/** A unified diff with three lines of context. @param {string} file @param {string} before @param {string} after */
export function unifiedDiff(file, before, after) {
  const header = `--- a/${file}\n+++ b/${file}`;
  const ops = diffLines(before.split('\n'), after.split('\n'));
  if (!ops) return `${header}\n(too different to diff line by line)`;
  let aLine = 1;
  let bLine = 1;
  const rows = ops.map(([op, text]) => {
    const row = { op, text, a: aLine, b: bLine };
    if (op !== '+') aLine++;
    if (op !== '-') bLine++;
    return row;
  });
  const hunks = [];
  let i = 0;
  while (i < rows.length) {
    if (rows[i].op === ' ') {
      i++;
      continue;
    }
    const start = Math.max(0, i - 3);
    let end = i;
    for (;;) {
      while (end < rows.length && rows[end].op !== ' ') end++;
      let next = end;
      while (next < rows.length && rows[next].op === ' ' && next - end <= 6) next++;
      // Changes within six lines of each other share a hunk.
      if (next < rows.length && rows[next].op !== ' ') {
        end = next;
        continue;
      }
      end = Math.min(rows.length, end + 3);
      break;
    }
    const hunk = rows.slice(start, end);
    const aCount = hunk.filter((r) => r.op !== '+').length;
    const bCount = hunk.filter((r) => r.op !== '-').length;
    hunks.push(`@@ -${hunk[0].a},${aCount} +${hunk[0].b},${bCount} @@\n${hunk.map((r) => r.op + r.text).join('\n')}`);
    i = end;
  }
  return `${header}\n${hunks.join('\n')}`;
}
