import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { SetupReadinessSchema, setupStateWord } from '@mml/shared';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type DemoSeedFacts,
  formatSetupPanel,
  probeSetupReadiness,
  SEEDED_DEMO_PROJECT,
} from '../../apps/server/src/setup-readiness.js';

/**
 * The setup readiness probe: the panel a judge reads before choosing a path.
 *
 * These tests pin the distinctions that make the panel worth trusting:
 *
 *   - a deliberately offline run is `not_available`; a missing tool is `missing`;
 *     a codespace is judged on *its* configuration, not on being a codespace;
 *   - a CLI found on PATH is `not_probed`, because login is a live fact the probe
 *     refuses to guess;
 *   - the demo row is only `ready` when the project record, its approved version
 *     and that artifact's bytes were all established, and every other
 *     combination says which part it could not establish;
 *   - every `missing` row carries the exact command that removes it;
 *   - the payload never echoes a credential value.
 *
 * No test here touches the real PATH, the real browser install, the real
 * database or the network: the probe takes its lookups and its demo-seed facts
 * as arguments for exactly this. The integration suite
 * (`tests/integration/health-setup-readiness.test.ts`) covers the same rows
 * against a real workspace and a real SQLite file.
 */

const roots: string[] = [];

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function facts(overrides: Partial<DemoSeedFacts> = {}): DemoSeedFacts {
  return {
    database: 'file',
    record: 'absent',
    project_name: null,
    workspace_state: 'absent',
    current_version: null,
    version_count: 0,
    artifact: 'unchecked',
    ...overrides,
  };
}

const seededFacts = (): DemoSeedFacts =>
  facts({
    record: 'present',
    project_name: 'Muse Recall demo',
    workspace_state: 'readable',
    current_version: 1,
    version_count: 1,
    artifact: 'hash_verified',
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
      cliLookup: () => true,
      browserExecutable: () => join(dir, 'chromium'),
      fileExists: (path: string) => path === join(dir, 'chromium'),
      demo_seed: facts(),
    },
  };
}

const CODESPACE = { CODESPACES: 'true', CODESPACE_NAME: 'glacial-fox-12' };

