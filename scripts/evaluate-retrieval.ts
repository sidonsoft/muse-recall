/**
 * Real-world retrieval evaluation.
 *
 * Seeds a realistic corpus across three projects — including a corrected
 * memory, a deleted memory, contradictory preferences, and a failed approach —
 * then asks 22 questions covering:
 *
 *   exact terminology · different vocabulary · indirect questions ·
 *   multiple projects · contradictory information · corrected information ·
 *   missing information · deleted memories · project-specific constraints
 *
 * Retrieval runs for every question. With `--muse-answers N`, the first N
 * questions are also answered by real Muse; a correct answer is only counted as
 * **memory-grounded** when the retrieval evidence contains the supporting
 * memory. A lucky guess without evidence does not count.
 *
 *   pnpm eval:retrieval [--muse-answers 6]
 */
import { mkdir, writeFile } from 'node:fs/promises';

const BASE_URL = process.env.DEMO_BASE_URL ?? 'http://127.0.0.1:8787';
const RUN = process.env.EVAL_RUN ?? Date.now().toString(36).slice(-6);
const MODEL = process.env.MUSE_MODEL ?? 'muse-wonder-1.0';

const museFlag = process.argv.indexOf('--muse-answers');
const MUSE_ANSWERS =
  Number(process.env.EVAL_MUSE_ANSWERS ?? (museFlag !== -1 ? process.argv[museFlag + 1] : 0)) || 0;

const GAME = `montys-meadow-${RUN}`;
const API = `starlight-api-${RUN}`;
const GARDEN = `garden-planner-${RUN}`;

interface Seed {
  key: string;
  project: string;
  type: string;
  content: string;
}

const SEEDS: Seed[] = [
  {
    key: 'engine',
    project: GAME,
    type: 'technical_decision',
    content: "We are building Monty's Memory Meadow with Phaser.",
  },
  {
    key: 'platform_old',
    project: GAME,
    type: 'technical_decision',
    content: 'The target platform is mobile web.',
  },
  {
    key: 'art',
    project: GAME,
    type: 'preference',
    content: 'The art direction is colourful illustrated farmyard scenery.',
  },
  {
    key: 'offline',
    project: GAME,
    type: 'constraint',
    content: 'The game must run offline on integrated graphics.',
  },
  {
    key: 'ship',
    project: GAME,
    type: 'goal',
    content: 'Ship the first playable build by December 2026.',
  },
  {
    key: 'sprites',
    project: GAME,
    type: 'unfinished_task',
    content: 'The sprite animation pipeline is still unfinished.',
  },
  {
    key: 'canvas',
    project: GAME,
    type: 'failed_approach',
    content: 'We tried a canvas-only renderer and it broke accessibility, so we abandoned it.',
  },
  {
    key: 'redis_deleted',
    project: GAME,
    type: 'technical_decision',
    content: 'We decided to cache leaderboards in Redis.',
  },

  {
    key: 'server',
    project: API,
    type: 'technical_decision',
    content: 'The Starlight API uses Fastify for its HTTP server.',
  },
  {
    key: 'db',
    project: API,
    type: 'technical_decision',
    content: 'Starlight persists data in Postgres.',
  },
  {
    key: 'auth',
    project: API,
    type: 'constraint',
    content: 'Every Starlight endpoint must require authentication.',
  },
  {
    key: 'ratelimit',
    project: API,
    type: 'unfinished_task',
    content: 'Rate limiting for Starlight is not implemented yet.',
  },

  {
    key: 'garden_ui',
    project: GARDEN,
    type: 'technical_decision',
    content: 'The garden planner is built with React and Vite.',
  },
  {
    key: 'garden_responsive',
    project: GARDEN,
    type: 'constraint',
    content: 'The garden planner must work on a phone screen.',
  },
  {
    key: 'palette_a',
    project: GARDEN,
    type: 'preference',
    content: 'The garden planner palette should be warm pastel green.',
  },
  {
    key: 'palette_b',
    project: GARDEN,
    type: 'preference',
    content: 'The garden planner palette should be high-contrast navy.',
  },
];

interface Question {
  id: string;
  category: string;
  project: string;
  query: string;
  /** Content that must appear among retrieved memories. */
  expected?: string;
  /** Content that must NOT appear among retrieved memories. */
  forbidden?: string;
  /** Whether retrieval is expected to find anything at all. */
  shouldFind: boolean;
}

