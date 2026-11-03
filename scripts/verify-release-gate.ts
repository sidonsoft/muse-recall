/**
 * `verify:release-gate` — one command that answers "would this stand up as a beta?".
 *
 * It runs the offline browser gates in sequence against freshly built production bundles, then reports
 * each gate's own outcome rather than a single blended verdict. Three things are deliberate:
 *
 * 1. **No provider credential may be present.** Every gate in this list is a measurement that spends
 *    nothing; a credential in the environment means the run being reported is not the run the release
 *    documents describe, so the whole gate refuses (exit 2) instead of running.
 * 2. **A gate that disappears is a failure, not a smaller pass.** The gate list is pinned by name and
 *    count, so a rename or a dropped step cannot quietly shrink the assurance while the headline still
 *    reads "N gates passed".
 * 3. **Blocked is not failed and not passed.** A missing browser or a stale bundle is a prerequisite
 *    problem; it prints `BLOCKED` with the fix and claims no measurement.
 *
 * The last line it prints is the one that matters most: none of these gates judge application quality.
 * That is a human decision, recorded separately.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { evidenceStamp, uniqueEvidenceDir } from './lib/evidence-dir.ts';
import { checkCountIssues, duplicateCheckNames } from './lib/gate-check-count.ts';

const ROOT = process.cwd();

interface GateSpec {
  /** The package.json script name, which is also what the release documents quote. */
  script: string;
  /** What the gate is relied on to prove, in the words the release notes use. */
  proves: string;
  timeoutMs: number;
  /** Where this gate writes its own evidence, so the release report can point at it. */
  evidenceParent: string;
}

const GATES: GateSpec[] = [
  {
    script: 'verify:security',
    proves: 'the origin guard refuses cross-origin writes',
    timeoutMs: 300_000,
    // It prints its measurements and exits; it keeps no evidence directory of its own.
    evidenceParent: '',
  },
  {
    script: 'verify:runtime',
    proves: 'an approved artifact runs in a real browser under the network policy',
    timeoutMs: 900_000,
    evidenceParent: 'test-results/runtime',
  },
  {
    script: 'verify:formsandbox',
    proves: 'a form inside an artifact cannot escape the preview sandbox',
    timeoutMs: 600_000,
    evidenceParent: '',
  },
  {
    script: 'verify:batchc-ui',
    proves: 'a suggested object becomes an inserted image the user approves',
    timeoutMs: 1_200_000,
    evidenceParent: 'test-results/batchc-ui',
  },
  {
    script: 'verify:batche-review-ui',
    proves: 'a screenshot review stays advisory and revision-pinned',
    timeoutMs: 1_200_000,
    evidenceParent: 'test-results/batche-review-ui',
  },
  {
    script: 'verify:batchd-playback-auth',
    proves: 'secured byte playback and download, and the build identity the release quotes',
    timeoutMs: 1_200_000,
    evidenceParent: 'test-results/batchd-playback-auth',
  },
  {
    script: 'verify:media-journey-offline',
    proves: 'asset → artifact → restart → rollback on uploaded bytes, with no provider',
    timeoutMs: 1_500_000,
    evidenceParent: 'test-results/media-journey',
  },
  {
    script: 'verify:studio-workflow',
    proves: 'the Studio UI drives generate → review → approve → restart end to end',
    timeoutMs: 1_800_000,
    // Reuses one fixed directory rather than a stamped one, so the release report names the directory
    // and the run inside it that produced the numbers quoted.
    evidenceParent: 'test-results/studio-after',
  },
  {
    script: 'verify:artifact-probes',
    proves: 'the probe battery can tell a stale published output from a fresh one',
    timeoutMs: 1_200_000,
    evidenceParent: 'test-results/artifact-probes',
  },
  {
    script: 'verify:beta-journey',
    proves: 'the beta user journey on production bundles, including both handover controls',
    timeoutMs: 1_200_000,
    evidenceParent: 'test-results/beta-journey',
  },
];

interface GateResult {
  script: string;
  proves: string;
  exit_code: number;
  outcome: 'pass' | 'fail' | 'blocked' | 'timeout';
  seconds: number;
  evidence_dir: string | null;
  checks: number | null;
  report_status: string | null;
  identity: Record<string, unknown> | null;
  log_tail: string;
}

