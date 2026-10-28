/**
 * Phase 17 Muse Spark runner: production HTML Studio (Forge) modify path.
 *
 * Each run gets a fresh database and workspace and its own server. The
 * baseline is seeded as approved version 1 (the layout `seedForgeDemo` writes);
 * the arm's memories are created through POST /api/memories and, in the
 * `corrected` arm, superseded through POST /api/memories/:id/correct — the
 * route the Studio's correction UI calls. The edit is a normal modify job with
 * the baseline screenshot attached, as in Phase 16.
 *
 * Usage:
 *   FORGE_MUSE_API_KEY=... P17_SHARD=0 P17_SHARDS=6 node run_spark.mjs          # trial shard
 *   FORGE_MUSE_API_KEY=... node run_spark.mjs pilot [stratum,...] [arm,...]            # pilot, excluded
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  api,
  armPlan,
  baselinePath,
  DESIGN,
  HERE,
  memoryInput,
  pilotCells,
  requireEnv,
  screenshotDataUrl,
  sha256,
  shardOf,
  sparkEnv,
  startServer,
  stopServer,
  trialCells,
  waitForJob,
} from './harness.mjs';

const PILOT = process.argv[2] === 'pilot';
const PILOT_STRATA = PILOT && process.argv[3] ? process.argv[3].split(',') : null;
const PILOT_ARMS = PILOT && process.argv[4] ? process.argv[4].split(',') : null;
const PILOT_TAG = process.env.P17_PILOT_TAG ?? 'pilot';
const SHARD = Number(process.env.P17_SHARD ?? 0);
const SHARDS = Number(process.env.P17_SHARDS ?? 1);
const PORT = Number(process.env.P17_PORT ?? 8950 + SHARD);
const key = requireEnv('FORGE_MUSE_API_KEY');

const OUT = path.join(HERE, PILOT ? 'pilot' : 'out', 'spark');
mkdirSync(path.join(OUT, 'prompts'), { recursive: true });
mkdirSync(path.join(OUT, 'jobs'), { recursive: true });

const cells = PILOT ? pilotCells((s, arm) => (!PILOT_STRATA || PILOT_STRATA.includes(s.id)) && (!PILOT_ARMS || PILOT_ARMS.includes(arm)), PILOT_TAG) : trialCells();
const RUNS = shardOf(cells, SHARD, SHARDS);
const SUMMARY = path.join(OUT, PILOT ? `${PILOT_TAG}-shard-${SHARD}.json` : `spark-shard-${SHARD}.json`);
console.log(`${PILOT ? 'PILOT' : 'TRIAL'} spark shard ${SHARD}/${SHARDS}: ${RUNS.length} runs`);

const shots = {};
for (const name of Object.keys(DESIGN.baselines)) shots[name] = await screenshotDataUrl(baselinePath(name));

function seedWorkspace(workspaceRoot, projectId, html) {
  const dir = path.join(workspaceRoot, 'forge', projectId);
  mkdirSync(path.join(dir, 'versions', '1'), { recursive: true });
  writeFileSync(path.join(dir, 'versions', '1', 'index.html'), html, 'utf8');
  const state = {
    current_version: 1,
    versions: [
      { version: 1, created_at: '2026-10-27T00:00:00.000Z', summary: 'Phase 17 baseline', base_version: null, job_id: null, sha256: sha256(html) },
    ],
  };
  writeFileSync(path.join(dir, 'state.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

const results = existsSync(SUMMARY) && !PILOT ? JSON.parse(readFileSync(SUMMARY, 'utf8')).results : [];
const done = new Set(results.map((r) => r.id));

for (const run of RUNS) {
  if (done.has(run.id)) continue;
  const stratum = DESIGN.strata.find((s) => s.id === run.stratum);
  const baselineFile = baselinePath(stratum.baseline);
  const baselineHtml = readFileSync(baselineFile, 'utf8');
  const rule = DESIGN.rules[DESIGN.baselines[stratum.baseline].rule];
  const plan = armPlan(run.stratum, run.arm);

  const dir = mkdtempSync(path.join(tmpdir(), `p17-${run.id}-`));
  const workspaceRoot = path.join(dir, 'workspaces');
  const projectId = 'p17';
  seedWorkspace(workspaceRoot, projectId, baselineHtml);

  const server = startServer(PORT, sparkEnv({ databasePath: path.join(dir, 'trial.db'), workspaceRoot, key }));
  const client = api(PORT);
  const t0 = Date.now();
  const record = {
    id: run.id,
    stratum: run.stratum,
    arm: run.arm,
    baseline_sha256: sha256(baselineHtml),
    request: plan.request,
  };
  try {
    await client.waitUp();
    await client.post('/api/forge/projects', { project_id: projectId, name: 'Phase 17' });
    const seeded = [];
    for (const content of plan.memories) {
      const created = await client.post('/api/memories', memoryInput(projectId, content));
      seeded.push({ id: created.memory.id, content });
    }
    let correction = null;
    if (plan.correct) {
      const target = seeded.find((m) => m.content === plan.correct.target);
      const { tags, expires_at, ...fields } = memoryInput(projectId, plan.correct.content);
      const corrected = await client.post(`/api/memories/${target.id}/correct`, {
        ...fields,
        tags,
        reason: plan.correct.reason,
      });
      correction = { superseded_id: target.id, replacement_id: corrected.memory.id };
    }
    record.seeded = seeded;
    record.correction = correction;

    const job0 = await client.post(`/api/forge/projects/${projectId}/modify`, {
      request: plan.request,
      screenshot_data_url: shots[stratum.baseline],
    });
    record.job_id = job0.id;
    const job = await waitForJob(client, job0.id);
    Object.assign(record, {
      status: job.status,
      error: job.error ?? null,
      usage: job.usage ?? null,
      memory_ids: job.memory_ids ?? [],
      prompt_sha256: job.prompt_sha256 ?? null,
      validation: job.validation ?? null,
    });

    const staging = path.join(workspaceRoot, 'forge', projectId, 'staging', job0.id);
    const prompt = readFileSync(path.join(staging, 'prompt.txt'), 'utf8');
    writeFileSync(path.join(OUT, 'prompts', `${run.id}.txt`), prompt);
    record.prompt_file_sha256 = sha256(prompt);
    record.rule_in_prompt = prompt.includes(rule.text);
    record.correction_in_prompt = prompt.includes(rule.correction);
    const jobFile = path.join(workspaceRoot, 'forge', projectId, 'jobs', `${job0.id}.json`);
    if (existsSync(jobFile)) copyFileSync(jobFile, path.join(OUT, 'jobs', `${run.id}.json`));

    if (record.status === 'succeeded') {
      const html = readFileSync(path.join(staging, 'index.html'));
      writeFileSync(path.join(OUT, `${run.id}.html`), html);
      record.output_sha256 = sha256(html);
      record.output_bytes = html.length;
    }
  } catch (err) {
    record.status = record.status ?? 'harness_error';
    record.error = String(err.message).slice(0, 300);
  } finally {
    record.seconds = Number(((Date.now() - t0) / 1000).toFixed(1));
    await stopServer(server);
  }
  console.log(run.id, record.status, record.seconds, `mem=${record.memory_ids?.length ?? '-'}`, `rule_in_prompt=${record.rule_in_prompt}`);
  results.push(record);
  writeFileSync(
    SUMMARY,
    `${JSON.stringify({ protocol: 'PROTOCOL.md', model: DESIGN.models.spark, seed: DESIGN.seed, pilot: PILOT, shard: SHARD, shards: SHARDS, results }, null, 2)}\n`,
  );
}
console.log(`done ${results.filter((r) => r.status === 'succeeded').length}/${results.length}`);
