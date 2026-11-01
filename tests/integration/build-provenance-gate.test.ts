/**
 * Hermetic stale-build refusal regression: points the live smoke at
 * empty fixture dist roots (no manifests) through the documented test
 * hook and proves the real harness refuses before starting browsers,
 * servers, or any provider dispatch — with a dummy key configured.
 * Never touches the real (ignored) production manifests or dist
 * outputs, so this passes on a clean checkout with no custom build.
 * No network, no provider calls.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..');

describe('stale build refusal (offline gate)', () => {
  it('refuses missing manifests before any browser/server/provider work', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'provenance-gate-'));
    const serverDist = join(fixture, 'server-dist');
    const webDist = join(fixture, 'web-dist');
    mkdirSync(serverDist, { recursive: true });
    mkdirSync(webDist, { recursive: true });
    try {
      let output = '';
      let exitCode = -1;
      const started = Date.now();
      try {
        output = execFileSync('pnpm', ['exec', 'tsx', 'scripts/verify-batchc-live-smoke.ts'], {
          cwd: ROOT,
          encoding: 'utf8',
          timeout: 240_000,
          env: {
            ...process.env,
            FORGE_MUSE_API_KEY: 'dummy-key-for-offline-gate-proof',
            FORGE_MUSE_BIN: '/bin/false',
            BATCHC_SMOKE_SERVER_DIST: serverDist,
            BATCHC_SMOKE_WEB_DIST: webDist,
          },
        });
      } catch (error) {
        const failed = error as { status?: number; stdout?: string; stderr?: string };
        exitCode = failed.status ?? -1;
        output = `${failed.stdout ?? ''}\n${failed.stderr ?? ''}`;
      }
      const elapsed = Date.now() - started;
      // Refusal, not success and not the missing-key path.
      expect(exitCode).toBe(1);
      expect(output).toMatch(/build manifest is missing or invalid/);
      expect(output).not.toContain('started the production API');
      expect(output).not.toContain('Browser:');
      // Fast: no browser, server, or provider wait could have happened.
      expect(elapsed).toBeLessThan(120_000);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  }, 300_000);
});
