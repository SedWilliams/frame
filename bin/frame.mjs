#!/usr/bin/env node
// @ts-check
/*
 * The `frame` command.
 *
 * Opens a project in Frame: starts the local server, opens the editor in the
 * browser, and waits. When the user clicks Done, it prints what changed and the
 * comments they left, then exits. An AI agent runs it in the background and
 * reads that result when the process ends. The last line of output is always
 * `FRAME_RESULT_JSON {...}`, the machine-readable version.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startFrame } from '../server/index.mjs';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(appDir, 'dist');
const version = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')).version;

const help = `Frame ${version}: edit a React site's UI visually, then hand the changes back.

Usage: frame [project-dir] [options]

Options:
  --page <route>   Open this route first, such as /pricing
  --port <number>  Port to listen on (default: the first free port from 4800)
  --no-open        Print the URL instead of opening a browser
  -v, --version    Print the version
  -h, --help       Show this help

Frame runs until you click Done in the editor, or until you press Ctrl+C.
It then prints the files you changed and your comments, ending with a line
that starts with FRAME_RESULT_JSON for tools to read.`;

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {{ dir?: string, page?: string, port?: number, open: boolean }} */
  const args = { open: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      console.log(help);
      process.exit(0);
    } else if (arg === '-v' || arg === '--version') {
      console.log(version);
      process.exit(0);
    } else if (arg === '--no-open') args.open = false;
    else if (arg === '--page') args.page = argv[++i];
    else if (arg === '--port') args.port = Number(argv[++i]);
    else if (arg.startsWith('-')) fail(`Unknown option ${arg}. Run frame --help.`);
    else if (!args.dir) args.dir = arg;
    else fail(`Unexpected argument ${arg}. Run frame --help.`);
  }
  return args;
}

/** @param {string} message @returns {never} */
function fail(message) {
  console.error(`frame: ${message}`);
  process.exit(1);
}

/** Opens a URL in the default browser. @param {string} url */
function openBrowser(url) {
  const [command, ...args] =
    process.platform === 'darwin' ? ['open', url] : process.platform === 'win32' ? ['cmd', '/c', 'start', '', url] : ['xdg-open', url];
  try {
    spawn(command, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    console.log(`Open this URL in your browser: ${url}`);
  }
}

/**
 * Listens on the first free port from `start`, trying ten, then any port.
 * @param {number} start @param {Parameters<typeof startFrame>[0]} options
 */
async function listenOnFreePort(start, options) {
  for (let port = start; port < start + 10; port++) {
    try {
      return await startFrame({ ...options, port });
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'EADDRINUSE') throw error;
    }
  }
  return startFrame({ ...options, port: 0 });
}

/** @param {import('../server/session.mjs').Summary} summary */
function report(summary) {
  const lines = ['', 'Frame session finished.'];
  if (summary.changedFiles.length) {
    lines.push('', 'Changed files:');
    for (const file of summary.changedFiles) lines.push(`  ${file.status === 'added' ? 'A' : 'M'} ${file.path} (+${file.additions} -${file.deletions})`);
  } else lines.push('', 'No files changed.');
  if (summary.comments.length) {
    lines.push('', 'Requests left on the canvas:');
    for (const comment of summary.comments)
      lines.push(`  - ${comment.file ? `${comment.file}${comment.line ? `:${comment.line}` : ''} ` : ''}${comment.element ? `(${comment.element}) ` : ''}${comment.text}`);
  }
  if (summary.note) lines.push('', `Note: ${summary.note}`);
  console.log(lines.join('\n'));
  console.log(`\nFRAME_RESULT_JSON ${JSON.stringify(summary)}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(args.dir ?? process.cwd());
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) fail(`${root} isn't a folder.`);
  if (!fs.existsSync(path.join(distDir, 'index.html')))
    fail(`The editor isn't built yet. Run \`npm install && npm run build\` in ${appDir}, or use skills/frame/scripts/frame.mjs, which does it for you.`);

  /** @type {(summary: import('../server/session.mjs').Summary) => void} */
  let finish = () => {};
  const done = new Promise((resolve) => (finish = resolve));
  const options = { root, distDir, onDone: finish };
  const server = args.port ? await startFrame({ ...options, port: args.port }) : await listenOnFreePort(4800, options);
  const url = `${server.url}${args.page ? `#page=${encodeURIComponent(args.page)}` : ''}`;
  console.log(`Frame is editing ${root}`);
  console.log(`Open ${url}`);
  console.log('Click Done in the editor when you finish, or press Ctrl+C.');
  if (args.open) openBrowser(url);

  const stop = async () => {
    const summary = await server.session.summary(undefined);
    report(summary);
    await server.close();
    process.exit(130);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  const summary = /** @type {import('../server/session.mjs').Summary} */ (await done);
  // Let the editor receive its response before the server goes away.
  setTimeout(async () => {
    report(summary);
    await server.close();
    process.exit(0);
  }, 300);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
