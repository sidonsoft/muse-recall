/**
 * Fresh-install rehearsal (release gate §5 item 7): does the documented install
 * path actually work, from a clone nobody has worked in, on this machine, with no
 * provider key?
 *
 * It clones this repository over the local filesystem — never a remote — then
 * does what README.md tells a newcomer to do, in README order, recording every
 * step's real exit code and duration: `pnpm install`, `pnpm run verify`,
 * `pnpm build`, the provenance bundle build, the documented first run
 * (`MODEL_PROVIDER=echo pnpm dev`) on the documented ports, the backup and media
 * restore drills, and finally the newest production browser gate *inside the
 * clone*, so the build identity that gate proves belongs to a clean tree rather
 * than to a developer's working copy.
 *
 * A rehearsal must not be able to pay for anything: it refuses to start when a
 * live provider key is in the environment, and it ends by checking that a clean
 * clone refuses to dispatch a live call too.
 *
 *   pnpm verify:fresh-install
 *   FRESH_INSTALL_KEEP=1 pnpm verify:fresh-install   # keep the clone afterwards
 *
 * The clone lives inside the evidence directory and is removed at the end unless
 * it is being kept on purpose. Nothing outside the evidence directory is written.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { arch, platform, release } from 'node:os';
import { join, resolve } from 'node:path';
import { launchVerificationBrowser, reportBrowserSelection } from './lib/browser.js';
import { manifestPath, readManifest } from './lib/build-provenance.js';
import {
  DOCUMENTED_PORTS,
  FirstRunBlocked,
  type FirstRunObservation,
  firstRunIssues,
  inspectFirstRun,
  withDocumentedFirstRun,
} from './lib/first-run.js';
import {
  cloneStateIssues,
  type EnvironmentManifest,
  environmentManifest,
  installSummary,
  liveCredentialProblems,
  type ProvenanceManifestView,
  provenanceIssues,
  type StepRecord,
  stepRecord,
} from './lib/fresh-install.js';

const ROOT = resolve(import.meta.dirname, '..');
const COMMIT = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).toString().trim();
const STAMP = new Date().toISOString().slice(0, 16).replace('T', '-').replace(/:/g, '');
const EVIDENCE = join(ROOT, 'test-results', 'fresh-install', STAMP);
const CONSOLE = join(EVIDENCE, 'console');
const CLONE = join(EVIDENCE, 'clone');
const KEEP = process.env.FRESH_INSTALL_KEEP === '1';
const PNPM = process.env.FRESH_INSTALL_PNPM ?? 'pnpm';

const checks: string[] = [];
const notes: string[] = [];
const steps: StepRecord[] = [];
let environment: EnvironmentManifest | Record<string, never> = {};

function log(message: string): void {
  console.log(message);
}

function write(status: string, failed: string[]): void {
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(
    join(EVIDENCE, 'report.json'),
    `${JSON.stringify({ gate: 'fresh-install', stamp: STAMP, commit: COMMIT, status, environment, steps, checks, failed, notes }, null, 2)}\n`,
  );
  log('');
  log(`Fresh-install rehearsal: ${status} (${checks.length} checks)`);
  for (const failure of failed) log(`  ✗ ${failure}`);
  log(`evidence: ${EVIDENCE}`);
}

function fail(description: string, detail: string): never {
  log(`  ✗ ${description}${detail ? ` (${detail})` : ''}`);
  write('FAILED before completion', [`${description}${detail ? `: ${detail}` : ''}`]);
  process.exit(1);
}

function pass(description: string, detail = ''): void {
  checks.push(description);
  log(`  ✓ ${description}${detail ? ` (${detail})` : ''}`);
}

/** Run one documented command, record its real outcome, and stop on a fatal one. */
function step(
  name: string,
  argv: [string, ...string[]],
  cwd: string,
  options: {
    timeoutMs: number;
    /** Default true: a step that must work for the rehearsal to mean anything. */
    isFatal?: boolean;
    expectExit?: number;
    env?: NodeJS.ProcessEnv;
    /** Check text to record on success; defaults to the step name. */
    check?: string;
  },
): StepRecord {
  mkdirSync(CONSOLE, { recursive: true });
  const logFile = join(CONSOLE, `${name.replace(/[^\w-]+/g, '_')}.log`);
  const started = Date.now();
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd,
    env: options.env ?? process.env,
    timeout: options.timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    encoding: 'utf8',
  });
  const durationMs = Date.now() - started;
  const timedOut = (result.error as { code?: string } | undefined)?.code === 'ETIMEDOUT';
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}${
    result.error && !timedOut ? `\nspawn error: ${String(result.error)}` : ''
  }`;
  writeFileSync(logFile, output.slice(-2_000_000));
  const record = stepRecord({
    name,
    argv,
    cwd,
    exitCode: result.status ?? null,
    durationMs,
    output,
    timedOut,
    logFile,
    expectExit: options.expectExit,
  });
  steps.push(record);
  const detail = `exit ${record.exitCode}, ${(durationMs / 1000).toFixed(1)}s`;
  if (!record.ok) {
    for (const line of record.tail.slice(-8)) log(`      ${line}`);
    if (options.isFatal === false) {
      notes.push(`${name} did not succeed (${detail}); the rehearsal continued and recorded it`);
      return record;
    }
    fail(name, detail);
  }
  pass(options.check ?? name, detail);
  return record;
}

function capture(argv: [string, ...string[]]): string | null {
  try {
    const output = execFileSync(argv[0], argv.slice(1), {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 20_000,
    })
      .toString()
      .trim();
    const firstLine = output.split('\n')[0] ?? '';
    // A tool that prints nothing is recorded as absent, not as an empty version.
    return firstLine === '' ? null : firstLine.slice(0, 120);
  } catch {
    return null;
  }
}

function toolVersion(argv: [string, ...string[]], pattern: RegExp): string | null {
  const out = capture(argv);
  return out && pattern.test(out) ? out : null;
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).toString().trim();
}

async function main(): Promise<void> {
  mkdirSync(EVIDENCE, { recursive: true });
  log(`Fresh-install rehearsal at ${COMMIT.slice(0, 12)} — evidence in ${EVIDENCE}`);

  const credentials = liveCredentialProblems(process.env);
  if (credentials.length > 0) {
    write('BLOCKED before any install', [
      `a rehearsal must not be able to spend a provider call, but these are set: ${credentials.join(', ')}`,
    ]);
    process.exit(2);
  }

  const versions: Record<string, string | null> = {
    node: process.version,
    pnpm: capture([PNPM, '--version']),
    git: capture(['git', '--version']),
    python3: capture(['python3', '--version']),
    ffmpeg: toolVersion(['ffmpeg', '-version'], /ffmpeg/),
    ffprobe: toolVersion(['ffprobe', '-version'], /ffprobe/),
    say: capture(['/usr/bin/say', '-v']),
  };
  const { browser, selection } = await launchVerificationBrowser();
  reportBrowserSelection(selection);
  await browser.close();
  environment = environmentManifest({
    platform: platform(),
    release: release(),
    arch: arch(),
    node: process.version,
    versions,
    env: process.env,
    browserPolicy: selection.policy,
  });
  writeFileSync(join(EVIDENCE, 'environment.json'), `${JSON.stringify(environment, null, 2)}\n`);
  notes.push(
    `browser: ${selection.selected ?? selection.attempted}; credentials recorded as presence only, never values`,
  );

  // 1. Clone from the local repository only, then pin it to the tested commit.
  step(
    'clone from the local repository',
    ['git', 'clone', '--quiet', '--no-hardlinks', ROOT, CLONE],
    ROOT,
    {
      timeoutMs: 5 * 60_000,
    },
  );
  step('check out the tested commit', ['git', 'checkout', '--quiet', COMMIT], CLONE, {
    timeoutMs: 60_000,
  });
  const cloneCommit = git(CLONE, ['rev-parse', 'HEAD']);
  const cloneClean = git(CLONE, ['status', '--porcelain']) === '';
  const cloneIssues = cloneStateIssues(
    { commit: cloneCommit, clean: cloneClean, branch: null },
    COMMIT,
  );
  if (cloneIssues.length > 0)
    fail('the clone is not the tested commit on a clean tree', cloneIssues.join('; '));
  pass('the clone is the tested commit on a clean tree', cloneCommit.slice(0, 12));

  // 2. The documented install command, with --frozen-lockfile so the rehearsal
  //    cannot quietly rewrite the lockfile it is supposed to prove.
  const install = step(
    'pnpm install --frozen-lockfile',
    [PNPM, 'install', '--frozen-lockfile'],
    CLONE,
    {
      timeoutMs: 20 * 60_000,
    },
  );
  const lockfileUntouched = git(CLONE, ['status', '--porcelain']) === '';
  if (!lockfileUntouched) {
    fail(
      'pnpm install changed the clean clone',
      `untracked or modified: ${git(CLONE, ['status', '--porcelain'])}`,
    );
  }
  pass('the install left the lockfile and tree alone', 'git status empty afterwards');
  const summary = installSummary(
    existsSync(install.logFile) ? readFileSync(install.logFile, 'utf8') : '',
  );
  if (summary.downloaded === 0) {
    pass(
      'the install needed no package downloads',
      `reused ${summary.reused ?? '?'} from the local store`,
    );
  } else if (summary.downloaded === null) {
    notes.push(
      'the install output carried no reusable/downloaded summary, so offline install is not claimed',
    );
  } else {
    notes.push(
      `the install downloaded ${summary.downloaded} package(s); a bare machine would need network`,
    );
  }

  // 3. The aggregate check, from a tree that has never been run in.
  step('pnpm run verify in the clone', [PNPM, 'run', 'verify'], CLONE, {
    timeoutMs: 25 * 60_000,
    check: 'lint, product typecheck, test typecheck and the suite pass in a clean clone',
  });

  // 4. The documented production build, then the provenance bundle build whose
  //    manifest has to name this clone's own commit.
  step('pnpm build in the clone', [PNPM, 'build'], CLONE, { timeoutMs: 15 * 60_000 });
  step(
    'build production bundles in the clone',
    [PNPM, 'exec', 'tsx', 'scripts/build-production-bundles.ts'],
    CLONE,
    {
      timeoutMs: 10 * 60_000,
    },
  );
  // Read the manifests through the same helper the gates use, so the rehearsal
  // judges the real contract rather than a guessed filename.
  const manifests: ProvenanceManifestView[] = [];
  for (const distDir of [
    join(CLONE, 'apps', 'server', 'dist'),
    join(CLONE, 'apps', 'web', 'dist'),
  ] as const) {
    const manifest = readManifest(distDir);
    if (!manifest) {
      manifests.push({
        kind: distDir.endsWith('server') ? 'server' : 'web',
        commit: '<missing>',
        treeClean: false,
        sourceHash: '',
        buildHash: '',
      });
      continue;
    }
    manifests.push({
      kind: manifest.component,
      commit: manifest.commit,
      treeClean: manifest.treeClean === true,
      sourceHash: manifest.sourceHash,
      buildHash: manifest.buildHash ?? '',
    });
  }
  const provenance = provenanceIssues(manifests, cloneCommit);
  if (provenance.length > 0)
    fail(
      'the clone could not prove its own build identity',
      `${provenance.join('; ')} (looked at ${manifestPath(join(CLONE, 'apps', 'server', 'dist'))})`,
    );
  pass(
    'a clean clone can build the production bundles and prove its own identity',
    manifests.map((manifest) => `${manifest.kind} ${manifest.buildHash.slice(0, 12)}`).join(', '),
  );

  // 5. The documented first run, on the documented ports.
  let firstRun: {
    value: FirstRunObservation & { browser: string };
    startupMs: number;
    portsReleased: boolean;
  };
  try {
    firstRun = await withDocumentedFirstRun(
      {
        command: [PNPM, 'dev'],
        cwd: CLONE,
        logFile: join(CONSOLE, 'first-run-dev.log'),
      },
      async (urls) => {
        const { browser, selection } = await launchVerificationBrowser();
        try {
          return {
            ...(await inspectFirstRun({
              browser,
              webUrl: urls.webUrl,
              apiUrl: urls.apiUrl,
              screenshotTo: join(EVIDENCE, 'first-run.png'),
              visitTabs: ['HTML Studio', 'Memory', 'Conversations', 'System'],
            })),
            browser: selection.selected ?? selection.attempted,
          };
        } finally {
          await browser.close();
        }
      },
    );
  } catch (error: unknown) {
    if (error instanceof FirstRunBlocked) {
      write('BLOCKED before the first run', [error.message]);
      process.exit(2);
    }
    throw error;
  }
  const observation = firstRun.value;
  notes.push(`first run inspected with ${observation.browser}`);
  pass(
    'both documented ports answered within the startup window',
    `${String(firstRun.startupMs)}ms`,
  );
  const runIssues = firstRunIssues(observation);
  if (runIssues.length > 0)
    fail('the documented first run does not work in a clean install', runIssues.join('; '));
  pass(
    'the first run serves a mounted app on the echo provider, with no non-local requests',
    `provider ${String(observation.provider)}, environment ${String(observation.environment)}`,
  );
  if (!firstRun.portsReleased) {
    fail(
      'the first run left a listener behind after being stopped',
      `port ${String(DOCUMENTED_PORTS.web)}`,
    );
  }
  pass('the first run shuts down without leaving a listener behind');

  // 6. Recovery drills, inside the clone.
  step('media backup and restore drill', [PNPM, 'media:drill'], CLONE, { timeoutMs: 10 * 60_000 });
  step('database backup and restore drill', [PNPM, 'backup:drill'], CLONE, {
    timeoutMs: 10 * 60_000,
  });

  // 7. The newest production browser gate, run inside the clean clone. Its own
  //    report records the bundle identity, so what it proves is the clone.
  step('production browser gate in the clone', [PNPM, 'verify:batchd-playback-auth'], CLONE, {
    timeoutMs: 20 * 60_000,
  });
  copyCloneGateReports();

  // 8. A clean clone must refuse to spend money unless told to.
  step(
    'a live smoke refuses to run without a key',
    [PNPM, 'exec', 'tsx', 'scripts/verify-batchc-live-smoke.ts'],
    CLONE,
    {
      timeoutMs: 5 * 60_000,
      expectExit: 2,
      check: 'a clean clone blocks a live run rather than spending a call',
    },
  );

  if (KEEP) {
    notes.push(`the clone was kept at ${CLONE}`);
  } else {
    rmSync(CLONE, { recursive: true, force: true });
    notes.push('the clone was removed afterwards; FRESH_INSTALL_KEEP=1 keeps it');
  }
  write('PASS', []);
}

/** Keep the reports the clone's own gates produced, before the clone goes away. */
function copyCloneGateReports(): void {
  for (const gate of ['batchd-playback-auth']) {
    const dir = join(CLONE, 'test-results', gate);
    if (!existsSync(dir)) {
      notes.push(`the clone produced no ${gate} report directory`);
      continue;
    }
    for (const stamp of readdirSync(dir)) {
      const report = join(dir, stamp, 'report.json');
      if (!existsSync(report)) continue;
      const target = join(EVIDENCE, 'clone-gates', gate, stamp);
      mkdirSync(target, { recursive: true });
      writeFileSync(join(target, 'report.json'), readFileSync(report));
      const parsed = JSON.parse(readFileSync(report, 'utf8')) as {
        observations?: { buildProvenance?: unknown };
      };
      const provenance = parsed.observations?.buildProvenance;
      if (provenance && typeof provenance === 'object') {
        notes.push(`clone ${gate} provenance: ${JSON.stringify(provenance)}`);
      }
    }
  }
}

main().catch((error: unknown) => {
  log(`fresh-install rehearsal stopped: ${String(error)}`);
  write('FAILED before completion', [String(error)]);
  process.exit(1);
});
