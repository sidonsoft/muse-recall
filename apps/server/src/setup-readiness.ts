import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_MEDIA_IMAGE_MODEL,
  DEFAULT_SAM_MODEL,
  redactSecrets,
  type SetupProbe,
  SetupProbeSchema,
  type SetupReadiness,
  SetupReadinessSchema,
  type SetupRowKey,
  setupStateWord,
} from '@mml/shared';
import { chromium } from 'playwright-core';
import { type BrowserPolicy, browserPolicy } from './forge/browser-policy.js';
import { isCliAvailable } from './forge/cli-lookup.js';
import { ForgeError, type ForgeWorkspace } from './forge/workspace.js';

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

/**
 * What a read-only inspection of the demo seed established. The readiness probe
 * refuses to call the demo "ready" from a file listing: the demo is the project,
 * the approved version that project reports, and the artifact those bytes point
 * at. Anything this inspection cannot establish is reported as such rather than
 * rounded up to "ready".
 */
export interface DemoSeedFacts {
  /** The SQLite file the server was configured with. */
  database: 'file' | 'in_memory' | 'absent' | 'unreadable';
  /** Is the demo project a record in the memory database? */
  record: 'present' | 'absent' | 'unchecked';
  project_name: string | null;
  /** Can the Forge state for the demo project be read? */
  workspace_state: 'readable' | 'absent' | 'unreadable';
  current_version: number | null;
  version_count: number;
  /** The approved artifact the state points at, checked against its recorded hash. */
  artifact: 'hash_verified' | 'missing' | 'hash_mismatch' | 'no_hash_recorded' | 'unchecked';
}

function openReadOnly(databasePath: string): DatabaseSync | null {
  // `readOnly` is the same option the backup tools use, and the file is checked
  // first so a readiness probe can never create an empty database on a typo.
  if (!safeExists(databasePath)) return null;
  try {
    return new DatabaseSync(databasePath, { readOnly: true });
  } catch {
    return null;
  }
}

/**
 * Gather the demo-seed facts with read-only operations: a `SELECT` against the
 * projects table, the Forge `state.json` the app itself would read, and the
 * approved artifact bytes hashed and compared with the hash recorded in that
 * state. Nothing is created, seeded, migrated or repaired here.
 */
