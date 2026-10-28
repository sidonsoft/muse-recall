import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The dev server proxies `/api` to the Fastify backend so the browser talks to
 * a single origin and no CORS preflight is needed in development.
 */
const proxy = {
  '/api': {
    target: process.env.VITE_PROXY_TARGET ?? 'http://127.0.0.1:8787',
    changeOrigin: false,
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@mml/shared': resolve(import.meta.dirname, '../../packages/shared/src/index.ts'),
      '@mml/ui-protocol': resolve(import.meta.dirname, '../../packages/ui-protocol/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
    proxy,
  },
  // The managed browser job serves the production build and proxies /api to a
  // disposable server, so no dev server or live model is involved.
  preview: {
    port: 4173,
    strictPort: true,
    host: '127.0.0.1',
    proxy,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
