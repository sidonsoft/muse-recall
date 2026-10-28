/**
 * Generate the Orchard Catch baseline through the production generate path,
 * with the child-safety rule and the meadow palette remembered — the same way
 * the Phase 16 baseline was produced. Every attempt is kept under
 * baselines/attempts/; the chosen attempt is copied to baselines/orchard-catch.html
 * by hand after the detector and browser checks, and recorded in the protocol.
 *
 * Usage: FORGE_MUSE_API_KEY=... node gen_orchard.mjs <attempt-label>
 */
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { api, DESIGN, HERE, memoryInput, requireEnv, sha256, sparkEnv, startServer, stopServer, waitForJob } from './harness.mjs';

const label = process.argv[2] ?? 'a1';
const key = requireEnv('FORGE_MUSE_API_KEY');
const PORT = Number(process.env.P17_PORT ?? 8940);
const OUT = path.join(HERE, 'baselines', 'attempts');
mkdirSync(OUT, { recursive: true });

const dir = mkdtempSync(path.join(tmpdir(), 'p17-orchard-'));
const workspaceRoot = path.join(dir, 'workspaces');
const projectId = 'p17-orchard';
const server = startServer(PORT, sparkEnv({ databasePath: path.join(dir, 'gen.db'), workspaceRoot, key }));
const client = api(PORT);
const t0 = Date.now();
const record = { label, request: DESIGN.orchard_generation.request };
try {
  await client.waitUp();
  await client.post('/api/forge/projects', { project_id: projectId, name: 'Orchard Catch' });
  for (const content of [DESIGN.rules.child_safety.text, DESIGN.baselines.orchard.context]) {
    await client.post('/api/memories', memoryInput(projectId, content));
  }
  const job0 = await client.post(`/api/forge/projects/${projectId}/generate`, { prompt: DESIGN.orchard_generation.request });
  const job = await waitForJob(client, job0.id);
  Object.assign(record, {
    job_id: job.id,
    status: job.status,
    error: job.error ?? null,
    usage: job.usage ?? null,
    memory_ids: job.memory_ids,
    validation: job.validation ?? null,
    prompt_sha256: job.prompt_sha256 ?? null,
  });
  const staging = path.join(workspaceRoot, 'forge', projectId, 'staging', job.id);
  if (job.status === 'succeeded') {
    const dest = path.join(OUT, `orchard-${label}.html`);
    copyFileSync(path.join(staging, 'index.html'), dest);
    record.output_sha256 = sha256(await readFile(dest));
  }
  copyFileSync(path.join(staging, 'prompt.txt'), path.join(OUT, `orchard-${label}.prompt.txt`));
} catch (err) {
  record.status = 'harness_error';
  record.error = String(err.message).slice(0, 300);
} finally {
  record.seconds = Number(((Date.now() - t0) / 1000).toFixed(1));
  await stopServer(server);
}
writeFileSync(path.join(OUT, `orchard-${label}.json`), `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify(record, null, 2));
