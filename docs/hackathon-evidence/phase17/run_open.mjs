/**
 * Phase 17 Muse Spark Open runner (Baseten chat completions).
 *
 * The memory block is no longer written by hand (a Phase 16B limit): each run
 * builds a fresh in-memory database with the production MemoryEngine, creates
 * the arm's memories with `engine.create`, supersedes the rule with
 * `engine.correct` (the call behind POST /api/memories/:id/correct), and
 * retrieves with the production query and the Forge budget, formatted exactly
 * as `ForgeJobManager.start` formats it. The prompt is the production
 * `buildForgePrompt` modify prompt with the baseline appended, as in Phase 16B.
 *
 * Usage (tsx resolves the TypeScript sources):
 *   BASETEN_API_KEY=... P17_SHARD=0 P17_SHARDS=6 pnpm exec tsx docs/hackathon-evidence/phase17/run_open.mjs
 *   BASETEN_API_KEY=... pnpm exec tsx docs/hackathon-evidence/phase17/run_open.mjs pilot [stratum,...] [arm,...]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildForgePrompt, buildRetrievalQuery } from '../../../apps/server/src/forge/prompt.ts';
import { MemoryEngine, openDatabase } from '../../../packages/memory-engine/src/index.ts';
import { armPlan, baselinePath, DESIGN, HERE, memoryInput, pilotCells, requireEnv, sha256, shardOf, trialCells } from './harness.mjs';

const PILOT = process.argv[2] === 'pilot';
const PILOT_STRATA = PILOT && process.argv[3] ? process.argv[3].split(',') : null;
const PILOT_ARMS = PILOT && process.argv[4] ? process.argv[4].split(',') : null;
const PILOT_TAG = process.env.P17_PILOT_TAG ?? 'pilot';
const SHARD = Number(process.env.P17_SHARD ?? 0);
const SHARDS = Number(process.env.P17_SHARDS ?? 1);
const KEY = requireEnv('BASETEN_API_KEY');
const MODEL = DESIGN.models.open;

const OUT = path.join(HERE, PILOT ? 'pilot' : 'out', 'open');
mkdirSync(path.join(OUT, 'prompts'), { recursive: true });

const cells = PILOT ? pilotCells((s, arm) => (!PILOT_STRATA || PILOT_STRATA.includes(s.id)) && (!PILOT_ARMS || PILOT_ARMS.includes(arm)), PILOT_TAG) : trialCells();
const RUNS = shardOf(cells, SHARD, SHARDS);
const SUMMARY = path.join(OUT, PILOT ? `${PILOT_TAG}-shard-${SHARD}.json` : `open-shard-${SHARD}.json`);
console.log(`${PILOT ? 'PILOT' : 'TRIAL'} open shard ${SHARD}/${SHARDS}: ${RUNS.length} runs`);

/** Production memory path for one arm; returns the prompt and what retrieval chose. */
function buildPrompt(run, baselineHtml) {
  const plan = armPlan(run.stratum, run.arm);
  const projectId = 'p17';
  const database = openDatabase({ path: ':memory:', wal: false });
  try {
    const engine = new MemoryEngine(database.db);
    engine.ensureProject(projectId, 'Phase 17');
    const seeded = plan.memories.map((content) => ({ id: engine.create(memoryInput(projectId, content)).memory.id, content }));
    let correction = null;
    if (plan.correct) {
      const target = seeded.find((m) => m.content === plan.correct.target);
      const { expires_at, ...fields } = memoryInput(projectId, plan.correct.content);
      const corrected = engine.correct({ ...fields, reason: plan.correct.reason, supersedes: [target.id] }, 'user');
      correction = { superseded_id: target.id, replacement_id: corrected.memory.id };
    }
    // Mirrors ForgeJobManager.start (apps/server/src/forge/runner.ts).
    const query = buildRetrievalQuery({ projectId, kind: 'modify', prompt: plan.request, request: plan.request });
    const retrieval = engine.retrieve({ project_id: projectId, query, budget: { max_memories: 6, max_characters: 3_000 } }, { now: new Date() });
    const memoryIds = retrieval.results.map((r) => r.memory.id);
    const memoryBlock = retrieval.results.length > 0 ? retrieval.results.map((r) => `- ${r.injected_content}`).join('\n') : '';
    const base = buildForgePrompt({ kind: 'modify', prompt: plan.request, request: plan.request, memoryBlock, hasScreenshot: false });
    const prompt = `${base}\n\nThe current index.html is:\n\`\`\`html\n${baselineHtml}\n\`\`\`\n\nReturn the complete updated index.html in one \`\`\`html code block. No commentary.`;
    return { prompt, plan, seeded, correction, memoryIds };
  } finally {
    database.close();
  }
}

