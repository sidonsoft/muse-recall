/**
 * Independent Phase 17 evidence check.
 *
 * Re-derives what the protocol promises from the committed files, without
 * importing the runners or the Python analysis:
 *
 *   - the detector fixtures pass and every baseline is clean (python3);
 *   - the Phase 16 detector that Phase 17 imports is the locked Phase 16 file;
 *   - once locked, every file in `protocol.sha256` matches;
 *   - for each model with trial output: 240 records, 10 per cell, in the order
 *     the seed formula gives; output and prompt hashes match their records;
 *     unusable runs have no output; manipulation checks hold;
 *   - violation counts, the stratified exact tests, the Newcombe bounds and the
 *     H1/H2/H3 verdicts reproduce `phase17-analysis.json`.
 *
 * `--pilot` checks the excluded pilot runs instead (integrity and manipulation
 * checks only). No network, no model, no mutation. Requires python3 on PATH.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const P17 = join(ROOT, 'docs/hackathon-evidence/phase17');
const P16 = join(ROOT, 'docs/hackathon-evidence/phase16');
const PILOT = process.argv.includes('--pilot');
const MARGIN = 0.15;

interface Design {
  seed: number;
  runs_per_cell: number;
  arms: string[];
  models: Record<string, { model: string; shards: number }>;
  rules: Record<
    string,
    { text: string; correction: string; detector: string; sensitivity: string }
  >;
  baselines: Record<string, { path: string; rule: string }>;
  strata: { id: string; baseline: string; request: string }[];
}

interface RunRecord {
  id: string;
  stratum: string;
  arm: string;
  status: string;
  output_sha256?: string;
  prompt_file_sha256?: string;
  rule_in_prompt?: boolean;
  correction_in_prompt?: boolean;
  memory_ids?: string[];
  correction?: { superseded_id: string; replacement_id: string } | null;
}

const design = JSON.parse(readFileSync(join(P17, 'design.json'), 'utf8')) as Design;

function fail(message: string): never {
  throw new Error(message);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

function python(args: string[]): string {
  const result = spawnSync('python3', ['-I', '-B', ...args], {
    encoding: 'utf8',
    maxBuffer: 1 << 26,
  });
  if (result.error) fail(`python3 is required: ${result.error.message}`);
  assert(result.status === 0, `python3 failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

/** Runs a named Phase 17 detector over files; returns violation by path. */
function detect(detector: string, paths: string[]): Record<string, boolean> {
  if (paths.length === 0) return {};
  const code = [
    'import sys, json',
    'sys.path.insert(0, sys.argv[1])',
    'from detectors import DETECTORS',
    'd = DETECTORS[sys.argv[2]]',
    "print(json.dumps({p: d(open(p, encoding='utf-8').read()).violation for p in sys.argv[3:]}))",
  ].join('\n');
  return JSON.parse(python(['-c', code, P17, detector, ...paths])) as Record<string, boolean>;
}

// --- statistics, re-implemented independently of stats17.py ---------------

function comb(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i += 1) r = (r * (n - k + i)) / i;
  return r;
}

type Stratum = [k1: number, n1: number, k0: number, n0: number];

function stratifiedExact(strata: Stratum[]): number {
  let dist = new Map<number, number>([[0, 1]]);
  let observed = 0;
  for (const [k1, n1, k0, n0] of strata) {
    if (n1 === 0 || n0 === 0) continue;
    observed += k1;
    const m = k1 + k0;
    const den = comb(n1 + n0, m);
    const next = new Map<number, number>();
    for (const [t, p] of dist) {
      for (let a = Math.max(0, m - n0); a <= Math.min(n1, m); a += 1) {
        const q = (comb(n1, a) * comb(n0, m - a)) / den;
        next.set(t + a, (next.get(t + a) ?? 0) + p * q);
      }
    }
    dist = next;
  }
  const pObs = dist.get(observed) ?? 0;
  let total = 0;
  for (const p of dist.values()) if (p <= pObs * (1 + 1e-9) + 1e-15) total += p;
  return Math.min(1, total);
}

