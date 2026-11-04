/**
 * `pnpm judge:check` — one command that tells a new reader which of the three
 * documented paths this machine can actually complete, before they start the
 * server and guess from an empty screen.
 *
 * Why this exists: the three paths (browse the demo project offline, generate
 * live applications through the coding CLI, use live media and SAM through a
 * server-side key) fail in ways that all look identical from the browser —
 * Studio opens fine and shows nothing interesting. The causes are local and
 * checkable: an unseeded workspace, no verification browser, no CLI on PATH, a
 * missing media key, or a container whose shipped default is the offline
 * provider.
 *
 * It performs **no network request and no model call of its own**: the probe is
 * PATH lookup, configuration, read-only queries and file hashing, which is also
 * why it is safe to run with no credentials configured. That is a claim about
 * this command, not about setup: `pnpm install` downloads dependencies from the
 * package registry, and running this script needs them installed. Login
 * validity and quota are reported as unverified with the command that settles
 * them, rather than inferred.
 *
 * The panel text comes from the same `probeSetupReadiness` + `formatSetupPanel`
 * the server prints at startup and that `GET /api/health` serves to the System
 * screen, so the three views of readiness cannot drift apart.
 *
 *   pnpm judge:check
 */

import { spawnSync } from 'node:child_process';
import type { SetupReadiness } from '@mml/shared';
import { loadConfig, loadDotEnv } from '../apps/server/src/config.js';
import { ForgeWorkspace } from '../apps/server/src/forge/workspace.js';
import {
  formatSetupPanel,
  gatherDemoSeedFacts,
  probeSetupReadiness,
  SEEDED_DEMO_PROJECT,
} from '../apps/server/src/setup-readiness.js';

const MIN_NODE_MAJOR = 24;

function toolVersion(command: string, args: string[]): string {
  try {
    const result = spawnSync(command, args, { encoding: 'utf8', timeout: 5_000 });
    if (result.status !== 0) return 'not found';
    return (result.stdout ?? '').trim().split('\n')[0] ?? 'not found';
  } catch {
    return 'not found';
  }
}

function lines(setup: SetupReadiness): string[] {
  const out: string[] = [];
  out.push('Muse Recall — judge readiness');
  out.push('');
  out.push(formatSetupPanel(setup));
  out.push('');
  out.push('Local toolchain');
  out.push(
    `  node                ${process.versions.node}${
      Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10) >= MIN_NODE_MAJOR
        ? ''
        : `  (needs ${MIN_NODE_MAJOR}+)`
    }`,
  );
  out.push(`  pnpm                ${toolVersion('pnpm', ['--version'])} (workspace pins 10.32.1)`);
  out.push('');
  out.push('What each path needs, and what you should see');
  out.push('');
  out.push('  1 · Explore offline (no credential; this path makes no provider call)');
  out.push('       pnpm install --frozen-lockfile');
  out.push('       pnpm demo:seed');
  out.push('       MODEL_PROVIDER=echo pnpm dev');
  out.push(
    `       then open http://127.0.0.1:5173 and pick "${SEEDED_DEMO_PROJECT}": recorded game, project decisions, a superseded palette, version history.`,
  );
  out.push(
    '       Expected: the System screen says the offline provider is active — that is this path working, not a failure.',
  );
  out.push('');
  out.push('  2 · Generate live applications (needs the CLI installed and logged in)');
  out.push('       muse --version && muse login');
  out.push('       pnpm exec playwright-core install chromium');
  out.push('       MODEL_PROVIDER=muse-cli pnpm dev');
  out.push(
    '       Expected: a Studio request stages a proposal, then shows preview / source / diff / memory references / Guard findings; approving publishes a version.',
  );
  out.push(
    '       Verification runs the staged application in a real browser before approval is offered, which is why the browser row above matters.',
  );
  out.push('');
  out.push('  3 · Live media and SAM (separate server-side key, separate quota)');
  out.push('       copy .env.example to .env, set FORGE_MUSE_API_KEY, restart the server');
  out.push(
    '       Expected: image generate/edit, reference-object selection, transcription and clip observation respond; screenshot review becomes available.',
  );
  out.push(
    '       A CLI login does not enable this path, and it never puts the key in the browser or in git.',
  );
  out.push('');
  out.push(
    '  Codespaces: the documented container installs neither the Muse CLI nor a login, so as',
  );
  out.push(
    '       shipped it runs the exploration path. The panel reads this instance’s actual provider',
  );
  out.push(
    '       setting and PATH, so a container you provisioned yourself is judged on what it has —',
  );
  out.push(
    '       though this project has not run live generation from a codespace, and login state is',
  );
  out.push('       never probed: it would be a live call.');
  out.push('  Guide and troubleshooting: docs/guide/FOR_JUDGES.md');
  return out;
}

async function main(): Promise<void> {
  const envFile = loadDotEnv();
  const config = loadConfig();
  const setup = probeSetupReadiness({
    providerId: config.provider.kind,
    cliBin: config.forge?.museBin ?? config.provider.museBin,
    mediaApiKey: config.forge?.apiKey ?? null,
    mediaModel: config.media?.model,
    samModel: config.media?.samModel,
    // Read-only inspection of the demo itself: the project record, the approved
    // version that project reports, and the artifact bytes against their hash.
    demo_seed: await gatherDemoSeedFacts({
      databasePath: config.databasePath,
      workspace: new ForgeWorkspace(config.workspaceRoot),
    }),
  });
  if (envFile) console.log(`env file: ${envFile}`);
  console.log(lines(setup).join('\n'));
  // Informational by design: a missing prerequisite on a path the reader has not
  // chosen yet is not an error, and a non-zero exit would make this unusable as a
  // first command in a guide. `GET /api/health` carries the same rows for gates.
}

void main();
