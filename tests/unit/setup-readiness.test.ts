import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SetupReadinessSchema } from '@mml/shared';
import { afterEach, describe, expect, it } from 'vitest';
import {
  formatSetupPanel,
  probeSetupReadiness,
  SEEDED_DEMO_PROJECT,
} from '../../apps/server/src/setup-readiness.js';

/**
 * Setup readiness: the panel a judge reads before choosing a path.
 *
 * These tests pin the distinctions that make the panel trustworthy:
 * a deliberately offline run or a codespace is `not_available`, not a broken
 * install; a CLI found on PATH is `not_probed`, because login is a live fact the
 * probe refuses to guess; and every `missing` row must carry the exact command
 * that removes it. The payload also never echoes credential material.
 *
 * No test here touches the real PATH, the real filesystem for browser lookup, or
 * the network: the probe takes its lookups as arguments for precisely this.
 */

const roots: string[] = [];

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function base(overrides: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'setup-readiness-'));
  roots.push(dir);
  return {
    dir,
    input: {
      env: { PATH: '/usr/bin', ...overrides },
      providerId: 'muse-cli',
      cliBin: 'muse',
      mediaApiKey: null,
      databasePath: join(dir, 'app.db'),
      workspaceRoot: join(dir, 'workspaces'),
      cliLookup: () => true,
      browserExecutable: () => join(dir, 'chromium'),
      fileExists: (path: string) => path === join(dir, 'chromium'),
    },
  };
}

describe('setup readiness probe', () => {
  it('reports every prerequisite as satisfiable on a configured local machine', () => {
    const { dir, input } = base({ FORGE_MEDIA_MODEL: 'muse-image-1.0' });
    const setup = probeSetupReadiness({
      ...input,
      mediaApiKey: 'a-server-side-key-long-enough',
      fileExists: (path: string) => path === join(dir, 'chromium') || path === input.databasePath,
      workspaceEntries: () => ['forge'],
    });
    expect(setup.environment).toBe('local');
    expect(setup.cli.state).toBe('not_probed');
    expect(setup.media_api.state).toBe('ready');
    expect(setup.browser.state).toBe('ready');
    expect(setup.offline_seed.state).toBe('ready');
    expect(() => SetupReadinessSchema.parse(setup)).not.toThrow();
  });

  it('a CLI on PATH is never reported as logged in', () => {
    const { input } = base();
    const setup = probeSetupReadiness({ ...input, mediaApiKey: 'x'.repeat(24) });
    expect(setup.cli.state).toBe('not_probed');
    expect(setup.cli.detail).toContain('not probed');
    expect(setup.cli.fix).toContain('muse login');
  });

  it('an offline provider run says generation is switched off, not broken', () => {
    const { input } = base();
    const setup = probeSetupReadiness({ ...input, providerId: 'echo' });
    expect(setup.cli.state).toBe('not_available');
    expect(setup.cli.detail).toContain('MODEL_PROVIDER=echo');
    expect(setup.cli.fix).toContain('MODEL_PROVIDER=muse-cli');
  });

  it('Codespaces says the generation path cannot run here and points at the guide', () => {
    const { input } = base({ CODESPACES: 'true', CODESPACE_NAME: 'brave-codespace' });
    const setup = probeSetupReadiness(input);
    expect(setup.environment).toBe('codespaces');
    expect(setup.cli.state).toBe('not_available');
    expect(setup.cli.detail).toContain('offline exploration path only');
    expect(setup.cli.fix).toContain('docs/guide/FOR_JUDGES.md');
  });

  it('a missing CLI names the binary it looked for', () => {
    const { input } = base();
    const setup = probeSetupReadiness({ ...input, cliLookup: () => false });
    expect(setup.cli.state).toBe('missing');
    expect(setup.cli.detail).toContain('"muse"');
    expect(setup.cli.fix).toContain('FORGE_MUSE_BIN');
  });

  it('a missing media key explains that a CLI login does not cover it, without leaking a key', () => {
    const { input } = base();
    const setup = probeSetupReadiness({ ...input, mediaApiKey: '  short  ' });
    expect(setup.media_api.state).toBe('missing');
    expect(setup.media_api.detail).toContain('CLI login does not configure');
    expect(setup.media_api.fix).toContain('FORGE_MUSE_API_KEY');
    expect(setup.media_api.detail).not.toContain('short');

    const configured = probeSetupReadiness({ ...input, mediaApiKey: 'do-not-print-this-value' });
    expect(configured.media_api.state).toBe('ready');
    expect(JSON.stringify(configured)).not.toContain('do-not-print-this-value');
  });

  it('no verification browser blocks approval and prints the install command', () => {
    const { input } = base();
    const setup = probeSetupReadiness({ ...input, browserExecutable: () => '/nope/chrome' });
    expect(setup.browser.state).toBe('missing');
    expect(setup.browser.detail).toContain('cannot be approved');
    expect(setup.browser.fix).toBe('pnpm exec playwright-core install chromium');
  });

  it('system-Chrome policy reports the policy it was given when Chrome is absent', () => {
    const { input } = base({ FORGE_RUNTIME_BROWSER: 'chrome' });
    const setup = probeSetupReadiness({
      ...input,
      cliLookup: () => false,
      fileExists: () => false,
    });
    expect(setup.browser.state).toBe('missing');
    expect(setup.browser.detail).toContain('FORGE_RUNTIME_BROWSER=chrome');
    expect(setup.browser.fix).toContain('FORGE_RUNTIME_BROWSER=managed');
  });

  it('an unseeded workspace is called out with the seed command, naming what is absent', () => {
    const { input } = base();
    const setup = probeSetupReadiness(input);
    expect(setup.offline_seed.state).toBe('missing');
    expect(setup.offline_seed.detail).toContain('no database file');
    expect(setup.offline_seed.detail).toContain('no workspace directories');
    expect(setup.offline_seed.fix).toContain('pnpm demo:seed');
    expect(setup.offline_seed.fix).toContain(SEEDED_DEMO_PROJECT);
  });

  it('a seeded database with no workspace says so precisely', () => {
    const { dir, input } = base();
    const setup = probeSetupReadiness({
      ...input,
      fileExists: (path: string) => path === join(dir, 'chromium') || path === input.databasePath,
    });
    expect(setup.offline_seed.state).toBe('missing');
    expect(setup.offline_seed.detail).not.toContain('no database file');
    expect(setup.offline_seed.detail).toContain('no workspace directories');
  });

  it('an in-memory instance is not told it forgot to seed', () => {
    const { input } = base();
    const setup = probeSetupReadiness({ ...input, databasePath: ':memory:' });
    expect(setup.offline_seed.state).toBe('not_probed');
    expect(setup.offline_seed.detail).toContain('in-memory');
    expect(setup.offline_seed.fix).toContain('pnpm demo:seed');
  });

  it('the seeded row names the files it checked, not a promise about quota', () => {
    const { dir, input } = base();
    const setup = probeSetupReadiness({
      ...input,
      fileExists: (path: string) => path === join(dir, 'chromium') || path === input.databasePath,
      workspaceEntries: () => ['forge', 'another'],
    });
    expect(setup.offline_seed.state).toBe('ready');
    expect(setup.offline_seed.detail).toContain('app.db');
    expect(setup.offline_seed.detail).toContain('2 workspace directories');
    expect(setup.offline_seed.detail).toContain(SEEDED_DEMO_PROJECT);
    expect(setup.offline_seed.detail).not.toMatch(/quota|logged in/i);
  });
});