function run(
  script: string,
  args: string[],
  timeoutMs: number,
): Promise<{ code: number; tail: string }> {
  return new Promise((resolve) => {
    const child = spawn('pnpm', ['run', script, ...args], {
      cwd: ROOT,
      env: offlineEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const lines: string[] = [];
    for (const stream of [child.stdout, child.stderr]) {
      stream?.setEncoding('utf8');
      stream?.on('data', (chunk: string) => {
        for (const line of chunk.split('\n')) {
          if (line.trim() === '') continue;
          lines.push(line);
          console.log(`    ${line}`);
        }
      });
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }, timeoutMs);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code: code === null ? -1 : code, tail: lines.slice(-12).join('\n') });
    });
  });
}

function offlineEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // The individual gates refuse on their own if a key is present; stripping here means the release
  // gate cannot be the thing that pays for a provider call by accident.
  for (const name of [
    'FORGE_MUSE_API_KEY',
    'FORGE_FALLBACK_API_KEY',
    'META_API_KEY',
    'BASETEN_API_KEY',
  ]) {
    delete env[name];
  }
  return env;
}

/**
 * Attribute an evidence directory only if this run produced it. Naming an older directory "the evidence
 * for this gate" would let a stale run stand in for a measurement that never happened.
 */
function evidenceFromRun(parent: string, startedAt: number): string | null {
  if (parent === '') return null;
  const absolute = join(ROOT, parent);
  if (!existsSync(absolute)) return null;
  const candidates = readdirSync(absolute)
    .map((entry) => ({ entry, at: statSync(join(absolute, entry)).mtimeMs }))
    .filter((item) => item.at >= startedAt - 2_000)
    .sort((left, right) => right.at - left.at);
  const newest = candidates[0];
  if (!newest) return null;
  // A gate that writes straight into its parent dir has no child to name.
  if (statSync(join(absolute, newest.entry)).isDirectory()) return join(parent, newest.entry);
  return parent;
}

