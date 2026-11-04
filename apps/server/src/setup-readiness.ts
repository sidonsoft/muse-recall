import { existsSync, readdirSync } from 'node:fs';
import { basename } from 'node:path';
import {
  DEFAULT_MEDIA_IMAGE_MODEL,
  DEFAULT_SAM_MODEL,
  type SetupProbe,
  type SetupReadiness,
  SetupReadinessSchema,
} from '@mml/shared';
import { chromium } from 'playwright-core';
import { isCliAvailable } from './forge/cli-lookup.js';

/**
 * Setup readiness: the three documented judge paths, stated as prerequisites
 * rather than as promises.
 *
 * A judge decides in the first two minutes whether this project is runnable.
 * `GET /api/health` already answers "is the server healthy", which is a
 * different question from "can I do the thing the README told me to do": a
 * perfectly healthy server running `MODEL_PROVIDER=echo` cannot generate an
 * application; a healthy server with no seeded workspace shows an empty Studio;
 * and a healthy server with no verification browser can stage an application
 * but can never verify or approve one.
 *
 * So this probe answers only the questions it can answer **without a network
 * request and without spending quota**: file existence, PATH lookup, environment
 * variables. It never puts a secret value in the payload — the media row says
 * that a key is configured, never what it is. Anything that would need a model
 * call (is the login valid? is there quota left?) is reported as `not_probed`
 * with the command that settles it, because guessing those states from a startup
 * probe is how a status panel starts lying.
 */

/** The demo project `pnpm demo:seed` creates (the README first run). */
export const SEEDED_DEMO_PROJECT = 'forge-demo';

export interface SetupReadinessInput {
  env?: NodeJS.ProcessEnv;
  /** Active provider id (`muse-cli` or `echo`). */
  providerId: string;
  /** Coding CLI binary used for generation, resolved from configuration. */
  cliBin?: string;
  /** Forge media key material — read for presence only, never reported. */
  mediaApiKey: string | null;
  mediaModel?: string;
  samModel?: string;
  /** `managed` (Playwright Chromium) or `chrome` (system Chrome). */
  runtimeBrowser?: 'managed' | 'chrome';
  databasePath: string;
  workspaceRoot: string;
  /** Injectable for tests; the real lookups are the defaults. */
  cliLookup?: (bin: string) => boolean;
  browserExecutable?: () => string | null;
  fileExists?: (path: string) => boolean;
  workspaceEntries?: (path: string) => string[];
}

function inCodespaces(env: NodeJS.ProcessEnv): boolean {
  return env.CODESPACES?.trim().toLowerCase() === 'true' || Boolean(env.CODESPACE_NAME?.trim());
}

/**
 * Where the managed browser would live. `playwright-core` answers a path
 * whether or not the browser was ever installed, so existence is the test.
 */
function managedBrowserPath(): string | null {
  try {
    const path = chromium.executablePath();
    return typeof path === 'string' && path.length > 0 ? path : null;
  } catch {
    return null;
  }
}

/** System-Chrome policy: the documented locations, PATH included. */
function systemChromePath(options: {
  lookup: (bin: string) => boolean;
  exists: (path: string) => boolean;
}): string {
  for (const name of ['google-chrome-stable', 'google-chrome', 'chrome']) {
    if (options.lookup(name)) return name;
  }
  const candidates =
    process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
      : ['/opt/google/chrome/chrome'];
  return candidates.find((candidate) => options.exists(candidate)) ?? '';
}

/** Same floor the configuration schema puts on `FORGE_MUSE_API_KEY`. */
function mediaKeyUsable(key: string | null): boolean {
  return typeof key === 'string' && key.trim().length >= 10;
}

/**
 * The probe. Never throws: a broken environment is exactly what this panel
 * exists to describe, so every branch degrades into a row plus a fix.
 */