export async function gatherDemoSeedFacts(options: {
  databasePath: string;
  workspace: ForgeWorkspace;
  projectId?: string;
}): Promise<DemoSeedFacts> {
  const projectId = options.projectId ?? SEEDED_DEMO_PROJECT;
  const facts: DemoSeedFacts = {
    database: 'file',
    record: 'unchecked',
    project_name: null,
    workspace_state: 'absent',
    current_version: null,
    version_count: 0,
    artifact: 'unchecked',
  };

  if (options.databasePath === ':memory:') {
    facts.database = 'in_memory';
  } else {
    const db = openReadOnly(options.databasePath);
    if (db === null) {
      facts.database = safeExists(options.databasePath) ? 'unreadable' : 'absent';
    } else {
      try {
        const row = db.prepare('SELECT name FROM projects WHERE id = ?').get(projectId) as
          | { name: string | null }
          | undefined;
        facts.record = row ? 'present' : 'absent';
        facts.project_name = row?.name ?? null;
      } catch {
        // No projects table (or a locked file): say "unchecked", not "absent".
        facts.record = 'unchecked';
      } finally {
        try {
          db.close();
        } catch {
          /* closing a read-only handle is not worth failing a probe over */
        }
      }
    }
  }

  try {
    const state = await options.workspace.state(projectId);
    facts.workspace_state = 'readable';
    facts.current_version = state.current_version;
    facts.version_count = state.versions.length;
    const entry = state.versions.find((version) => version.version === state.current_version);
    if (state.current_version === null) {
      facts.artifact = 'unchecked';
    } else if (!entry?.sha256) {
      facts.artifact = 'no_hash_recorded';
    } else {
      try {
        // `currentHtml` re-reads the artifact and throws if the bytes no longer
        // match the recorded hash; a null return means the file is not there.
        const html = await options.workspace.currentHtml(projectId);
        facts.artifact = html === null ? 'missing' : 'hash_verified';
      } catch (error) {
        facts.artifact =
          error instanceof ForgeError && error.code === 'version_corrupt'
            ? 'hash_mismatch'
            : 'unchecked';
      }
    }
  } catch {
    facts.workspace_state = 'unreadable';
  }

  return facts;
}

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
  /**
   * Read-only demo-seed facts from `gatherDemoSeedFacts`. Omitted means this
   * surface did not inspect the demo, which the row reports as `not_probed`
   * instead of guessing from file existence.
   */
  demo_seed?: DemoSeedFacts;
  /** Injectable for tests; the real lookups are the defaults. */
  cliLookup?: (bin: string) => boolean;
  browserExecutable?: () => string | null;
  fileExists?: (path: string) => boolean;
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
  const runtimeBrowser = input.runtimeBrowser ?? browserPolicy(env);
  // Same default the configuration schema gives MUSE_BIN, so a caller that has
  // no Forge/provider override still gets the documented binary name.
  const cliBin = input.cliBin?.trim() || 'muse';

  // Bound every row at the shared schema boundary, including diagnostics from
  // long configured paths or names. Redact before truncating any credential.
  const bound = (probe: SetupProbe): SetupProbe => ({
    ...probe,
    detail: boundedText(probe.detail, SetupProbeSchema.shape.detail.maxLength ?? 240),
    fix:
      probe.fix === null
        ? null
        : boundedText(probe.fix, SetupProbeSchema.shape.fix.unwrap().maxLength ?? 300),
  });
  return SetupReadinessSchema.parse({
    generated_at: new Date().toISOString(),
    environment: inCodespaces(env) ? 'codespaces' : 'local',
    provider: input.providerId,
    cli: bound(
      probeCli({
        codespace: inCodespaces(env),
        providerId: input.providerId,
        cliBin,
        lookup,
      }),
    ),
    media_api: bound(
      probeMedia({
        key: input.mediaApiKey,
        mediaModel: input.mediaModel ?? env.FORGE_MEDIA_MODEL ?? DEFAULT_MEDIA_IMAGE_MODEL,
        samModel: input.samModel ?? env.FORGE_SAM_MODEL ?? DEFAULT_SAM_MODEL,
      }),
    ),
    browser: bound(
      probeBrowser({
        policy: runtimeBrowser,
        executable: input.browserExecutable,
        lookup,
        exists,
      }),
    ),
    offline_seed: bound(probeSeed(input.demo_seed)),
  });
}

function probeCli(options: {
  codespace: boolean;
  providerId: string;
  cliBin: string;
  lookup: (bin: string) => boolean;
}): SetupProbe {
  if (options.providerId !== 'muse-cli') {
    return {
      state: 'not_available',
      detail: `MODEL_PROVIDER=${options.providerId}: this instance runs the deterministic offline provider on purpose, so Studio generation is switched off by design.`,
      fix: 'After seeding, restart with `MODEL_PROVIDER=muse-cli pnpm dev` — that path needs the Muse CLI installed and logged in.',
    };
  }
  // Being a codespace does not decide whether generation can run here: this
  // instance's provider setting and whether a CLI is actually on PATH do. The
  // documented default container installs and authenticates neither, which is a
  // missing prerequisite — said plainly, without pretending the platform forbids
  // it or that a hand-provisioned codespace is broken.
  if (!options.lookup(options.cliBin)) {
    return {
      state: 'missing',
      detail: options.codespace
        ? `No coding CLI found on PATH as "${boundedText(options.cliBin, 48)}" in this codespace: the documented devcontainer does not install or authenticate the Muse CLI, so as shipped it cannot generate.`
        : `No coding CLI found on PATH as "${boundedText(options.cliBin, 48)}" (configured by MUSE_BIN / FORGE_MUSE_BIN).`,
      fix: 'Install the Muse Code CLI, then `muse login`. If the binary is not on PATH, point MUSE_BIN (or FORGE_MUSE_BIN for Studio alone) at it.',
    };
  }
  return {
    state: 'not_probed',
    detail: options.codespace
      ? `Found "${boundedText(options.cliBin, 48)}" on PATH in this codespace, so generation is not blocked by a missing binary; authentication and provider access remain unverified, because checking them would be a live call.`
      : `Found the coding CLI as "${boundedText(options.cliBin, 48)}" on PATH. Login state is deliberately not probed: that would be a live call.`,
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
    detail: `A server-side media key is configured and length-checked (image ${boundedText(options.mediaModel, 24)}, segmentation ${boundedText(options.samModel, 24)}); the value is never reported. No request was made, so provider access and remaining quota are unverified.`,
    fix: null,
  };
}

