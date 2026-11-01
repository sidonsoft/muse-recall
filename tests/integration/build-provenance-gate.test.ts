/**
 * Stale-build refusal regression: with the recorded build manifests
 * moved aside (restored afterwards), the live smoke must refuse before
 * starting browsers, servers, or any provider dispatch — even with a
 * (dummy) key configured. Zero network, zero provider calls.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..');
const SERVER_MANIFEST = join(ROOT, 'apps/server/dist/.build-manifest.json');
const WEB_MANIFEST = join(ROOT, 'apps/web/dist/.build-manifest.json');

describe('stale build refusal (offline gate)', () => {
  it('refuses before any browser/server/provider work with zero dispatches', async () => {
    const backupDir = join(tmpdir(), `manifest-backup-${Date.now()}`);
    const { mkdirSync } = await import('node:fs');
    mkdirSync(backupDir, { recursive: true });
    const moved: Array<{ from: string; to: string }> = [];
    try {
      for (const manifest of [SERVER_MANIFEST, WEB_MANIFEST]) {
        if (!existsSync(manifest)) continue;
        const to = join(backupDir, `${moved.length}.manifest.json`);
        renameSync(manifest, to);
        moved.push({ from: manifest, to });
      }
      expect(moved.length).toBeGreaterThan(0);
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
      for (const { from, to } of moved) {
        if (existsSync(to) && !existsSync(from)) renameSync(to, from);
      }
      // Both manifests are back: the gate passes again afterwards.
      for (const { from } of moved) {
        expect(existsSync(from)).toBe(true);
      }
    }
  }, 300_000);
});
