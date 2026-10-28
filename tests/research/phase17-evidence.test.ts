/**
 * Phase 17 evidence verification regressions.
 *
 * These tests operate on disposable copies of the evidence tree: every mutation
 * happens under a fresh temporary directory and the real `out/` records are
 * never touched. They cover the failure modes the locked verifier does not
 * catch — a missing manifest, a changed locked file, an incomplete manifest and
 * a tampered statistical value — plus the inventory policy for the SHA256SUMS
 * check (OS metadata ignored, required evidence mandatory, unexpected
 * substantive files rejected).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeRelative } from '../../scripts/verify-phase17-strict';

const ROOT = join(import.meta.dirname, '../..');
const TSX = join(ROOT, 'node_modules/tsx/dist/cli.mjs');
const P17 = 'docs/hackathon-evidence/phase17';
const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'p17-evidence-'));
  created.push(dir);
  return dir;
}

function put(root: string, rel: string, content: string): void {
  const dest = join(root, rel);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, content);
}

const sha = (content: string) => createHash('sha256').update(content).digest('hex');

function run(script: string, root: string) {
  return spawnSync(process.execPath, [TSX, join(ROOT, script), `--root=${root}`], {
    encoding: 'utf8',
    timeout: 120_000,
  });
}

/** A minimal but internally consistent evidence tree for the inventory check. */
function sumsTree(): string {
  const root = temp();
  const files: Record<string, string> = {
    [`${P17}/phase17-analysis.json`]: '{}\n',
    [`${P17}/out/spark/spark-shard-0.json`]: JSON.stringify({
      results: [
        { id: 'sim-01', status: 'succeeded' },
        { id: 'sim-02', status: 'failed' },
      ],
    }),
    [`${P17}/out/spark/sim-01.html`]: '<html><body>ok</body></html>',
    [`${P17}/out/spark/prompts/sim-01.txt`]: 'prompt one',
    [`${P17}/out/spark/prompts/sim-02.txt`]: 'prompt two',
    [`${P17}/out/spark/jobs/sim-01.json`]: '{"status":"succeeded"}',
    [`${P17}/out/spark/jobs/sim-02.json`]: '{"status":"failed"}',
    [`${P17}/out/open/open-shard-0.json`]: JSON.stringify({
      results: [{ id: 'open-01', status: 'succeeded' }],
    }),
    [`${P17}/out/open/open-01.html`]: '<html>open</html>',
    [`${P17}/out/open/prompts/open-01.txt`]: 'open prompt',
  };
  for (const [rel, content] of Object.entries(files)) put(root, rel, content);
  const manifest = Object.keys(files)
    .sort()
    .map((rel) => `${sha(files[rel])}  ${rel.slice(P17.length + 1)}`)
    .join('\n');
  put(root, `${P17}/SHA256SUMS`, `${manifest}\n`);
  return root;
}

const LOCKED = [
  'PROTOCOL.md',
  'design.json',
  'detectors.py',
  'test_detectors.py',
  'stats17.py',
  'analyze_phase17.py',
  'power.py',
  'power.txt',
  'harness.mjs',
  'run_spark.mjs',
  'run_open.mjs',
  'gen_orchard.mjs',
  'baselines/orchard-catch.html',
  'protocol.sha256',
  'LOCK.md',
  'phase17-analysis.json',
  'CORRECTIONS.sha256',
  'exact_stats.py',
  'phase17-analysis-corrected.json',
  'STATS_CORRECTION.md',
].map((rel) => `${P17}/${rel}`);

const EXTERNAL = [
  'docs/hackathon-evidence/phase16/detector.py',
  'demo/forge-baseline/index.html',
  'docs/demo/evidence/artifacts/v3-staged.html',
  'scripts/verify-phase17.ts',
];

/** A complete copy of the locked identity and lock metadata, for the strict check. */
function strictTree(): string {
  const root = temp();
  for (const rel of [...LOCKED, ...EXTERNAL]) {
    const dest = join(root, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(ROOT, rel), dest);
  }
  return root;
}

