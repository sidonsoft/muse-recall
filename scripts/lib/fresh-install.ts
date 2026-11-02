/**
 * Fresh-install rehearsal: the parts of it that can be decided without running
 * anything (release gate §5 item 7).
 *
 * A fresh-install rehearsal is easy to fake: clone into a directory that already
 * has the artifacts, or run the steps with the developer's shell environment —
 * including a live provider key — and the exercise proves nothing. These helpers
 * keep it honest: the clone must be at the tested commit and clean, every step
 * records its real exit code and how long it took, the environment manifest
 * records which credentials were *present* without ever recording their values,
 * and a rehearsal run must not be able to spend a provider call at all.
 */

import { redactSecrets } from '../../packages/shared/src/redact.js';

/** Command-line environment variables that would let a rehearsal pay for a call. */
export const LIVE_CREDENTIAL_VARS = [
  'FORGE_MUSE_API_KEY',
  'FORGE_FALLBACK_API_KEY',
  'META_API_KEY',
];

/** How many trailing output lines a step keeps in the report. */
export const STEP_TAIL_LINES = 40;

export interface StepRecord {
  name: string;
  command: string;
  /** Null when the step could not be started at all. */
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  ok: boolean;
  /** Tail of the combined output, secret-redacted, so a failure explains itself. */
  tail: string[];
  logFile: string;
}

export interface StepInput {
  name: string;
  argv: string[];
  cwd: string;
  exitCode: number | null;
  durationMs: number;
  output: string;
  timedOut?: boolean;
  logFile: string;
  /** Steps that are allowed to fail without failing the rehearsal. */
  fatal?: boolean;
  /** Expected exit code when the step's whole point is a refusal. */
  expectExit?: number;
}

/**
 * Shape one step's result. A step fails when its exit code is not the expected
 * one, when it timed out, or when it never started.
 */
export function stepRecord(input: StepInput): StepRecord {
  const expected = input.expectExit ?? 0;
  const tail = input.output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line !== '')
    .slice(-STEP_TAIL_LINES)
    .map((line) => redactSecrets(line, { maxLength: 500 }));
  return {
    name: input.name,
    command: input.argv.join(' '),
    exitCode: input.exitCode,
    durationMs: input.durationMs,
    timedOut: input.timedOut === true,
    ok: !input.timedOut && input.exitCode === expected,
    tail,
    logFile: input.logFile,
  };
}

export interface EnvironmentManifest {
  platform: string;
  release: string;
  arch: string;
  node: string;
  pnpm: string | null;
  git: string | null;
  tools: Record<string, string | null>;
  /** Presence only. The values never reach this file, the report, or the logs. */
  credentialsPresent: Record<string, boolean>;
  browserPolicy: string;
  cloneIsolation: string;
}

/**
 * What the machine provided. Tool versions are recorded so a claim like "works on
 * a clean install" can be reproduced or refuted rather than relitigated.
 */
export function environmentManifest(options: {
  platform: string;
  release: string;
  arch: string;
  node: string;
  versions: Record<string, string | null>;
  env: NodeJS.ProcessEnv;
  browserPolicy: string;
}): EnvironmentManifest {
  const credentialsPresent: Record<string, boolean> = {};
  for (const name of LIVE_CREDENTIAL_VARS) {
    credentialsPresent[name] = (options.env[name] ?? '').trim() !== '';
  }
  const tools: Record<string, string | null> = {};
  for (const [name, value] of Object.entries(options.versions)) {
    if (name === 'node' || name === 'pnpm' || name === 'git') continue;
    tools[name] = value;
  }
  return {
    platform: options.platform,
    release: options.release,
    arch: options.arch,
    node: options.node,
    pnpm: options.versions.pnpm ?? null,
    git: options.versions.git ?? null,
    tools,
    credentialsPresent,
    browserPolicy: options.browserPolicy,
    cloneIsolation: 'local file clone only — no remote was contacted',
  };
}

/** Names of live credentials that are set; a rehearsal must run with none of them. */
export function liveCredentialProblems(env: NodeJS.ProcessEnv): string[] {
  return LIVE_CREDENTIAL_VARS.filter((name) => (env[name] ?? '').trim() !== '');
}

export interface CloneState {
  commit: string;
  clean: boolean;
  branch: string | null;
}

/** The clone must be the commit under test, not whatever the working tree holds. */
export function cloneStateIssues(clone: CloneState, testedCommit: string): string[] {
  const issues: string[] = [];
  if (clone.commit !== testedCommit) {
    issues.push(`the clone is at ${clone.commit}, not the tested commit ${testedCommit}`);
  }
  if (!clone.clean)
    issues.push('the clone is not clean, so its build identity is not the tested one');
  return issues;
}

export interface ProvenanceManifestView {
  kind: string;
  commit: string;
  treeClean: boolean;
  sourceHash: string;
  buildHash: string;
}

/**
 * A clean clone must be able to produce the same provenance discipline the
 * developer sees: a manifest naming its own commit, on a clean tree, with real
 * hashes. Anything else means the build is lying about what it contains.
 */
export function provenanceIssues(
  manifests: ProvenanceManifestView[],
  cloneCommit: string,
): string[] {
  const issues: string[] = [];
  if (manifests.length === 0) return ['no build manifest was written by the clone'];
  for (const manifest of manifests) {
    if (manifest.commit !== cloneCommit) {
      issues.push(`${manifest.kind} bundle names commit ${manifest.commit}, not ${cloneCommit}`);
    }
    if (!manifest.treeClean) issues.push(`${manifest.kind} bundle was built from a dirty tree`);
    if (!/^[0-9a-f]{16,64}$/.test(manifest.sourceHash)) {
      issues.push(`${manifest.kind} bundle has no usable source hash`);
    }
    if (!/^[0-9a-f]{16,64}$/.test(manifest.buildHash)) {
      issues.push(`${manifest.kind} bundle has no usable build hash`);
    }
  }
  const kinds = new Set(manifests.map((manifest) => manifest.kind));
  for (const kind of ['server', 'web']) {
    if (!kinds.has(kind)) issues.push(`the clone built no ${kind} bundle manifest`);
  }
  return issues;
}

export interface InstallSummary {
  /** Package downloads pnpm reported. Null when the summary line was not found. */
  downloaded: number | null;
  reused: number | null;
}

/**
 * What the package manager itself said about fetching. `downloaded 0` is the
 * evidence that a clean install is satisfied from the local store; the absence
 * of the line is not evidence of anything, so it comes back as null and the
 * caller must not claim offline installation.
 */
export function installSummary(output: string): InstallSummary {
  // Take the last progress line that reports the numbers: pnpm prints several,
  // and the final one is the total.
  const line = output
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => /reused \d+|downloaded \d+/.test(entry))
    .at(-1);
  const downloaded = /downloaded (\d+)/.exec(line ?? '')?.[1];
  const reused = /reused (\d+)/.exec(line ?? '')?.[1];
  return {
    downloaded: downloaded === undefined ? null : Number(downloaded),
    reused: reused === undefined ? null : Number(reused),
  };
}
