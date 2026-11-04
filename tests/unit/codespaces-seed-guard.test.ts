import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkSeedGuard } from '../../scripts/lib/codespaces-seed-guard.js';

/**
 * The setup seed guard, executed — not just asserted as text.
 *
 * `seedForgeDemo` wipes the forge-demo workspace, so the guard standing
 * between setup and the seed is the only thing protecting a judge's generated
 * versions. These tests run the real guard (the same Node environment
 * resolution the seed uses) against disposable roots with sentinel files, and
 * prove the destructive direction is unreachable except by explicit force.
 * Nothing here touches a real project, database, port or credential.
 */

let root: string;
let envBefore: NodeJS.ProcessEnv;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'seed-guard-'));
  envBefore = { ...process.env };
  delete process.env.WORKSPACE_ROOT;
  delete process.env.SEED_DEMO;
  delete process.env.MML_ENV_FILE;
});

/**
 * Environment for fixture-root cases: INIT_CWD (set by pnpm to the invoking
 * directory) and MML_ENV_FILE would redirect root/.env discovery away from
 * the disposable fixture, exactly as they do for the real seed. Stripping
 * them simulates a direct invocation against the fixture root; shell-export
 * semantics for the remaining variables are preserved.
 */
function fixtureEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.INIT_CWD;
  delete env.MML_ENV_FILE;
  return { ...env, ...extra };
}

afterEach(() => {
  // The guard snapshots and restores process.env itself; this asserts it.
  for (const key of Object.keys(process.env)) {
    if (!(key in envBefore)) delete process.env[key];
  }
  Object.assign(process.env, envBefore);
});

function writeEnv(lines: string): void {
  writeFileSync(join(root, '.env'), `${lines}\n`, 'utf8');
}

/** A forge-demo project with sentinel state in every location the seed wipes. */
function seedFakeDemo(workspaceRoot: string): Record<string, string> {
  const project = join(workspaceRoot, 'forge', 'forge-demo');
  const sentinels: Record<string, string> = {
    [join(project, 'state.json')]: '{"current_version": 7}',
    [join(project, 'versions', '7', 'index.html')]: '<!-- judge work -->',
    [join(project, 'staging', 'job-1', 'index.html')]: '<!-- staged -->',
    [join(project, 'jobs', 'job-1.json')]: '{"judge": "work"}',
  };
  for (const [path, body] of Object.entries(sentinels)) {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, body, 'utf8');
  }
  return sentinels;
}

function sha1(path: string): string {
  return createHash('sha1').update(readFileSync(path)).digest('hex');
}

describe('seed guard preserves existing demo state', () => {
  it('skips when versions, staging, jobs and state exist, and leaves every byte alone', () => {
    const workspace = join(root, 'ws');
    const sentinels = seedFakeDemo(workspace);
    writeEnv(`WORKSPACE_ROOT=${workspace}`);
    const envHash = sha1(join(root, '.env'));

    for (let run = 0; run < 2; run += 1) {
      const result = checkSeedGuard({ cwd: root, env: fixtureEnv() });
      expect(result.decision).toBe('skip');
      expect(result.projectDir).toBe(join(workspace, 'forge', 'forge-demo'));
    }
    for (const [path, body] of Object.entries(sentinels)) {
      expect(readFileSync(path, 'utf8')).toBe(body);
    }
    expect(sha1(join(root, '.env'))).toBe(envHash);
  });

  it('seeds a fresh root with no state', () => {
    const result = checkSeedGuard({ cwd: root, env: fixtureEnv() });
    expect(result.decision).toBe('seed');
    expect(result.projectDir).toBe(join(root, 'workspaces', 'forge', 'forge-demo'));
  });

  it('an empty project directory is not state', () => {
    mkdirSync(join(root, 'workspaces', 'forge', 'forge-demo'), { recursive: true });
    const result = checkSeedGuard({ cwd: root, env: fixtureEnv() });
    expect(result.decision).toBe('seed');
  });
});