describe('Phase 17 inventory check (verify-phase17-sums.ts)', () => {
  it('accepts a consistent inventory and ignores .DS_Store', () => {
    const root = sumsTree();
    expect(run('scripts/verify-phase17-sums.ts', root).status).toBe(0);
    put(root, `${P17}/out/spark/.DS_Store`, 'not evidence');
    const after = run('scripts/verify-phase17-sums.ts', root);
    expect(after.status).toBe(0);
    expect(after.stdout).toContain('os metadata ignored: 1');
  });

  it('fails when required evidence is missing', () => {
    const root = sumsTree();
    rmSync(join(root, P17, 'out/spark/sim-01.html'));
    const result = run('scripts/verify-phase17-sums.ts', root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/missing|mismatch/i);
  });

  it('fails when evidence changes', () => {
    const root = sumsTree();
    put(root, `${P17}/out/spark/sim-01.html`, '<html>tampered</html>');
    const result = run('scripts/verify-phase17-sums.ts', root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/mismatch/i);
  });

  it('fails on an unlisted substantive artefact', () => {
    const root = sumsTree();
    put(root, `${P17}/out/spark/extra.html`, '<html>extra</html>');
    const result = run('scripts/verify-phase17-sums.ts', root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/SHA256SUMS is missing/);
  });

  it('fails on a file outside the documented evidence shapes', () => {
    const root = sumsTree();
    put(root, `${P17}/out/spark/notes.md`, 'not evidence');
    const result = run('scripts/verify-phase17-sums.ts', root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/unexpected artefact/i);
  });
});

describe('Phase 17 strict lock and statistics (verify-phase17-strict.ts)', () => {
  it('fails when the protocol manifest is missing', () => {
    const root = strictTree();
    rmSync(join(root, P17, 'protocol.sha256'));
    const result = run('scripts/verify-phase17-strict.ts', root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/protocol\.sha256 is missing/);
  });

  it('fails when the lock metadata is missing', () => {
    const root = strictTree();
    rmSync(join(root, P17, 'LOCK.md'));
    const result = run('scripts/verify-phase17-strict.ts', root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/LOCK\.md is missing/);
  });

  it('fails when a locked file is modified', () => {
    const root = strictTree();
    const path = join(root, P17, 'PROTOCOL.md');
    writeFileSync(path, `${readFileSync(path, 'utf8')}\ntampered\n`);
    const result = run('scripts/verify-phase17-strict.ts', root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/does not match the manifest/);
  });

  it('fails when a manifest entry is removed', () => {
    const root = strictTree();
    const path = join(root, P17, 'protocol.sha256');
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    writeFileSync(path, `${lines.slice(0, -1).join('\n')}\n`);
    const result = run('scripts/verify-phase17-strict.ts', root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/does not match the locked pre-registration identity/);
  });

  it('fails when a statistical value is tampered with', () => {
    const root = strictTree();
    const path = join(root, P17, 'phase17-analysis.json');
    const analysis = JSON.parse(readFileSync(path, 'utf8'));
    analysis.models.spark.primary.H1_memory_vs_none.p = 0;
    writeFileSync(path, JSON.stringify(analysis));
    const result = run('scripts/verify-phase17-strict.ts', root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/differs from the preserved as-run analysis|p differs/);
  });
});

describe('relative-only statistical comparison', () => {
  it('never accepts zero for a tiny probability', () => {
    expect(closeRelative(0, 2.0233041917047282e-16)).toBe(false);
    expect(closeRelative(1e-30, 2.0233041917047282e-16)).toBe(false);
  });

  it('accepts the pinned value and rejects a changed one', () => {
    expect(closeRelative(2.0233041917047282e-16, 2.0233041917047282e-16)).toBe(true);
    expect(closeRelative(2.03e-16, 2.0233041917047282e-16)).toBe(false);
  });
});
