#!/usr/bin/env node
/**
 * Study 02 pilot — replacement runs for unusable pilot executions.
 *
 * Context (user-approved, 2026-10-31): pilot runs are harness-validation data,
 * not hypothesis-test data. For each PILOT run whose record is unusable, one
 * replacement execution of the same scenario/arm/repetition may be run, under a
 * pre-declared rule: same prompt, same seed policy, exactly one replacement per
 * failed run, original failure kept and reported. Replacements are stored under
 * `pilot/replacements/` and are NEVER written over the primary records, never
 * enter the confirmatory dataset, and are reported separately in the analysis.
 *
 * This tool is pilot-only and refuses `--confirmatory`. It will not run while a
 * pilot runner is active (single endpoint slot) and it honours the same curl/SSE
 * transport and idle gate as the pilot runner.
 *
 * Usage:
 *   pnpm exec tsx experiments/study-02-rare-trigger/scripts/study02/run_replacements.mjs --dry-run
 *   pnpm exec tsx experiments/study-02-rare-trigger/scripts/study02/run_replacements.mjs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  ENDPOINT_DEFAULT, MAX_TOKENS_DEFAULT, MODEL_DEFAULT, MODELS_URL_DEFAULT, PHASE17, STUDY,
  TIMEOUT_MS_DEFAULT, buildPrompt, executeRun, preflight, readJson, writeAtomic, writeJsonAtomic,
} from './runner.mjs';

const PILOT = path.join(STUDY, 'pilot');
const REPL = path.join(PILOT, 'replacements');
const LOCK = path.join(PILOT, 'replacements.lock');

function fail(message) {
  console.error(`REFUSED: ${message}`);
  process.exit(2);
}

if (process.argv.includes('--confirmatory')) fail('--confirmatory is not a supported mode; replacements are pilot-only');
const dryRun = process.argv.includes('--dry-run');
const limitArg = process.argv.indexOf('--limit');
const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : null;
if (limit !== null && (!Number.isInteger(limit) || limit < 1)) fail('--limit must be a positive integer');

// One replacement pass at a time; the endpoint has a single generation slot.
if (existsSync(LOCK) && !dryRun) {
  const other = Number(readFileSync(LOCK, 'utf8').trim());
  try {
    process.kill(other, 0);
    fail(`another replacement pass is active (pid ${other})`);
  } catch {
    // stale lock
  }
}

const design = readJson(path.join(PHASE17, 'design.json'), 'Phase 17 design');
const plan = readJson(path.join(PILOT, 'pilot-plan.json'), 'pilot plan');
const manifest = readJson(path.join(PILOT, 'manifest.json'), 'pilot manifest');
const scenarioById = new Map(plan.pilot_scenarios.map((s) => [s.pilot_scenario_id, s]));

const recordsDir = path.join(PILOT, 'records');
const failed = [];
for (const run of manifest.runs) {
  const file = path.join(recordsDir, `${run.run_id}.json`);
  if (!existsSync(file)) continue; // not yet executed; not a failure
  const record = readJson(file, run.run_id);
  if (record.usable) continue;
  failed.push({ run, record });
}

if (failed.length === 0) {
  console.log('no unusable pilot records; nothing to replace');
  process.exit(0);
}

const targets = [];
for (const { run, record } of failed) {
  const scenario = scenarioById.get(run.scenario_id);
  if (!scenario) fail(`no pilot scenario for ${run.scenario_id}`);
  const replId = `${run.run_id}--repl1`;
  const variantFile = path.join(STUDY, 'corpus', 'variants', `${run.variant_id}.html`);
  if (!existsSync(variantFile)) fail(`missing variant ${variantFile}`);
  targets.push({
    run, record, scenario, replId, variantFile,
    spec: {
      ...run,
      run_id: replId,
      repeat_id: 'replacement-1',
      repeat_of: run.run_id,
      seed_mode: 'replacement-same-seed',
      variant_file: variantFile,
      request_text: scenario.paraphrase_text,
    },
  });
}

console.log(`unusable primary records: ${failed.length}`);
for (const t of targets) {
  console.log(`  ${t.run.run_id}  =>  ${t.replId}  (${t.record.failure_kind || 'unusable'})`);
}
if (dryRun) {
  // Validate prompt construction for the first target without writing or calling the model.
  const promptInfo = buildPrompt(design, targets[0].spec);
  console.log(`[dry-run] prompt build OK for ${targets[0].replId}: ${promptInfo.prompt_bytes} bytes, rule_in_prompt=${promptInfo.rule_in_prompt}, memories=${promptInfo.memory_ids.length}`);
  console.log(`[dry-run] ${targets.length} replacement executions planned; no model calls`);
  process.exit(0);
}

const useTargets = limit ? targets.slice(0, limit) : targets;

mkdirSync(path.join(REPL, 'prompts'), { recursive: true });
mkdirSync(path.join(REPL, 'raw'), { recursive: true });
mkdirSync(path.join(REPL, 'records'), { recursive: true });
mkdirSync(path.join(REPL, 'outputs'), { recursive: true });
writeFileSync(LOCK, `${process.pid}\n`);

let ran = 0;
try {
  const pf = await preflight({ modelsUrl: MODELS_URL_DEFAULT, model: MODEL_DEFAULT });
  console.log(`model asserted: ${pf.model}`);

  for (const t of useTargets) {
    const recordFile = path.join(REPL, 'records', `${t.replId}.json`);
    if (existsSync(recordFile)) {
      console.log(`[replacement] skip existing ${t.replId}`);
      continue;
    }
    const promptInfo = buildPrompt(design, t.spec);
    writeAtomic(path.join(REPL, 'prompts', `${t.replId}.txt`), promptInfo.prompt);
    const record = await executeRun(t.spec, promptInfo, {
      endpoint: ENDPOINT_DEFAULT,
      model: MODEL_DEFAULT,
      maxTokens: MAX_TOKENS_DEFAULT,
      timeoutMs: TIMEOUT_MS_DEFAULT,
      pilotDir: REPL,
      onProgress: () => {},
    });
    record.replacement_for = t.run.run_id;
    record.replacement_reason = t.record.failure_kind || 'unusable';
    record.replacement_rule = 'one replacement per unusable pilot run; original failure retained; pilot-only';
    writeJsonAtomic(recordFile, record);
    ran += 1;
    console.log(`[replacement] ${t.replId} ${record.status} ${record.seconds_total}s tokens=${record.usage?.completion_tokens ?? '-'}`);
  }
  console.log(`replacements run: ${ran}/${useTargets.length}`);
} finally {
  try {
    writeFileSync(LOCK, '');
  } catch {
    // ignore
  }
}
