/**
 * Integrated showcase — Demos A–E in one run, with real Muse inference.
 *
 *   1. Capture project requirements in session A.
 *   2. New session B recalls them with no transcript (Demo A).
 *   3. Correct the platform in session C; session D uses the new value and the
 *      old memory is superseded (Demo B).
 *   4. Muse generates a planning form; the submission reaches the agent and
 *      produces pending tool calls (Demo D).
 *   5. Tasks are approved, executed, and retrieved in a brand-new session
 *      (Demo E).
 *
 * Demo C (context efficiency) is measured separately by
 * scripts/evaluation-comparison.ts and docs/benchmarks/evaluation-comparison.md.
 *
 *   DATABASE_PATH=./data/showcase.db pnpm dev:server
 *   pnpm demo:showcase
 */
import { mkdir, writeFile } from 'node:fs/promises';

const BASE_URL = process.env.DEMO_BASE_URL ?? 'http://127.0.0.1:8787';
const MODEL = process.env.MUSE_MODEL ?? 'muse-wonder-1.0';
const PROJECT = process.env.DEMO_PROJECT ?? 'montys-memory-meadow';

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

interface Turn {
  assistant_message: { content: string };
  retrieval: { memory_ids: string[]; selected_count: number };
  usage: { input_tokens: number; output_tokens: number };
}

interface ToolCall {
  id: string;
  tool: string;
  status: string;
  arguments: Record<string, unknown>;
  result: unknown;
}

interface Surface {
  id: string;
  title: string;
  spec: {
    blocks: {
      kind: string;
      id?: string;
      title?: string;
      fields?: {
        id: string;
        type: string;
        required?: boolean;
        options?: { value: string }[];
      }[];
    }[];
  };
}

const checks: { name: string; pass: boolean; detail: string }[] = [];
const transcript: Record<string, unknown> = {};

function check(name: string, pass: boolean, detail: string): void {
  checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const body = (await response.json()) as Envelope<T>;
  if (!body.ok || body.data === undefined) throw new Error(`${path}: ${body.error?.message}`);
  return body.data;
}

async function newSession(projectId: string | null = PROJECT): Promise<string> {
  const created = await api<{ id: string }>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ project_id: projectId }),
  });
  return created.id;
}