function probeBrowser(options: {
  policy: BrowserPolicy | null;
  executable?: () => string | null;
  lookup: (bin: string) => boolean;
  exists: (path: string) => boolean;
}): SetupProbe {
  if (options.policy === null) {
    return {
      state: 'missing',
      detail:
        'Invalid FORGE_RUNTIME_BROWSER value: approval-time browser verification refuses this configuration.',
      fix: 'Set FORGE_RUNTIME_BROWSER=managed (install Chromium with `pnpm exec playwright-core install chromium`), or FORGE_RUNTIME_BROWSER=chrome with Chrome installed.',
    };
  }
  if (options.policy === 'chrome') {
    const found = systemChromePath({ lookup: options.lookup, exists: options.exists });
    if (found) {
      return {
        state: 'ready',
        detail: `FORGE_RUNTIME_BROWSER=chrome and a system Chrome was found (${basename(found)}). It was not launched, so launchability stays unverified.`,
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
      detail: `A managed Chromium executable exists for application verification (${label}). It was not launched: a browser runs only when a staged application is verified.`,
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

function probeSeed(facts: DemoSeedFacts | undefined): SetupProbe {
  // No facts means this surface did not inspect the demo. Saying "missing" would
  // send a reader off to re-seed a database nobody looked at.
  if (!facts) {
    return {
      state: 'not_probed',
      detail:
        'The demo seed was not inspected on this surface, so the panel does not claim it is present.',
      fix: 'Run `pnpm judge:check` — it inspects the project record, its approved version and that artifact read-only.',
    };
  }
  if (facts.database === 'in_memory') {
    return {
      state: 'not_probed',
      detail:
        'This instance opened an in-memory database, so there is no demo seed behind it to inspect.',
      fix: 'Run `pnpm demo:seed`, then start the documented way (`pnpm dev`), which opens the SQLite file at the checkout root.',
    };
  }
  if (facts.database === 'absent' || facts.database === 'unreadable') {
    return {
      state: facts.database === 'absent' ? 'missing' : 'not_probed',
      detail:
        facts.database === 'absent'
          ? 'Nothing to browse yet: the database file this server opens does not exist.'
          : 'The database file exists but could not be opened read-only, so the demo seed is unverified.',
      fix: 'Run `pnpm demo:seed` before starting the server; it creates the database and the demo project inside it.',
    };
  }
  const demo = `"${boundedText(facts.project_name ?? SEEDED_DEMO_PROJECT, 40)}"`;

  // Ready means all three facts at once: the memory record, the version the
  // record's workspace reports, and that version's bytes matching their hash.
  if (
    facts.record === 'present' &&
    facts.workspace_state === 'readable' &&
    facts.current_version !== null &&
    facts.artifact === 'hash_verified'
  ) {
    return {
      state: 'ready',
      detail:
        `Project ${demo} (id ${SEEDED_DEMO_PROJECT}) is a record in the database and reports v${facts.current_version} ` +
        `approved (${facts.version_count} version${facts.version_count === 1 ? '' : 's'}); those artifact bytes match ` +
        `their recorded hash. Read-only: nothing was seeded or written.`,
      fix: null,
    };
  }

  if (facts.artifact === 'hash_mismatch') {
    return {
      state: 'missing',
      detail: `Project ${demo} reports v${facts.current_version}, but those bytes no longer match their recorded hash — the app refuses to serve them.`,
      fix: 'For the demo, `pnpm demo:seed` re-creates it. For a real project use Studio → Recovery (inspect, then repair); this check changed nothing.',
    };
  }
  if (facts.artifact === 'missing') {
    return {
      state: 'missing',
      detail: `Project ${demo} reports v${facts.current_version} approved, but that version file is not in the workspace.`,
      fix: 'Re-seed the demo with `pnpm demo:seed`, or inspect the project under Studio → Recovery.',
    };
  }
  if (facts.workspace_state === 'unreadable' || facts.record === 'unchecked') {
    return {
      state: 'not_probed',
      detail:
        'The demo project could not be fully inspected (its workspace state is unreadable, or the projects table was unavailable), so this row stays unverified rather than guessed.',
      fix: `Open Studio → Recovery for ${facts.project_name ? `"${boundedText(facts.project_name, 40)}"` : 'that project'} (inspect, then repair), or re-seed the demo with \`pnpm demo:seed\`.`,
    };
  }
  if (facts.current_version === null) {
    return {
      state: 'missing',
      detail:
        facts.record === 'present'
          ? `Project ${demo} exists in memory but has no approved version, so Studio opens with nothing to review.`
          : `Nothing to browse yet: no project record and no approved version for id ${SEEDED_DEMO_PROJECT}.`,
      fix: `Run \`pnpm demo:seed\` before starting the server — it creates the "${SEEDED_DEMO_PROJECT}" project, its decisions and its approved version 1 (re-running resets it).`,
    };
  }
  if (facts.artifact === 'no_hash_recorded') {
    return {
      state: 'not_probed',
      detail: `Project ${demo} reports v${facts.current_version}, but that version recorded no hash, so there is no expected digest to compare its bytes against.`,
      fix: 'Open Studio → Recovery for that project to inspect the history.',
    };
  }
  if (facts.artifact === 'unchecked') {
    return {
      state: 'not_probed',
      detail: `Project ${demo} reports v${facts.current_version}, but its artifact was not opened, so this row cannot claim its bytes.`,
      fix: `Run \`pnpm judge:check\`, which reads the project record, its version and that artifact.`,
    };
  }
  return {
    state: 'missing',
    detail: `The workspace holds ${demo} at v${facts.current_version}, but that id is not a project record in this database: memory, decisions and retrieval will look empty.`,
    fix: `Run \`pnpm demo:seed\` to rebuild the "${SEEDED_DEMO_PROJECT}" project and its memory records.`,
  };
}

/** Keep the schema limit inclusive of the truncation marker. */
function boundedText(value: string, limit: number): string {
  const redacted = redactSecrets(value);
  return redacted.length > limit ? `${redacted.slice(0, limit - 1)}…` : redacted;
}

function safeExists(path: string): boolean {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}

const STATE_WORD_NOTE =
  'Read-only presence/configuration checks: no model call, no quota spend, nothing written, no secret value printed. "configured" and "installed" are not "verified".';

/**
 * The panel as a human reads it in a terminal. One function feeds both the
 * server's startup line and `pnpm judge:check`, so the two can never disagree:
 * a judge who watches the server print one thing and runs a script that prints
 * another stops trusting either of them.
 */
export function formatSetupPanel(setup: SetupReadiness): string {
  const rows: Array<[SetupRowKey, string, SetupProbe]> = [
    ['cli', 'CLI', setup.cli],
    ['media_api', 'Media API', setup.media_api],
    ['browser', 'Browser validation', setup.browser],
    ['offline_seed', 'Offline demo', setup.offline_seed],
  ];
  const lines = [`Setup status — ${setup.environment}, provider ${setup.provider}`];
  for (const [key, label, probe] of rows) {
    const word = setupStateWord(key, probe.state);
    // In a terminal, the rows that need action are the ones you scan for; the UI
    // keeps the same words at their own case.
    lines.push(`  ${label.padEnd(19)} ${probe.state === 'missing' ? word.toUpperCase() : word}`);
    lines.push(`    ${probe.detail}`);
    if (probe.fix) lines.push(`    fix: ${probe.fix}`);
  }
  lines.push(
    '  Paths: (1) browse the demo project offline · (2) generate live applications (Muse CLI) · (3) media and SAM (FORGE_MUSE_API_KEY).',
  );
  lines.push('  Everything on those paths is documented in docs/guide/FOR_JUDGES.md.');
  lines.push(`  ${STATE_WORD_NOTE}`);
  return lines.join('\n');
}
