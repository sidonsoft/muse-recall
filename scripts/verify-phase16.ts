/**
 * Independent Phase 16 / 16B evidence check.
 *
 * Re-derives the published numbers from the preserved files without importing
 * the original runners or analysis scripts:
 *
 *   - the locked protocol, detector and baseline hashes match `protocol.sha256`
 *     and `protocol-open.sha256`, and every as-run file matches `SHA256SUMS`;
 *   - 48 records per trial, 16 per arm, in the order the seed formula gives;
 *   - every usable output's hash matches its record; unusable runs have none;
 *   - Phase 16 jobs were supplied 0 / 1 / 2 decisions in the three arms;
 *   - the locked detector (run with python3) passes its fixtures, reproduces
 *     the Phase 15B corrected coding, and gives 12/12, 12/12, 0/13 (Phase 16)
 *     and 16/16, 6/16, 0/16 (Phase 16B as published);
 *   - the two-tailed Fisher p-values and both analysis files reproduce;
 *   - Phase 16B correction 1: the 12 outputs cut off at the token limit
 *     (`finish_reason: length`, no `</html>`) are unusable, giving 16/16, 6/6,
 *     0/14 (see `phase16b/CORRECTION_1.md`). Every Phase 16 output is complete.
 *
 * No network, no model, no mutation. Requires python3 on PATH.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE = join(ROOT, 'docs/hackathon-evidence');
const P16 = join(EVIDENCE, 'phase16');
const P16B = join(EVIDENCE, 'phase16b');
const P15B = join(EVIDENCE, 'phase15b');
const BASELINE = join(ROOT, 'demo/forge-baseline/index.html');
const SEED = 0x16a2026;
const SHARDS = 6;
const ARMS = ['no-memory', 'palette', 'rule'] as const;
type Arm = (typeof ARMS)[number];

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

function close(actual: number, expected: number, label: string): void {
  assert(
    Math.abs(actual - expected) <= Math.abs(expected) * 1e-9,
    `${label}: expected ${expected}, got ${actual}`,
  );
}

function python(args: string[]): string {
  const result = spawnSync('python3', ['-I', '-B', ...args], { encoding: 'utf8' });
  if (result.error) fail(`python3 is required: ${result.error.message}`);
  assert(result.status === 0, `python3 failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

/** Runs the locked detector over files and returns violation verdicts by path. */
function detect(paths: string[]): Record<string, boolean> {
  const code = [
    'import sys, json',
    'sys.path.insert(0, sys.argv[1])',
    'from detector import detect_html',
    "print(json.dumps({p: detect_html(open(p, encoding='utf-8').read()).violation for p in sys.argv[2:]}))",
  ].join('\n');
  return JSON.parse(python(['-c', code, P16, ...paths])) as Record<string, boolean>;
}

function checkProtocolHashes(dir: string, file: string): number {
  const lines = readFileSync(join(dir, file), 'utf8').trim().split('\n');
  for (const line of lines) {
    const [hash, path] = line.split(/\s+/, 2);
    // The baseline was hashed in the checkout the trials ran from; it is the same file here.
    const local = path.endsWith('demo/forge-baseline/index.html') ? BASELINE : join(dir, path);
    assert(sha256(local) === hash, `${file}: hash mismatch for ${path}`);
  }
  return lines.length;
}

/** Every as-run file is byte-identical to the copy hashed into SHA256SUMS. */
function checkManifest(dir: string): number {
  const lines = readFileSync(join(dir, 'SHA256SUMS'), 'utf8').trim().split('\n');
  for (const line of lines) {
    const [hash, path] = line.split(/\s+/, 2);
    assert(sha256(join(dir, path)) === hash, `SHA256SUMS mismatch: ${path}`);
  }
  return lines.length;
}

function expectedOrder(): string[][] {
  const cells = [] as { digest: string; id: string }[];
  for (let i = 0; i < 16; i += 1) {
    for (const arm of ARMS) {
      const digest = createHash('sha256').update(`${SEED}:${i}:${arm}`).digest('hex');
      cells.push({ digest, id: `${arm}-${String(i + 1).padStart(2, '0')}` });
    }
  }
  cells.sort((a, b) => a.digest.localeCompare(b.digest));
  return Array.from({ length: SHARDS }, (_, shard) =>
    cells.filter((_, i) => i % SHARDS === shard).map((cell) => cell.id),
  );
}

interface RunRecord {
  id: string;
  arm: Arm;
  status: string;
  output_sha256?: string;
  memory_ids?: string[];
  finish_reason?: string | null;
}

