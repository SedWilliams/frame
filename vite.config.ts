import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: { 'process.env.BABEL_TYPES_8_BREAKING': 'false' },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'jsx-parser': ['@babel/parser'],
          'jsx-generator': ['@babel/generator', '@babel/types'],
        },
      },
    },
  },
});
