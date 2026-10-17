/*
 * Vite config for the dev server and production build.
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // @babel/types reads this flag from process.env, which doesn't exist in the browser.
  define: { 'process.env.BABEL_TYPES_8_BREAKING': 'false' },
  build: {
    rollupOptions: {
      output: {
        // The Babel parser and generator are about 300 KB each. Separate chunks keep every
        // file under Vite's 500 KB warning and let browsers cache Babel apart from app code.
        manualChunks: {
          'jsx-parser': ['@babel/parser'],
          'jsx-generator': ['@babel/generator', '@babel/types'],
        },
      },
    },
  },
});
