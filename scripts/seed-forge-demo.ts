/**
 * Seed the deterministic Muse Recall / HTML Studio demo.
 *
 * Creates, from one command:
 *   - project `forge-demo` at version 1, from the recorded real Spark baseline,
 *   - its three remembered decisions (child-safety constraint, sunset palette,
 *     and the corrected ocean palette that supersedes sunset) via the
 *     production memory engine.
 *
 *   pnpm demo:seed
 *   pnpm dev:server            (with FORGE_FALLBACK_API_KEY if quota is low)
 *   open Forge → project "forge-demo"
 *
 * Relative `DATABASE_PATH` / `WORKSPACE_ROOT` values resolve against
 * `apps/server`, exactly as the server resolves them, so the seed and the
 * server always agree on where state lives.
 */
import { isAbsolute, resolve } from 'node:path';
import { DEMO_PROJECT_ID, seedForgeDemo } from './lib/demo-seed.js';

const APPS_SERVER = resolve(import.meta.dirname, '../apps/server');

function serverPath(value: string | undefined, fallback: string): string {
  const candidate = value ?? fallback;
  return isAbsolute(candidate) ? candidate : resolve(APPS_SERVER, candidate);
}

const projectId = process.env.SEED_PROJECT ?? DEMO_PROJECT_ID;
const workspaceRoot = serverPath(process.env.WORKSPACE_ROOT, './workspaces');
const databasePath = serverPath(process.env.DATABASE_PATH, './data/muse-memory-lab.db');

const result = await seedForgeDemo({ workspaceRoot, databasePath, projectId });

console.log(`Seeded Forge project "${result.projectId}" at ${result.workspaceDir}`);
console.log(`  version 1 · baseline sha256 ${result.baselineSha256}`);
console.log(`  database ${databasePath}`);
console.log(`  child-safety decision ${result.constraint.id} (${result.constraint.status})`);
console.log(
  `  palette ${result.supersededPalette.id} (${result.supersededPalette.status}) → ${result.activePalette.id} (${result.activePalette.status})`,
);
console.log(
  `  created this run: constraint=${String(result.created.constraint)}, palette=${String(result.created.palette)}`,
);
console.log('Open Forge with project id:', projectId);
