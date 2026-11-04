/**
 * Codespaces seed guard: decide whether `pnpm demo:seed` may run.
 *
 * `seedForgeDemo` wipes and rewrites the forge-demo workspace (versions,
 * staging, jobs), so setup must only invoke it when the project has no state
 * yet. This guard answers that question with the *same* configuration
 * resolution the seed itself uses — shell-exported variables win over the
 * `.env` file, relative paths resolve against the repository root — because a
 * shell re-implementation disagrees on quoted values, spaces and overrides,
 * and a disagreement here deletes a judge's work.
 *
 * `.env` is never sourced as shell code and never written: it is loaded
 * through the server's own loader into a snapshotted process environment,
 * read, and then the snapshot is restored, so the check has no observable
 * side effects on the caller.
 *
 * Fail-safe direction: anything unreadable or ambiguous reports `skip`, never
 * `seed`. Only an explicit `SEED_DEMO=force` permits resetting existing demo
 * state; `SEED_DEMO=never` never seeds.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadDotEnv, resolveProjectRoot } from '../../apps/server/src/config.js';
import { DEMO_PROJECT_ID } from './demo-seed.js';

export type SeedDecision = 'seed' | 'skip';

export interface SeedGuardResult {
  decision: SeedDecision;
  /** Human-readable reason, safe to print in setup output. */
  reason: string;
  /** Repository root the paths resolved against. */
  projectRoot: string;
  /** Resolved workspace root (no secrets, just a path). */
  workspaceRoot: string;
  /** Resolved forge-demo project directory that was inspected. */
  projectDir: string;
  /** The `.env` file that was read, or null when none was found. */
  envFile: string | null;
}

export interface SeedGuardOptions {
  /** Directory setup runs from; defaults to the current working directory. */
  cwd?: string;
  /** Environment to resolve from; defaults to process.env. Never mutated. */
  env?: NodeJS.ProcessEnv;
  /** SEED_DEMO value: 'auto' | 'force' | 'never'. Defaults to env or 'auto'. */
  seedDemo?: string;
}

function projectHasState(projectDir: string): boolean {
  const entries = readdirSync(projectDir);
  // Any recorded state counts: an approved version, staged work, a job
  // record, or the project manifest itself. A leftover empty directory from
  // an interrupted run does not.
  return entries.some((entry) => {
    if (entry === 'state.json') return true;
    const full = join(projectDir, entry);
    try {
      if (!statSync(full).isDirectory()) return false;
      if (entry === 'versions' || entry === 'staging' || entry === 'jobs') {
        return readdirSync(full).length > 0;
      }
      return false;
    } catch {
      // An entry that cannot be inspected is state we cannot account for.
      return true;
    }
  });
}

/**
 * Decide whether the demo seed may run. Never throws: every failure mode —
 * an unreadable directory, a missing env file pointer, an unresolvable root —
 * resolves to `skip`, because seeding over an unknown state is the destructive
 * direction.
 */
export function checkSeedGuard(options: SeedGuardOptions = {}): SeedGuardResult {
  const cwd = options.cwd ?? process.cwd();
  // Snapshot the whole environment: loading the `.env` file mutates
  // process.env, and this check must leave no trace on its caller.
  const snapshot = { ...process.env };
  const restore = () => {
    for (const key of Object.keys(process.env)) {
      if (!(key in snapshot)) delete process.env[key];
    }
    Object.assign(process.env, snapshot);
  };
  try {
    return checkSeedGuardInner({ ...options, cwd });
  } finally {
    restore();
  }
}

function checkSeedGuardInner(options: SeedGuardOptions & { cwd: string }): SeedGuardResult {
  const env = options.env ?? process.env;
  const seedDemo = (options.seedDemo ?? env.SEED_DEMO ?? 'auto').trim().toLowerCase();
  const { cwd } = options;

  if (seedDemo === 'never') {
    return {
      decision: 'skip',
      reason: 'SEED_DEMO=never: seeding is disabled for this run.',
      projectRoot: cwd,
      workspaceRoot: '',
      projectDir: '',
      envFile: null,
    };
  }

  let projectRoot: string;
  let envFile: string | null;
  try {
    projectRoot = resolveProjectRoot(cwd, env);
    // The same loader the seed and the server use: explicit shell variables
    // win over the file, quoted values and spaces parse as Node parses them.
    envFile = loadDotEnv(cwd, env);
  } catch (error) {
    return {
      decision: 'skip',
      reason: `Could not resolve configuration (${error instanceof Error ? error.message : String(error)}); refusing to seed over an unknown state.`,
      projectRoot: cwd,
      workspaceRoot: '',
      projectDir: '',
      envFile: null,
    };
  }

  // Shell-exported WORKSPACE_ROOT wins over the file — exactly as the seed
  // resolves it. resolve() anchors a relative value at the repository root
  // and passes an absolute value through, matching the seed's projectPath.
  const configured = (env.WORKSPACE_ROOT ?? process.env.WORKSPACE_ROOT ?? './workspaces').trim();
  const anchored = resolve(projectRoot, configured.length > 0 ? configured : './workspaces');
  const projectDir = join(anchored, 'forge', DEMO_PROJECT_ID);

  if (seedDemo === 'force') {
    return {
      decision: 'seed',
      reason:
        'SEED_DEMO=force: explicitly resetting forge-demo to its recorded version 1 (generated versions, staging and jobs in this project will be replaced).',
      projectRoot,
      workspaceRoot: anchored,
      projectDir,
      envFile,
    };
  }

  if (seedDemo !== 'auto' && seedDemo !== '') {
    return {
      decision: 'skip',
      reason: `Unrecognised SEED_DEMO=${JSON.stringify(seedDemo)} (expected auto, force or never); refusing to seed.`,
      projectRoot,
      workspaceRoot: anchored,
      projectDir,
      envFile,
    };
  }

  let present: boolean;
  try {
    if (!existsSync(projectDir)) {
      present = false;
    } else if (!statSync(projectDir).isDirectory()) {
      // A file where the project directory should be is not seedable state
      // and not seedable ground: ambiguous, so do not touch it.
      return {
        decision: 'skip',
        reason: `${projectDir} exists but is not a directory; refusing to seed over it. Remove it or set SEED_DEMO=force after inspecting it.`,
        projectRoot,
        workspaceRoot: anchored,
        projectDir,
        envFile,
      };
    } else {
      present = projectHasState(projectDir);
    }
  } catch (error) {
    return {
      decision: 'skip',
      reason: `Could not inspect ${projectDir} (${error instanceof Error ? error.message : String(error)}); refusing to seed over an unreadable state.`,
      projectRoot,
      workspaceRoot: anchored,
      projectDir,
      envFile,
    };
  }

  if (present) {
    return {
      decision: 'skip',
      reason: `Keeping the existing forge-demo project (${projectDir} holds recorded state); not reseeding. Reset with SEED_DEMO=force after stopping the app.`,
      projectRoot,
      workspaceRoot: anchored,
      projectDir,
      envFile,
    };
  }
  return {
    decision: 'seed',
    reason: `No forge-demo state under ${projectDir}; seeding the recorded demo.`,
    projectRoot,
    workspaceRoot: anchored,
    projectDir,
    envFile,
  };
}