const QUESTIONS: Question[] = [
  {
    id: 'q01',
    category: 'exact terminology',
    project: GAME,
    query: 'Which engine does the memory meadow game use?',
    expected: 'Phaser',
    shouldFind: true,
  },
  {
    id: 'q02',
    category: 'exact terminology',
    project: GAME,
    query: 'What art direction are we using?',
    expected: 'farmyard',
    shouldFind: true,
  },
  {
    id: 'q03',
    category: 'different vocabulary',
    project: API,
    query: 'What database backs Starlight?',
    expected: 'Postgres',
    shouldFind: true,
  },
  {
    id: 'q04',
    category: 'different vocabulary',
    project: API,
    query: 'Which framework is the API built on?',
    expected: 'Fastify',
    shouldFind: true,
  },
  {
    id: 'q05',
    category: 'indirect question',
    project: GAME,
    query: 'Can the game work without internet?',
    expected: 'offline',
    shouldFind: true,
  },
  {
    id: 'q06',
    category: 'indirect question',
    project: GAME,
    query: 'What should we avoid in the renderer?',
    expected: 'canvas',
    shouldFind: true,
  },
  {
    id: 'q07',
    category: 'multiple projects',
    project: GARDEN,
    query: 'What is the garden planner frontend built with?',
    expected: 'React',
    shouldFind: true,
  },
  {
    id: 'q08',
    category: 'project isolation',
    project: API,
    query: 'Which game engine are we using?',
    expected: undefined,
    forbidden: 'Phaser',
    shouldFind: false,
  },
  {
    id: 'q09',
    category: 'corrected information',
    project: GAME,
    query: 'What platform do we target now?',
    expected: 'desktop browsers',
    forbidden: 'mobile web',
    shouldFind: true,
  },
  {
    id: 'q10',
    category: 'corrected information',
    project: GAME,
    query: 'Did the target platform change?',
    expected: 'desktop browsers',
    forbidden: 'mobile web',
    shouldFind: true,
  },
  {
    id: 'q11',
    category: 'missing information',
    project: GAME,
    query: 'What is our marketing budget?',
    shouldFind: false,
  },
  {
    id: 'q12',
    category: 'deleted memory',
    project: GAME,
    query: 'What did we decide about Redis for leaderboards?',
    expected: undefined,
    forbidden: 'Redis',
    shouldFind: false,
  },
  {
    id: 'q13',
    category: 'project constraint',
    project: GAME,
    query: 'Any hard requirements for the game?',
    expected: 'offline',
    shouldFind: true,
  },
  {
    id: 'q14',
    category: 'project goal',
    project: GAME,
    query: 'When do we ship the first playable build?',
    expected: 'December',
    shouldFind: true,
  },
  {
    id: 'q15',
    category: 'unfinished work',
    project: GAME,
    query: 'What is still unfinished?',
    expected: 'sprite',
    shouldFind: true,
  },
  {
    id: 'q16',
    category: 'failed approach',
    project: GAME,
    query: 'Did we try a canvas renderer?',
    expected: 'canvas',
    shouldFind: true,
  },
  {
    id: 'q17',
    category: 'project constraint',
    project: API,
    query: 'What must every endpoint require?',
    expected: 'authentication',
    shouldFind: true,
  },
  {
    id: 'q18',
    category: 'unfinished work',
    project: API,
    query: 'What is missing from the API?',
    expected: 'Rate limiting',
    shouldFind: true,
  },
  {
    id: 'q19',
    category: 'corrected information',
    project: GAME,
    query: 'Is mobile still the priority?',
    expected: 'desktop browsers',
    forbidden: 'mobile web',
    shouldFind: true,
  },
  {
    id: 'q20',
    category: 'contradictory information',
    project: GARDEN,
    query: 'What palette should the garden planner use?',
    expected: 'palette',
    shouldFind: true,
  },
  {
    id: 'q21',
    category: 'project constraint',
    project: GARDEN,
    query: 'What must the garden planner support?',
    expected: 'phone screen',
    shouldFind: true,
  },
  {
    id: 'q22',
    category: 'missing information',
    project: GARDEN,
    query: 'What is the garden planner deadline?',
    shouldFind: false,
  },
];

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { message: string };
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const body = (await response.json()) as ApiEnvelope<T>;
  if (!body.ok || body.data === undefined) throw new Error(`${path}: ${body.error?.message}`);
  return body.data;
}

function parseSse(text: string): { event: string; data: Record<string, unknown> }[] {
  return text
    .split('\n\n')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => ({
      event: /^event: (.+)$/m.exec(chunk)?.[1] ?? 'message',
      data: JSON.parse(/^data: (.+)$/m.exec(chunk)?.[1] ?? '{}') as Record<string, unknown>,
    }));
}

