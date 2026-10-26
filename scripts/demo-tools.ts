/**
 * Agent-tool demonstration with real Muse inference.
 *
 *   1. Ask Muse to create two project tasks.
 *   2. Muse plans tool calls; writes are held for approval.
 *   3. Approve them through the API; the tasks are created and Muse continues.
 *   4. Ask Muse to list the tasks (read tool executes without approval).
 *   5. Start a new session and ask what is planned — the read tool proves the
 *      state persisted independently of the transcript.
 *
 *   DATABASE_PATH=./data/tools.db pnpm dev:server
 *   pnpm demo:tools
 */
import { mkdir, writeFile } from 'node:fs/promises';

const BASE_URL = process.env.DEMO_BASE_URL ?? 'http://127.0.0.1:8787';
const PROJECT = process.env.DEMO_PROJECT ?? 'montys-memory-meadow';

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

interface ToolCall {
  id: string;
  tool: string;
  status: string;
  arguments: Record<string, unknown>;
  result: unknown;
  error: string | null;
}

interface Message {
  role: string;
  content: string;
}

interface Turn {
  assistant_message: Message;
  retrieval: { memory_ids: string[] };
  usage: { input_tokens: number; output_tokens: number };
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const body = (await response.json()) as ApiEnvelope<T>;
  if (!body.ok || body.data === undefined) {
    throw new Error(`${path}: ${body.error?.message ?? 'request failed'}`);
  }
  return body.data;
}

async function send(sessionId: string, content: string): Promise<Turn> {
  return api<Turn>(`/api/sessions/${sessionId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content, capture_memories: false }),
  });
}

async function listTools(sessionId: string): Promise<ToolCall[]> {
  const result = await api<{ items: ToolCall[] }>(`/api/sessions/${sessionId}/tools`);
  return result.items;
}

async function decide(sessionId: string, callId: string, decision: 'approve' | 'deny') {
  return api<{ call: ToolCall; turn: Turn | null }>(
    `/api/sessions/${sessionId}/tools/${callId}/decision`,
    { method: 'POST', body: JSON.stringify({ decision }) },
  );
}

async function main() {
  console.log('Muse Recall — agent tools demonstration (real Muse)\n');

  const session = await api<{ id: string }>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ project_id: PROJECT }),
  });
  console.log(`session: ${session.id}`);

  console.log('\n1. Ask Muse to create two tasks');
  const planTurn = await send(
    session.id,
    'Create a project task to fix the menu layout, and another task to add sound effects. Use the tools.',
  );
  console.log(`   muse: ${oneLine(planTurn.assistant_message.content, 180)}`);

  let calls = await listTools(session.id);
  console.log(`   tool calls requested: ${calls.length}`);
  for (const call of calls) {
    console.log(`     · ${call.tool} [${call.status}] ${JSON.stringify(call.arguments)}`);
  }

  console.log('\n2. Approve the pending writes');
  for (const call of calls.filter((entry) => entry.status === 'pending')) {
    const result = await decide(session.id, call.id, 'approve');
    console.log(
      `   approved ${call.tool} → ${result.call.status}${result.turn ? ` (turn tokens ${result.turn.usage.input_tokens})` : ''}`,
    );
  }

  calls = await listTools(session.id);
  const created = calls.filter(
    (entry) => entry.tool === 'task.create' && entry.status === 'executed',
  );
  console.log(`   executed task creations: ${created.length}`);

  console.log('\n3. Ask Muse to list the tasks (read tool runs without approval)');
  const listTurn = await send(session.id, 'List the project tasks and tell me what is planned.');
  console.log(`   muse: ${oneLine(listTurn.assistant_message.content, 240)}`);

  console.log('\n4. New session, same project');
  const next = await api<{ id: string }>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ project_id: PROJECT }),
  });
  const recallTurn = await send(next.id, 'What tasks are planned for this project?');
  console.log(`   muse: ${oneLine(recallTurn.assistant_message.content, 240)}`);

  const nextCalls = await listTools(next.id);
  const executedReads = nextCalls.filter((call) => call.status === 'executed');

  const evidence = {
    generated_at: new Date().toISOString(),
    model: process.env.MUSE_MODEL ?? 'muse-wonder-1.0',
    project: PROJECT,
    session_ids: { planning: session.id, recall: next.id },
    plan_turn: planTurn,
    initial_calls: calls,
    executed_task_creations: created,
    list_turn: listTurn,
    recall_turn: recallTurn,
    recall_tool_calls: nextCalls,
    summary: {
      tasks_created: created.length,
      read_calls_in_recall_session: executedReads.length,
    },
  };

  await mkdir('docs/benchmarks', { recursive: true });
  await writeFile('docs/benchmarks/tools-demo.json', `${JSON.stringify(evidence, null, 2)}\n`);
  console.log('\nwrote docs/benchmarks/tools-demo.json');
}

function oneLine(text: string, max: number): string {
  const single = text.replace(/\s+/g, ' ').trim();
  return single.length <= max ? single : `${single.slice(0, max - 1)}…`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
