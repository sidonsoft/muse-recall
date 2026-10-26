/**
 * Demo C — context-efficiency comparison with real Muse inference.
 *
 * Two configurations answer the same question:
 *
 *   A. Baseline: no persistent memory. The facts are supplied in an earlier
 *      conversation turn, so the answering call re-sends them as history.
 *   B. Memory: a fresh session in the project; the facts arrive as retrieved
 *      memories, and the answering call carries no history.
 *
 * Measured per trial: input tokens, application-added characters, retrieved
 * memory characters, answer correctness, latency, and the number of turns the
 * task required. Multiple trials, identical model.
 *
 * The script does **not** assume memory is cheaper. The provider's own baseline
 * (~16.6k tokens for the Muse CLI) dominates both configurations, and that is
 * reported explicitly.
 *
 *   pnpm bench:context [--trials 3]
 */
import { mkdir, writeFile } from 'node:fs/promises';

const BASE_URL = process.env.DEMO_BASE_URL ?? 'http://127.0.0.1:8787';
const PROJECT = process.env.CONTEXT_PROJECT ?? 'context-efficiency-demo';
const MODEL = process.env.MUSE_MODEL ?? 'muse-wonder-1.0';

const FACTS = [
  'We are building a children memory game using Phaser.',
  'The target platform is mobile web.',
  'The art direction is colourful illustrated farmyard scenery.',
];

const QUESTION =
  'What game are we building, which engine are we using, and what is the target platform?';

const EXPECTED = ['phaser', 'mobile web'];
const trialsFlag = process.argv.indexOf('--trials');
const TRIALS =
  Number(process.env.CONTEXT_TRIALS ?? (trialsFlag !== -1 ? process.argv[trialsFlag + 1] : 3)) || 3;

