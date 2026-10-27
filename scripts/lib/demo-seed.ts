/**
 * Deterministic demo seed for Muse Forge.
 *
 * Two things are seeded, from one command:
 *
 * 1. the Forge workspace — the recorded real Spark generation as version 1,
 * 2. the project's remembered creative decisions — through the production
 *    memory engine (create + transactional correction), never by editing the
 *    database directly.
 *
 * The decision texts are the Phase 12A trial texts verbatim, so the seeded
 * demo exercises the same remembered palette pair whose influence was measured
 * in the authentic A/C experiment.
 *
 * Re-running is safe: memories are looked up by exact content across active and
 * superseded rows, and a consistent seed adds nothing. A seed whose state has
 * drifted (for example a superseded child-safety constraint) fails loudly with
 * a recovery instruction instead of layering a second, conflicting history.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryEngine, openDatabase } from '../../packages/memory-engine/src/index.js';
import type { Memory, MemoryCreateInput } from '../../packages/shared/src/index.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const DEMO_PROJECT_ID = 'forge-demo';
export const DEMO_PROJECT_NAME = 'Muse Forge demo';

/** Child-friendly design constraint (authentic Phase 11/12 decision text). */
export const CHILD_SAFETY_DECISION =
  'This children’s game must avoid flashing effects, countdown timers, and penalties for mistakes.';
/** Initial art direction, superseded during seeding by the corrected decision. */
export const SUNSET_DECISION =
  'Art direction: maintain a warm sunset palette. Use #FF7E5F as the primary accent and #2D1E2F for dark text. Avoid aggressive neon colours.';
/** Corrected art direction: the active decision after the palette change. */
export const OCEAN_DECISION =
  'Art direction: use a cool ocean palette. Primary accent #4EA8DE and dark text #102A43.';
export const PALETTE_CORRECTION_REASON =
  'Creative direction changed from a warm sunset mood to a cool ocean mood.';

/**
 * Fixed timestamp for the seeded version record so repeated seeding produces a
 * byte-identical `state.json` (apart from nothing: the value is constant).
 */
export const DEMO_SEED_TIMESTAMP = '2026-10-27T00:00:00.000Z';

export interface DemoSeedOptions {
  workspaceRoot: string;
  databasePath: string;
  projectId?: string;
  /** Defaults to the recorded real baseline in this repository. */
  baselinePath?: string;
}

export interface SeededDecision {
  id: string;
  status: Memory['status'];
  content: string;
}

export interface DemoSeedResult {
  projectId: string;
  workspaceDir: string;
  version: number;
  baselineSha256: string;
  constraint: SeededDecision;
  activePalette: SeededDecision;
  supersededPalette: SeededDecision;
  /** True when this run created the memory (false when it already existed). */
  created: { constraint: boolean; palette: boolean };
}

function decisionInput(
  projectId: string,
  type: MemoryCreateInput['type'],
  content: string,
  tags: string[],
): MemoryCreateInput {
  return {
    type,
    scope: 'project',
    project_id: projectId,
    content,
    source: { session_id: null, reference: 'seed:phase14a-demo' },
    confidence: type === 'constraint' ? 0.95 : 0.9,
    validation_status: 'verified',
    tags,
    expires_at: null,
  };
}

function findExact(engine: MemoryEngine, projectId: string, content: string): Memory | null {
  const listed = engine.list({
    project_id: projectId,
    status: ['active', 'superseded'],
    limit: 200,
  });
  return listed.items.find((memory) => memory.content === content) ?? null;
}

function requireMemory(engine: MemoryEngine, id: string, label: string): Memory {
  const memory = engine.get(id);
  if (!memory) throw new Error(`Seeded ${label} memory ${id} disappeared.`);
  return memory;
}

/**
 * Create the demo decisions in an existing database.
 *
 * Exposed separately from the workspace/CLI wrapper so the idempotence test can
 * run it repeatedly against one engine.
 */
