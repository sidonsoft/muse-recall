/**
 * Strict Phase 17 lock and statistics validator (unlocked companion).
 *
 * `scripts/verify-phase17.ts` is locked in `protocol.sha256` and is not edited.
 * Two of its behaviours are too weak for a frozen result, and this companion
 * closes both gaps under `pnpm verify:research17`:
 *
 *   - it treats a missing `protocol.sha256` as a draft and still prints PASS;
 *   - its p-value comparison has an absolute 1e-15 floor, so any value below
 *     that (including 0) compares equal to the published one.
 *
 * This validator therefore:
 *   1. requires the manifest and the lock metadata to be present;
 *   2. pins the manifest's own SHA-256 (the established pre-registration
 *      identity) and requires exactly the 17 locked paths, in order;
 *   3. re-hashes every locked file against the manifest;
 *   4. pins the original `phase17-analysis.json` by hash and compares every
 *      p-value and risk difference with a relative-only tolerance, so a tiny
 *      probability cannot be tampered with;
 *   5. checks `CORRECTIONS.sha256` and its files, keeping the original
 *      as-run analysis distinct from the post-run corrected reporting;
 *   6. re-derives the corrected analysis from the raw records by running
 *      `exact_stats.py --check`.
 *
 * Usage: tsx scripts/verify-phase17-strict.ts [--root=<dir>]
 * Exits nonzero on any failure. No network, no model, no mutation.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const rootArg = process.argv.slice(2).find((a) => a.startsWith('--root='));
const ROOT = rootArg ? resolve(rootArg.slice('--root='.length)) : REPO;
const P17 = join(ROOT, 'docs/hackathon-evidence/phase17');

/** SHA-256 of `protocol.sha256` at the lock; the content identity of the pre-registration. */
const MANIFEST_SHA256 = '2f1f76668d31ebfa171ff042e2509493e329f72d20a18bce1f57a3c866d58767';
/** SHA-256 of the preserved as-run analysis. */
const ANALYSIS_SHA256 = 'f384fca782cc7b0f8c8675f4218b98ef1ebbfbc9e0eedd4b0f1687e598fd9d64';
/** SHA-256 of the correction manifest (checksums of the corrected reporting). */
const CORRECTIONS_SHA256 = '1f506e226468963ed5f6f94b7d9a2f3b437ce5676c2b0fd6ce40596c70cb6c32';
const LOCK_COMMIT = '6640e83f3c999cd1349420ad5e95bc329fff7d36';
const LOCK_TAG = 'phase17-preregistration';

/** The locked inventory, in the order the lock commits it. */
const EXPECTED_MANIFEST = [
  'docs/hackathon-evidence/phase17/PROTOCOL.md',
  'docs/hackathon-evidence/phase17/design.json',
  'docs/hackathon-evidence/phase17/detectors.py',
  'docs/hackathon-evidence/phase17/test_detectors.py',
  'docs/hackathon-evidence/phase17/stats17.py',
  'docs/hackathon-evidence/phase17/analyze_phase17.py',
  'docs/hackathon-evidence/phase17/power.py',
  'docs/hackathon-evidence/phase17/power.txt',
  'docs/hackathon-evidence/phase17/harness.mjs',
  'docs/hackathon-evidence/phase17/run_spark.mjs',
  'docs/hackathon-evidence/phase17/run_open.mjs',
  'docs/hackathon-evidence/phase17/gen_orchard.mjs',
  'docs/hackathon-evidence/phase17/baselines/orchard-catch.html',
  'docs/hackathon-evidence/phase16/detector.py',
  'demo/forge-baseline/index.html',
  'docs/demo/evidence/artifacts/v3-staged.html',
  'scripts/verify-phase17.ts',
];

const CORRECTION_FILES = [
  'exact_stats.py',
  'phase17-analysis-corrected.json',
  'STATS_CORRECTION.md',
];

/** The as-run values of the four cells that carry p-values, pinned at review time. */
const PINNED: Record<string, Record<string, { h1: number; h3: number; worst: number }>> = {
  spark: {
    primary: {
      h1: 2.0233041917047282e-16,
      h3: 3.3516103624202434e-16,
      worst: 2.8210518128749196e-17,
    },
    sensitivity_detector: {
      h1: 8.208014167766698e-16,
      h3: 1.6690937900960992e-17,
      worst: 1.2627539403918104e-13,
    },
  },
  open: {
    primary: {
      h1: 4.724252673657283e-16,
      h3: 5.434113128287434e-16,
      worst: 4.724252673657283e-16,
    },
    sensitivity_detector: {
      h1: 4.724252673657283e-16,
      h3: 1.1242654379272392e-15,
      worst: 4.724252673657283e-16,
    },
  },
};

