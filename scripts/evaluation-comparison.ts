/**
 * Phase 6 evaluation: persistent memory vs facts supplied inline.
 *
 * Both configurations answer with a single Muse call, so the comparison isolates
 * one variable: the facts arrive either inside the user's message or as a
 * validated retrieved-memory block. Same model, same questions, same machine.
 *
 * Additional checks: correction/stale avoidance and project isolation.
 *
 *   DATABASE_PATH=./data/eval.db pnpm dev:server
 *   pnpm eval:comparison
 */
import { mkdir, writeFile } from 'node:fs/promises';

const BASE_URL = process.env.DEMO_BASE_URL ?? 'http://127.0.0.1:8787';
const MODEL = process.env.MUSE_MODEL ?? 'muse-wonder-1.0';
const RUN = Date.now().toString(36).slice(-6);
const TRIALS = Number(process.env.EVAL_TRIALS ?? 2) || 2;

interface Facts {
  id: string;
  project: string;
  facts: string[];
  question: string;
  expected: string[];
}

const TASKS: Facts[] = [
  {
    id: 'game',
    project: `eval-game-${RUN}`,
    facts: [
      "We are building Monty's Memory Meadow with Phaser.",
      'The target platform is mobile web.',
      'The art direction is colourful illustrated farmyard scenery.',
    ],
    question:
      'What game are we building, which engine are we using, and what is the target platform?',
    expected: ['phaser', 'mobile web'],
  },
  {
    id: 'api',
    project: `eval-api-${RUN}`,
    facts: [
      'The Starlight API uses Fastify for its HTTP server.',
      'Starlight persists data in Postgres.',
      'Every Starlight endpoint must require authentication.',
    ],
    question: 'What does Starlight use for its HTTP server and for storage?',
    expected: ['fastify', 'postgres'],
  },
];

interface Turn {
  assistant_message: { content: string; latency_ms: number | null };
  context: { prompt_characters: number; memory_characters: number; history_messages: number };
  usage: { input_tokens: number; output_tokens: number };
  retrieval: { memory_ids: string[]; selected_count: number };
}

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

async function session(projectId: string | null): Promise<string> {
  const created = await api<{ id: string }>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ project_id: projectId }),
  });
  return created.id;
}

