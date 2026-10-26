import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * One test process for the whole monorepo.
 *
 * Workspace packages are aliased to their TypeScript sources so tests exercise
 * exactly what the apps consume, with no intermediate build step.
 *
 * Tests default to the deterministic `echo` provider. The live Muse suite is
 * gated behind MML_LIVE_MUSE=1 so CI never burns a contributor's quota.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@mml/shared': resolve(import.meta.dirname, 'packages/shared/src/index.ts'),
      '@mml/memory-engine': resolve(import.meta.dirname, 'packages/memory-engine/src/index.ts'),
      '@mml/muse-provider': resolve(import.meta.dirname, 'packages/muse-provider/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    reporters: ['default'],
  },
});
