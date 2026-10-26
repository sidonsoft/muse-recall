/**
 * Cross-session memory demonstrations (A and B), executed against the running
 * application over HTTP with real Muse inference.
 *
 *   DATABASE_PATH=./data/demo.db pnpm dev:server
 *   pnpm demo:sessions
 *
 * Writes JSON evidence to docs/benchmarks/ so the claims in the docs can be
 * checked against what actually happened.
 *
 * Run against a **fresh database**: Demo B supersedes a fact, and replaying it
 * against an already-corrected store would find nothing to supersede.
 */
import { mkdir, writeFile } from 'node:fs/promises';

const BASE_URL = process.env.DEMO_BASE_URL ?? 'http://127.0.0.1:8787';
const PROJECT = process.env.DEMO_PROJECT ?? 'montys-memory-meadow';

interface TurnRecord {
  answer: string;
  memory_ids: string[];
  memory_contents: string[];
  retrieval_mode: string;
  memory_characters: number;
  prompt_characters: number;
  history_messages: number;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number | null;
  captures: { content: string; superseded_ids: string[]; created: boolean; type: string }[];
}

interface SseFrame {
  event: string;
  data: Record<string, unknown>;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const body = (await response.json()) as { ok: boolean; data?: T; error?: { message: string } };
  if (!body.ok || body.data === undefined) {
    throw new Error(`${path} failed: ${body.error?.message ?? 'unknown error'}`);
  }
  return body.data;
}

function parseSse(body: string): SseFrame[] {
  return body
    .split('\n\n')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const event = /^event: (.+)$/m.exec(chunk)?.[1] ?? 'message';
      const data = /^data: (.+)$/m.exec(chunk)?.[1] ?? '{}';
      return { event, data: JSON.parse(data) as Record<string, unknown> };
    });
}

async function createSession(projectId: string | null): Promise<string> {
  const session = await request<{ id: string }>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ project_id: projectId }),
  });
  return session.id;
}

async function sendTurn(sessionId: string, content: string): Promise<TurnRecord> {
  const response = await fetch(`${BASE_URL}/api/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ content }),
  });

  if (!response.ok) throw new Error(`turn failed: HTTP ${response.status}`);

  const frames = parseSse(await response.text());
  const error = frames.find((frame) => frame.event === 'error');
  if (error) throw new Error(`turn error: ${JSON.stringify(error.data)}`);

  const captured = frames.find((frame) => frame.event === 'memory_captured');
  const completed = frames.find((frame) => frame.event === 'completed');
  const retrieval = frames.find((frame) => frame.event === 'retrieval');
  if (!completed) throw new Error('no completed event');

  const turn = completed.data.turn as {
    assistant_message: { content: string; latency_ms: number | null };
    retrieval: { memory_ids: string[]; query_mode: string; characters_used: number };
    context: { prompt_characters: number; memory_characters: number; history_messages: number };
    usage: { input_tokens: number; output_tokens: number };
  };

  const results = (retrieval?.data.results ?? []) as { memory: { content: string } }[];

  return {
    answer: turn.assistant_message.content,
    memory_ids: turn.retrieval.memory_ids,
    memory_contents: results.map((entry) => entry.memory.content),
    retrieval_mode: turn.retrieval.query_mode,
    memory_characters: turn.context.memory_characters,
    prompt_characters: turn.context.prompt_characters,
    history_messages: turn.context.history_messages,
    input_tokens: turn.usage.input_tokens,
    output_tokens: turn.usage.output_tokens,
    latency_ms: turn.assistant_message.latency_ms,
    captures: (captured?.data.captures ?? []) as TurnRecord['captures'],
  };
}

async function main() {
  console.log('Muse Memory Lab — session demonstrations (real Muse)\n');

  // --- Demo A -----------------------------------------------------------
  console.log('DEMO A — cross-session memory');
  const sessionA = await createSession(PROJECT);
  const capture = await sendTurn(
    sessionA,
    'We are building a children memory game using Phaser. The target platform is mobile web. The art direction is colourful illustrated farmyard scenery. Remember these requirements.',
  );
  console.log(`  session A (${sessionA}) acknowledged: ${truncate(capture.answer, 90)}`);
  console.log(`  memories captured in that turn: ${capture.memory_contents.length}`);

  const memories = await request<{ items: { content: string; status: string }[] }>(
    `/api/memories?project_id=${PROJECT}`,
  );
  const active = memories.items.filter((memory) => memory.status === 'active');
  console.log(`  active memories in project: ${active.length}`);
  for (const memory of active) console.log(`    · ${memory.content}`);

  const sessionB = await createSession(PROJECT);
  const answerB = await sendTurn(
    sessionB,
    'What game are we building, which engine are we using, and what is the target platform?',
  );
  console.log(`\n  session B (${sessionB}) — new session, no transcript carried`);
  console.log(`  answer: ${answerB.answer}`);
  console.log(
    `  retrieved ${answerB.memory_ids.length} memories, ${answerB.memory_characters} chars, history messages: ${answerB.history_messages}`,
  );
  console.log(`  retrieval: ${answerB.memory_contents.join(' | ')}`);

  // --- Demo B -----------------------------------------------------------
  console.log('\nDEMO B — correctable memory');
  const sessionC = await createSession(PROJECT);
  const correction = await sendTurn(
    sessionC,
    'We have changed the target platform. The game will now prioritize desktop browsers instead of mobile web. Remember this correction.',
  );
  console.log(`  session C (${sessionC}) acknowledged: ${truncate(correction.answer, 90)}`);
  for (const capture of correction.captures) {
    console.log(
      `  captured: ${capture.content}${capture.superseded_ids.length > 0 ? ` (superseded ${capture.superseded_ids.length})` : ' (new)'}`,
    );
  }

  // Status must be requested explicitly: the list endpoint defaults to active.
  const afterCorrection = await request<{ items: { content: string; status: string }[] }>(
    `/api/memories?project_id=${PROJECT}&status=active,superseded,expired`,
  );
  const superseded = afterCorrection.items.filter((memory) => memory.status === 'superseded');
  console.log(`  superseded memories now: ${superseded.length}`);
  for (const memory of superseded) console.log(`    ✗ ${memory.content}`);

  const sessionD = await createSession(PROJECT);
  const answerD = await sendTurn(
    sessionD,
    'What platform are we targeting now, and did that change?',
  );
  console.log(`\n  session D (${sessionD}) — new session`);
  console.log(`  answer: ${answerD.answer}`);
  console.log(`  retrieved: ${answerD.memory_contents.join(' | ')}`);

  const evidence = {
    generated_at: new Date().toISOString(),
    base_url: BASE_URL,
    project: PROJECT,
    demo_a: {
      session_a: sessionA,
      session_b: sessionB,
      captured_turn: capture,
      active_memories: active.map((memory) => memory.content),
      answer: answerB,
    },
    demo_b: {
      session_c: sessionC,
      session_d: sessionD,
      correction_turn: correction,
      superseded_memories: superseded.map((memory) => memory.content),
      answer: answerD,
    },
  };

  await mkdir('docs/benchmarks', { recursive: true });
  await writeFile('docs/benchmarks/demo-sessions.json', `${JSON.stringify(evidence, null, 2)}\n`);
  console.log('\nwrote docs/benchmarks/demo-sessions.json');
}

function truncate(text: string, max: number): string {
  const single = text.replace(/\s+/g, ' ').trim();
  return single.length <= max ? single : `${single.slice(0, max - 1)}…`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