export function probeSetupReadiness(input: SetupReadinessInput): SetupReadiness {
  const env = input.env ?? process.env;
  const exists = input.fileExists ?? safeExists;
  const lookup = input.cliLookup ?? ((bin: string) => isCliAvailable(bin, env));
  const runtimeBrowser =
    input.runtimeBrowser ?? (env.FORGE_RUNTIME_BROWSER === 'chrome' ? 'chrome' : 'managed');
  // Same default the configuration schema gives MUSE_BIN, so a caller that has
  // no Forge/provider override still gets the documented binary name.
  const cliBin = input.cliBin?.trim() || 'muse';

  return SetupReadinessSchema.parse({
    generated_at: new Date().toISOString(),
    environment: inCodespaces(env) ? 'codespaces' : 'local',
    provider: input.providerId,
    cli: probeCli({
      codespace: inCodespaces(env),
      providerId: input.providerId,
      cliBin,
      lookup,
    }),
    media_api: probeMedia({
      key: input.mediaApiKey,
      mediaModel: input.mediaModel ?? env.FORGE_MEDIA_MODEL ?? DEFAULT_MEDIA_IMAGE_MODEL,
      samModel: input.samModel ?? env.FORGE_SAM_MODEL ?? DEFAULT_SAM_MODEL,
    }),
    browser: probeBrowser({
      policy: runtimeBrowser,
      executable: input.browserExecutable,
      lookup,
      exists,
    }),
    offline_seed: probeSeed({
      databasePath: input.databasePath,
      workspaceRoot: input.workspaceRoot,
      exists,
      entries: input.workspaceEntries ?? listDirectoryNames,
    }),
  });
}

function probeCli(options: {
  codespace: boolean;
  providerId: string;
  cliBin: string;
  lookup: (bin: string) => boolean;
}): SetupProbe {
  if (options.codespace) {
    return {
      state: 'not_available',
      detail:
        'Codespaces supports the offline exploration path only: this container has no logged-in Muse CLI, so live application generation cannot run here.',
      fix: 'Explore here; generate on your own machine — install the Muse CLI, run `muse login`, then `MODEL_PROVIDER=muse-cli pnpm dev`. Guide: docs/guide/FOR_JUDGES.md.',
    };
  }
  if (options.providerId !== 'muse-cli') {
    return {
      state: 'not_available',
      detail: `MODEL_PROVIDER=${options.providerId}: this instance runs the deterministic offline provider on purpose, so Studio generation is switched off by design.`,
      fix: 'After seeding, restart with `MODEL_PROVIDER=muse-cli pnpm dev` — that path needs the Muse CLI installed and logged in.',
    };
  }
  if (!options.lookup(options.cliBin)) {
    return {
      state: 'missing',
      detail: `No coding CLI found on PATH as "${options.cliBin}" (configured by MUSE_BIN / FORGE_MUSE_BIN).`,
      fix: 'Install the Muse CLI, then `muse login`. If the binary is not on PATH, point MUSE_BIN (or FORGE_MUSE_BIN for Studio alone) at it.',
    };
  }
  return {
    state: 'not_probed',
    detail: `Found the coding CLI as "${options.cliBin}" on PATH. Login state is deliberately not probed: that would be a live call.`,
    fix: 'If you have not logged in on this machine, run `muse login`. Then confirm the panel with `pnpm judge:check`.',
  };
}

function probeMedia(options: {
  key: string | null;
  mediaModel: string;
  samModel: string;
}): SetupProbe {
  if (!mediaKeyUsable(options.key)) {
    return {
      state: 'missing',
      detail:
        'No server-side media key: image generation and editing, SAM cutout, transcription, clip observation and screenshot review stay unavailable. A CLI login does not configure this path.',
      fix: 'Copy `.env.example` to `.env` and set FORGE_MUSE_API_KEY (never commit `.env`). Provider calls use quota and can incur charges.',
    };
  }
  return {
    state: 'ready',
    detail: `A server-side media key is configured (image ${options.mediaModel}, segmentation ${options.samModel}). The key value itself is never reported.`,
    fix: null,
  };
}