async function say(sessionId: string, content: string, capture = false): Promise<Turn> {
  return api<Turn>(`/api/sessions/${sessionId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content, capture_memories: capture }),
  });
}

const oneLine = (text: string, max = 240): string => {
  const single = text.replace(/\s+/g, ' ').trim();
  return single.length <= max ? single : `${single.slice(0, max - 1)}…`;
};

function formValues(surface: Surface): Record<string, string | string[] | number | boolean> {
  const form = surface.spec.blocks.find((block) => block.kind === 'form');
  const values: Record<string, string | string[] | number | boolean> = {};
  for (const field of form?.fields ?? []) {
    if (field.type === 'select') values[field.id] = field.options?.[0]?.value ?? '';
    else if (field.type === 'multiselect') values[field.id] = [field.options?.[0]?.value ?? ''];
    else if (field.type === 'checkbox') values[field.id] = true;
    else if (field.type === 'number') values[field.id] = 5;
    else if (field.type === 'textarea')
      values[field.id] = 'A short, playable meadow level that children can finish unaided.';
    else values[field.id] = 'Playable meadow loop';
  }
  return values;
}

async function main() {
  console.log('Muse Recall — integrated showcase (real Muse)\n');

  // --- Demo A ------------------------------------------------------------
  const sessionA = await newSession();
  const capture = await say(
    sessionA,
    'We are building a children memory game using Phaser. The target platform is mobile web. The art direction is colourful illustrated farmyard scenery. Remember these requirements.',
    true,
  );
  transcript.demoA = { session: sessionA, turn: capture };

  const sessionB = await newSession();
  const recall = await say(
    sessionB,
    'What game are we building, which engine are we using, and what is the target platform?',
  );
  const recallText = recall.assistant_message.content.toLowerCase();
  check(
    'Demo A: new session recalls requirements without transcript',
    recallText.includes('phaser') &&
      recallText.includes('mobile web') &&
      recall.retrieval.memory_ids.length >= 2,
    `answer="${oneLine(recall.assistant_message.content)}" · ${recall.retrieval.memory_ids.length} memories`,
  );
  transcript.demoA.recall = recall;

  // --- Demo B ------------------------------------------------------------
  const sessionC = await newSession();
  const correctionTurn = await say(
    sessionC,
    'We have changed the target platform. The game will now prioritize desktop browsers instead of mobile web. Remember this correction.',
    true,
  );
  transcript.demoB = { session: sessionC, turn: correctionTurn };

  const memories = await api<{ items: { id: string; content: string; status: string }[] }>(
    `/api/memories?project_id=${PROJECT}&status=active,superseded`,
  );
  const superseded = memories.items.filter((memory) => memory.status === 'superseded');
  check(
    'Demo B: correction supersedes the previous platform',
    superseded.some((memory) => memory.content.toLowerCase().includes('mobile web')),
    `${superseded.length} superseded record(s)`,
  );

  const sessionD = await newSession();
  const platformTurn = await say(
    sessionD,
    'What platform are we targeting now, and did that change?',
  );
  const platformText = platformTurn.assistant_message.content.toLowerCase();
  const activeMobile = memories.items.some(
    (memory) =>
      memory.status === 'active' && memory.content.toLowerCase().includes('is mobile web'),
  );
  check(
    'Demo B: new session uses the current platform',
    platformText.includes('desktop') && !activeMobile,
    `answer="${oneLine(platformTurn.assistant_message.content)}"`,
  );
  transcript.demoB.recall = platformTurn;

  // --- Demo D ------------------------------------------------------------
  const generated = await api<{ surface: Surface }>(`/api/sessions/${sessionD}/ui`, {
    method: 'POST',
    body: JSON.stringify({ intent: 'Plan the first playable milestone for our Phaser game' }),
  });
  const surface = generated.surface;
  const fieldCount =
    surface.spec.blocks.find((block) => block.kind === 'form')?.fields?.length ?? 0;
  check(
    'Demo D: Muse generates a valid planning interface',
    fieldCount >= 3,
    `"${surface.title}" with ${fieldCount} fields`,
  );

  const submission = await api<{ turn: Turn; memory: { content: string } | null }>(
    `/api/sessions/${sessionD}/ui/${surface.id}/events`,
    {
      method: 'POST',
      body: JSON.stringify({ action_id: 'plan', values: formValues(surface) }),
    },
  );
  transcript.demoD = { surface, submission };
  check(
    'Demo D: structured submission reaches the agent',
    submission.turn.assistant_message.content.length > 0,
    `agent continued with "${oneLine(submission.turn.assistant_message.content, 160)}"`,
  );

  // --- Demo E ------------------------------------------------------------
  let calls = await api<{ items: ToolCall[] }>(`/api/sessions/${sessionD}/tools`).then(
    (result) => result.items,
  );
  const pending = calls.filter((call) => call.status === 'pending');
  check(
    'Demo E: tool calls require approval',
    pending.length > 0,
    `${pending.length} pending: ${pending.map((call) => call.tool).join(', ')}`,
  );

  for (const call of pending) {
    await api(`/api/sessions/${sessionD}/tools/${call.id}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision: 'approve' }),
    });
  }
  calls = await api<{ items: ToolCall[] }>(`/api/sessions/${sessionD}/tools`).then(
    (result) => result.items,
  );
  const executed = calls.filter((call) => call.status === 'executed');
  check(
    'Demo E: approved tool calls execute',
    executed.length >= pending.length && pending.length > 0,
    `${executed.length} executed`,
  );

  const sessionE = await newSession();
  const summary = await say(
    sessionE,
    'Summarise the project for a teammate: what are we building, what platform, and what tasks are planned?',
  );
  const summaryText = summary.assistant_message.content.toLowerCase();
  const taskTitles = calls
    .filter((call) => call.tool === 'task.create' && call.status === 'executed')
    .map((call) => String(call.arguments.title ?? '').toLowerCase())
    .filter(Boolean);
  const mentionsTask = taskTitles.some((title) => title.length > 3 && summaryText.includes(title));
  check(
    'Demo E: new session retrieves project state and tasks',
    summaryText.includes('desktop') && (mentionsTask || summaryText.includes('task')),
    `answer="${oneLine(summary.assistant_message.content)}"`,
  );
  transcript.demoE = { session: sessionE, summary, calls };

  const report = {
    generated_at: new Date().toISOString(),
    model: MODEL,
    project: PROJECT,
    sessions: { a: sessionA, b: sessionB, c: sessionC, d: sessionD, e: sessionE },
    checks,
    passed: checks.filter((entry) => entry.pass).length,
    total: checks.length,
    transcript,
  };

  await mkdir('docs/benchmarks', { recursive: true });
  await writeFile('docs/benchmarks/showcase.json', `${JSON.stringify(report, null, 2)}\n`);

  console.log(`\n${report.passed}/${report.total} showcase checks passed`);
  console.log('wrote docs/benchmarks/showcase.json');
  if (report.passed !== report.total) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
