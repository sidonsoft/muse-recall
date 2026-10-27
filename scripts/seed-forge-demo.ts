/**
 * Seed a deterministic Forge demo project from the recorded real baseline.
 *
 * The baseline is a real `muse-spark-1.3-contributor` generation captured during
 * Phase 11; seeding it removes model variance from the start of the demo while
 * every subsequent modification still uses real inference.
 *
 *   pnpm demo:seed
 *   pnpm dev:server            (with FORGE_FALLBACK_API_KEY if quota is low)
 *   open Forge → project "forge-demo"
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const projectId = process.env.SEED_PROJECT ?? 'forge-demo';
const workspaceRoot = resolve(process.env.WORKSPACE_ROOT ?? 'apps/server/workspaces');
const projectDir = join(workspaceRoot, 'forge', projectId);
const baseline = await readFile('demo/forge-baseline/index.html', 'utf8');
const sha256 = createHash('sha256').update(baseline).digest('hex');

await rm(join(projectDir, 'versions'), { recursive: true, force: true });
await rm(join(projectDir, 'staging'), { recursive: true, force: true });
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
          created_at: new Date().toISOString(),
          summary: 'Demo baseline — recorded real Spark generation',
          base_version: null,
          job_id: null,
          sha256,
        },
      ],
    },
    null,
    2,
  )}\n`,
  'utf8',
);

console.log(`Seeded ${projectId} at ${projectDir} (v1, ${baseline.length} chars).`);
console.log('Open Forge with project id:', projectId);