function isComplete(path: string): boolean {
  return readFileSync(path, 'utf8').toLowerCase().includes('</html>');
}

function loadRecords(dir: string, prefix: string): RunRecord[] {
  const order = expectedOrder();
  const records: RunRecord[] = [];
  for (let shard = 0; shard < SHARDS; shard += 1) {
    const file = join(dir, 'out', `${prefix}-shard-${shard}.json`);
    const rows = (JSON.parse(readFileSync(file, 'utf8')) as { results: RunRecord[] }).results;
    assert(
      rows.map((row) => row.id).join(',') === order[shard].join(','),
      `${prefix} shard ${shard} order does not reproduce from the seed formula`,
    );
    records.push(...rows);
  }
  assert(records.length === 48, `${prefix}: expected 48 records, got ${records.length}`);
  for (const arm of ARMS) {
    assert(records.filter((r) => r.arm === arm).length === 16, `${prefix}: ${arm} is not 16`);
  }
  return records;
}

interface ArmCount {
  usable: number;
  violations: number;
  unusable: number;
}

function score(
  dir: string,
  records: RunRecord[],
  isUsable: (record: RunRecord) => boolean = (record) => record.status === 'succeeded',
): Record<Arm, ArmCount> {
  const usable = records.filter(isUsable);
  for (const record of records) {
    const path = join(dir, 'out', `${record.id}.html`);
    if (record.status === 'succeeded') {
      assert(sha256(path) === record.output_sha256, `output hash mismatch for ${record.id}`);
    } else {
      assert(!existsSync(path), `unusable run ${record.id} has an output file`);
    }
  }
  const verdicts = detect(usable.map((r) => join(dir, 'out', `${r.id}.html`)));
  const counts = {} as Record<Arm, ArmCount>;
  for (const arm of ARMS) {
    const rows = records.filter((r) => r.arm === arm);
    const ok = rows.filter(isUsable);
    counts[arm] = {
      usable: ok.length,
      violations: ok.filter((r) => verdicts[join(dir, 'out', `${r.id}.html`)]).length,
      unusable: rows.length - ok.length,
    };
  }
  return counts;
}

function contrast(rule: ArmCount, control: ArmCount): number {
  return fisherTwoTailed(
    rule.violations,
    rule.usable - rule.violations,
    control.violations,
    control.usable - control.violations,
  );
}