async function one(run) {
  const stratum = DESIGN.strata.find((s) => s.id === run.stratum);
  const baselineHtml = readFileSync(baselinePath(stratum.baseline), 'utf8');
  const rule = DESIGN.rules[DESIGN.baselines[stratum.baseline].rule];
  const { prompt, plan, seeded, correction, memoryIds } = buildPrompt(run, baselineHtml);
  writeFileSync(path.join(OUT, 'prompts', `${run.id}.txt`), prompt);
  const rec = {
    id: run.id,
    stratum: run.stratum,
    arm: run.arm,
    model: MODEL.model,
    baseline_sha256: sha256(baselineHtml),
    request: plan.request,
    seeded,
    correction,
    memory_ids: memoryIds,
    prompt_file_sha256: sha256(prompt),
    rule_in_prompt: prompt.includes(rule.text),
    correction_in_prompt: prompt.includes(rule.correction),
  };
  const t0 = Date.now();
  for (let attempt = 1; attempt <= 2; attempt++) {
    rec.attempts = attempt;
    try {
      const res = await fetch(MODEL.endpoint, {
        method: 'POST',
        headers: { authorization: `Api-Key ${KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: MODEL.model, messages: [{ role: 'user', content: prompt }], max_tokens: MODEL.max_tokens, temperature: MODEL.temperature }),
      });
      const body = await res.json();
      rec.http = res.status;
      rec.usage = body.usage ?? null;
      rec.finish_reason = body.choices?.[0]?.finish_reason ?? null;
      if (!res.ok) throw new Error(JSON.stringify(body).slice(0, 200));
      // A reply cut off at max_tokens is incomplete HTML, never a usable edit.
      if (rec.finish_reason === 'length') throw new Error('truncated at max_tokens');
      const content = body.choices?.[0]?.message?.content ?? '';
      const m = /```html\s*([\s\S]*?)```/i.exec(content) || /```\s*([\s\S]*?)```/.exec(content);
      let html = m ? m[1].trim() : null;
      if (!html && /<html[\s>]/i.test(content)) html = content.trim();
      if (!html || !/<html[\s>]/i.test(html)) throw new Error('no html block');
      writeFileSync(path.join(OUT, `${run.id}.html`), html);
      rec.status = 'succeeded';
      rec.error = null;
      rec.output_bytes = Buffer.byteLength(html);
      rec.output_sha256 = sha256(html);
      break;
    } catch (err) {
      rec.status = 'failed';
      rec.error = String(err.message).slice(0, 300);
      if (attempt < 2) await new Promise((r) => setTimeout(r, 3000));
    }
  }
  rec.seconds = Number(((Date.now() - t0) / 1000).toFixed(1));
  console.log(run.id, rec.status, rec.seconds, `mem=${memoryIds.length}`, `rule_in_prompt=${rec.rule_in_prompt}`, rec.usage?.completion_tokens ?? '-');
  return rec;
}

const results = existsSync(SUMMARY) && !PILOT ? JSON.parse(readFileSync(SUMMARY, 'utf8')).results : [];
const done = new Set(results.map((r) => r.id));
for (const run of RUNS) {
  if (done.has(run.id)) continue;
  results.push(await one(run));
  writeFileSync(
    SUMMARY,
    `${JSON.stringify({ protocol: 'PROTOCOL.md', model: MODEL, seed: DESIGN.seed, pilot: PILOT, shard: SHARD, shards: SHARDS, results }, null, 2)}\n`,
  );
}
console.log('done', results.filter((r) => r.status === 'succeeded').length, '/', results.length);
