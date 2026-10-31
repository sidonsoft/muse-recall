#!/usr/bin/env node
/**
 * Study 02 pilot entry point (Dell PolyStrata endpoint).
 *
 * Runs the conditionally approved pilot ONLY: 30 scenarios x 4 arms x rep 0
 * (120 primary) + 12 repeat executions = 132 total. There is deliberately no
 * confirmatory path in this tool: `--confirmatory` is refused, and the pilot
 * plan itself must hold exactly 120 primary + 12 repeat executions.
 *
 * Usage:
 *   # build every prompt and the manifest, make zero model calls
 *   pnpm exec tsx experiments/study-02-rare-trigger/scripts/study02/run_pilot.mjs --dry-run
 *
 *   # execute the pilot (Lead only, after endpoint qualification)
 *   pnpm exec tsx experiments/study-02-rare-trigger/scripts/study02/run_pilot.mjs --resume
 *
 * Outputs (under experiments/study-02-rare-trigger/pilot/ unless --out-root):
 *   prompts/<run_id>.txt  raw/<run_id>.attemptN.json  records/<run_id>.json
 *   outputs/<run_id>.html  manifest.json  summary.json
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ENDPOINT_DEFAULT, MAX_TOKENS_DEFAULT, MODELS_URL_DEFAULT, MODEL_DEFAULT, STUDY, TIMEOUT_MS_DEFAULT, runPilot } from './runner.mjs';

function usage() {
  return `Study 02 pilot runner (30 scenarios x 4 arms + 12 repeats = 132)

Options:
  --dry-run                build prompts + manifest, make zero model calls
  --limit N                execute only the first N ordered runs
  --resume                 resume: recorded runs are never re-executed (default behaviour)
  --plan PATH              pilot plan (default pilot/pilot-plan.json)
  --corpus-root PATH       directory holding corpus/ (default study root)
  --out-root PATH          directory holding pilot/ outputs (default study root; tests only)
  --design PATH            rules/contexts source (default Phase 17 design.json)
  --endpoint URL           chat completions URL (default ${ENDPOINT_DEFAULT})
  --models-url URL         model-list URL (default ${MODELS_URL_DEFAULT})
  --model ID               asserted model id (default ${MODEL_DEFAULT})
  --max-tokens N           completion cap (default ${MAX_TOKENS_DEFAULT})
  --timeout-ms N           per-request AbortSignal timeout (default ${TIMEOUT_MS_DEFAULT})
  --concurrency N          parallel requests (default 1; the Dell endpoint is one slot)
  --confirmatory           REFUSED: not a supported mode

Exit codes: 0 ok, 2 refused/invalid input, 3 completed with unusable runs.`;
}

function parseArgs(argv) {
  const options = {};
  const need = (index, flag) => {
    if (index + 1 >= argv.length) throw new Error(`${flag} needs a value`);
    return argv[index + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--dry-run': options.dryRun = true; break;
      case '--resume': options.resume = true; break;
      case '--confirmatory':
        throw new Error('REFUSED: --confirmatory is not a supported mode; this tool runs the approved pilot only');
      case '--limit': options.limit = Number(need(i, arg)); i++; break;
      case '--plan': options.planFile = path.resolve(need(i, arg)); i++; break;
      case '--corpus-root': options.corpusRoot = path.resolve(need(i, arg)); i++; break;
      case '--out-root': options.outRoot = path.resolve(need(i, arg)); i++; break;
      case '--design': options.designFile = path.resolve(need(i, arg)); i++; break;
      case '--endpoint': options.endpoint = need(i, arg); i++; break;
      case '--models-url': options.modelsUrl = need(i, arg); i++; break;
      case '--model': options.model = need(i, arg); i++; break;
      case '--max-tokens': options.maxTokens = Number(need(i, arg)); i++; break;
      case '--timeout-ms': options.timeoutMs = Number(need(i, arg)); i++; break;
      case '--concurrency': options.concurrency = Number(need(i, arg)); i++; break;
      case '--help': case '-h': options.help = true; break;
      default: throw new Error(`unknown argument ${arg}`);
    }
  }
  return options;
}

async function main() {
  if (process.argv.includes('--confirmatory')) {
    console.error('REFUSED: --confirmatory is not a supported mode; this tool runs the approved pilot only.');
    return 2;
  }
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    console.error(usage());
    return 2;
  }
  if (options.help) {
    console.log(usage());
    return 0;
  }
  const outRoot = options.outRoot ?? STUDY;
  const pilotDir = path.join(outRoot, 'pilot');
  const planFile = options.planFile ?? path.join(pilotDir, 'pilot-plan.json');
  const limit = options.limit ?? null;
  if (limit !== null && (!Number.isInteger(limit) || limit < 1)) {
    console.error('REFUSED: --limit must be a positive integer');
    return 2;
  }

  let completed = 0;
  const progress = (spec, record) => {
    if (record.status === 'skipped_existing') return;
    completed += 1;
    const status = record.status === 'succeeded' ? 'ok' : `FAIL(${record.failure_kind ?? record.status})`;
    const tokens = record.usage?.completion_tokens ?? '-';
    const seconds = record.seconds_total ?? '-';
    console.log(`[pilot] ${completed} ${spec.run_id} ${status} ${seconds}s mem=${record.memory_ids?.length ?? '-'} tokens=${tokens}`);
  };

  try {
    const result = await runPilot({
      planFile,
      corpusRoot: options.corpusRoot ?? STUDY,
      pilotDir,
      designFile: options.designFile,
      endpoint: options.endpoint ?? ENDPOINT_DEFAULT,
      modelsUrl: options.modelsUrl ?? MODELS_URL_DEFAULT,
      model: options.model ?? MODEL_DEFAULT,
      maxTokens: options.maxTokens ?? MAX_TOKENS_DEFAULT,
      timeoutMs: options.timeoutMs ?? TIMEOUT_MS_DEFAULT,
      concurrency: options.concurrency ?? 1,
      limit,
      dryRun: Boolean(options.dryRun),
      onProgress: progress,
    });
    const s = result.summary;
    if (options.dryRun) {
      console.log(`[dry-run] prompts written: ${s.prompts_written}/${s.counts.selected}; model calls: 0`);
      console.log(`[dry-run] counts: primary ${s.counts.primary}, repeats ${s.counts.repeats} (${s.repeat_composition.same_seed} same-seed, ${s.repeat_composition.new_seed} new-seed)`);
      console.log(`[dry-run] manifest: ${s.manifest}`);
      console.log(`[dry-run] manipulation failures: ${s.manipulation_failures}`);
      return s.manipulation_failures === 0 ? 0 : 3;
    }
    console.log(
      `[pilot] done: ${s.recorded}/${s.planned} recorded, ${s.usable} usable, ${s.unusable} unusable, ` +
        `${s.manipulation_failures} manipulation failures (model ${s.model_observed})`,
    );
    return s.unusable > 0 || s.manipulation_failures > 0 ? 3 : 0;
  } catch (err) {
    console.error(`REFUSED: ${err.message}`);
    return 2;
  }
}

// Refuse a confirmatory invocation even before importing/running anything else.
if (process.argv.includes('--confirmatory')) {
  console.error('REFUSED: --confirmatory is not a supported mode; this tool runs the approved pilot only.');
  process.exit(2);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().then((code) => process.exit(code));
}

export { main, parseArgs };