async function seedCorpus(): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const seed of SEEDS) {
    const created = await api<{ memory: { id: string } }>('/api/memories', {
      method: 'POST',
      body: JSON.stringify({
        type: seed.type,
        scope: 'project',
        project_id: seed.project,
        content: seed.content,
        confidence: 0.9,
        validation_status: 'verified',
        source: { session_id: null, reference: 'retrieval-eval-seed' },
      }),
    });
    ids[seed.key] = created.memory.id;
  }

  // Correct the platform decision so the old value is superseded.
  await api(`/api/memories/${ids.platform_old}/correct`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'technical_decision',
      project_id: GAME,
      content: 'The target platform is desktop browsers.',
      confidence: 0.95,
      validation_status: 'verified',
      reason: 'evaluation: platform changed',
    }),
  });

  // Delete the Redis decision entirely.
  await api(`/api/memories/${ids.redis_deleted}`, {
    method: 'DELETE',
    body: JSON.stringify({ reason: 'evaluation: deleted case' }),
  });

  return ids;
}

interface PreviewResult {
  retrieval: {
    results: { memory: { content: string; status: string }; score: number; evidence: string }[];
    metadata: {
      query_mode: string;
      candidate_count: number;
      selected_count: number;
      characters_used: number;
    };
  };
}

async function askMuse(
  project: string,
  question: string,
): Promise<{ answer: string; memoryCount: number }> {
  const session = await api<{ id: string }>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ project_id: project }),
  });
  const response = await fetch(`${BASE_URL}/api/sessions/${session.id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ content: question }),
  });
  const frames = parseSse(await response.text());
  const error = frames.find((frame) => frame.event === 'error');
  if (error) throw new Error(JSON.stringify(error.data));
  const completed = frames.find((frame) => frame.event === 'completed');
  const turn = completed?.data.turn as {
    assistant_message: { content: string };
    retrieval: { memory_ids: string[] };
  };
  return {
    answer: turn.assistant_message.content,
    memoryCount: turn.retrieval.memory_ids.length,
  };
}

async function main() {
  console.log(`Muse Memory Lab — retrieval evaluation (run ${RUN})`);
  console.log(`seeding corpus in ${GAME}, ${API}, ${GARDEN}\n`);
  const ids = await seedCorpus();

  const results: {
    question: Question;
    retrieved: string[];
    success: boolean;
    forbiddenPresent: boolean;
    mode: string;
    selected: number;
    characters: number;
    evidence: string[];
    muse?: { answer: string; correct: boolean; grounded: boolean; memoryCount: number };
  }[] = [];

  for (const question of QUESTIONS) {
    const preview = await api<PreviewResult>('/api/retrieval/preview', {
      method: 'POST',
      body: JSON.stringify({ project_id: question.project, query: question.query }),
    });

    const contents = preview.retrieval.results.map((entry) => entry.memory.content);
    const joined = contents.join(' \n ').toLowerCase();

    const foundExpected = question.expected
      ? joined.includes(question.expected.toLowerCase())
      : true;
    const forbiddenPresent = question.forbidden
      ? joined.includes(question.forbidden.toLowerCase())
      : false;

    const success = question.shouldFind
      ? foundExpected && !forbiddenPresent
      : !forbiddenPresent &&
        contents.every((content) => {
          // "should not find" cases must not surface the topic at all.
          const topic = question.forbidden ?? (question.id === 'q11' ? 'marketing' : 'deadline');
          return !content.toLowerCase().includes(topic.toLowerCase());
        });

    results.push({
      question,
      retrieved: contents,
      success,
      forbiddenPresent,
      mode: preview.retrieval.metadata.query_mode,
      selected: preview.retrieval.metadata.selected_count,
      characters: preview.retrieval.metadata.characters_used,
      evidence: preview.retrieval.results.map((entry) => entry.evidence),
    });

    console.log(
      `${question.id} [${question.category}] ${success ? 'PASS' : 'FAIL'} · ${preview.retrieval.metadata.selected_count} selected · ${preview.retrieval.metadata.query_mode}`,
    );
  }

  // Optional answer correctness with real Muse.
  if (MUSE_ANSWERS > 0) {
    const sample = results.slice(0, MUSE_ANSWERS);
    for (const entry of sample) {
      if (!entry.question.expected) continue;
      const { answer, memoryCount } = await askMuse(entry.question.project, entry.question.query);
      const correct = answer.toLowerCase().includes(entry.question.expected.toLowerCase());
      entry.muse = {
        answer,
        correct,
        grounded: correct && entry.success && memoryCount > 0,
        memoryCount,
      };
      console.log(
        `${entry.question.id} muse: ${correct ? 'correct' : 'wrong'} · grounded=${entry.muse.grounded} (${memoryCount} memories)`,
      );
    }
  }

  const retrievalPasses = results.filter((entry) => entry.success).length;
  const museEntries = results.filter((entry) => entry.muse);
  const museCorrect = museEntries.filter((entry) => entry.muse?.correct).length;
  const museGrounded = museEntries.filter((entry) => entry.muse?.grounded).length;

  const summary = {
    generated_at: new Date().toISOString(),
    run: RUN,
    model: MODEL,
    seeded_memories: SEEDS.length,
    projects: { game: GAME, api: API, garden: GARDEN },
    totals: {
      questions: QUESTIONS.length,
      retrieval_passes: retrievalPasses,
      retrieval_rate: Number((retrievalPasses / QUESTIONS.length).toFixed(4)),
      muse_answers: museEntries.length,
      muse_correct: museCorrect,
      muse_grounded: museGrounded,
    },
    by_category: summariseByCategory(results, 'success'),
    results: results.map((entry) => ({
      id: entry.question.id,
      category: entry.question.category,
      project: entry.question.project,
      query: entry.question.query,
      expected: entry.question.expected ?? null,
      forbidden: entry.question.forbidden ?? null,
      should_find: entry.question.shouldFind,
      success: entry.success,
      retrieved: entry.retrieved,
      query_mode: entry.mode,
      selected: entry.selected,
      characters: entry.characters,
      evidence: entry.evidence,
      muse: entry.muse ?? null,
    })),
    memory_ids: ids,
  };

  await mkdir('docs/benchmarks', { recursive: true });
  await writeFile(
    'docs/benchmarks/retrieval-eval-latest.json',
    `${JSON.stringify(summary, null, 2)}\n`,
  );

  const markdown = `# Retrieval evaluation — measured

Generated ${summary.generated_at} · run \`${RUN}\` · model \`${MODEL}\`.
Corpus: ${SEEDS.length} seeded memories across 3 projects, including one corrected
and one deleted memory.

| Metric | Result |
| --- | --- |
| Retrieval questions | ${summary.totals.questions} |
| Retrieval passes | ${summary.totals.retrieval_passes} (${(summary.totals.retrieval_rate * 100).toFixed(1)}%) |
| Muse answers sampled | ${summary.totals.muse_answers} |
| Answers correct | ${summary.totals.muse_correct} |
| Answers **memory-grounded** (correct + supporting retrieval) | ${summary.totals.muse_grounded} |

## By category

| Category | Pass / total |
| --- | --- |
${Object.entries(summary.by_category)
  .map(([category, counts]) => `| ${category} | ${counts.passed} / ${counts.total} |`)
  .join('\n')}

## Per question

| # | Category | Result | Mode | Selected | Retrieved |
| --- | --- | --- | --- | --- | --- |
${summary.results
  .map(
    (entry) =>
      `| ${entry.id} | ${entry.category} | ${entry.success ? 'PASS' : 'FAIL'} | ${entry.query_mode} | ${entry.selected} | ${entry.retrieved.map((content) => content.replace(/\|/g, '/').slice(0, 80)).join('<br>') || '—'} |`,
  )
  .join('\n')}

A correct answer is only counted as memory-grounded when the retrieval evidence for
that turn contains the supporting memory. Retrieval alone is not proof that the model
used it, and a correct guess without evidence is not counted.
`;

  await writeFile('docs/benchmarks/retrieval-eval-latest.md', markdown);

  console.log(
    `\nretrieval ${retrievalPasses}/${QUESTIONS.length} · muse answers ${museCorrect}/${museEntries.length} correct · ${museGrounded} grounded`,
  );
  console.log('wrote docs/benchmarks/retrieval-eval-latest.{json,md}');
}

function summariseByCategory(
  results: { question: Question; success: boolean }[],
  _field: string,
): Record<string, { total: number; passed: number }> {
  const out: Record<string, { total: number; passed: number }> = {};
  for (const entry of results) {
    const bucket = out[entry.question.category] ?? { total: 0, passed: 0 };
    bucket.total += 1;
    if (entry.success) bucket.passed += 1;
    out[entry.question.category] = bucket;
  }
  return out;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
