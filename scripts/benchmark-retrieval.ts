/**
 * Retrieval benchmark.
 *
 * Builds a deterministic synthetic corpus, runs labelled queries against the
 * real retrieval path, and reports measured numbers — no simulated values.
 *
 * What it measures:
 *   - retrieval latency (mean / p50 / p95 over repeated runs)
 *   - candidate, selected and excluded counts
 *   - characters injected per query
 *   - retrieval accuracy: does the memory that answers the query appear?
 *   - correction accuracy: after a correction, is the new fact retrieved and
 *     the superseded one absent?
 *   - stale-memory retrieval rate: fraction of returned memories that are not
 *     active (must be 0)
 *
 * Usage:
 *   pnpm bench:retrieval [--queries 30] [--repeats 10] [--out docs/benchmarks]
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryEngine, openDatabase } from '../packages/memory-engine/src/index.js';
import type { MemoryType } from '../packages/shared/src/index.js';

const PROJECTS = ['alpha-game', 'beta-tool', 'gamma-site'] as const;
const MEMORIES_PER_PROJECT = 40;
const GLOBAL_MEMORIES = 10;

const TYPES: MemoryType[] = [
  'technical_decision',
  'constraint',
  'verified_solution',
  'failed_approach',
  'unfinished_task',
  'contextual_fact',
  'goal',
  'preference',
];

/** Deterministic PRNG so the corpus and query set are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function arg(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const parsed = Number(process.argv[index + 1]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function argString(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

interface LabelledQuery {
  projectId: string;
  query: string;
  expectedId: string;
}

interface Accuracy {
  total: number;
  hits: number;
}

const random = mulberry32(20_261_027);
const outDir = argString('out', 'docs/benchmarks');
const queryCount = arg('queries', 30);
const repeats = arg('repeats', 10);

console.log('Muse Memory Lab — retrieval benchmark');
console.log('=====================================');

const directory = await mkdtemp(join(tmpdir(), 'mml-bench-'));
const databasePath = join(directory, 'benchmark.db');
const opened = openDatabase({ path: databasePath });
const engine = new MemoryEngine(opened.db);

try {
  // ---- Seed -------------------------------------------------------------
  const seedStartedAt = performance.now();
  const created: { id: string; projectId: string; content: string; type: MemoryType }[] = [];

  for (const [projectIdIndex, projectId] of PROJECTS.entries()) {
    for (let index = 0; index < MEMORIES_PER_PROJECT; index += 1) {
      const type = TYPES[Math.floor(random() * TYPES.length)] ?? 'contextual_fact';
      // A single alphanumeric token: FTS5 splits on '-', so a hyphenated
      // token would shatter into common words and match the whole corpus.
      const token = `sigil${projectIdIndex}${index}`;
      const content = `${projectId} ${type.replace(/_/g, ' ')} ${index}: ${token} concerns storage and rendering.`;
      const result = engine.create({
        type,
        scope: 'project',
        project_id: projectId,
        content,
        confidence: 0.5 + random() * 0.5,
        validation_status: random() > 0.3 ? 'verified' : 'unverified',
        tags: [projectId],
      });
      created.push({ id: result.memory.id, projectId, content, type });
    }
  }

  for (let index = 0; index < GLOBAL_MEMORIES; index += 1) {
    const type = index % 2 === 0 ? 'preference' : 'constraint';
    const content = `Global ${type.replace(/_/g, ' ')}: prefer-global-${index} for all projects.`;
    engine.create({
      type,
      scope: 'global',
      project_id: null,
      content,
      confidence: 0.9,
    });
  }

  const seedMs = performance.now() - seedStartedAt;
  const totalMemories = created.length + GLOBAL_MEMORIES;

  // ---- Labelled queries -------------------------------------------------
  const queries: LabelledQuery[] = [];
  for (let index = 0; index < queryCount; index += 1) {
    const pick = created[Math.floor(random() * created.length)];
    if (!pick) continue;
    const token = pick.content.match(/sigil\d+/)?.[0] ?? '';
    queries.push({ projectId: pick.projectId, query: token, expectedId: pick.id });
  }

  // ---- Latency and selectivity -----------------------------------------
  const latencies: number[] = [];
  const candidateCounts: number[] = [];
  const selectedCounts: number[] = [];
  const characterCounts: number[] = [];
  const accuracy: Accuracy = { total: queries.length, hits: 0 };
  let staleResults = 0;
  let totalResults = 0;

  const startedAt = performance.now();
  for (const item of queries) {
    for (let repeat = 0; repeat < repeats; repeat += 1) {
      const result = engine.retrieve({ project_id: item.projectId, query: item.query });
      latencies.push(result.metadata.latency_ms);
      candidateCounts.push(result.metadata.candidate_count);
      selectedCounts.push(result.metadata.selected_count);
      characterCounts.push(result.metadata.characters_used);

      if (repeat === 0) {
        const ids = result.results.map((entry) => entry.memory.id);
        if (ids.includes(item.expectedId)) accuracy.hits += 1;
      }

      for (const entry of result.results) {
        totalResults += 1;
        if (entry.memory.status !== 'active') staleResults += 1;
      }
    }
  }
  const elapsedMs = performance.now() - startedAt;

  // ---- Correction accuracy ---------------------------------------------
  const correctionSample = created
    .filter((memory) => memory.type !== 'constraint' && memory.type !== 'goal')
    .slice(0, 12);

  let correctionHits = 0;
  let staleAfterCorrection = 0;
  let correctionResults = 0;

  for (const [index, memory] of correctionSample.entries()) {
    const revisedToken = `revisedsigil${index}`;
    engine.correct({
      supersedes: [memory.id],
      type: memory.type,
      project_id: memory.projectId,
      content: `${memory.projectId} corrected decision: ${revisedToken} supersedes the earlier storage choice.`,
      confidence: 0.95,
      validation_status: 'verified',
    });

    const result = engine.retrieve({ project_id: memory.projectId, query: revisedToken });
    const ids = result.results.map((entry) => entry.memory.id);

    const supersededPresent = ids.includes(memory.id);
    const replacementPresent = result.results.some((entry) =>
      entry.memory.content.includes(revisedToken),
    );
    if (supersededPresent) staleAfterCorrection += 1;
    correctionResults += result.results.length;

    // A correct correction: the new fact is retrievable and the superseded
    // record is not.
    if (replacementPresent && !supersededPresent) correctionHits += 1;
  }

  // ---- Deletion consistency -------------------------------------------
  const deletionSample = created.slice(60, 70);
  for (const memory of deletionSample) {
    engine.softDelete(memory.id, { reason: 'benchmark deletion' });
  }

  let deletedStillRetrievable = 0;
  for (const memory of deletionSample) {
    const token = memory.content.match(/sigil\d+/)?.[0] ?? '';
    const result = engine.retrieve({ project_id: memory.projectId, query: token });
    if (result.results.some((entry) => entry.memory.id === memory.id)) {
      deletedStillRetrievable += 1;
    }
  }

  // ---- Report -----------------------------------------------------------
  const sorted = [...latencies].sort((a, b) => a - b);
  const percentile = (p: number): number =>
    sorted.length === 0
      ? 0
      : (sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0);
  const mean = (values: number[]): number =>
    values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

  const summary = {
    generated_at: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      sqlite: (
        opened.db.prepare('SELECT sqlite_version() AS version').get() as unknown as {
          version: string;
        }
      ).version,
      fts: 'FTS5',
    },
    corpus: {
      memories: totalMemories,
      projects: PROJECTS.length,
      global_memories: GLOBAL_MEMORIES,
      seed_ms: Math.round(seedMs),
    },
    retrieval: {
      queries: queries.length,
      repeats_per_query: repeats,
      total_retrievals: latencies.length,
      elapsed_ms: Math.round(elapsedMs),
      latency_ms: {
        mean: Number(mean(latencies).toFixed(4)),
        p50: Number(percentile(0.5).toFixed(4)),
        p95: Number(percentile(0.95).toFixed(4)),
      },
      candidates: { mean: Number(mean(candidateCounts).toFixed(2)) },
      selected: { mean: Number(mean(selectedCounts).toFixed(2)) },
      characters: { mean: Number(mean(characterCounts).toFixed(1)) },
      accuracy: {
        queries: accuracy.total,
        hits: accuracy.hits,
        rate: accuracy.total === 0 ? 0 : Number((accuracy.hits / accuracy.total).toFixed(4)),
      },
      stale_memory_rate: totalResults === 0 ? 0 : Number((staleResults / totalResults).toFixed(6)),
    },
    correction: {
      corrections: correctionSample.length,
      accurate: correctionHits,
      accuracy_rate:
        correctionSample.length === 0
          ? 0
          : Number((correctionHits / correctionSample.length).toFixed(4)),
      stale_after_correction: staleAfterCorrection,
      result_count: correctionResults,
    },
    deletion: {
      deleted: deletionSample.length,
      still_retrievable: deletedStillRetrievable,
    },
    final_stats: engine.stats(),
  };

  console.log(JSON.stringify(summary, null, 2));

  await mkdir(outDir, { recursive: true });
  const jsonPath = join(outDir, 'retrieval-latest.json');
  await writeFile(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  const markdown = `# Retrieval benchmark — latest run

Generated ${summary.generated_at} on Node ${summary.environment.node} ·
SQLite ${summary.environment.sqlite} (${summary.environment.fts}).

Corpus: **${totalMemories} memories** across ${PROJECTS.length} projects plus ${GLOBAL_MEMORIES}
global memories, seeded in ${summary.corpus.seed_ms} ms.

| Metric | Value |
| --- | --- |
| Retrievals measured | ${summary.retrieval.total_retrievals} (${queries.length} queries × ${repeats}) |
| Latency mean | ${summary.retrieval.latency_ms.mean} ms |
| Latency p50 | ${summary.retrieval.latency_ms.p50} ms |
| Latency p95 | ${summary.retrieval.latency_ms.p95} ms |
| Mean candidates | ${summary.retrieval.candidates.mean} |
| Mean selected | ${summary.retrieval.selected.mean} |
| Mean characters injected | ${summary.retrieval.characters.mean} |
| Retrieval accuracy (hit@8) | ${(summary.retrieval.accuracy.rate * 100).toFixed(1)}% (${summary.retrieval.accuracy.hits}/${summary.retrieval.accuracy.queries}) |
| Correction accuracy | ${(summary.correction.accuracy_rate * 100).toFixed(1)}% (${summary.correction.accurate}/${summary.correction.corrections}) |
| Stale-memory retrieval rate | ${(summary.retrieval.stale_memory_rate * 100).toFixed(3)}% |
| Superseded returned after correction | ${summary.correction.stale_after_correction} |
| Deleted still retrievable | ${summary.deletion.still_retrievable} |

## What this does and does not show

- It measures the **retrieval path**, not model quality: no Muse call is made.
- Accuracy is defined as "the memory containing the query's unique token appears in
  the top-8 result for that token". It is a retrieval-recall measurement, not an
  answer-quality measurement.
- Stale-memory rate counts returned memories whose lifecycle status is not ACTIVE.
  The expected value is exactly 0.
`;

  await writeFile(join(outDir, 'retrieval-latest.md'), markdown, 'utf8');
  console.log(`\nwrote ${jsonPath} and ${join(outDir, 'retrieval-latest.md')}`);
} finally {
  opened.close();
  await rm(directory, { recursive: true, force: true });
}
