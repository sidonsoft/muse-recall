/**
 * The documented first run, turned into a gate.
 *
 * README's first-run instruction is `MODEL_PROVIDER=echo pnpm dev` followed by
 * opening http://127.0.0.1:5173. This script starts exactly that, opens the app
 * in the managed browser, walks the screens the guide documents, and fails if the
 * app does not mount, if the server is not the offline provider, if anything
 * leaves the machine, or if the console logs an error on any screen.
 *
 * It exists because production-bundle gates cannot see this class of defect:
 * React strips development warnings from production builds, so a duplicate
 * sibling key — which is what this caught — passes every production gate and
 * still lands in front of a new user. Run it against a clean clone with
 * `pnpm verify:fresh-install`.
 *
 *   pnpm verify:first-run
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launchVerificationBrowser, reportBrowserSelection } from './lib/browser.js';
import {
  DOCUMENTED_PORTS,
  FirstRunBlocked,
  type FirstRunObservation,
  firstRunIssues,
  inspectFirstRun,
  withDocumentedFirstRun,
} from './lib/first-run.js';
import { liveCredentialProblems } from './lib/fresh-install.js';

const ROOT = resolve(import.meta.dirname, '..');
const STAMP = new Date().toISOString().slice(0, 16).replace('T', '-').replace(/:/g, '');
const EVIDENCE = join(ROOT, 'test-results', 'first-run', STAMP);
const PNPM = process.env.FIRST_RUN_PNPM ?? 'pnpm';
const SCREENS = ['HTML Studio', 'Memory', 'Conversations', 'System'];

const checks: string[] = [];
const notes: string[] = [];

function log(message: string): void {
  console.log(message);
}

function write(status: string, failed: string[], observation?: FirstRunObservation): void {
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(
    join(EVIDENCE, 'report.json'),
    `${JSON.stringify(
      {
        gate: 'first-run',
        stamp: STAMP,
        status,
        checks,
        failed,
        notes,
        observation: observation ?? null,
        devLog: join(EVIDENCE, 'console', 'dev.log'),
      },
      null,
      2,
    )}\n`,
  );
  log('');
  log(`Documented first run: ${status} (${String(checks.length)} checks)`);
  for (const failure of failed) log(`  ✗ ${failure}`);
  log(`evidence: ${EVIDENCE}`);
}

function pass(description: string, detail = ''): void {
  checks.push(description);
  log(`  ✓ ${description}${detail ? ` (${detail})` : ''}`);
}

function fail(description: string, detail: string): never {
  log(`  ✗ ${description} (${detail})`);
  write('FAILED before completion', [`${description}: ${detail}`]);
  process.exit(1);
}

async function main(): Promise<void> {
  mkdirSync(join(EVIDENCE, 'console'), { recursive: true });
  log(`Documented first run: ${DOCUMENTED_PORTS.api} API, ${DOCUMENTED_PORTS.web} web`);

  const credentials = liveCredentialProblems(process.env);
  if (credentials.length > 0) {
    write('BLOCKED before the first run', [
      `the first run is the offline path; these are set, so what started would not be what README describes: ${credentials.join(', ')}`,
    ]);
    process.exit(2);
  }

  const { browser, selection } = await launchVerificationBrowser();
  reportBrowserSelection(selection);
  let run: Awaited<ReturnType<typeof withDocumentedFirstRun<FirstRunObservation>>>;
  try {
    run = await withDocumentedFirstRun(
      {
        command: [PNPM, 'dev'],
        cwd: ROOT,
        logFile: join(EVIDENCE, 'console', 'dev.log'),
      },
      async (urls) =>
        inspectFirstRun({
          browser,
          webUrl: urls.webUrl,
          apiUrl: urls.apiUrl,
          screenshotTo: join(EVIDENCE, 'first-run.png'),
          visitTabs: SCREENS,
        }),
    );
  } catch (error: unknown) {
    await browser.close();
    if (error instanceof FirstRunBlocked) {
      write('BLOCKED before the first run', [error.message]);
      process.exit(2);
    }
    throw error;
  }
  await browser.close();

  const observation = run.value;
  // Readiness and the screen walkthrough are printed apart: folding them together
  // would call a multi-second walkthrough "startup".
  pass(
    'both documented ports answered',
    `${String(run.startupMs)}ms to ready, ${String(run.walkthroughMs)}ms walking the screens`,
  );
  const issues = firstRunIssues(observation);
  if (issues.length > 0) fail('the documented first run does not hold up', issues.join('; '));
  pass(
    'the app mounts on the echo provider and every documented screen loads without console errors',
    `${String(observation.provider)}, ${observation.tabsVisited.join(' / ')}`,
  );
  const outbound = [...new Set(observation.nonLocalRequests)];
  pass(
    'the only host the fresh app contacted is the allowlisted Phaser CDN',
    outbound.length > 0 ? outbound.join(', ') : 'no outbound requests at all',
  );
  if (observation.buildIdentity !== null) {
    fail(
      'the development server reported a build identity',
      observation.buildIdentity.slice(0, 12),
    );
  }
  if (!run.portsReleased) {
    fail(
      'the first run left a listener behind',
      `port ${String(DOCUMENTED_PORTS.web)} still answering`,
    );
  }
  pass('the first run shuts down without leaving a listener behind');

  notes.push(`inspected with ${selection.selected ?? selection.attempted}`);
  notes.push(
    'console errors and outbound requests were captured across the screen walk, not only at first paint',
  );
  write('PASS', [], observation);
}

main().catch((error: unknown) => {
  log(`first-run check stopped: ${String(error)}`);
  write('FAILED before completion', [String(error)]);
  process.exit(1);
});
