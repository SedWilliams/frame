/*
 * Vite config for the dev server and production build.
 *
 * The build uses relative URLs and keeps its assets under __frame/, so the
 * local server can serve a project's own public files at the site root without
 * clashing with Frame's. Set FRAME_PROJECT to a project folder and `npm run dev`
 * edits that project, with the same file API the `frame` command serves.
 */

import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createFrameHandler } from './server/index.mjs';

/** Mounts Frame's API on Vite's dev server for the project in FRAME_PROJECT. */
function frameProject(root: string): Plugin {
  const frame = createFrameHandler({ root: path.resolve(root) });
  return {
    name: 'frame-project',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        // Vite serves its own modules. Frame takes its API and the project's public files.
        const url = req.url ?? '/';
        if (/^\/(@vite|@react-refresh|@fs|@id|src\/|node_modules\/)/.test(url) || url === '/' || url.startsWith('/index.html')) return next();
        if (!(await frame.handle(req, res))) next();
      });
      server.httpServer?.once('close', () => frame.close());
    },
    transformIndexHtml(html) {
      return frame.injectToken(html);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), ...(process.env.FRAME_PROJECT ? [frameProject(process.env.FRAME_PROJECT)] : [])],
  // @babel/types reads this flag from process.env, which doesn't exist in the browser.
  define: { 'process.env.BABEL_TYPES_8_BREAKING': 'false' },
  build: {
    assetsDir: '__frame/assets',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Babel is about 600 KB. Its own chunks let browsers cache it apart from app code.
        manualChunks: {
          'jsx-parser': ['@babel/parser'],
          'jsx-generator': ['@babel/types'],
        },
      },
    },
  },
});