interface TurnMeasurement {
  input_tokens: number;
  output_tokens: number;
  latency_ms: number | null;
  prompt_characters: number;
  context_chars: {
    system: number;
    constraints: number;
    memories: number;
    corrections: number;
    history: number;
    request: number;
  };
  memory_characters: number;
  history_messages: number;
  answer: string;
  correct: boolean;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const body = (await response.json()) as { ok: boolean; data?: T; error?: { message: string } };
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

async function turn(
  sessionId: string,
  content: string,
  capture: boolean,
): Promise<TurnMeasurement> {
  const response = await fetch(`${BASE_URL}/api/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ content, capture_memories: capture }),
  });
  if (!response.ok) throw new Error(`turn failed: HTTP ${response.status}`);

  const frames = parseSse(await response.text());
  const error = frames.find((frame) => frame.event === 'error');
  if (error) throw new Error(`turn error: ${JSON.stringify(error.data)}`);
  const completed = frames.find((frame) => frame.event === 'completed');
  if (!completed) throw new Error('no completed event');

  const turnData = completed.data.turn as {
    assistant_message: { content: string; latency_ms: number | null };
    context: {
      prompt_characters: number;
      memory_characters: number;
      history_messages: number;
      sections: TurnMeasurement['context_chars'];
    };
    usage: { input_tokens: number; output_tokens: number };
  };

  const answer = turnData.assistant_message.content;
  return {
    input_tokens: turnData.usage.input_tokens,
    output_tokens: turnData.usage.output_tokens,
    latency_ms: turnData.assistant_message.latency_ms,
    prompt_characters: turnData.context.prompt_characters,
    context_chars: turnData.context.sections,
    memory_characters: turnData.context.memory_characters,
    history_messages: turnData.context.history_messages,
    answer,
    correct: EXPECTED.every((term) => answer.toLowerCase().includes(term)),
  };
}

async function createSession(projectId: string | null): Promise<string> {
  const session = await request<{ id: string }>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ project_id: projectId }),
  });
  return session.id;
}

async function seedMemories(): Promise<void> {
  const existing = await request<{ items: unknown[] }>(`/api/memories?project_id=${PROJECT}`);
  if (existing.items.length > 0) return;

  for (const content of FACTS) {
    await request('/api/memories', {
      method: 'POST',
      body: JSON.stringify({
        type: content.includes('platform') ? 'technical_decision' : 'contextual_fact',
        scope: 'project',
        project_id: PROJECT,
        content,
        confidence: 0.9,
        validation_status: 'verified',
        source: { session_id: null, reference: 'context-benchmark-seed' },
      }),
    });
  }
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function main() {
  await seedMemories();

  const baseline: TurnMeasurement[] = [];
  const baselineTotals: number[] = [];
  const memory: TurnMeasurement[] = [];
  const memoryTotals: number[] = [];
  let baselineTurns = 0;
  let memoryTurns = 0;

  for (let trial = 0; trial < TRIALS; trial += 1) {
    // A — baseline: facts in history, no persistent memory.
    const sessionA = await createSession(null);
    const setup = await turn(sessionA, `Context for our project: ${FACTS.join(' ')}`, false);
    const answerA = await turn(sessionA, QUESTION, false);
    baseline.push(answerA);
    baselineTotals.push(setup.input_tokens + answerA.input_tokens);
    baselineTurns += 2;

    // B — memory: facts retrieved into a fresh session.
    const sessionB = await createSession(PROJECT);
    const answerB = await turn(sessionB, QUESTION, false);
    memory.push(answerB);
    memoryTotals.push(answerB.input_tokens);
    memoryTurns += 1;

    console.log(
      `trial ${trial + 1}: baseline answering=${answerA.input_tokens} tok (task ${setup.input_tokens + answerA.input_tokens}) · memory=${answerB.input_tokens} tok · correct A=${answerA.correct} B=${answerB.correct}`,
    );
  }

  const summary = {
    generated_at: new Date().toISOString(),
    model: MODEL,
    trials: TRIALS,
    task: { question: QUESTION, expected_terms: EXPECTED, facts: FACTS },
    baseline: {
      description: 'No persistent memory; facts supplied in the previous conversation turn.',
      turns_per_task: 2,
      answering_input_tokens: {
        mean: Number(mean(baseline.map((entry) => entry.input_tokens)).toFixed(2)),
        samples: baseline.map((entry) => entry.input_tokens),
      },
      task_input_tokens: {
        mean: Number(mean(baselineTotals).toFixed(2)),
        samples: baselineTotals,
      },
      app_added_characters: Number(
        mean(baseline.map((entry) => entry.context_chars.history)).toFixed(2),
      ),
      recalled_characters: Number(
        mean(baseline.map((entry) => entry.memory_characters)).toFixed(2),
      ),
      latency_ms: Number(mean(baseline.map((entry) => entry.latency_ms ?? 0)).toFixed(2)),
      correctness: baseline.filter((entry) => entry.correct).length / TRIALS,
      answers: baseline.map((entry) => entry.answer),
    },
    memory_enabled: {
      description: 'Persistent memory retrieved into a fresh session; no prior transcript.',
      turns_per_task: 1,
      answering_input_tokens: {
        mean: Number(mean(memory.map((entry) => entry.input_tokens)).toFixed(2)),
        samples: memory.map((entry) => entry.input_tokens),
      },
      task_input_tokens: {
        mean: Number(mean(memoryTotals).toFixed(2)),
        samples: memoryTotals,
      },
      app_added_characters: Number(
        mean(
          memory.map((entry) => entry.context_chars.memories + entry.context_chars.constraints),
        ).toFixed(2),
      ),
      retrieved_memory_characters: Number(
        mean(memory.map((entry) => entry.memory_characters)).toFixed(2),
      ),
      latency_ms: Number(mean(memory.map((entry) => entry.latency_ms ?? 0)).toFixed(2)),
      correctness: memory.filter((entry) => entry.correct).length / TRIALS,
      answers: memory.map((entry) => entry.answer),
    },
    deltas: {
      answering_input_tokens: Number(
        (
          mean(memory.map((entry) => entry.input_tokens)) -
          mean(baseline.map((entry) => entry.input_tokens))
        ).toFixed(2),
      ),
      task_input_tokens: Number((mean(memoryTotals) - mean(baselineTotals)).toFixed(2)),
      turns_saved_per_task: 2 - 1,
      turns_exercised: { baseline: baselineTurns, memory: memoryTurns },
    },
    caveats: [
      'Both configurations pay the Muse CLI baseline (~16.6k input tokens); it dominates these numbers.',
      'The baseline re-sends the fact statement as conversation history on the answering call.',
      'Memory adds retrieved-memory characters but removes the history re-send.',
      'A single model, a single machine, and a small synthetic task set: these are measurements, not a general benchmark.',
    ],
  };

  console.log('\nAnswering-call input tokens:');
  console.log(`  baseline (history): ${summary.baseline.answering_input_tokens.mean}`);
  console.log(`  memory-enabled:     ${summary.memory_enabled.answering_input_tokens.mean}`);
  console.log(`  delta:              ${summary.deltas.answering_input_tokens}`);
  console.log(
    `Correctness: baseline ${(summary.baseline.correctness * 100).toFixed(0)}% · memory ${(summary.memory_enabled.correctness * 100).toFixed(0)}%`,
  );
  console.log(
    `Turns: baseline ${summary.baseline.turns_per_task} · memory ${summary.memory_enabled.turns_per_task}`,
  );

  await mkdir('docs/benchmarks', { recursive: true });
  await writeFile(
    'docs/benchmarks/context-efficiency-latest.json',
    `${JSON.stringify(summary, null, 2)}\n`,
  );

  const markdown = `# Context efficiency — measured with real Muse

Generated ${summary.generated_at} · model \`${MODEL}\` · ${TRIALS} trials per configuration.

Task: "${QUESTION}"

| Metric | Baseline (history) | Memory-enabled |
| --- | --- | --- |
| Turns required | ${summary.baseline.turns_per_task} | ${summary.memory_enabled.turns_per_task} |
| Answering-call input tokens (mean) | ${summary.baseline.answering_input_tokens.mean} | ${summary.memory_enabled.answering_input_tokens.mean} |
| Whole-task input tokens (mean) | ${summary.baseline.task_input_tokens.mean} | ${summary.memory_enabled.task_input_tokens.mean} |
| Application-added characters | ${summary.baseline.app_added_characters} (history) | ${summary.memory_enabled.app_added_characters} (memory) |
| Retrieved memory characters | ${summary.baseline.recalled_characters} | ${summary.memory_enabled.retrieved_memory_characters} |
| Answer latency (mean ms) | ${summary.baseline.latency_ms} | ${summary.memory_enabled.latency_ms} |
| Correct answers | ${(summary.baseline.correctness * 100).toFixed(0)}% | ${(summary.memory_enabled.correctness * 100).toFixed(0)}% |

## Result

- Answering-call delta (memory − baseline): **${summary.deltas.answering_input_tokens} input tokens**
- Whole-task delta: **${summary.deltas.task_input_tokens} input tokens**
- Turns per task: baseline **2** · memory **1** (one turn saved per task)

${summary.deltas.answering_input_tokens <= 0 ? 'Memory used fewer tokens on the answering call in this configuration.' : 'Memory used **more** tokens on the answering call in this configuration — it is not a token-saving mechanism at this task size.'}

## Caveats

${summary.caveats.map((caveat) => `- ${caveat}`).join('\n')}

## Answers

Baseline: ${summary.baseline.answers.map((answer) => `"${answer.replace(/\s+/g, ' ').trim()}"`).join(' · ')}

Memory: ${summary.memory_enabled.answers.map((answer) => `"${answer.replace(/\s+/g, ' ').trim()}"`).join(' · ')}
`;

  await writeFile('docs/benchmarks/context-efficiency-latest.md', markdown);
  console.log('\nwrote docs/benchmarks/context-efficiency-latest.{json,md}');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