function wilson(k: number, n: number, z: number): [number, number] {
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

function newcombe(
  k1: number,
  n1: number,
  k2: number,
  n2: number,
  z: number,
): [number, number, number] {
  const p1 = k1 / n1;
  const p2 = k2 / n2;
  const [l1, u1] = wilson(k1, n1, z);
  const [l2, u2] = wilson(k2, n2, z);
  const d = p1 - p2;
  return [
    d,
    d - Math.sqrt((p1 - l1) ** 2 + (u2 - p2) ** 2),
    d + Math.sqrt((u1 - p1) ** 2 + (p2 - l2) ** 2),
  ];
}

function close(actual: number, expected: number, label: string): void {
  assert(
    Math.abs(actual - expected) <= Math.max(Math.abs(expected) * 1e-9, 1e-15),
    `${label}: expected ${expected}, got ${actual}`,
  );
}

// --- checks ----------------------------------------------------------------

function ruleOf(stratumId: string) {
  const stratum =
    design.strata.find((s) => s.id === stratumId) ?? fail(`unknown stratum ${stratumId}`);
  return design.rules[design.baselines[stratum.baseline].rule];
}

function expectedOrder(): string[] {
  const cells: { id: string; key: string }[] = [];
  for (const stratum of design.strata) {
    for (const arm of design.arms) {
      for (let i = 0; i < design.runs_per_cell; i += 1) {
        cells.push({
          id: `${stratum.id}-${arm}-${String(i + 1).padStart(2, '0')}`,
          key: sha256(`${design.seed}:${stratum.id}:${arm}:${i}`),
        });
      }
    }
  }
  return cells.sort((a, b) => a.key.localeCompare(b.key)).map((c) => c.id);
}

const EXPECTED_MEMORIES: Record<string, number> = { none: 0, memory: 2, manual: 1, corrected: 2 };
const RULE_IN_PROMPT: Record<string, boolean> = {
  none: false,
  memory: true,
  manual: true,
  corrected: false,
};

function loadRecords(dir: string, prefix: RegExp, shards: number | null): RunRecord[] {
  const files = readdirSync(dir)
    .filter((f) => prefix.test(f))
    .sort();
  const records: RunRecord[] = [];
  if (shards !== null) {
    const order = expectedOrder();
    assert(
      files.length === shards,
      `${dir}: expected ${shards} shard files, found ${files.length}`,
    );
    for (let shard = 0; shard < shards; shard += 1) {
      const file =
        files.find((f) => f.endsWith(`-shard-${shard}.json`)) ?? fail(`missing shard ${shard}`);
      const rows = (JSON.parse(readFileSync(join(dir, file), 'utf8')) as { results: RunRecord[] })
        .results;
      const want = order.filter((_, i) => i % shards === shard);
      assert(
        rows.map((r) => r.id).join(',') === want.join(','),
        `${dir} shard ${shard} order does not reproduce from the seed formula`,
      );
      records.push(...rows);
    }
  } else {
    for (const f of files)
      records.push(
        ...(JSON.parse(readFileSync(join(dir, f), 'utf8')) as { results: RunRecord[] }).results,
      );
  }
  return records;
}

function checkRecords(dir: string, records: RunRecord[]): string[] {
  const problems: string[] = [];
  for (const r of records) {
    const html = join(dir, `${r.id}.html`);
    if (r.status === 'succeeded') {
      assert(sha256(readFileSync(html)) === r.output_sha256, `output hash mismatch for ${r.id}`);
    } else {
      assert(!existsSync(html), `unusable run ${r.id} has an output file`);
    }
    const promptPath = join(dir, 'prompts', `${r.id}.txt`);
    if (!existsSync(promptPath)) {
      problems.push(`${r.id}: no prompt recorded`);
      continue;
    }
    const prompt = readFileSync(promptPath, 'utf8');
    assert(sha256(prompt) === r.prompt_file_sha256, `prompt hash mismatch for ${r.id}`);
    const rule = ruleOf(r.stratum);
    assert(
      prompt.includes(rule.text) === r.rule_in_prompt,
      `${r.id}: rule_in_prompt does not match the prompt file`,
    );
    if (prompt.includes(rule.text) !== RULE_IN_PROMPT[r.arm])
      problems.push(`${r.id}: rule in prompt = ${prompt.includes(rule.text)}`);
    if ((r.memory_ids ?? []).length !== EXPECTED_MEMORIES[r.arm])
      problems.push(`${r.id}: ${(r.memory_ids ?? []).length} memories supplied`);
    if (r.arm === 'corrected') {
      const c = r.correction;
      if (
        !c ||
        (r.memory_ids ?? []).includes(c.superseded_id) ||
        !(r.memory_ids ?? []).includes(c.replacement_id)
      )
        problems.push(`${r.id}: correction not reflected in retrieval`);
      if (!prompt.includes(rule.correction))
        problems.push(`${r.id}: correction text missing from prompt`);
    }
  }
  return problems;
}

type Cells = Map<string, { usable: number; violations: number; unusable: number }>;

function count(dir: string, records: RunRecord[], sensitivity: boolean): Cells {
  const cells: Cells = new Map();
  const byDetector = new Map<string, string[]>();
  for (const r of records) {
    const key = `${r.stratum}|${r.arm}`;
    if (!cells.has(key)) cells.set(key, { usable: 0, violations: 0, unusable: 0 });
    if (r.status === 'succeeded') {
      const rule = ruleOf(r.stratum);
      const name = sensitivity ? rule.sensitivity : rule.detector;
      byDetector.set(name, [...(byDetector.get(name) ?? []), join(dir, `${r.id}.html`)]);
    }
  }
  const verdicts: Record<string, boolean> = {};
  for (const [name, paths] of byDetector) Object.assign(verdicts, detect(name, paths));
  for (const r of records) {
    const cell = cells.get(`${r.stratum}|${r.arm}`) ?? fail('cell');
    if (r.status === 'succeeded') {
      cell.usable += 1;
      if (verdicts[join(dir, `${r.id}.html`)]) cell.violations += 1;
    } else {
      cell.unusable += 1;
    }
  }
  return cells;
}

const cell = (cells: Cells, s: string, a: string) =>
  cells.get(`${s}|${a}`) ?? { usable: 0, violations: 0, unusable: 0 };

function pooled(cells: Cells, arm: string): [number, number] {
  let k = 0;
  let n = 0;
  for (const s of design.strata) {
    k += cell(cells, s.id, arm).violations;
    n += cell(cells, s.id, arm).usable;
  }
  return [k, n];
}

function pairs(cells: Cells, a1: string, a0: string): Stratum[] {
  return design.strata.map((s) => {
    const x = cell(cells, s.id, a1);
    const y = cell(cells, s.id, a0);
    return [x.violations, x.usable, y.violations, y.usable];
  });
}

interface Block {
  totals: Record<string, { violations: number; usable: number; unusable: number }>;
  H1_memory_vs_none: { p: number; supported: boolean };
  H2_memory_noninferior_to_manual: { ci90: [number, number]; supported: boolean };
  H3_corrected_vs_memory: { p: number; supported: boolean };
}

function checkAnalysis(model: string, cells: Cells, block: Block): string {
  for (const arm of design.arms) {
    const [k, n] = pooled(cells, arm);
    assert(
      block.totals[arm].violations === k && block.totals[arm].usable === n,
      `${model} ${arm}: analysis totals differ (${k}/${n})`,
    );
  }
  const p1 = stratifiedExact(pairs(cells, 'memory', 'none'));
  const p3 = stratifiedExact(pairs(cells, 'corrected', 'memory'));
  close(block.H1_memory_vs_none.p, p1, `${model} H1 p`);
  close(block.H3_corrected_vs_memory.p, p3, `${model} H3 p`);
  const [km, nm] = pooled(cells, 'memory');
  const [ka, na] = pooled(cells, 'manual');
  const [, lo, hi] = newcombe(km, nm, ka, na, 1.6448536269514722);
  close(block.H2_memory_noninferior_to_manual.ci90[1], hi, `${model} H2 upper bound`);
  close(block.H2_memory_noninferior_to_manual.ci90[0], lo, `${model} H2 lower bound`);
  const [d1] = newcombe(...pooled(cells, 'memory'), ...pooled(cells, 'none'), 1.959963984540054);
  const [d3] = newcombe(
    ...pooled(cells, 'corrected'),
    ...pooled(cells, 'memory'),
    1.959963984540054,
  );
  const [small, large] = p1 <= p3 ? [p1, p3] : [p3, p1];
  const holm = small <= 0.025 ? [true, large <= 0.05] : [false, false];
  const h1 = (p1 <= p3 ? holm[0] : holm[1]) && d1 < 0;
  const h3 = (p1 <= p3 ? holm[1] : holm[0]) && d3 > 0;
  assert(block.H1_memory_vs_none.supported === h1, `${model} H1 verdict differs`);
  assert(
    block.H2_memory_noninferior_to_manual.supported === hi < MARGIN,
    `${model} H2 verdict differs`,
  );
  assert(block.H3_corrected_vs_memory.supported === h3, `${model} H3 verdict differs`);
  const line = (arm: string) => `${pooled(cells, arm).join('/')}`;
  return `none ${line('none')}, memory ${line('memory')}, manual ${line('manual')}, corrected ${line('corrected')}; H1 p=${p1.toExponential(2)} ${h1 ? 'supported' : 'not supported'}; H2 upper ${(hi * 100).toFixed(1)} pp ${hi < MARGIN ? 'supported' : 'not supported'}; H3 p=${p3.toExponential(2)} ${h3 ? 'supported' : 'not supported'}`;
}

function main(): void {
  const fixtures = python([join(P17, 'test_detectors.py')]);
  assert(fixtures.includes('all detector tests passed'), 'detector fixtures failed');
  console.log('Phase 17 evidence verification');
  console.log(`  detectors: ${fixtures.trim().split('\n')[0]}`);

  const p16Lock = readFileSync(join(P16, 'protocol.sha256'), 'utf8');
  const p16Detector = sha256(readFileSync(join(P16, 'detector.py')));
  assert(
    p16Lock.includes(p16Detector),
    'phase16/detector.py differs from the locked Phase 16 detector',
  );
  console.log('  child-safety detector: the locked Phase 16 file, unchanged');

  const lockFile = join(P17, 'protocol.sha256');
  if (existsSync(lockFile)) {
    const lines = readFileSync(lockFile, 'utf8').trim().split('\n');
    for (const line of lines) {
      const [hash, path] = line.split(/\s+/, 2);
      assert(
        sha256(readFileSync(join(ROOT, path))) === hash,
        `protocol.sha256: hash mismatch for ${path}`,
      );
    }
    console.log(`  lock: ${lines.length}/${lines.length} files match protocol.sha256`);
  } else {
    console.log(
      '  lock: protocol.sha256 not present — protocol is a DRAFT, no trial evidence expected',
    );
  }
  for (const [name, b] of Object.entries(design.baselines)) {
    console.log(
      `  baseline ${name}: ${sha256(readFileSync(join(ROOT, b.path))).slice(0, 12)}… ${b.path}`,
    );
  }

  const analysisPath = join(P17, 'phase17-analysis.json');
  let failedChecks = 0;
  for (const model of Object.keys(design.models)) {
    const dir = join(P17, PILOT ? 'pilot' : 'out', model);
    if (!existsSync(dir)) {
      console.log(`  ${model}: no ${PILOT ? 'pilot' : 'trial'} output`);
      continue;
    }
    const records = PILOT
      ? loadRecords(dir, /^pilot\w*-shard-\d+\.json$/, null)
      : loadRecords(dir, new RegExp(`^${model}-shard-\\d+\\.json$`), design.models[model].shards);
    if (!PILOT) {
      assert(
        records.length === design.strata.length * design.arms.length * design.runs_per_cell,
        `${model}: expected ${design.strata.length * design.arms.length * design.runs_per_cell} records, got ${records.length}`,
      );
    }
    const problems = checkRecords(dir, records);
    const cells = count(dir, records, false);
    const usable = records.filter((r) => r.status === 'succeeded').length;
    const shown =
      problems.length > 5 ? `${problems.slice(0, 5).join('; ')}; …` : problems.join('; ');
    console.log(
      `  ${model}: ${records.length} runs, ${usable} usable; hashes match; manipulation checks ${problems.length ? `FAILED for ${problems.length} runs: ${shown}` : 'pass'}`,
    );
    failedChecks += problems.length;
    if (PILOT) {
      const line = design.arms.map((a) => `${a} ${pooled(cells, a).join('/')}`).join(', ');
      console.log(`    pilot violations (excluded from analysis): ${line}`);
      continue;
    }
    assert(existsSync(analysisPath), 'phase17-analysis.json missing');
    const analysis = JSON.parse(readFileSync(analysisPath, 'utf8')) as {
      models: Record<
        string,
        { primary: Block; sensitivity_detector: Block; manipulation_check: { problems: string[] } }
      >;
    };
    assert(
      analysis.models[model].manipulation_check.problems.length === problems.length,
      `${model}: phase17-analysis.json reports a different number of manipulation-check failures`,
    );
    console.log(`    primary: ${checkAnalysis(model, cells, analysis.models[model].primary)}`);
    console.log(
      `    sensitivity detectors: ${checkAnalysis(model, count(dir, records, true), analysis.models[model].sensitivity_detector)}`,
    );
  }
  // Failed manipulation checks are reported, not fatal: the protocol analyses runs as randomised.
  console.log(
    failedChecks
      ? `PASS (evidence reproduces; ${failedChecks} manipulation-check failures, reported above)`
      : 'PASS',
  );
}

main();
