/**
 * Capture the five current README surfaces.
 *
 * 1. conversation.png      — a useful answer grounded in project memory
 * 2. planning-form.png     — a Muse-generated declarative planning form
 * 3. tool-approval.png     — a write tool pending explicit approval
 * 4. memory-detail.png     — a corrected decision with its audit history
 * 5. memory-retrieval.png  — Forge-mode retrieval with scores and budget
 *
 * The product paths are real: the script boots the production Fastify app over
 * a disposable SQLite database, seeds decisions through the production memory
 * engine, and drives the real React client in managed Playwright Chromium.
 *
 * No paid generation is used. The model provider is the repository's
 * deterministic EchoProvider with a scripted responder. It is deliberately
 * still reported as `echo` (offline / not a model) in the UI; the responder
 * reads the actual `<project_constraints>` and `<retrieved_memories>` blocks
 * from the assembled prompt to compose the grounded answer. Nothing in the
 * browser DOM, response badges, retrieval results, or provider identity is
 * faked.
 *
 * Usage (from the repository root):
 *   pnpm exec tsx scripts/capture-readme-surfaces.ts
 *
 * Optional:
 *   KEEP_CAPTURE_DATA=1  keep the disposable DB/workspace under the OS temp dir
 *   CAPTURE_TIMEOUT_MS   override the per-wait timeout (default 30s)
 *
 * The script allocates free ports, starts no shared service, and always closes
 * the browser, the Vite dev server, the Fastify app, and the database.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../apps/server/src/app.js';
import { loadConfig } from '../apps/server/src/config.js';
import { MemoryEngine, openDatabase } from '../packages/memory-engine/src/index.js';
import { EchoProvider } from '../packages/muse-provider/src/index.js';
import type { Memory, MemoryCreateInput, ModelRequest } from '../packages/shared/src/index.js';
import { launchVerificationBrowser, reportBrowserSelection } from './lib/browser.js';

const ROOT = resolve(import.meta.dirname, '..');
const OUTPUT_DIR = join(ROOT, 'docs/assets/readme-2026-10-29');
const WEB_DIR = join(ROOT, 'apps/web');
const TIMEOUT_MS = Number(process.env.CAPTURE_TIMEOUT_MS ?? 30_000);
const VIEWPORT = { width: 1600, height: 1000 } as const;
const PROJECT_ID = 'reading-nook';
const PROJECT_NAME = 'Reading Nook';

const OLD_PALETTE =
  'Art direction: warm sunset palette. Use #FF7E5F as the primary accent and #2D1E2F for dark text.';
const OCEAN_PALETTE =
  'Ocean palette: #4EA8DE accent, #102A43 text. Keep surfaces calm and low-contrast.';
const CHILD_SAFETY =
  'No flashing effects, countdown timers, or penalties for mistakes. Keep the pace gentle.';
const PROJECT_GOAL = 'Reading Nook: a ten-minute browser game about arranging a cozy window seat.';
const CORRECTION_REASON = 'Creative direction moved from a warm sunset mood to a calm ocean mood.';

const PLANNING_FORM = {
  title: 'Reading Nook — first playable',
  description:
    'Choose the milestone, target platform, and first-version scope. The submitted plan is saved to project memory.',
  fields: [
    {
      id: 'milestone',
      label: 'First milestone',
      type: 'text',
      required: true,
      options: [],
      placeholder: 'e.g. a playable window-seat scene',
    },
    {
      id: 'platform',
      label: 'Target platform',
      type: 'select',
      required: true,
      options: ['Desktop browser (1280×800)', 'Mobile web', 'Both'],
      placeholder: '',
    },
    {
      id: 'scope',
      label: 'First-version scope',
      type: 'multiselect',
      required: true,
      options: ['Window-seat builder', 'Story unlock', 'Gentle page-turn sound'],
      placeholder: '',
    },
  ],
  submit_label: 'Save plan',
};

const TOOL_ARGUMENTS = {
  title: 'Add a gentle page-turn sound to Reading Nook',
  description: 'Soft paper rustle at low volume; never a sudden loud cue.',
  status: 'todo',
};

const problems: string[] = [];
const notes: string[] = [];

function note(message: string): void {
  notes.push(message);
  console.log(`  ✓ ${message}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function tail(text: string, lines = 12): string {
  return text.trim().split('\n').slice(-lines).join('\n');
}

async function freePort(): Promise<number> {
  return await new Promise<number>((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate a local port.'));
        return;
      }
      const { port } = address;
      server.close(() => resolvePort(port));
    });
  });
}

async function waitForHttp(url: string, timeoutMs = TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no response yet';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError}`);
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const pid = child.pid;
  if (pid === undefined) return;
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  const exited = new Promise<void>((resolveExit) => child.once('exit', () => resolveExit()));
  const timedOut = await Promise.race([exited.then(() => false), sleep(4_000).then(() => true)]);
  if (!timedOut) return;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
  await Promise.race([exited, sleep(2_000)]);
}

function decisionInput(
  type: MemoryCreateInput['type'],
  content: string,
  tags: string[],
  reference: string,
): MemoryCreateInput {
  return {
    type,
    scope: 'project',
    project_id: PROJECT_ID,
    content,
    source: { session_id: null, reference },
    confidence: type === 'constraint' ? 0.96 : 0.93,
    validation_status: 'verified',
    tags,
    expires_at: null,
  };
}

interface SeededReadingNook {
  goal: Memory;
  safety: Memory;
  ocean: Memory;
  oldPalette: Memory;
}

function seedReadingNook(engine: MemoryEngine): SeededReadingNook {
  engine.ensureProject(PROJECT_ID, PROJECT_NAME);

  const goal = engine.create(
    decisionInput('goal', PROJECT_GOAL, ['reading-nook', 'goal'], 'design-kickoff'),
  ).memory;
  const safety = engine.create(
    decisionInput('constraint', CHILD_SAFETY, ['reading-nook', 'child-safety'], 'design-review'),
  ).memory;
  const oldPalette = engine.create(
    decisionInput(
      'constraint',
      OLD_PALETTE,
      ['reading-nook', 'palette', 'sunset'],
      'art-review-01',
    ),
  ).memory;
  const corrected = engine.correct(
    {
      ...decisionInput(
        'technical_decision',
        OCEAN_PALETTE,
        ['reading-nook', 'palette', 'ocean'],
        'art-review-02',
      ),
      supersedes: [oldPalette.id],
      reason: CORRECTION_REASON,
    },
    'user',
  );

  return {
    goal,
    safety,
    ocean: corrected.memory,
    oldPalette: corrected.superseded[0] ?? oldPalette,
  };
}

/** Extract the escaped content lines of one prompt memory block. */
function blockContents(prompt: string, tag: string): string[] {
  const pattern = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`);
  const block = pattern.exec(prompt)?.[1];
  if (!block) return [];

  const entries: string[] = [];
  let current: string[] = [];
  let collecting = false;
  for (const line of block.split('\n')) {
    if (/^\[\d+\] id=/.test(line)) {
      if (collecting) entries.push(current.join(' ').trim());
      current = [];
      collecting = true;
      continue;
    }
    if (!collecting) continue;
    if (line.trim().length > 0) current.push(line.trim());
  }
  if (collecting) entries.push(current.join(' ').trim());
  return entries.filter((entry) => entry.length > 0);
}

/**
 * Compose the answer from the memory blocks the runtime actually supplied.
 *
 * This is not a model: it is a deterministic responder whose text changes when
 * retrieval changes. If the palette or safety rule is absent, the answer says
 * so instead of inventing it.
 */
function groundedAnswer(prompt: string): string {
  const memories = [
    ...blockContents(prompt, 'project_constraints'),
    ...blockContents(prompt, 'retrieved_memories'),
  ];
  const hasPalette = memories.some((entry) => /#4ea8de|ocean palette/i.test(entry));
  const hasSafety = memories.some((entry) => /flashing effects/i.test(entry));
  const hasProject = memories.some((entry) => /reading nook|window seat/i.test(entry));

  if (!hasPalette && !hasSafety) {
    return 'I do not have the palette or the safety rules in project memory yet. Add them in the Memory inspector, then ask again.';
  }

  const parts: string[] = [];
  if (hasProject) {
    parts.push('Reading Nook is a ten-minute browser game about arranging a cozy window seat.');
  } else {
    parts.push('Here is what project memory records for Reading Nook.');
  }
  if (hasPalette) {
    parts.push('Use the ocean palette — #4EA8DE as the accent and #102A43 for dark text.');
  }
  if (hasSafety) {
    parts.push(
      'Keep it child-safe: no flashing effects, countdown timers, or penalties for mistakes.',
    );
  }
  return parts.join(' ');
}

function scriptedResponder(request: ModelRequest): string {
  const prompt = request.messages.map((message) => message.content).join('\n\n');
  const first = request.messages[0]?.content ?? '';

  if (first.startsWith('Design a short interactive planning form')) {
    return JSON.stringify(PLANNING_FORM);
  }

  if (first.startsWith('You are the tool-planning step')) {
    if (/Current request:[\s\S]*create a task/i.test(prompt)) {
      return JSON.stringify({
        calls: [{ tool: 'task.create', arguments_json: JSON.stringify(TOOL_ARGUMENTS) }],
      });
    }
    return JSON.stringify({ calls: [] });
  }

  if (/<current_request>[\s\S]*first milestone for Reading Nook/i.test(prompt)) {
    return "I've mapped the first milestone into a short planning form. Choose the platform and scope, and I'll save the plan to Reading Nook's project memory.";
  }

  if (/Create a task to add a gentle page-turn sound/i.test(prompt)) {
    return "I've drafted a task for a gentle page-turn sound and paused it for your approval. Nothing has been written yet — approve the pending call to add it to Reading Nook.";
  }

  if (/<current_request>[\s\S]*(palette|safety rules)/i.test(prompt)) {
    return groundedAnswer(prompt);
  }

  return 'I can help with that. Ask about Reading Nook’s palette, safety rules, or milestone plan.';
}

async function createSession(apiOrigin: string, title: string): Promise<string> {
  const response = await fetch(`${apiOrigin}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project_id: PROJECT_ID, title }),
  });
  const payload = (await response.json()) as { data?: { id?: string }; error?: unknown };
  assert(
    response.status === 201,
    `session create failed: ${response.status} ${JSON.stringify(payload.error ?? payload)}`,
  );
  assert(typeof payload.data?.id === 'string', 'session create returned no id');
  return payload.data.id;
}

