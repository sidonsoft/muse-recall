/** Checkpoint-2 endpoint qualification: distribution, projection, stop rule, determinism. */
import { readFileSync, writeFileSync } from 'node:fs';
const OUT = '/tmp/study02-qual';
const all = JSON.parse(readFileSync(`${OUT}/runs/records.json`, 'utf8'));
const full = all.filter((r) => r.finish_reason !== 'length' && r.status !== 'failed');
const cap = all.find((r) => r.finish_reason === 'length');
const walls = full.map((r) => r.wall_s).sort((a, b) => a - b);
const mean = walls.reduce((a, b) => a + b, 0) / walls.length;
const median = walls.length % 2 ? walls[(walls.length - 1) / 2] : (walls[walls.length / 2 - 1] + walls[walls.length / 2]) / 2;
const pctile = (p) => { const idx = (walls.length - 1) * p; const lo = Math.floor(idx), hi = Math.ceil(idx); return walls[lo] + (walls[hi] - walls[lo]) * (idx - lo); };
const stdev = Math.sqrt(walls.reduce((a, b) => a + (b - mean) ** 2, 0) / (walls.length - 1));
const p95 = pctile(0.95), p90 = pctile(0.9);
const primary = full.filter((r) => /primary/.test(r.id));
const primaryMean = primary.reduce((a, b) => a + b.wall_s, 0) / primary.length;
const h = (s) => Number((s / 3600).toFixed(2));
const seedProbe = JSON.parse(readFileSync(`${OUT}/runs/seed_probe.json`, 'utf8'));
const seedProbe2 = JSON.parse(readFileSync(`${OUT}/runs/seed_probe2.json`, 'utf8'));
const eq = (a, b) => a.content === b.content;

const perBaseline = full.filter((r) => /primary/.test(r.id)).map((r) => ({
  baseline: r.baseline,
  baseline_path: r.baseline_path,
  prompt_chars: r.prompt_chars,
  prompt_tokens: r.usage.prompt_tokens,
  completion_tokens: r.usage.completion_tokens,
  wall_s: r.wall_s,
  finish_reason: r.finish_reason,
  output_html_bytes: r.output_html_bytes,
  output_sha256: r.output_html_sha256,
  prompt_ms: r.timings.prompt_ms,
  predicted_ms: r.timings.predicted_ms,
  prompt_per_second: r.timings.prompt_per_second,
  predicted_per_second: r.timings.predicted_per_second,
  cache_n: r.timings.cache_n,
  html_block_extracted: r.html_block_found,
  html_complete: r.html_complete,
  thinking_off_honoured: !r.reasoning_content_present && !r.content_is_null,
  model_echoed_ok: r.model_echoed_ok,
}));