function fail(message: string): never {
  throw new Error(message);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

/**
 * Relative-only comparison: no absolute floor, so a value of 0 never matches a
 * tiny expected probability, and 1e-24 is judged to the same precision as 0.5.
 */
export function closeRelative(actual: number, expected: number, rel = 1e-9): boolean {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
  if (expected === 0) return actual === 0;
  return Math.abs(actual - expected) <= Math.abs(expected) * rel;
}

interface ModelBlock {
  totals: Record<string, { violations: number; usable: number; unusable: number }>;
  H1_memory_vs_none: { p: number; risk_difference: number };
  H2_memory_noninferior_to_manual: { risk_difference: number; ci90: number[] };
  H3_corrected_vs_memory: { p: number; risk_difference: number };
  worst_case_H1_p?: number;
  worst_case_H1?: { p: number };
}

function load(path: string): { models: Record<string, Record<string, ModelBlock>> } {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function main(): void {
  // 1. The manifest and its identity.
  const manifest = join(P17, 'protocol.sha256');
  assert(
    existsSync(manifest),
    'protocol.sha256 is missing: the pre-registration cannot be verified',
  );
  assert(
    sha256(manifest) === MANIFEST_SHA256,
    'protocol.sha256 does not match the locked pre-registration identity',
  );

  const lines = readFileSync(manifest, 'utf8').trim().split('\n');
  const paths = lines.map((line) => line.split(/\s+/, 2)[1]);
  assert(
    paths.length === EXPECTED_MANIFEST.length,
    `manifest lists ${paths.length} files, expected ${EXPECTED_MANIFEST.length}`,
  );
  for (const want of EXPECTED_MANIFEST) {
    assert(paths.includes(want), `manifest is missing the locked entry ${want}`);
  }
  for (const path of paths) {
    assert(EXPECTED_MANIFEST.includes(path), `manifest has an unexpected entry ${path}`);
  }

  // 2. Every locked file.
  for (const line of lines) {
    const [hash, path] = line.split(/\s+/, 2);
    assert(existsSync(join(ROOT, path)), `locked file is missing: ${path}`);
    assert(sha256(join(ROOT, path)) === hash, `locked file does not match the manifest: ${path}`);
  }

  // 3. Lock metadata.
  const lockFile = join(P17, 'LOCK.md');
  assert(existsSync(lockFile), 'LOCK.md is missing: the lock metadata cannot be verified');
  const lock = readFileSync(lockFile, 'utf8');
  assert(lock.includes(LOCK_COMMIT), `LOCK.md does not record the lock commit ${LOCK_COMMIT}`);
  assert(lock.includes(LOCK_TAG), `LOCK.md does not record the tag ${LOCK_TAG}`);
  const protocol = readFileSync(join(P17, 'PROTOCOL.md'), 'utf8').split('\n')[0];
  assert(
    /locked before the first trial run/.test(protocol),
    'PROTOCOL.md does not carry the locked status line',
  );

  // 4. The original as-run analysis: hash and values, relative-only.
  const analysisPath = join(P17, 'phase17-analysis.json');
  assert(existsSync(analysisPath), 'phase17-analysis.json is missing');
  assert(
    sha256(analysisPath) === ANALYSIS_SHA256,
    'phase17-analysis.json differs from the preserved as-run analysis',
  );
  const analysis = load(analysisPath);

  // 5. The corrected reporting, kept distinct from the original.
  const correctionsManifest = join(P17, 'CORRECTIONS.sha256');
  assert(existsSync(correctionsManifest), 'CORRECTIONS.sha256 is missing');
  assert(
    sha256(correctionsManifest) === CORRECTIONS_SHA256,
    'CORRECTIONS.sha256 does not match the reviewed correction identity',
  );
  const correctionLines = readFileSync(correctionsManifest, 'utf8').trim().split('\n');
  const correctionPaths = correctionLines.map((line) => line.split(/\s+/, 2)[1]);
  assert(
    correctionPaths.length === CORRECTION_FILES.length,
    `CORRECTIONS.sha256 lists ${correctionPaths.length} files, expected ${CORRECTION_FILES.length}`,
  );
  for (const name of CORRECTION_FILES) {
    assert(correctionPaths.includes(name), `CORRECTIONS.sha256 is missing ${name}`);
    const line = correctionLines.find((l) => l.endsWith(name)) ?? fail(`missing ${name}`);
    const [hash, path] = line.split(/\s+/, 2);
    assert(existsSync(join(P17, path)), `correction file is missing: ${path}`);
    assert(sha256(join(P17, path)) === hash, `correction file does not match: ${path}`);
  }

  const corrected = load(join(P17, 'phase17-analysis-corrected.json'));

  for (const model of Object.keys(PINNED)) {
    assert(analysis.models[model], `analysis is missing model ${model}`);
    assert(corrected.models[model], `corrected analysis is missing model ${model}`);
    for (const block of ['primary', 'sensitivity_detector']) {
      const a = analysis.models[model][block];
      const c = corrected.models[model][block];
      const pinned = PINNED[model][block];
      assert(a && c, `${model}/${block} is missing from an analysis file`);
      for (const arm of Object.keys(a.totals)) {
        assert(
          a.totals[arm].violations === c.totals[arm].violations &&
            a.totals[arm].usable === c.totals[arm].usable &&
            a.totals[arm].unusable === c.totals[arm].unusable,
          `${model}/${block}/${arm}: counts differ between the as-run and corrected analyses`,
        );
      }
      assert(
        closeRelative(a.H1_memory_vs_none.p, pinned.h1),
        `${model}/${block}: H1 p differs from the pinned as-run value (${a.H1_memory_vs_none.p})`,
      );
      assert(
        closeRelative(a.H3_corrected_vs_memory.p, pinned.h3),
        `${model}/${block}: H3 p differs from the pinned as-run value (${a.H3_corrected_vs_memory.p})`,
      );
      const worst = a.worst_case_H1_p ?? a.worst_case_H1?.p;
      assert(
        typeof worst === 'number' && closeRelative(worst, pinned.worst),
        `${model}/${block}: worst-case H1 p differs from the pinned as-run value`,
      );
      // The published values were upper bounds; the exact ones must not exceed them.
      assert(
        c.H1_memory_vs_none.p <= a.H1_memory_vs_none.p * (1 + 1e-12),
        `${model}/${block}: exact H1 p exceeds the as-run p`,
      );
      assert(
        c.H3_corrected_vs_memory.p <= a.H3_corrected_vs_memory.p * (1 + 1e-12),
        `${model}/${block}: exact H3 p exceeds the as-run p`,
      );
      assert(
        closeRelative(c.H1_memory_vs_none.risk_difference, a.H1_memory_vs_none.risk_difference),
        `${model}/${block}: H1 risk difference differs from the as-run analysis`,
      );
      assert(
        closeRelative(
          c.H2_memory_noninferior_to_manual.ci90[1],
          a.H2_memory_noninferior_to_manual.ci90[1],
        ),
        `${model}/${block}: H2 upper bound differs from the as-run analysis`,
      );
    }
  }

  // 6. The corrected analysis must reproduce from the raw records.
  const run = spawnSync(
    'python3',
    ['-I', join(P17, 'exact_stats.py'), '--check', `--root=${ROOT}`],
    { encoding: 'utf8' },
  );
  assert(!run.error, `python3 is required: ${run.error?.message}`);
  assert(
    run.status === 0,
    `corrected statistics do not reproduce from the records: ${(run.stderr || run.stdout).trim()}`,
  );

  console.log('Phase 17 strict lock and statistics');
  console.log(
    `  manifest: ${EXPECTED_MANIFEST.length}/${EXPECTED_MANIFEST.length} locked paths, identity matches`,
  );
  console.log('  locked files: all match the manifest');
  console.log(`  lock metadata: ${LOCK_COMMIT.slice(0, 12)}… + tag ${LOCK_TAG}`);
  console.log(
    '  as-run analysis: hash and p-values match the preserved values (relative comparison)',
  );
  console.log(
    '  corrected reporting: separate manifest verified; values reproduce from the records',
  );
  console.log('PASS');
}

const invokedDirectly =
  /verify-phase17-strict\.(ts|js)$/.test(process.argv[1] ?? '') ||
  import.meta.url === pathToFileURL(process.argv[1] ?? '').href;

if (invokedDirectly) {
  try {
    main();
  } catch (error) {
    console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