async function turn(sessionId: string, content: string): Promise<Turn> {
  return api<Turn>(`/api/sessions/${sessionId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content, capture_memories: false }),
  });
}

function correct(answer: string, expected: string[]): boolean {
  const lower = answer.toLowerCase();
  return expected.every((term) => lower.includes(term.toLowerCase()));
}

async function seed(task: Facts): Promise<void> {
  for (const fact of task.facts) {
    await api('/api/memories', {
      method: 'POST',
      body: JSON.stringify({
        type: fact.toLowerCase().includes('platform') ? 'technical_decision' : 'contextual_fact',
        scope: 'project',
        project_id: task.project,
        content: fact,
        confidence: 0.9,
        validation_status: 'verified',
        source: { session_id: null, reference: 'evaluation-seed' },
      }),
    });
  }
}

const mean = (values: number[]): number =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
const round = (n: number): number => Number(n.toFixed(2));

async function main() {
  const gameTask = TASKS[0];
  const isolationSource = gameTask?.project ?? '';
  for (const task of TASKS) await seed(task);

  // Concrete property types instead of Record<string, number[]>: the keys are
  // fixed by construction below, and indexing a Record under
  // noUncheckedIndexedAccess yields `number[] | undefined` for every access -
  // the type now says what the data actually is (type-level only, zero runtime
  // difference).
  type MetricSeries = {
    input_tokens: number[];
    prompt_chars: number[];
    app_chars: number[];
    latency: number[];
    correct: number[];
  };
  const baseline: MetricSeries = {
    input_tokens: [],
    prompt_chars: [],
    app_chars: [],
    latency: [],
    correct: [],
  };
  const experimental: MetricSeries & { retrieval: number[] } = {
    input_tokens: [],
    prompt_chars: [],
    app_chars: [],
    latency: [],
    correct: [],
    retrieval: [],
  };
  const perTask: {
    task: string;
    trial: number;
    baseline: { tokens: number; chars: number; correct: boolean };
    memory: { tokens: number; chars: number; correct: boolean; memories: number };
  }[] = [];

  for (const task of TASKS) {
    for (let trial = 1; trial <= TRIALS; trial += 1) {
      const inline = `Context for this project:\n${task.facts.map((fact) => `- ${fact}`).join('\n')}\n\n${task.question}`;
      const baseTurn = await turn(await session(null), inline);
      const bCorrect = correct(baseTurn.assistant_message.content, task.expected);
      baseline.input_tokens.push(baseTurn.usage.input_tokens);
      baseline.prompt_chars.push(baseTurn.context.prompt_characters);
      baseline.app_chars.push(inline.length);
      baseline.latency.push(baseTurn.assistant_message.latency_ms ?? 0);
      baseline.correct.push(bCorrect ? 1 : 0);

      const memTurn = await turn(await session(task.project), task.question);
      const mCorrect = correct(memTurn.assistant_message.content, task.expected);
      experimental.input_tokens.push(memTurn.usage.input_tokens);
      experimental.prompt_chars.push(memTurn.context.prompt_characters);
      experimental.app_chars.push(memTurn.context.memory_characters);
      experimental.latency.push(memTurn.assistant_message.latency_ms ?? 0);
      experimental.correct.push(mCorrect ? 1 : 0);
      experimental.retrieval.push(memTurn.retrieval.memory_ids.length);

      perTask.push({
        task: task.id,
        trial,
        baseline: { tokens: baseTurn.usage.input_tokens, chars: inline.length, correct: bCorrect },
        memory: {
          tokens: memTurn.usage.input_tokens,
          chars: memTurn.context.memory_characters,
          correct: mCorrect,
          memories: memTurn.retrieval.memory_ids.length,
        },
      });

      console.log(
        `${task.id} trial ${trial}: inline ${baseTurn.usage.input_tokens} tok (${bCorrect ? 'ok' : 'wrong'}) · memory ${memTurn.usage.input_tokens} tok (${mCorrect ? 'ok' : 'wrong'}, ${memTurn.retrieval.memory_ids.length} memories)`,
      );
    }
  }

  // --- Correction and stale-memory avoidance -------------------------------
  const correctionProject = `eval-correction-${RUN}`;
  const original = await api<{ memory: { id: string } }>('/api/memories', {
    method: 'POST',
    body: JSON.stringify({
      type: 'technical_decision',
      scope: 'project',
      project_id: correctionProject,
      content: 'The target platform is mobile web.',
      confidence: 0.9,
      validation_status: 'verified',
    }),
  });
  const corrected = await api<{ memory: { id: string } }>(
    `/api/memories/${original.memory.id}/correct`,
    {
      method: 'POST',
      body: JSON.stringify({
        type: 'technical_decision',
        project_id: correctionProject,
        content: 'The target platform is desktop browsers.',
        reason: 'evaluation correction',
      }),
    },
  );
  const correctionTurn = await turn(
    await session(correctionProject),
    'What platform are we targeting now?',
  );
  const preview = await api<{
    retrieval: { results: { memory: { id: string; content: string } }[] };
  }>('/api/retrieval/preview', {
    method: 'POST',
    body: JSON.stringify({
      project_id: correctionProject,
      query: 'target platform mobile web desktop browsers',
    }),
  });
  const activeIds = preview.retrieval.results.map((entry) => entry.memory.id);
  const correctionCheck = {
    answer: correctionTurn.assistant_message.content,
    answer_has_current: correctionTurn.assistant_message.content.toLowerCase().includes('desktop'),
    superseded_id: original.memory.id,
    current_id: corrected.memory.id,
    superseded_in_active_retrieval: activeIds.includes(original.memory.id),
    current_in_active_retrieval: activeIds.includes(corrected.memory.id),
  };
  console.log(
    `correction: has current=${correctionCheck.answer_has_current} · superseded in retrieval=${correctionCheck.superseded_in_active_retrieval}`,
  );

  // --- Project isolation ---------------------------------------------------
  const isolationProject = `eval-isolation-${RUN}`;
  await api('/api/memories', {
    method: 'POST',
    body: JSON.stringify({
      type: 'technical_decision',
      scope: 'project',
      project_id: isolationSource,
      content: 'Isolation canary: Phaser renderer decision.',
      confidence: 0.9,
      validation_status: 'verified',
    }),
  });
  const isolationPreview = await api<{
    retrieval: { results: { memory: { content: string; project_id: string | null } }[] };
  }>('/api/retrieval/preview', {
    method: 'POST',
    body: JSON.stringify({
      project_id: isolationProject,
      query: 'Phaser renderer decision isolation canary',
    }),
  });
  const leaked = isolationPreview.retrieval.results.filter(
    (entry) => entry.memory.project_id === isolationSource,
  ).length;
  const isolation = { leaked_from_other_project: leaked, checked_project: isolationProject };

  const result = {
    generated_at: new Date().toISOString(),
    run: RUN,
    model: MODEL,
    trials_per_configuration: TRIALS,
    sample_size_per_configuration: baseline.input_tokens.length,
    tasks: TASKS.map((task) => ({ id: task.id, question: task.question, expected: task.expected })),
    baseline: {
      description: 'Facts supplied inline in a single user message; no persistent memory.',
      input_tokens: { mean: round(mean(baseline.input_tokens)), samples: baseline.input_tokens },
      prompt_characters: {
        mean: round(mean(baseline.prompt_chars)),
        samples: baseline.prompt_chars,
      },
      app_added_characters: { mean: round(mean(baseline.app_chars)) },
      latency_ms: { mean: round(mean(baseline.latency)), samples: baseline.latency },
      correctness: {
        passes: baseline.correct.reduce((a, b) => a + b, 0),
        n: baseline.correct.length,
      },
    },
    experimental: {
      description: 'Fresh session; facts retrieved from project memory as a validated block.',
      input_tokens: {
        mean: round(mean(experimental.input_tokens)),
        samples: experimental.input_tokens,
      },
      prompt_characters: {
        mean: round(mean(experimental.prompt_chars)),
        samples: experimental.prompt_chars,
      },
      app_added_characters: { mean: round(mean(experimental.app_chars)) },
      latency_ms: { mean: round(mean(experimental.latency)), samples: experimental.latency },
      correctness: {
        passes: experimental.correct.reduce((a, b) => a + b, 0),
        n: experimental.correct.length,
      },
      retrieved_memories: {
        mean: round(mean(experimental.retrieval)),
        samples: experimental.retrieval,
      },
    },
    deltas: {
      input_tokens_mean: round(mean(experimental.input_tokens) - mean(baseline.input_tokens)),
      prompt_characters_mean: round(mean(experimental.prompt_chars) - mean(baseline.prompt_chars)),
      latency_ms_mean: round(mean(experimental.latency) - mean(baseline.latency)),
    },
    per_task: perTask,
    correction: correctionCheck,
    isolation,
    caveats: [
      'Both configurations pay the Muse CLI baseline (~16.6k input tokens); it dominates raw token totals.',
      'Facts-inline and memory-block are both single-call configurations; the comparison isolates context source, not turn count.',
      `Sample size is small (n=${baseline.input_tokens.length} per configuration); no statistical significance is claimed.`,
      'Answers are scored by expected-term matching, which measures recall of facts, not prose quality.',
    ],
  };

  await mkdir('docs/benchmarks', { recursive: true });
  await writeFile(
    'docs/benchmarks/evaluation-comparison.json',
    `${JSON.stringify(result, null, 2)}\n`,
  );

  const md = `# Evaluation comparison — persistent memory vs inline facts

Generated ${result.generated_at} · model \`${MODEL}\` · **n=${baseline.input_tokens.length} per configuration** (${TASKS.length} tasks × ${TRIALS} trials).

| Metric | Baseline (facts inline) | Memory-enabled |
| --- | --- | --- |
| Input tokens (mean) | ${result.baseline.input_tokens.mean} | ${result.experimental.input_tokens.mean} |
| Prompt characters (mean) | ${result.baseline.prompt_characters.mean} | ${result.experimental.prompt_characters.mean} |
| Application-added characters | ${result.baseline.app_added_characters.mean} | ${result.experimental.app_added_characters.mean} |
| Latency (mean ms) | ${result.baseline.latency_ms.mean} | ${result.experimental.latency_ms.mean} |
| Correct answers | ${result.baseline.correctness.passes}/${result.baseline.correctness.n} | ${result.experimental.correctness.passes}/${result.experimental.correctness.n} |
| Retrieved memories (mean) | 0 | ${result.experimental.retrieved_memories.mean} |

**Deltas (memory − baseline):** ${result.deltas.input_tokens_mean} input tokens · ${result.deltas.prompt_characters_mean} prompt characters · ${result.deltas.latency_ms_mean} ms.

## Correction and stale-memory avoidance

- Answer contains the current platform: **${correctionCheck.answer_has_current ? 'yes' : 'no'}**
- Superseded memory present in active retrieval: **${correctionCheck.superseded_in_active_retrieval ? 'yes' : 'no'}**
- Current memory present in active retrieval: **${correctionCheck.current_in_active_retrieval ? 'yes' : 'no'}**

## Project isolation

- Memories leaked from another project: **${isolation.leaked_from_other_project}**

## Per-run detail

| Task | Trial | Inline tokens | Inline correct | Memory tokens | Memory correct | Memories |
| --- | --- | --- | --- | --- | --- | --- |
${perTask
  .map(
    (row) =>
      `| ${row.task} | ${row.trial} | ${row.baseline.tokens} | ${row.baseline.correct ? 'yes' : 'no'} | ${row.memory.tokens} | ${row.memory.correct ? 'yes' : 'no'} | ${row.memory.memories} |`,
  )
  .join('\n')}

## Caveats

${result.caveats.map((caveat) => `- ${caveat}`).join('\n')}
`;
  await writeFile('docs/benchmarks/evaluation-comparison.md', md);

  console.log(
    `\nmeans: inline ${result.baseline.input_tokens.mean} tok · memory ${result.experimental.input_tokens.mean} tok · delta ${result.deltas.input_tokens_mean}`,
  );
  console.log(
    `correctness: inline ${result.baseline.correctness.passes}/${result.baseline.correctness.n} · memory ${result.experimental.correctness.passes}/${result.experimental.correctness.n}`,
  );
  console.log('wrote docs/benchmarks/evaluation-comparison.{json,md}');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