describe('setup readiness probe', () => {
  it('reports every prerequisite as satisfiable on a configured local machine', () => {
    const { dir, input } = base({ FORGE_MEDIA_MODEL: 'muse-image-1.0' });
    const setup = probeSetupReadiness({
      ...input,
      mediaApiKey: 'a-server-side-key-long-enough',
      demo_seed: seededFacts(),
    });
    expect(setup.environment).toBe('local');
    expect(setup.cli.state).toBe('not_probed');
    expect(setup.media_api.state).toBe('ready');
    expect(setup.browser.state).toBe('ready');
    expect(setup.offline_seed.state).toBe('ready');
    expect(() => SetupReadinessSchema.parse(setup)).not.toThrow();
    // The word in each row says what that row actually checked.
    expect(setupStateWord('media_api', 'ready')).toBe('configured');
    expect(setupStateWord('browser', 'ready')).toBe('installed');
    expect(setupStateWord('offline_seed', 'ready')).toBe('seeded');
    expect(dir).toBeTruthy();
  });

  it.each([true, false])('bounds long diagnostics with CLI present=%s', (cliPresent) => {
    const { input } = base(CODESPACE);
    const setup = probeSetupReadiness({
      ...input,
      cliBin: `/opt/${'nested/'.repeat(60)}muse`,
      cliLookup: () => cliPresent,
      mediaApiKey: 'do-not-print-this-key',
      mediaModel: 'i'.repeat(200),
      samModel: 's'.repeat(200),
      demo_seed: { ...seededFacts(), project_name: 'Demo project '.repeat(100) },
    });
    expect(setup.cli.state).toBe(cliPresent ? 'not_probed' : 'missing');
    expect(setup.media_api.state).toBe('ready');
    expect(setup.media_api.detail).toContain('quota are unverified');
    expect(setup.offline_seed.state).toBe('ready');
    expect(setup.offline_seed.detail).toContain('match their recorded hash');
    expect(() => SetupReadinessSchema.parse(setup)).not.toThrow();
    expect(JSON.stringify(setup)).not.toContain('do-not-print-this-key');
    expect(setup.cli.fix).toContain('muse login');
  });

  it('redacts credentials in diagnostic labels before shortening them', () => {
    const { input } = base();
    const secret = 'supersecretvalue';
    const setup = probeSetupReadiness({
      ...input,
      cliBin: `/opt/api_key=${secret}/${'long/'.repeat(100)}muse`,
      demo_seed: { ...seededFacts(), project_name: `api_key=${secret} ${'name'.repeat(100)}` },
    });
    expect(JSON.stringify(setup)).not.toContain(secret);
    expect(setup.cli.detail).toContain('[REDACTED]');
    expect(setup.offline_seed.detail).toContain('[REDACTED]');
    expect(setup.offline_seed.detail).toContain('match their recorded hash');
  });

  it('honors the legacy Chrome policy even when managed Chromium is installed', () => {
    const { input } = base({ FORGE_RUNTIME_CHANNEL: 'chrome' });
    const setup = probeSetupReadiness({ ...input, cliLookup: () => false });
    expect(setup.browser.state).toBe('missing');
    expect(setup.browser.fix).toContain('FORGE_RUNTIME_BROWSER=managed');
  });

  it('lets explicit managed policy override the legacy Chrome policy', () => {
    const { input } = base({ FORGE_RUNTIME_CHANNEL: 'chrome', FORGE_RUNTIME_BROWSER: 'managed' });
    expect(probeSetupReadiness(input).browser.state).toBe('ready');
  });

  it.each(['chrmo', ''])(
    'rejects invalid browser policy %j without probing an executable',
    (policy) => {
      const { input } = base({ FORGE_RUNTIME_BROWSER: policy });
      const setup = probeSetupReadiness({
        ...input,
        browserExecutable: () => {
          throw new Error('must not probe');
        },
      });
      expect(setup.browser.state).toBe('missing');
      expect(setup.browser.detail).toContain('Invalid FORGE_RUNTIME_BROWSER');
      expect(setup.browser.fix).toContain('FORGE_RUNTIME_BROWSER=managed');
    },
  );

  it('a CLI on PATH is never reported as logged in', () => {
    const { input } = base();
    const setup = probeSetupReadiness({ ...input, demo_seed: seededFacts() });
    expect(setup.cli.state).toBe('not_probed');
    expect(setup.cli.detail).toContain('not probed');
    expect(setup.cli.fix).toContain('muse login');
  });

  it('the offline provider reads as a chosen setup, not a broken install', () => {
    const { input } = base();
    const setup = probeSetupReadiness({ ...input, providerId: 'echo' });
    expect(setup.cli.state).toBe('not_available');
    expect(setup.cli.detail).toContain('MODEL_PROVIDER=echo');
    expect(setup.cli.fix).toContain('MODEL_PROVIDER=muse-cli');
  });

  it('a codespace with the CLI present and the live provider is configured, not impossible', () => {
    const { input } = base(CODESPACE);
    const setup = probeSetupReadiness({ ...input, demo_seed: seededFacts() });
    expect(setup.environment).toBe('codespaces');
    // Being a codespace no longer decides this on its own.
    expect(setup.cli.state).toBe('not_probed');
    expect(setup.cli.detail).toContain('codespace');
    expect(setup.cli.detail).toContain('unverified');
    expect(setup.cli.fix).toContain('muse login');
  });

  it('a codespace with no CLI says what is missing, naming the shipped container', () => {
    const { input } = base(CODESPACE);
    const setup = probeSetupReadiness({
      ...input,
      cliLookup: () => false,
      demo_seed: seededFacts(),
    });
    expect(setup.cli.state).toBe('missing');
    expect(setup.cli.detail).toContain('devcontainer');
    expect(setup.cli.fix).toContain('muse login');
    // The environment is still reported, so the reader knows where they are.
    expect(setup.environment).toBe('codespaces');
  });

  it('no CLI at all points at the variables that select the binary', () => {
    const { input } = base();
    const setup = probeSetupReadiness({ ...input, cliLookup: () => false });
    expect(setup.cli.state).toBe('missing');
    expect(setup.cli.detail).toContain('MUSE_BIN');
    expect(setup.cli.fix).toContain('Install the Muse Code CLI');
  });

  it('a configured media key is reported as configured, never as provider access', () => {
    const { input } = base();
    const key = 'do-not-print-this-value-please';
    const setup = probeSetupReadiness({ ...input, mediaApiKey: key, demo_seed: seededFacts() });
    expect(setup.media_api.state).toBe('ready');
    expect(setup.media_api.detail).toContain('length-checked');
    expect(setup.media_api.detail).toContain('provider access and remaining quota are unverified');
    expect(JSON.stringify(setup)).not.toContain('do-not-print-this-value-please');
  });

  it('no media key names the variable and states that a CLI login does not cover it', () => {
    const { input } = base();
    const setup = probeSetupReadiness(input);
    expect(setup.media_api.state).toBe('missing');
    expect(setup.media_api.detail).toContain('CLI login');
    expect(setup.media_api.fix).toContain('FORGE_MUSE_API_KEY');
    expect(setup.media_api.fix).toContain('.env');
  });

  it('no verification browser blocks approval and prints the install command', () => {
    const { input } = base();
    const setup = probeSetupReadiness({ ...input, browserExecutable: () => '/nope/chrome' });
    expect(setup.browser.state).toBe('missing');
    expect(setup.browser.detail).toContain('cannot be approved');
    expect(setup.browser.fix).toBe('pnpm exec playwright-core install chromium');
  });

  it('an installed browser says it was not launched', () => {
    const { dir, input } = base();
    const setup = probeSetupReadiness({ ...input, demo_seed: seededFacts() });
    expect(setup.browser.state).toBe('ready');
    expect(setup.browser.detail).toContain('was not launched');
    expect(setup.browser.detail).toContain(basename(join(dir, 'chromium')));
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
});

describe('offline demo seed row', () => {
  it('says so when this surface did not inspect the demo', () => {
    const { input } = base();
    const without = { ...input, demo_seed: undefined };
    const setup = probeSetupReadiness(without);
    expect(setup.offline_seed.state).toBe('not_probed');
    expect(setup.offline_seed.detail).toContain('not inspected');
    expect(setup.offline_seed.fix).toContain('judge:check');
  });

  it('an in-memory instance is not told it forgot to seed', () => {
    const { input } = base();
    const setup = probeSetupReadiness({ ...input, demo_seed: facts({ database: 'in_memory' }) });
    expect(setup.offline_seed.state).toBe('not_probed');
    expect(setup.offline_seed.detail).toContain('in-memory');
    expect(setup.offline_seed.fix).toContain('pnpm demo:seed');
  });

  it('a missing database file is the one thing that is reported as missing outright', () => {
    const { input } = base();
    const setup = probeSetupReadiness({ ...input, demo_seed: facts({ database: 'absent' }) });
    expect(setup.offline_seed.state).toBe('missing');
    expect(setup.offline_seed.detail).toContain('database file');
  });

  it('an unreadable database file stays unverified instead of becoming a seed problem', () => {
    const { input } = base();
    const setup = probeSetupReadiness({ ...input, demo_seed: facts({ database: 'unreadable' }) });
    expect(setup.offline_seed.state).toBe('not_probed');
    expect(setup.offline_seed.detail).toContain('read-only');
  });

  it('unrelated workspace content is not mistaken for the demo', () => {
    const { input } = base();
    // Another project is fully seeded; the demo project still is not.
    const setup = probeSetupReadiness({
      ...input,
      demo_seed: facts({ record: 'absent', workspace_state: 'readable', current_version: null }),
    });
    expect(setup.offline_seed.state).toBe('missing');
    expect(setup.offline_seed.detail).toContain(SEEDED_DEMO_PROJECT);
    expect(setup.offline_seed.detail).not.toMatch(/hash/);
    expect(setup.offline_seed.fix).toContain('pnpm demo:seed');
    expect(setup.offline_seed.fix).toContain(SEEDED_DEMO_PROJECT);
  });

  it('a project record with no approved version says Studio would open empty', () => {
    const { input } = base();
    const setup = probeSetupReadiness({
      ...input,
      demo_seed: facts({
        record: 'present',
        project_name: 'Some app',
        workspace_state: 'readable',
        current_version: null,
      }),
    });
    expect(setup.offline_seed.state).toBe('missing');
    expect(setup.offline_seed.detail).toContain('no approved version');
  });

  it('workspace bytes with no project record says memory would look empty', () => {
    const { input } = base();
    const setup = probeSetupReadiness({
      ...input,
      demo_seed: facts({
        record: 'absent',
        workspace_state: 'readable',
        current_version: 1,
        version_count: 1,
        artifact: 'hash_verified',
      }),
    });
    expect(setup.offline_seed.state).toBe('missing');
    expect(setup.offline_seed.detail).toContain('is not a project record');
    expect(setup.offline_seed.detail).toContain('memory');
  });

  it('a version whose bytes are gone is reported as missing, not ready', () => {
    const { input } = base();
    const setup = probeSetupReadiness({
      ...input,
      demo_seed: facts({
        record: 'present',
        project_name: 'Muse Recall demo',
        workspace_state: 'readable',
        current_version: 1,
        version_count: 1,
        artifact: 'missing',
      }),
    });
    expect(setup.offline_seed.state).toBe('missing');
    expect(setup.offline_seed.detail).toContain('version file is not in the workspace');
  });

  it('bytes that no longer match their hash are named as refused by the app', () => {
    const { input } = base();
    const setup = probeSetupReadiness({
      ...input,
      demo_seed: facts({
        record: 'present',
        project_name: 'Muse Recall demo',
        workspace_state: 'readable',
        current_version: 2,
        version_count: 2,
        artifact: 'hash_mismatch',
      }),
    });
    expect(setup.offline_seed.state).toBe('missing');
    expect(setup.offline_seed.detail).toContain('no longer match their recorded hash');
    expect(setup.offline_seed.fix).toContain('Recovery');
    expect(setup.offline_seed.fix).toContain('changed nothing');
  });

  it('a version that recorded no hash is unverified, because there is nothing to compare', () => {
    const { input } = base();
    const setup = probeSetupReadiness({
      ...input,
      demo_seed: facts({
        record: 'present',
        workspace_state: 'readable',
        current_version: 3,
        version_count: 3,
        artifact: 'no_hash_recorded',
      }),
    });
    expect(setup.offline_seed.state).toBe('not_probed');
    expect(setup.offline_seed.detail).toContain('recorded no hash');
  });

  it('an unreadable workspace state is unverified rather than guessed', () => {
    const { input } = base();
    const setup = probeSetupReadiness({
      ...input,
      demo_seed: facts({ record: 'present', workspace_state: 'unreadable' }),
    });
    expect(setup.offline_seed.state).toBe('not_probed');
    expect(setup.offline_seed.detail).toContain('could not be fully inspected');
  });

  it('the ready row names the three things it established, and that it wrote nothing', () => {
    const { input } = base();
    const setup = probeSetupReadiness({ ...input, demo_seed: seededFacts() });
    expect(setup.offline_seed.state).toBe('ready');
    for (const fragment of [
      'Muse Recall demo',
      SEEDED_DEMO_PROJECT,
      'v1 approved',
      'match their recorded hash',
      'Read-only',
    ]) {
      expect(setup.offline_seed.detail).toContain(fragment);
    }
    expect(setup.offline_seed.fix).toBeNull();
  });
});

describe('setup panel rendering', () => {
  it('a broken machine prints a fix line for every absent prerequisite', () => {
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
    expect(panel).toContain('fix: Install the Muse Code CLI');
    expect(panel).toContain('docs/guide/FOR_JUDGES.md');
    expect(panel).toContain('(2) generate live applications');
  });

  it('a provisioned machine still gets exactly one hint: the login the probe cannot verify', () => {
    const { dir, input } = base();
    const setup = probeSetupReadiness({
      ...input,
      mediaApiKey: 'long-enough-server-key',
      demo_seed: seededFacts(),
    });
    const panel = formatSetupPanel(setup);
    // Media, browser and the demo are settled facts about this machine; login is
    // not, and the panel says so instead of claiming a readiness it did not check.
    expect(panel.match(/fix:/g)).toHaveLength(1);
    expect(panel).toContain('fix: If you have not logged in on this machine, run `muse login`');
    for (const word of ['configured', 'installed', 'seeded', 'unverified']) {
      expect(panel).toContain(word);
    }
    // No row may be printed as a live check it did not perform.
    expect(panel).toContain('not "verified"');
    expect(panel).toContain('no model call, no quota spend, nothing written');
    expect(dir).toBeTruthy();
  });

  it('the shout belongs to the terminal, not to the shared wording table', () => {
    // The System screen pill and the terminal panel read the same table, so the
    // table holds the calm word and only the panel emphasizes it.
    expect(setupStateWord('media_api', 'missing')).toBe('missing');
    expect(setupStateWord('cli', 'not_available')).toBe('not here');
    const { input } = base();
    expect(formatSetupPanel(probeSetupReadiness(input))).toContain('MISSING');
  });

  it('the unseeded case tells the reader to seed before starting, and never claims readiness', () => {
    const { input } = base();
    const panel = formatSetupPanel(probeSetupReadiness(input));
    expect(panel).toContain('MISSING');
    expect(panel).toContain('pnpm demo:seed');
    expect(panel).not.toContain('seeded');
  });
});