describe('setup panel rendering', () => {
  it('labels every row, states the three paths, and shows a fix for each missing one', () => {
    const { dir, input } = base();
    const setup = probeSetupReadiness({
      ...input,
      cliLookup: () => false,
      browserExecutable: () => join(dir, 'not-installed'),
    });
    const panel = formatSetupPanel(setup);
    for (const label of ['CLI', 'Media API', 'Browser validation', 'Offline demo']) {
      expect(panel).toContain(label);
    }
    expect(panel).toContain('MISSING');
    expect(panel).toContain('fix: pnpm exec playwright-core install chromium');
    expect(panel).toContain('fix: Install the Muse CLI');
    expect(panel).toContain('docs/guide/FOR_JUDGES.md');
    expect(panel).toContain('(2) generate live applications');
  });

  it('a provisioned machine still gets exactly one hint: the login the probe cannot verify', () => {
    const { dir, input } = base();
    const setup = probeSetupReadiness({
      ...input,
      mediaApiKey: 'long-enough-server-key',
      fileExists: (path: string) => path === join(dir, 'chromium') || path === input.databasePath,
      workspaceEntries: () => ['forge'],
    });
    const panel = formatSetupPanel(setup);
    // Media, browser and the seeded demo are settled facts; login is not, and the
    // panel says so instead of claiming a readiness it did not check.
    expect(panel.match(/ ready\n/g)).toHaveLength(3);
    expect(panel.match(/fix:/g)).toHaveLength(1);
    expect(panel).toContain('fix: If you have not logged in on this machine, run `muse login`');
  });
});