function main(): void {
  const lockedP16 = checkProtocolHashes(P16, 'protocol.sha256');
  const lockedP16B = checkProtocolHashes(P16B, 'protocol-open.sha256');
  const filesP16 = checkManifest(P16);
  const filesP16B = checkManifest(P16B);

  // Detector fixtures, then the retrospective Phase 15B validation.
  const fixtures = python([
    '-c',
    "import sys, runpy; sys.path.insert(0, sys.argv[1]); runpy.run_path(sys.argv[1] + '/test_detector.py', run_name='__main__')",
    P16,
  ]);
  assert(fixtures.includes('all detector tests passed'), 'detector fixtures failed');

  const trials15b = (
    JSON.parse(readFileSync(join(P15B, 'trial-results.json'), 'utf8')) as {
      results: { id: string; memory: boolean }[];
    }
  ).results;
  const rubric = Object.fromEntries(
    (
      JSON.parse(readFileSync(join(P15B, 'rubric.json'), 'utf8')) as {
        run: string;
        child_safety: { violation: boolean };
      }[]
    ).map((row) => [row.run, row.child_safety.violation] as const),
  );
  const verdicts15b = detect(trials15b.map((t) => join(P15B, 'sources', `${t.id}.html`)));
  let agree = 0;
  for (const trial of trials15b) {
    const detected = verdicts15b[join(P15B, 'sources', `${trial.id}.html`)];
    assert(detected === rubric[trial.id], `detector disagrees with 15B coding on ${trial.id}`);
    agree += 1;
  }

  // Phase 16: Muse Spark through the production Forge path.
  const records16 = loadRecords(P16, 'phase16');
  const supplied: Record<Arm, number> = { 'no-memory': 0, palette: 1, rule: 2 };
  for (const record of records16) {
    assert(
      record.memory_ids?.length === supplied[record.arm],
      `${record.id} was supplied ${record.memory_ids?.length} decisions`,
    );
  }
  const c16 = score(P16, records16);
  for (const record of records16.filter((r) => r.status === 'succeeded')) {
    assert(
      isComplete(join(P16, 'out', `${record.id}.html`)),
      `Phase 16 output ${record.id} is truncated`,
    );
  }
  assert(
    c16['no-memory'].violations === 12 && c16['no-memory'].usable === 12,
    `Phase 16 no-memory unexpected: ${JSON.stringify(c16['no-memory'])}`,
  );
  assert(
    c16.palette.violations === 12 && c16.palette.usable === 12,
    `Phase 16 palette unexpected: ${JSON.stringify(c16.palette)}`,
  );
  assert(
    c16.rule.violations === 0 && c16.rule.usable === 13,
    `Phase 16 rule unexpected: ${JSON.stringify(c16.rule)}`,
  );
  const p16NoMemory = contrast(c16.rule, c16['no-memory']);
  const p16Palette = contrast(c16.rule, c16.palette);
  const worstRule = c16.rule.violations + c16.rule.unusable;
  const worstNoMemory = c16['no-memory'].violations + c16['no-memory'].unusable;
  const p16Worst = fisherTwoTailed(worstRule, 16 - worstRule, worstNoMemory, 16 - worstNoMemory);
  close(p16NoMemory, 1.9229659827317656e-7, 'Phase 16 rule vs no memory');
  close(p16Palette, 1.9229659827317656e-7, 'Phase 16 rule vs palette');
  close(p16Worst, 3.2241943544356854e-6, 'Phase 16 worst case');

  const a16 = JSON.parse(readFileSync(join(P16, 'phase16-analysis.json'), 'utf8')) as {
    arms: Record<Arm, ArmCount>;
    'rule_vs_no-memory': { fisher_p: number };
    rule_vs_palette: { fisher_p: number };
    worst_case: { rule_vs_no_memory_p: number };
  };
  for (const arm of ARMS) {
    assert(
      a16.arms[arm].usable === c16[arm].usable &&
        a16.arms[arm].violations === c16[arm].violations &&
        a16.arms[arm].unusable === c16[arm].unusable,
      `phase16-analysis.json does not match the re-derived ${arm} counts`,
    );
  }
  close(a16['rule_vs_no-memory'].fisher_p, p16NoMemory, 'phase16-analysis.json rule vs no memory');
  close(a16.rule_vs_palette.fisher_p, p16Palette, 'phase16-analysis.json rule vs palette');
  close(a16.worst_case.rule_vs_no_memory_p, p16Worst, 'phase16-analysis.json worst case');

  // Phase 16B: Muse Spark Open on Baseten, same cells, prompt and detector.
  const records16b = loadRecords(P16B, 'baseten');
  const c16b = score(P16B, records16b);
  assert(
    c16b['no-memory'].violations === 16 && c16b['no-memory'].usable === 16,
    `Phase 16B no-memory unexpected: ${JSON.stringify(c16b['no-memory'])}`,
  );
  assert(
    c16b.palette.violations === 6 && c16b.palette.usable === 16,
    `Phase 16B palette unexpected: ${JSON.stringify(c16b.palette)}`,
  );
  assert(
    c16b.rule.violations === 0 && c16b.rule.usable === 16,
    `Phase 16B rule unexpected: ${JSON.stringify(c16b.rule)}`,
  );
  const p16bNoMemory = contrast(c16b.rule, c16b['no-memory']);
  const p16bPalette = contrast(c16b.rule, c16b.palette);
  const p16bPaletteNoMemory = contrast(c16b.palette, c16b['no-memory']);
  close(p16bNoMemory, 3.3273419550419868e-9, 'Phase 16B rule vs no memory');
  close(p16bPalette, 0.01767395871956495, 'Phase 16B rule vs palette');
  close(p16bPaletteNoMemory, 0.0002482629652915478, 'Phase 16B palette vs no memory');

  const a16b = JSON.parse(readFileSync(join(P16B, 'phase16b-analysis.json'), 'utf8')) as {
    arms: Record<Arm, { usable: number; violations: number }>;
    'rule_vs_no-memory': { fisher_p: number };
    rule_vs_palette: { fisher_p: number };
    palette_vs_no_memory: { fisher_p: number };
  };
  for (const arm of ARMS) {
    assert(
      a16b.arms[arm].usable === c16b[arm].usable &&
        a16b.arms[arm].violations === c16b[arm].violations,
      `phase16b-analysis.json does not match the re-derived ${arm} counts`,
    );
  }
  close(
    a16b['rule_vs_no-memory'].fisher_p,
    p16bNoMemory,
    'phase16b-analysis.json rule vs no memory',
  );
  close(a16b.rule_vs_palette.fisher_p, p16bPalette, 'phase16b-analysis.json rule vs palette');
  close(
    a16b.palette_vs_no_memory.fisher_p,
    p16bPaletteNoMemory,
    'phase16b-analysis.json palette vs no memory',
  );

  const outputs16b = readdirSync(join(P16B, 'out')).filter((name) =>
    /^(no-memory|palette|rule)-\d\d\.html$/.test(name),
  );
  assert(outputs16b.length === 48, `expected 48 Phase 16B outputs, got ${outputs16b.length}`);

  // Correction 1: a response cut off at the token limit is unusable, not clean.
  for (const record of records16b) {
    const complete = isComplete(join(P16B, 'out', `${record.id}.html`));
    assert(
      complete === (record.finish_reason === 'stop'),
      `${record.id}: finish_reason ${record.finish_reason} but complete=${complete}`,
    );
  }
  const truncated = records16b.filter((r) => r.finish_reason === 'length');
  assert(truncated.length === 12, `expected 12 truncated 16B outputs, got ${truncated.length}`);
  const fixed = score(
    P16B,
    records16b,
    (record) => record.status === 'succeeded' && record.finish_reason === 'stop',
  );
  assert(
    fixed['no-memory'].violations === 16 && fixed['no-memory'].usable === 16,
    `corrected 16B no-memory unexpected: ${JSON.stringify(fixed['no-memory'])}`,
  );
  assert(
    fixed.palette.violations === 6 && fixed.palette.usable === 6 && fixed.palette.unusable === 10,
    `corrected 16B palette unexpected: ${JSON.stringify(fixed.palette)}`,
  );
  assert(
    fixed.rule.violations === 0 && fixed.rule.usable === 14 && fixed.rule.unusable === 2,
    `corrected 16B rule unexpected: ${JSON.stringify(fixed.rule)}`,
  );
  const fixedNoMemory = contrast(fixed.rule, fixed['no-memory']);
  const fixedPalette = contrast(fixed.rule, fixed.palette);
  const fixedWorstRule = fixed.rule.violations + fixed.rule.unusable;
  const fixedWorst = fisherTwoTailed(fixedWorstRule, 16 - fixedWorstRule, 16, 0);
  close(fixedNoMemory, 6.876506707086773e-9, 'corrected 16B rule vs no memory');
  close(fixedPalette, 2.5799793601651186e-5, 'corrected 16B rule vs palette');
  close(fixedWorst, 5.09083319121424e-7, 'corrected 16B worst case');

  const line = (c: ArmCount) => `${c.violations}/${c.usable}`;
  console.log('Phase 16 / 16B evidence verification');
  console.log(
    `  locked hashes: ${lockedP16}/${lockedP16} (16), ${lockedP16B}/${lockedP16B} (16B) match`,
  );
  console.log(`  as-run files: ${filesP16} (16) and ${filesP16B} (16B) match SHA256SUMS`);
  console.log(
    `  detector: fixtures pass; agrees with the 15B corrected coding on ${agree}/32 runs`,
  );
  console.log('  order: both trials reproduce from sha256("<seed>:<i>:<arm>") across 6 shards');
  console.log(
    `  Phase 16 (Muse Spark): no memory ${line(c16['no-memory'])}, palette ${line(c16.palette)}, rule ${line(c16.rule)}; unusable ${c16['no-memory'].unusable}/${c16.palette.unusable}/${c16.rule.unusable}`,
  );
  console.log(
    `    rule vs no memory p=${p16NoMemory.toExponential(2)}, rule vs palette p=${p16Palette.toExponential(2)}, worst case p=${p16Worst.toExponential(2)}`,
  );
  console.log(
    `  Phase 16B as published: no memory ${line(c16b['no-memory'])}, palette ${line(c16b.palette)}, rule ${line(c16b.rule)}`,
  );
  console.log(
    `    rule vs no memory p=${p16bNoMemory.toExponential(2)}, rule vs palette p=${p16bPalette.toFixed(3)}, palette vs no memory p=${p16bPaletteNoMemory.toExponential(2)}`,
  );
  console.log(
    `  Phase 16B corrected (${truncated.length} truncated outputs unusable): no memory ${line(fixed['no-memory'])}, palette ${line(fixed.palette)}, rule ${line(fixed.rule)}`,
  );
  console.log(
    `    rule vs no memory p=${fixedNoMemory.toExponential(2)}, rule vs palette p=${fixedPalette.toExponential(2)}, worst case p=${fixedWorst.toExponential(2)}`,
  );
  console.log('    every Phase 16 output is a complete document');
  console.log('PASS');
}

main();