async function sendMessage(apiOrigin: string, sessionId: string, content: string): Promise<void> {
  const response = await fetch(`${apiOrigin}/api/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content, capture_memories: false }),
  });
  const payload = (await response.json()) as { data?: unknown; error?: unknown };
  assert(
    response.status === 200,
    `message failed: ${response.status} ${JSON.stringify(payload.error ?? payload)}`,
  );
}

async function generateSurface(
  apiOrigin: string,
  sessionId: string,
  intent: string,
): Promise<void> {
  const response = await fetch(`${apiOrigin}/api/sessions/${sessionId}/ui`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ intent }),
  });
  const payload = (await response.json()) as { data?: unknown; error?: unknown };
  assert(
    response.status === 201,
    `interface generation failed: ${response.status} ${JSON.stringify(payload.error ?? payload)}`,
  );
}

async function waitForLocatorCount(
  locator: { count: () => Promise<number> },
  minimum: number,
  label: string,
  timeoutMs = TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await locator.count()) >= minimum) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${minimum} ${label}.`);
}

function pngInfo(buffer: Buffer): { width: number; height: number } {
  const signature = buffer.subarray(0, 8).toString('hex');
  assert(signature === '89504e470d0a1a0a', 'output is not a PNG');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function main(): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const tempDir = await mkdtemp(join(tmpdir(), 'mml-readme-capture-'));
  const databasePath = join(tempDir, 'data', 'capture.db');
  const workspaceRoot = join(tempDir, 'workspaces');
  await mkdir(dirname(databasePath), { recursive: true });
  await mkdir(workspaceRoot, { recursive: true });

  const apiPort = await freePort();
  const webPort = await freePort();
  const webOrigin = `http://127.0.0.1:${webPort}`;
  const apiOrigin = `http://127.0.0.1:${apiPort}`;

  const config = loadConfig(
    {
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: String(apiPort),
      LOG_LEVEL: 'warn',
      DATABASE_PATH: databasePath,
      SQLITE_WAL: 'false',
      WORKSPACE_ROOT: workspaceRoot,
      CORS_ORIGINS: webOrigin,
      MODEL_PROVIDER: 'echo',
      // The echo provider has no Muse model; keep the header honest instead of
      // inheriting the Muse CLI default.
      MUSE_MODEL: 'echo-1',
      MEMORY_AUTO_CAPTURE: 'suggest',
      TOOL_APPROVAL_POLICY: 'always',
      TOOL_DECISION_MODE: 'always',
      MEMORY_SWEEP_ON_START: 'true',
    },
    ROOT,
  );

  const database = openDatabase({ path: databasePath, wal: false });
  const engine = new MemoryEngine(database.db);
  const provider = new EchoProvider({ respond: scriptedResponder });
  let app: FastifyInstance | null = null;
  let vite: ChildProcess | null = null;
  let browser: Awaited<ReturnType<typeof launchVerificationBrowser>>['browser'] | null = null;
  let viteLog = '';

  try {
    seedReadingNook(engine);
    note(`seeded ${PROJECT_ID} with active decisions and one correction`);

    app = await buildApp({
      config,
      db: database.db,
      dbPath: databasePath,
      provider,
      engine,
      startedAt: Date.now(),
    });
    await app.listen({ host: config.host, port: config.port });
    await waitForHttp(`${apiOrigin}/api/live`);
    note(`production API listening on ${apiOrigin}`);

    // Stage all three journeys through the production HTTP API before the
    // browser opens, so every capture shows one fully populated workspace.
    // The timestamps still read in the order the work happened.
    const conversationId = await createSession(apiOrigin, 'Reading Nook design review');
    const planningId = await createSession(apiOrigin, 'Reading Nook first milestone');
    const toolsId = await createSession(apiOrigin, 'Reading Nook sound pass');
    await sendMessage(
      apiOrigin,
      toolsId,
      'Create a task to add a gentle page-turn sound to Reading Nook.',
    );
    await sendMessage(apiOrigin, planningId, 'Help me plan the first milestone for Reading Nook.');
    await generateSurface(apiOrigin, planningId, 'Plan the first milestone for Reading Nook.');
    await sendMessage(
      apiOrigin,
      conversationId,
      'Which palette and safety rules should I follow for the Reading Nook?',
    );
    note('staged three conversations through the production API');

    vite = spawn(
      'pnpm',
      ['exec', 'vite', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'],
      {
        cwd: WEB_DIR,
        env: { ...process.env, VITE_PROXY_TARGET: apiOrigin },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      },
    );
    vite.stdout?.on('data', (chunk: Buffer) => {
      viteLog += chunk.toString();
    });
    vite.stderr?.on('data', (chunk: Buffer) => {
      viteLog += chunk.toString();
    });
    await waitForHttp(webOrigin, 45_000).catch((error) => {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\nVite log:\n${tail(viteLog)}`,
      );
    });
    note(`Vite client listening on ${webOrigin}`);

    const launched = await launchVerificationBrowser();
    browser = launched.browser;
    reportBrowserSelection(launched.selection);

    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      colorScheme: 'dark',
      locale: 'en-US',
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    page.setDefaultTimeout(TIMEOUT_MS);

    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      if (/Download the React DevTools/.test(text)) return;
      problems.push(`console error: ${text}`);
    });
    page.on('pageerror', (error) => {
      problems.push(`page exception: ${error.message}`);
    });
    page.on('response', (response) => {
      if (response.status() >= 400) {
        problems.push(`HTTP ${response.status()} ${response.url()}`);
      }
    });

    await page.goto(webOrigin, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
    await page.getByRole('button', { name: 'HTML Studio', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Conversations', exact: true }).waitFor();
    note('React client rendered');

    // ---------------------------------------------------------------------
    // 1. Conversation grounded in project memory
    // ---------------------------------------------------------------------
    await page.getByRole('button', { name: 'Conversations', exact: true }).click();
    await page
      .getByRole('button', { name: /Reading Nook design review/ })
      .first()
      .click();
    const composer = page.getByLabel('Message');
    await composer.waitFor();
    const memoryUsed = page.getByRole('button', { name: /Memory used/ }).first();
    await memoryUsed.waitFor({ timeout: 20_000 });
    await memoryUsed.click();
    await page
      .getByText(/score \d/)
      .first()
      .waitFor();
    await waitForLocatorCount(page.getByText(/score \d/), 2, 'memory evidence scores');

    const conversationSection = composer.locator('xpath=ancestor::section[1]');
    await conversationSection
      .locator('div.overflow-y-auto')
      .first()
      .evaluate((element) => {
        element.scrollTop = 0;
      });
    await sleep(250);

    const conversationText = (await conversationSection.textContent()) ?? '';
    assert(conversationText.includes('#4EA8DE'), 'answer did not use the ocean palette');
    assert(
      conversationText.includes('flashing effects'),
      'answer did not use the child-safety constraint',
    );
    assert(/score \d/.test(conversationText), 'memory evidence did not show scores');
    const headerText = (await page.locator('header').first().textContent()) ?? '';
    assert(
      headerText.includes('echo (offline)') && headerText.includes('echo-1'),
      'the deterministic provider is not honestly labelled in the UI',
    );
    assert(
      !headerText.includes('muse-wonder'),
      'the offline provider is still credited with a Muse model id',
    );
    await page.screenshot({
      path: join(OUTPUT_DIR, 'conversation.png'),
      animations: 'disabled',
    });
    note('conversation.png — grounded answer + expanded Memory used evidence');

    // ---------------------------------------------------------------------
    // 2. Declarative planning form
    // ---------------------------------------------------------------------
    await page
      .getByRole('button', { name: /Reading Nook first milestone/ })
      .first()
      .click();
    await page.getByLabel('Message').waitFor();

    const surface = page.getByRole('region', { name: /^Interface: Reading Nook/ });
    await surface.waitFor({ timeout: 20_000 });
    await surface.getByLabel('First milestone').fill('A playable window-seat scene');
    await surface
      .getByLabel('Target platform')
      .selectOption({ label: 'Desktop browser (1280×800)' });
    await surface.getByText('Window-seat builder', { exact: true }).click();
    await surface.getByText('Story unlock', { exact: true }).click();
    await sleep(250);
    // Bottom-align the transcript so the complete form sits above the composer
    // and the earlier user turn is cleanly out of frame.
    await page
      .getByLabel('Message')
      .locator('xpath=ancestor::section[1]')
      .locator('div.overflow-y-auto')
      .first()
      .evaluate((container) => {
        container.scrollTop = container.scrollHeight;
      });
    await sleep(250);

    const surfaceText = (await surface.textContent()) ?? '';
    assert(surfaceText.includes('Generated interface'), 'planning form is not labelled generated');
    assert(surfaceText.includes('Save plan'), 'planning form submit control is missing');
    assert(surfaceText.includes('Desktop browser'), 'planning form platform choice is missing');
    await page.screenshot({
      path: join(OUTPUT_DIR, 'planning-form.png'),
      animations: 'disabled',
    });
    note('planning-form.png — generated form with filled plan choices');

    // ---------------------------------------------------------------------
    // 3. Pending write tool awaiting explicit approval
    // ---------------------------------------------------------------------
    await page
      .getByRole('button', { name: /Reading Nook sound pass/ })
      .first()
      .click();
    await page.getByLabel('Message').waitFor();
    await page
      .getByLabel('Message')
      .locator('xpath=ancestor::section[1]')
      .locator('div.overflow-y-auto')
      .first()
      .evaluate((element) => {
        element.scrollTop = 0;
      });

    const approve = page.getByRole('button', { name: 'Approve', exact: true });
    await approve.waitFor({ timeout: 20_000 });
    await page.getByText('Tool activity', { exact: true }).waitFor();
    const toolPanel = approve.locator('xpath=ancestor::div[contains(@class,"border-t")][1]');
    await sleep(250);

    const toolText = (await toolPanel.textContent()) ?? '';
    assert(toolText.includes('pending'), 'tool call is not pending');
    assert(toolText.includes('task.create'), 'pending tool is not task.create');
    assert(
      toolText.includes('approval required'),
      'pending tool does not state approval is required',
    );
    await page.screenshot({
      path: join(OUTPUT_DIR, 'tool-approval.png'),
      animations: 'disabled',
    });
    note('tool-approval.png — pending task.create with Approve/Deny controls');

    // ---------------------------------------------------------------------
    // 4. Corrected memory detail and history
    // ---------------------------------------------------------------------
    await page.getByRole('button', { name: 'Memory', exact: true }).click();
    await page.getByLabel('Search memories').waitFor({ timeout: 10_000 });
    await page
      .getByRole('button', { name: /warm sunset palette/ })
      .first()
      .click();
    const detail = page.getByRole('region', { name: 'Memory detail' });
    await detail.waitFor();
    await page.getByText('Superseded by', { exact: true }).waitFor();
    await page
      .getByText(/Creative direction moved/)
      .first()
      .waitFor();
    const detailText = (await detail.textContent()) ?? '';
    assert(detailText.includes('superseded'), 'detail is not the corrected record');
    assert(detailText.includes('Ocean palette'), 'replacement link is missing');
    assert(detailText.includes('superseded'), 'history does not record the supersession');
    await page.screenshot({
      path: join(OUTPUT_DIR, 'memory-detail.png'),
      animations: 'disabled',
    });
    note('memory-detail.png — superseded record, replacement link, and reason');

    // ---------------------------------------------------------------------
    // 5. Forge-mode retrieval explanation
    // ---------------------------------------------------------------------
    await page.getByRole('button', { name: 'Retrieval explanation' }).click();
    const retrieval = page.getByRole('region', { name: 'Retrieval explanation' });
    await retrieval.waitFor();
    await retrieval.getByLabel('Retrieval query').fill('ocean palette and child safety');
    await retrieval.getByLabel('Retrieval mode').selectOption('forge');
    await retrieval.getByLabel('Project').selectOption(PROJECT_ID);
    // Keep the preview inside the 1600x1000 frame: two full explanation cards
    // plus the visible budget fields. The metadata still reports the third
    // candidate as excluded by the explicit count budget.
    await retrieval.getByLabel('Max memories').fill('2');
    await retrieval.getByRole('button', { name: 'Explain', exact: true }).click();
    await retrieval.getByText('candidates', { exact: true }).waitFor();
    await waitForLocatorCount(retrieval.locator('ol > li'), 2, 'retrieval result cards');

    const modeValue = await retrieval
      .getByLabel('Retrieval mode')
      .evaluate((element) => (element as HTMLSelectElement).value);
    assert(modeValue === 'forge', `retrieval mode is ${modeValue}, not forge`);
    const retrievalText = (await retrieval.textContent()) ?? '';
    assert(retrievalText.includes('candidates'), 'retrieval metadata is missing');
    assert(/excluded\s*1/.test(retrievalText), 'the excluded candidate is not reported');
    assert(retrievalText.includes('pinned'), 'Forge-pinned decisions are not marked');
    assert(/0\.\d{3}/.test(retrievalText), 'retrieval scores are missing');

    await page.getByRole('button', { name: 'Retrieval explanation' }).evaluate((element) => {
      element.scrollIntoView({ block: 'start' });
    });
    await sleep(250);
    await page.screenshot({
      path: join(OUTPUT_DIR, 'memory-retrieval.png'),
      animations: 'disabled',
    });
    note('memory-retrieval.png — Forge mode, pinned decisions, component scores');

    if (problems.length > 0) {
      throw new Error(`browser reported problems:\n${problems.join('\n')}`);
    }

    // ---------------------------------------------------------------------
    // Artifact checks
    // ---------------------------------------------------------------------
    const artifacts = [
      'conversation.png',
      'planning-form.png',
      'tool-approval.png',
      'memory-detail.png',
      'memory-retrieval.png',
    ];
    const hashes = new Map<string, string>();
    for (const name of artifacts) {
      const path = join(OUTPUT_DIR, name);
      const buffer = await readFile(path);
      const file = await stat(path);
      const info = pngInfo(buffer);
      assert(
        info.width === VIEWPORT.width && info.height === VIEWPORT.height,
        `${name} is ${info.width}x${info.height}, expected ${VIEWPORT.width}x${VIEWPORT.height}`,
      );
      assert(file.size > 25_000, `${name} is suspiciously small (${file.size} bytes)`);
      const hash = createHash('sha256').update(buffer).digest('hex');
      assert(!hashes.has(hash), `${name} is identical to ${hashes.get(hash)}`);
      hashes.set(hash, name);
      console.log(
        `  ${name} · ${info.width}x${info.height} · ${(file.size / 1024).toFixed(0)} KiB · ${hash.slice(0, 12)}`,
      );
    }
    note('all five captures are distinct, 1600x1000 PNGs');

    // The corrected decision remains the only active palette in retrieval.
    const palette = engine.retrieve({ project_id: PROJECT_ID, query: 'palette', mode: 'forge' });
    assert(
      palette.results.every((entry) => entry.memory.content !== OLD_PALETTE),
      'superseded sunset palette leaked into retrieval',
    );
    note('superseded palette is absent from active retrieval');

    console.log('\nCaptured:');
    for (const name of artifacts) console.log(`  ${join(OUTPUT_DIR, name)}`);
    console.log('\nProvider provenance: echo (deterministic offline provider, scripted responder)');
    console.log(`Database/workspace: ${tempDir} (disposable)`);
    if (process.env.KEEP_CAPTURE_DATA === '1') {
      console.log('KEEP_CAPTURE_DATA=1 — leaving the disposable run data in place.');
    }
  } finally {
    // Each teardown is independent: one failure must not strand a server, the
    // database, or the disposable workspace.
    if (browser) {
      await browser.close().catch((error: unknown) => {
        console.error(`Browser close failed: ${String(error)}`);
      });
    }
    if (vite) {
      await stopChild(vite).catch((error: unknown) => {
        console.error(`Vite stop failed: ${String(error)}`);
      });
    }
    if (app) {
      await app.close().catch((error: unknown) => {
        console.error(`API close failed: ${String(error)}`);
      });
    }
    try {
      database.close();
    } catch (error) {
      console.error(`Database close failed: ${String(error)}`);
    }
    if (process.env.KEEP_CAPTURE_DATA !== '1') {
      await rm(tempDir, { recursive: true, force: true }).catch((error: unknown) => {
        console.error(`Disposable data cleanup failed: ${String(error)}`);
      });
    }
  }
}

try {
  console.log('Capturing README surfaces…');
  await main();
  console.log('\nREADME surface capture complete.');
} catch (error) {
  console.error(`\nCapture failed: ${error instanceof Error ? error.message : String(error)}`);
  if (notes.length > 0) console.error(`Completed steps: ${notes.length}`);
  process.exitCode = 1;
}