function readReport(evidenceDir: string | null): Record<string, unknown> | null {
  if (!evidenceDir) return null;
  const file = join(ROOT, evidenceDir, 'report.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function main(): Promise<number> {
  const keys = [
    'FORGE_MUSE_API_KEY',
    'FORGE_FALLBACK_API_KEY',
    'META_API_KEY',
    'BASETEN_API_KEY',
  ].filter((name) => (process.env[name] ?? '').trim() !== '');
  if (keys.length > 0) {
    console.error(
      `BLOCKED: the release gate runs only gates that spend nothing, and provider credentials are exported (${keys.join(', ')}). Unset them, or run the paid gates separately with their own budget.`,
    );
    return 2;
  }

  const scripts = new Set(
    Object.keys(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts),
  );
  const undocumented = GATES.map((gate) => gate.script).filter((script) => !scripts.has(script));
  if (undocumented.length > 0) {
    console.error(
      `BLOCKED: the release gate names scripts that do not exist: ${undocumented.join(', ')} (KI-75: a document that names a command nobody can run is a defect)`,
    );
    return 2;
  }

  const stamp = evidenceStamp();
  const evidence = uniqueEvidenceDir(join(ROOT, 'test-results', 'release-gate'), stamp);
  const out = evidence.path;
  mkdirSync(out, { recursive: true });

  console.log(
    `\nrelease gate ${stamp} — ${GATES.length} gates, no provider credential in the environment`,
  );
  const built = await runBuild();
  if (built.code !== 0) {
    console.error(
      'BLOCKED: production bundles could not be built; the release identity would be unmeasurable',
    );
    return 2;
  }

  const results: GateResult[] = [];
  for (const gate of GATES) {
    console.log(`\n── ${gate.script} — ${gate.proves}`);
    const started = Date.now();
    const { code, tail } = await run(gate.script, [], gate.timeoutMs);
    const evidenceDir = evidenceFromRun(gate.evidenceParent, started);
    const report = readReport(evidenceDir);
    const checks =
      typeof report?.checks === 'number'
        ? report.checks
        : Array.isArray(report?.checks)
          ? report.checks.length
          : null;
    const identity =
      report && typeof report.observations === 'object' && report.observations !== null
        ? (((report.observations as Record<string, unknown>).build_provenance as
            | Record<string, unknown>
            | undefined) ??
          ((report.observations as Record<string, unknown>).buildProvenance as
            | Record<string, unknown>
            | undefined) ??
          null)
        : null;
    const outcome: GateResult['outcome'] =
      code === 0 ? 'pass' : code === 2 ? 'blocked' : code === -1 ? 'timeout' : 'fail';
    const entry: GateResult = {
      script: gate.script,
      proves: gate.proves,
      exit_code: code,
      outcome,
      seconds: Math.round((Date.now() - started) / 1000),
      evidence_dir: evidenceDir,
      checks,
      report_status: typeof report?.status === 'string' ? report.status : null,
      identity,
      log_tail: tail,
    };
    results.push(entry);
    console.log(
      `   → ${outcome.toUpperCase()} (${entry.seconds}s${checks === null ? '' : `, ${checks} checks`})`,
    );
  }

  const blocked = results.filter(
    (entry) => entry.outcome === 'blocked' || entry.outcome === 'timeout',
  );
  const failed = results.filter((entry) => entry.outcome === 'fail');
  const status = failed.length > 0 ? 'fail' : blocked.length > 0 ? 'blocked' : 'pass';

  const identityGate = results.find((entry) => entry.script === 'verify:batchd-playback-auth');
  const releaseIdentity = identityGate?.identity ?? null;

  const report = {
    gate: 'verify:release-gate',
    status,
    measured_at: new Date().toISOString(),
    provider_credentials_exported: 0,
    provider_calls: 0,
    gates: results.map((entry) => ({
      script: entry.script,
      proves: entry.proves,
      exit_code: entry.exit_code,
      outcome: entry.outcome,
      seconds: entry.seconds,
      evidence_dir: entry.evidence_dir,
      checks: entry.checks,
      report_status: entry.report_status,
      identity: entry.identity,
    })),
    gate_logs: results.map((entry) => ({ script: entry.script, log_tail: entry.log_tail })),
    release_identity: releaseIdentity,
    human_review_status: 'required_not_performed',
    evidence_dir: out,
    note: 'A pass here means every offline gate above measured what it claims. It says nothing about whether the applications the product generates are good, and no gate in this list is allowed to claim otherwise.',
  };
  writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const lines = [
    `# Release gate ${stamp}`,
    '',
    `Status: **${status.toUpperCase()}** — ${results.filter((entry) => entry.outcome === 'pass').length}/${results.length} gates passed.`,
    '',
    '| gate | outcome | checks | seconds | evidence |',
    '| --- | --- | --- | --- | --- |',
    ...results.map(
      (entry) =>
        `| \`${entry.script}\` | ${entry.outcome} | ${entry.checks ?? '—'} | ${entry.seconds} | \`${entry.evidence_dir ?? '—'}\` |`,
    ),
    '',
    '## What the release may claim about its bytes',
    '',
    '```json',
    JSON.stringify(releaseIdentity ?? { identity: 'not measured' }, null, 2),
    '```',
    '',
    '## What this gate does not claim',
    '',
    report.note,
    '',
  ];
  writeFileSync(join(out, 'RELEASE-GATE.md'), `${lines.join('\n')}\n`, 'utf8');

  console.log(`\n${status.toUpperCase()} — ${results.length} gates — evidence: ${out}`);
  for (const entry of failed)
    console.log(`FAILED: ${entry.script} — ${entry.log_tail.split('\n').slice(-2).join(' ')}`);
  for (const entry of blocked) console.log(`BLOCKED: ${entry.script} (${entry.outcome})`);
  if (releaseIdentity) {
    console.log(
      `release identity: commit ${String(releaseIdentity.commit ?? '?').slice(0, 7)}, commit-identity claim supported: ${String(releaseIdentity.supportsCommitIdentity ?? false)}`,
    );
  }
  console.log(
    "HUMAN REVIEW REQUIRED: no gate in this list judges application quality; that is a person's decision.",
  );

  const issues = checkCountIssues({
    measured: results.map((entry) => entry.script),
    min: GATES.length,
    required: GATES.map((entry) => entry.script),
    duplicates: duplicateCheckNames(results.map((entry) => entry.script)),
  });
  if (issues.length > 0) {
    console.error(issues.join('\n'));
    return 1;
  }
  return status === 'pass' ? 0 : status === 'blocked' ? 2 : 1;
}

/** Build step, kept separate because the release identity is meaningless without it. */
async function runBuild(): Promise<{ code: number }> {
  console.log('\n── build: tsx scripts/build-production-bundles.ts');
  const { code } = await new Promise<{ code: number }>((resolve) => {
    const child = spawn(process.execPath, ['scripts/build-production-bundles.ts'], {
      cwd: ROOT,
      env: offlineEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const stream of [child.stdout, child.stderr]) {
      stream?.setEncoding('utf8');
      stream?.on('data', (chunk: string) => {
        for (const line of chunk.split('\n')) if (line.trim()) console.log(`    ${line}`);
      });
    }
    child.on('exit', (exitCode) => resolve({ code: exitCode ?? 1 }));
  });
  return { code };
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