const analysis = {
  generated_at: new Date().toISOString(),
  endpoint: 'http://192.168.86.39:8080',
  model_id: all[0].model_requested,
  generation_params: {
    model: all[0].model_requested, reasoning_effort: 'none', chat_template_kwargs: { enable_thinking: false },
    temperature: 0.7, top_p: 0.8, top_k: 20, presence_penalty: 1.5, min_p: 0.0,
    max_tokens_full_file: 16384, stream: false, distinct_explicit_seed_per_request: true,
  },
  per_baseline: perBaseline,
  repeated_runs: all.filter((r) => /sameseed|newseed/.test(r.id)).map((r) => ({
    id: r.id, baseline: r.baseline, seed: r.seed, wall_s: r.wall_s, completion_tokens: r.usage.completion_tokens,
    output_html_bytes: r.output_html_bytes, output_sha256: r.output_html_sha256, finish_reason: r.finish_reason,
    cache_n: r.timings.cache_n, prompt_ms: r.timings.prompt_ms,
  })),
  cap_probe: {
    id: cap.id, max_tokens: cap.max_tokens, completion_tokens: cap.usage.completion_tokens,
    finish_reason: cap.finish_reason, wall_s: cap.wall_s,
    html_block_extracted: cap.html_block_found,
    note: 'max_tokens was honoured exactly (512); output cut mid-file; finish_reason "length"; no html block -> extraction must treat length as a failed/censored run',
  },
  determinism: {
    finding: 'same explicit seed does NOT reproduce output at temperature > 0; greedy (temperature 0) IS reproducible; different seeds can change the sample stream',
    same_seed_same_prompt_full_file: {
      first: 'q01-farmyard-primary', repeat: 'q04-farmyard-sameseed', seed: 1001,
      completion_tokens: [5861, 4327], html_bytes: [15932, 11485],
      byte_identical_output: false,
    },
    different_seed_same_prompt_full_file: {
      id: 'q05-farmyard-newseed', seed: 1004, completion_tokens: 5467, html_bytes: 14827,
      differs_from_seed_1001: true,
    },
    micro_probe_1: {
      prompt: 'List five single words', max_tokens: 24, temperature: 0.7, seed: 7, repeats: 2,
      contents: seedProbe.map((r) => r.content), identical: eq(seedProbe[0], seedProbe[1]),
      different_seed_8_identical_to_seed_7: eq(seedProbe[2], seedProbe[0]),
      greedy_identical: eq(seedProbe[3], seedProbe[4]),
    },
    micro_probe_2: {
      prompt: 'Write a comma-separated list of 20 distinct animal names', max_tokens: 60, temperature: 0.7, seed: 7, repeats: 3,
      contents: [seedProbe2[0].content, seedProbe2[1].content, seedProbe2[2].content].map((c) => c.slice(0, 100)),
      identical_pairs: [[0, 1, eq(seedProbe2[0], seedProbe2[1])], [0, 2, eq(seedProbe2[0], seedProbe2[2])], [1, 2, eq(seedProbe2[1], seedProbe2[2])]],
      different_seed_8_identical: eq(seedProbe2[0], seedProbe2[3]),
      greedy_identical: eq(seedProbe2[4], seedProbe2[5]),
      greedy_equals_temp07: eq(seedProbe2[4], seedProbe2[0]),
    },
  },
  distribution_seconds: {
    sample: 'full-file generations only (n=5; excludes the 512-token cap probe)',
    n: walls.length, values: walls,
    mean: Number(mean.toFixed(2)), median: Number(median.toFixed(2)), stdev: Number(stdev.toFixed(2)),
    min: walls[0], max: walls[walls.length - 1],
    p90: Number(p90.toFixed(2)), p95: Number(p95.toFixed(2)),
    p95_note: 'n=5: p95 is interpolated and ~the max; max is the conservative bound',
    primary_baselines_mean_s: Number(primaryMean.toFixed(2)),
  },
  projection: {
    assumption: 'sequential single-slot execution; wall = prompt_ms + predicted_ms + ~0.1 s; per-run mean of the measured full-file distribution; no prefix-cache benefit assumed for distinct pilot prompts (cache_n=0 whenever the preceding prompt differed)',
    pilot_132: {
      hours_at_mean: h(132 * mean), hours_at_median: h(132 * median),
      hours_at_primary_mean: h(132 * primaryMean), hours_at_p95_conservative: h(132 * p95),
      hours_at_max: h(132 * walls[walls.length - 1]),
    },
    confirmatory_4800: {
      hours_at_mean: h(4800 * mean), hours_at_median: h(4800 * median),
      hours_at_primary_mean: h(4800 * primaryMean), hours_at_max: h(4800 * walls[walls.length - 1]),
      days_at_mean: Number(((4800 * mean) / 86400).toFixed(1)),
    },
    formula_check: 'wall_s ~= prompt_tokens/370 + completion_tokens/24.2; predicted from measured prefill 356-380 tok/s and decode 23.7-24.6 tok/s',
  },
  stop_rule: {
    rule: '132-execution projected wall time > 10 h OR measured p95 per run > 8 min (480 s)',
    projected_132h_central_mean: h(132 * mean),
    projected_132h_primary_mean: h(132 * primaryMean),
    projected_132h_p95_conservative: h(132 * p95),
    projected_132h_max: h(132 * walls[walls.length - 1]),
    p95_seconds: Number(p95.toFixed(1)),
    p95_under_8min: p95 < 480,
    triggered_by_projected_hours: h(132 * mean) > 10,
    triggered_by_p95: p95 > 480,
    triggered: h(132 * mean) > 10 || p95 > 480,
    margin_note: 'central projection 8.73 h is 13% below the 10 h threshold; the p95-per-run and max-per-run projections (10.22 h / 10.37 h) would exceed it, so the margin is thin. A pilot rolling mean above 272.7 s/run would breach 10 h.',
    rolling_breach_threshold_seconds_per_run: Number((36000 / 132).toFixed(1)),
  },
  stop_rule_triggered: h(132 * mean) > 10 || p95 > 480,
  recommendation: 'GO_WITH_CAVEATS',
  recommendation_reasons: [
    'central projection 8.73 h (median 8.28 h) for 132 executions is below the 10 h stop threshold',
    'p95 per run 278.6 s (4.6 min) is below the 8 min threshold',
    'margin is thin: +13% per-run time breaches 10 h; two of five full-file runs already exceeded 260 s',
    'the endpoint is not a managed service and the seed does not provide determinism',
  ],
  harness_requirements: [
    'client timeout >= 400 s (recommend 900 s; observed max 282.8 s)',
    'sequential, single in-flight request; /v1/status concurrency is 1',
    'assert response.model == qwen3.6-35b-a3b-ud-q3_k_m',
    'always send reasoning_effort:"none" and chat_template_kwargs.enable_thinking=false',
    'treat finish_reason != "stop" as failed/censored; at 512-token cap no html block existed',
    'do not rely on seed for byte-identical replay; greedy (temperature 0) is the only reproducible mode',
    'no prefix-cache benefit for distinct prompts (cache_n=0 unless the immediately preceding prompt was identical)',
    'record usage/timings/wall/seed per run; keep resumable checkpoints',
  ],
};
writeFileSync(`${OUT}/measurements.json`, `${JSON.stringify(analysis, null, 2)}\n`);
console.log(JSON.stringify({ distribution: analysis.distribution_seconds, projection: analysis.projection, stop_rule: analysis.stop_rule, stop_rule_triggered: analysis.stop_rule_triggered, recommendation: analysis.recommendation }, null, 2));