describe('seed guard uses the same resolution as the seed', () => {
  it('handles quoted values and paths containing spaces', () => {
    const spaced = join(root, 'my demo ws');
    seedFakeDemo(spaced);
    writeEnv('WORKSPACE_ROOT="./my demo ws"');
    const result = checkSeedGuard({ cwd: root, env: fixtureEnv() });
    expect(result.decision).toBe('skip');
    expect(result.projectDir).toBe(join(spaced, 'forge', 'forge-demo'));
  });

  it('handles single quotes and the export prefix the way Node parses them', () => {
    const spaced = join(root, 'single quoted ws');
    seedFakeDemo(spaced);
    writeEnv("export WORKSPACE_ROOT='./single quoted ws'");
    const result = checkSeedGuard({ cwd: root, env: fixtureEnv() });
    expect(result.decision).toBe('skip');
    expect(result.projectDir).toBe(join(spaced, 'forge', 'forge-demo'));
  });

  it('an exported WORKSPACE_ROOT wins over the file, like the seed', () => {
    const filed = join(root, 'file-ws');
    const exported = join(root, 'exported-ws');
    seedFakeDemo(filed);
    writeEnv(`WORKSPACE_ROOT=${filed}`);
    // The shell export points at an empty root: the file's state must not
    // leak into the decision.
    const seeded = checkSeedGuard({
      cwd: root,
      env: fixtureEnv({ WORKSPACE_ROOT: exported }),
    });
    expect(seeded.decision).toBe('seed');
    expect(seeded.projectDir).toBe(join(exported, 'forge', 'forge-demo'));
    // And the reverse: the export points at state the file does not name.
    const kept = checkSeedGuard({
      cwd: root,
      env: fixtureEnv({ WORKSPACE_ROOT: filed }),
    });
    expect(kept.decision).toBe('skip');
  });

  it.each([' ./quoted workspace ', ''])('preserves the seed path exactly for %j', (value) => {
    const workspace = value === '' ? root : join(root, value);
    seedFakeDemo(workspace);
    const result = checkSeedGuard({ cwd: root, env: fixtureEnv({ WORKSPACE_ROOT: value }) });
    expect(result.decision).toBe('skip');
    expect(result.projectDir).toBe(join(workspace, 'forge', 'forge-demo'));
  });

  it('does not auto-seed a different SEED_PROJECT target', () => {
    const result = checkSeedGuard({ cwd: root, env: fixtureEnv({ SEED_PROJECT: 'judge-work' }) });
    expect(result.decision).toBe('skip');
    expect(result.reason).toContain('SEED_PROJECT');
  });

  it('keeps arbitrary files in a project directory', () => {
    const project = join(root, 'workspaces', 'forge', 'forge-demo');
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, 'judge-notes.txt'), 'keep this');
    expect(checkSeedGuard({ cwd: root, env: fixtureEnv() }).decision).toBe('skip');
    expect(readFileSync(join(project, 'judge-notes.txt'), 'utf8')).toBe('keep this');
  });

  it('an absolute WORKSPACE_ROOT passes through instead of anchoring at the root', () => {
    const absolute = join(root, 'abs-ws');
    seedFakeDemo(absolute);
    writeEnv(`WORKSPACE_ROOT=${absolute}`);
    const result = checkSeedGuard({ cwd: root, env: fixtureEnv() });
    expect(result.decision).toBe('skip');
    expect(result.projectDir).toBe(join(absolute, 'forge', 'forge-demo'));
  });
});

describe('seed guard fail-safe direction', () => {
  it('SEED_DEMO=never never seeds, even on a fresh root', () => {
    const result = checkSeedGuard({ cwd: root, env: fixtureEnv({ SEED_DEMO: 'never' }) });
    expect(result.decision).toBe('skip');
  });

  it('only explicit SEED_DEMO=force permits resetting existing state', () => {
    const workspace = join(root, 'ws');
    seedFakeDemo(workspace);
    writeEnv(`WORKSPACE_ROOT=${workspace}`);
    const forced = checkSeedGuard({
      cwd: root,
      env: fixtureEnv({ SEED_DEMO: 'force' }),
    });
    expect(forced.decision).toBe('seed');
    expect(forced.reason).toContain('SEED_DEMO=force');
    const upper = checkSeedGuard({
      cwd: root,
      env: fixtureEnv({ SEED_DEMO: 'FORCE' }),
    });
    expect(upper.decision).toBe('seed');
    for (const other of ['yes', '1', 'true', 'please']) {
      const result = checkSeedGuard({
        cwd: root,
        env: fixtureEnv({ SEED_DEMO: other }),
      });
      expect(result.decision, `SEED_DEMO=${other}`).toBe('skip');
    }
  });

  it('a file where the project directory should be is ambiguous, so skip', () => {
    const workspace = join(root, 'ws');
    const projectDir = join(workspace, 'forge', 'forge-demo');
    mkdirSync(join(workspace, 'forge'), { recursive: true });
    writeFileSync(projectDir, 'not a directory', 'utf8');
    writeEnv(`WORKSPACE_ROOT=${workspace}`);
    const result = checkSeedGuard({ cwd: root, env: fixtureEnv() });
    expect(result.decision).toBe('skip');
    expect(result.reason).toMatch(/not a directory/i);
  });

  it('an unreadable project directory fails safe instead of reseeding', () => {
    const workspace = join(root, 'ws');
    const projectDir = join(workspace, 'forge', 'forge-demo');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, 'state.json'), '{}', 'utf8');
    writeEnv(`WORKSPACE_ROOT=${workspace}`);
    chmodSync(projectDir, 0o000);
    try {
      // A process that can still read through the mode bits (root) cannot
      // use this case as evidence; ENOTDIR above is the portable proof.
      let readable = true;
      try {
        readFileSync(join(projectDir, 'state.json'));
      } catch {
        readable = false;
      }
      if (!readable) {
        const result = checkSeedGuard({ cwd: root, env: fixtureEnv() });
        expect(result.decision).toBe('skip');
        expect(result.reason).toMatch(/unreadable|could not inspect/i);
      }
    } finally {
      chmodSync(projectDir, 0o755);
    }
  });

  it('an MML_ENV_FILE pointing nowhere fails safe instead of reseeding', () => {
    const result = checkSeedGuard({
      cwd: root,
      env: fixtureEnv({ MML_ENV_FILE: join(root, 'no-such.env') }),
    });
    expect(result.decision).toBe('skip');
  });

  it('leaves process.env exactly as it found it', () => {
    const workspace = join(root, 'ws');
    writeEnv(`WORKSPACE_ROOT=${workspace}\nMODEL_PROVIDER=echo`);
    const marker = 'SEED_GUARD_ENV_PROBE';
    delete process.env[marker];
    checkSeedGuard({ cwd: root, env: fixtureEnv() });
    expect(process.env[marker]).toBeUndefined();
    expect(process.env.WORKSPACE_ROOT).toBeUndefined();
    expect(process.env.MODEL_PROVIDER).toBe(envBefore.MODEL_PROVIDER);
  });
});