function probeBrowser(options: {
  policy: 'managed' | 'chrome';
  executable?: () => string | null;
  lookup: (bin: string) => boolean;
  exists: (path: string) => boolean;
}): SetupProbe {
  if (options.policy === 'chrome') {
    const found = systemChromePath({ lookup: options.lookup, exists: options.exists });
    if (found) {
      return {
        state: 'ready',
        detail: `FORGE_RUNTIME_BROWSER=chrome and a system Chrome is present (${basename(found)}).`,
        fix: null,
      };
    }
    return {
      state: 'missing',
      detail:
        'FORGE_RUNTIME_BROWSER=chrome, but no system Chrome was found. There is no automatic fallback, and an application cannot be approved before a browser verifies it.',
      fix: 'Install Chrome, or set FORGE_RUNTIME_BROWSER=managed after running `pnpm exec playwright-core install chromium`.',
    };
  }
  const path = options.executable ? options.executable() : managedBrowserPath();
  if (path && options.exists(path)) {
    const label = path.split(/[\\/]/).filter(Boolean).slice(-2).join('/');
    return {
      state: 'ready',
      detail: `Managed Chromium is installed for application verification (${label}).`,
      fix: null,
    };
  }
  return {
    state: 'missing',
    detail:
      'No managed Chromium for application verification: a staged application can be built but not verified in a real browser, so it cannot be approved.',
    fix: 'pnpm exec playwright-core install chromium',
  };
}

function probeSeed(options: {
  databasePath: string;
  workspaceRoot: string;
  exists: (path: string) => boolean;
  entries: (path: string) => string[];
}): SetupProbe {
  // `:memory:` is what the test bench and a few scripts open. There is no file
  // to check there, and saying "missing" would send a judge off to seed a
  // database that the instance is not using.
  if (options.databasePath === ':memory:') {
    return {
      state: 'not_probed',
      detail:
        'This instance opened an in-memory database, so there is no seeded demo file behind it to check.',
      fix: 'Run `pnpm demo:seed`, then start the documented way (`pnpm dev`), which opens the SQLite file at the checkout root.',
    };
  }
  const database = options.exists(options.databasePath);
  const workspaces = options.entries(options.workspaceRoot);
  if (database && workspaces.length > 0) {
    return {
      state: 'ready',
      detail:
        `The files behind the offline demo are in place: ${basename(options.databasePath)} plus ` +
        `${workspaces.length} workspace ${workspaces.length === 1 ? 'directory' : 'directories'} ` +
        `under ${basename(options.workspaceRoot)}. Open the seeded "${SEEDED_DEMO_PROJECT}" project in Studio.`,
      fix: null,
    };
  }
  const absent = [
    database ? null : `no database file (${basename(options.databasePath)})`,
    workspaces.length > 0
      ? null
      : `no workspace directories under ${basename(options.workspaceRoot)}`,
  ].filter((part): part is string => part !== null);
  return {
    state: 'missing',
    detail: `Nothing to browse yet: ${absent.join('; ')}.`,
    fix: `Run \`pnpm demo:seed\` before starting the server — it creates the "${SEEDED_DEMO_PROJECT}" project and its workspace (re-running resets it to its recorded version 1).`,
  };
}

function safeExists(path: string): boolean {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}

/** Directory names under a path, or [] when it does not exist or cannot be read. */
function listDirectoryNames(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

const STATE_WORD: Record<SetupProbe['state'], string> = {
  ready: 'ready',
  missing: 'MISSING',
  not_available: 'not here',
  not_probed: 'unverified',
};

/**
 * The panel as a human reads it in a terminal. One function feeds both the
 * server's startup line and `pnpm judge:check`, so the two can never disagree:
 * a judge who watches the server print one thing and runs a script that prints
 * another stops trusting either of them.
 */
export function formatSetupPanel(setup: SetupReadiness): string {
  const rows: Array<[string, SetupProbe]> = [
    ['CLI', setup.cli],
    ['Media API', setup.media_api],
    ['Browser validation', setup.browser],
    ['Offline demo', setup.offline_seed],
  ];
  const lines = [`Setup status — ${setup.environment}, provider ${setup.provider}`];
  for (const [label, probe] of rows) {
    lines.push(`  ${label.padEnd(19)} ${STATE_WORD[probe.state]}`);
    lines.push(`    ${probe.detail}`);
    if (probe.fix) lines.push(`    fix: ${probe.fix}`);
  }
  lines.push(
    '  Paths: (1) browse the seeded demo offline · (2) generate live applications (Muse CLI) · (3) media and SAM (FORGE_MUSE_API_KEY).',
  );
  lines.push('  Everything on those paths is documented in docs/guide/FOR_JUDGES.md.');
  return lines.join('\n');
}
