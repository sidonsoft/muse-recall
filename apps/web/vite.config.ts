import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Hostnames of explicitly trusted forwarding-proxy origins (`FORWARDED_ORIGINS`,
 * set by the Codespaces devcontainer). Empty by default, so Vite keeps its
 * loopback-only Host check.
 */
const forwardedHosts = (process.env.FORWARDED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0)
  .map((origin) => new URL(origin).hostname);

/**
 * The dev server proxies `/api` to the Fastify backend so the browser talks to
 * a single origin and no CORS preflight is needed in development.
 */
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
    // Loopback by default. The devcontainer sets WEB_HOST=0.0.0.0 so the
    // Codespaces port forwarder can reach Vite inside the container.
    host: process.env.WEB_HOST ?? '127.0.0.1',
    ...(forwardedHosts.length > 0 ? { allowedHosts: forwardedHosts } : {}),
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET ?? 'http://127.0.0.1:8787',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