export function seedDemoMemories(
  engine: MemoryEngine,
  projectId = DEMO_PROJECT_ID,
): {
  constraint: SeededDecision;
  activePalette: SeededDecision;
  supersededPalette: SeededDecision;
  created: { constraint: boolean; palette: boolean };
} {
  engine.ensureProject(projectId, DEMO_PROJECT_NAME);

  let constraint = findExact(engine, projectId, CHILD_SAFETY_DECISION);
  let constraintCreated = false;
  if (!constraint) {
    const result = engine.create(
      decisionInput(projectId, 'constraint', CHILD_SAFETY_DECISION, [
        'demo',
        'child-safety',
        'phase14a',
      ]),
    );
    constraint = result.memory;
    constraintCreated = result.created;
  }
  if (constraint.status !== 'active') {
    throw new Error(
      `The seeded child-safety decision exists but is ${constraint.status}. Use a fresh demo database (delete DATABASE_PATH) and seed again.`,
    );
  }

  let sunset = findExact(engine, projectId, SUNSET_DECISION);
  let ocean = findExact(engine, projectId, OCEAN_DECISION);
  let paletteCreated = false;

  if (!sunset && !ocean) {
    const first = engine.create(
      decisionInput(projectId, 'constraint', SUNSET_DECISION, ['demo', 'palette', 'sunset']),
    );
    sunset = first.memory;
    paletteCreated = true;
  } else if (sunset && sunset.status === 'active') {
    paletteCreated = true;
  }

  if (sunset && sunset.status === 'active') {
    // One transactional supersession: sunset becomes auditable history, ocean
    // becomes the only retrievable palette decision. Replaying this is
    // idempotent only if the sunset row is still active, so it runs once.
    const corrected = engine.correct(
      {
        ...decisionInput(projectId, 'constraint', OCEAN_DECISION, ['demo', 'palette', 'ocean']),
        supersedes: [sunset.id],
        reason: PALETTE_CORRECTION_REASON,
      },
      'user',
    );
    ocean = corrected.memory;
    sunset = requireMemory(engine, sunset.id, 'sunset');
  }

  if (!sunset || !ocean) {
    throw new Error(
      'The demo palette seed is inconsistent (sunset and ocean decisions disagree). Use a fresh demo database (delete DATABASE_PATH) and seed again.',
    );
  }
  if (sunset.status !== 'superseded' || ocean.status !== 'active') {
    throw new Error(
      `The demo palette seed is inconsistent (sunset=${sunset.status}, ocean=${ocean.status}). Use a fresh demo database and seed again.`,
    );
  }

  return {
    constraint: {
      id: constraint.id,
      status: constraint.status,
      content: constraint.content,
    },
    activePalette: { id: ocean.id, status: ocean.status, content: ocean.content },
    supersededPalette: { id: sunset.id, status: sunset.status, content: sunset.content },
    created: { constraint: constraintCreated, palette: paletteCreated },
  };
}

function baselinePathFor(options: DemoSeedOptions): string {
  return options.baselinePath ?? join(ROOT, 'demo/forge-baseline/index.html');
}

async function seedWorkspace(
  options: DemoSeedOptions,
  projectId: string,
): Promise<{ workspaceDir: string; baselineSha256: string }> {
  const baseline = await readFile(baselinePathFor(options), 'utf8');
  const baselineSha256 = createHash('sha256').update(baseline).digest('hex');
  const projectDir = join(resolve(options.workspaceRoot), 'forge', projectId);

  await rm(join(projectDir, 'versions'), { recursive: true, force: true });
  await rm(join(projectDir, 'staging'), { recursive: true, force: true });
  await rm(join(projectDir, 'jobs'), { recursive: true, force: true });
  await mkdir(join(projectDir, 'versions', '1'), { recursive: true });
  await writeFile(join(projectDir, 'versions', '1', 'index.html'), baseline, 'utf8');
  await writeFile(
    join(projectDir, 'state.json'),
    `${JSON.stringify(
      {
        current_version: 1,
        versions: [
          {
            version: 1,
            created_at: DEMO_SEED_TIMESTAMP,
            summary: 'Demo baseline — recorded real Spark generation',
            base_version: null,
            job_id: null,
            sha256: baselineSha256,
          },
        ],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return { workspaceDir: projectDir, baselineSha256 };
}

/** Seed both the workspace and the project memory for the demo. */
export async function seedForgeDemo(options: DemoSeedOptions): Promise<DemoSeedResult> {
  const projectId = options.projectId ?? DEMO_PROJECT_ID;
  const database = openDatabase({ path: options.databasePath, wal: false });
  let memories: ReturnType<typeof seedDemoMemories>;
  try {
    memories = seedDemoMemories(new MemoryEngine(database.db), projectId);
  } finally {
    database.close();
  }
  const workspace = await seedWorkspace(options, projectId);
  return {
    projectId,
    workspaceDir: workspace.workspaceDir,
    version: 1,
    baselineSha256: workspace.baselineSha256,
    ...memories,
  };
}
