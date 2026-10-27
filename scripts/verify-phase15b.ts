/**
 * Independent Phase 15B evidence check.
 *
 * Re-derives the published numbers from the preserved files without importing
 * the original runner or analysis code:
 *
 *   - 32 trial records, 16/16 allocation, all succeeded;
 *   - every raw output hash matches `trial-results.json`;
 *   - the execution order reproduces from the documented seed formula;
 *   - v1 and v2 counts are 15/5 and 15/0;
 *   - both two-tailed Fisher exact p-values reproduce;
 *   - the recovered tooling matches its SHA-256 manifest;
 *   - the baseline hash matches the protocol.
 *
 * No network, no model, no mutation.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE = join(ROOT, 'docs/hackathon-evidence/phase15b');
const RECOVERED = join(EVIDENCE, 'recovered');
const BASELINE_SHA = '5385c5582dac572351c29ee0c1bba128609a49bc5ba171db03f656e065bdee03';
const SEED = 0x15b2026;

function fail(message: string): never {
  throw new Error(message);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function comb(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 1; i <= k; i += 1) result = (result * (n - k + i)) / i;
  return result;
}

function fisherTwoTailed(a: number, b: number, c: number, d: number): number {
  const n = a + b + c + d;
  const r1 = a + b;
  const c1 = a + c;
  const c2 = b + d;
  const denominator = comb(n, r1);
  const probability = (x: number) => (comb(c1, x) * comb(c2, r1 - x)) / denominator;
  const observed = probability(a);
  let total = 0;
  for (let x = Math.max(0, r1 - c2); x <= Math.min(r1, c1); x += 1) {
    if (probability(x) <= observed + 1e-12) total += probability(x);
  }
  return total;
}

interface TrialRecord {
  id: string;
  memory: boolean;
  status: string;
  output_sha256: string | null;
}

function main(): void {
  const results = JSON.parse(readFileSync(join(EVIDENCE, 'trial-results.json'), 'utf8')) as {
    baseline_sha256: string;
    results: TrialRecord[];
  };
  const trials = results.results;

  assert(trials.length === 32, `expected 32 records, got ${trials.length}`);
  assert(new Set(trials.map((r) => r.id)).size === 32, 'duplicate run ids');
  assert(
    trials.filter((r) => r.memory).length === 16 && trials.filter((r) => !r.memory).length === 16,
    'allocation is not 16/16',
  );
  assert(
    trials.every((r) => r.status === 'succeeded'),
    'at least one trial did not succeed',
  );
  assert(results.baseline_sha256 === BASELINE_SHA, 'trial-results baseline hash mismatch');
  assert(
    sha256(join(RECOVERED, 'baseline/sky-pairs-high-cand2.html')) === BASELINE_SHA,
    'baseline hash mismatch',
  );

  let hashes = 0;
  for (const record of trials) {
    const actual = sha256(join(EVIDENCE, 'sources', `${record.id}.html`));
    assert(actual === record.output_sha256, `output hash mismatch for ${record.id}`);
    hashes += 1;
  }

  // Recompute the order with the actual runner formula.
  const order = [] as { digest: string; id: string }[];
  for (let i = 0; i < 16; i += 1) {
    for (const memory of [false, true]) {
      const digest = createHash('sha256').update(`${SEED}:${i}:${memory}`).digest('hex');
      order.push({ digest, id: `${memory ? 'mem' : 'nomem'}-${String(i + 1).padStart(2, '0')}` });
    }
  }
  order.sort((a, b) => a.digest.localeCompare(b.digest));
  assert(
    order.map((entry) => entry.id).join(',') === trials.map((record) => record.id).join(','),
    'execution order does not reproduce from the seed formula',
  );

  type RubricRow = { run: string; child_safety: { violation: boolean } };
  const toMap = (rows: RubricRow[]) =>
    Object.fromEntries(rows.map((row) => [row.run, row] as const));
  const v1 = toMap(
    JSON.parse(readFileSync(join(EVIDENCE, 'rubric-v1-flawed.json'), 'utf8')) as RubricRow[],
  );
  const v2 = toMap(JSON.parse(readFileSync(join(EVIDENCE, 'rubric.json'), 'utf8')) as RubricRow[]);
  assert(Object.keys(v1).length === 40, 'v1 rubric should contain 32 trial + 8 pilot rows');
  assert(Object.keys(v2).length === 40, 'v2 rubric should contain 32 trial + 8 pilot rows');

  const count = (rubric: Record<string, RubricRow>) => ({
    memory: trials.filter((r) => r.memory && rubric[r.id].child_safety.violation).length,
    noMemory: trials.filter((r) => !r.memory && rubric[r.id].child_safety.violation).length,
  });
  const c1 = count(v1);
  const c2 = count(v2);
  assert(c1.memory === 5 && c1.noMemory === 15, `v1 counts unexpected: ${JSON.stringify(c1)}`);
  assert(c2.memory === 0 && c2.noMemory === 15, `v2 counts unexpected: ${JSON.stringify(c2)}`);

  const p1 = fisherTwoTailed(c1.memory, 16 - c1.memory, c1.noMemory, 16 - c1.noMemory);
  const p2 = fisherTwoTailed(c2.memory, 16 - c2.memory, c2.noMemory, 16 - c2.noMemory);
  assert(Math.abs(p1 - 0.00063516628782383) < 1e-15, `v1 Fisher p unexpected: ${p1}`);
  assert(Math.abs(p2 - 5.656481323571378e-8) < 1e-16, `v2 Fisher p unexpected: ${p2}`);

  const analysis = JSON.parse(readFileSync(join(EVIDENCE, 'analysis.json'), 'utf8')) as {
    table: { rule_remembered: number[]; no_memory: number[] };
    fisher_two_tailed_p: number;
  };
  assert(
    analysis.table.rule_remembered[0] === c2.memory &&
      analysis.table.no_memory[0] === c2.noMemory &&
      Math.abs(analysis.fisher_two_tailed_p - p2) < 1e-16,
    'analysis.json does not match the re-derived v2 counts',
  );

  // Recovered bundle integrity.
  const sums = readFileSync(join(RECOVERED, 'SHA256SUMS'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => {
      const [hash, path] = line.split(/\s+/, 2);
      return { hash, path };
    });
  assert(sums.length >= 72, `expected at least 72 recovered files, got ${sums.length}`);
  for (const entry of sums) {
    assert(
      sha256(join(RECOVERED, entry.path)) === entry.hash,
      `recovered hash mismatch: ${entry.path}`,
    );
  }

  const diffs = readdirSync(join(RECOVERED, 'recorded-diffs')).filter((name) =>
    name.endsWith('.diff'),
  );
  assert(diffs.length === 40, `expected 40 recorded diffs, got ${diffs.length}`);
  for (const name of diffs) {
    assert(
      readFileSync(join(RECOVERED, 'recorded-diffs', name)).byteLength === 0,
      `${name} is not empty`,
    );
  }

  console.log('Phase 15B evidence verification');
  console.log(`  records: ${trials.length} (16 memory / 16 no-memory), 0 unusable`);
  console.log(`  raw output hashes: ${hashes}/32 match`);
  console.log('  execution order: reproduces from sha256("22749222:<i>:<true|false>")');
  console.log(
    `  v1: memory ${c1.memory}/16, no-memory ${c1.noMemory}/16, p=${p1.toExponential(6)}`,
  );
  console.log(
    `  v2: memory ${c2.memory}/16, no-memory ${c2.noMemory}/16, p=${p2.toExponential(6)}`,
  );
  console.log(
    `  recovered hashes: ${sums.length}/${sums.length} match; 40 recorded diffs are empty`,
  );
  console.log('PASS');
}

main();