describe('seed check CLI (the contract setup.sh consumes)', () => {
  const script = join(__dirname, '..', '..', 'scripts', 'codespaces-seed-check.ts');

  // The tsx loader as an absolute path: `--import tsx` would resolve from
  // the fixture cwd, where the package is not installed.
  const loader = join(__dirname, '..', '..', 'node_modules', 'tsx', 'dist', 'loader.mjs');

  function runCli(fixture: string, env: NodeJS.ProcessEnv): { stdout: string; status: number } {
    let stdout = '';
    let status = -1;
    try {
      stdout = execFileSync(process.execPath, ['--import', loader, script], {
        cwd: fixture,
        env,
        encoding: 'utf8',
        timeout: 60_000,
      });
      status = 0;
    } catch (error) {
      const failure = error as { stdout?: string; status?: number };
      stdout = failure.stdout ?? '';
      status = failure.status ?? -1;
    }
    return { stdout, status };
  }

  it('prints SEED_DECISION=skip for existing state and =seed for a fresh root', () => {
    const kept = mkdtempSync(join(tmpdir(), 'seed-cli-kept-'));
    const keptWs = join(kept, 'ws');
    seedFakeDemo(keptWs);
    writeFileSync(join(kept, '.env'), `WORKSPACE_ROOT=${keptWs}\n`, 'utf8');
    const skip = runCli(kept, fixtureEnv({ SEED_DEMO: 'auto' }));
    expect(skip.status).toBe(0);
    expect(skip.stdout.trim()).toBe('SEED_DECISION=skip');

    const fresh = mkdtempSync(join(tmpdir(), 'seed-cli-fresh-'));
    const seed = runCli(fresh, fixtureEnv({ SEED_DEMO: 'auto' }));
    expect(seed.status).toBe(0);
    expect(seed.stdout.trim()).toBe('SEED_DECISION=seed');

    const never = runCli(fresh, fixtureEnv({ SEED_DEMO: 'never' }));
    expect(never.status).toBe(0);
    expect(never.stdout.trim()).toBe('SEED_DECISION=skip');
  });

  it('a broken configuration exits decided, never undecided', () => {
    const broken = mkdtempSync(join(tmpdir(), 'seed-cli-broken-'));
    const result = runCli(broken, {
      ...process.env,
      SEED_DEMO: 'auto',
      MML_ENV_FILE: join(broken, 'missing.env'),
    });
    expect(result.stdout.trim()).toBe('SEED_DECISION=skip');
  });

  it('does not write or modify the .env file', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'seed-cli-env-'));
    writeFileSync(join(fixture, '.env'), 'WORKSPACE_ROOT=./ws\n', 'utf8');
    const before = existsSync(join(fixture, '.env'))
      ? readFileSync(join(fixture, '.env'), 'utf8')
      : null;
    runCli(fixture, fixtureEnv());
    expect(readFileSync(join(fixture, '.env'), 'utf8')).toBe(before);
  });
});
