/**
 * Phase 12C — real-game Decision Guard evaluation.
 *
 * Runs the *production* Forge pipeline (staging → structural validation →
 * browser runtime verification → Decision Guard advisory → approval) on:
 *
 *   A. authentic Muse/Spark output with a deterministic, labelled mutation that
 *      introduces a prohibited mechanic (countdown + mistake penalty),
 *   B. authentic Muse/Spark output with no prohibited mechanic,
 *   C. authentic Muse/Spark output for a decision the deterministic engine
 *      cannot establish (colour-only cues).
 *
 * Plus a supplementary, clearly-labelled correction case over authentic Phase
 * 12A output that exercises the engine's known `0x`/`#` palette gap.
 *
 * No model call is made. The fake-Muse fixture only transports recorded bytes;
 * every validation, runtime check and approval below is the production code.
 *
 *   pnpm eval:guard
 */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { ForgeJobManager } from '../apps/server/src/forge/runner.js';
import { checkGameRuntime } from '../apps/server/src/forge/runtime-check.js';
import { ForgeError, ForgeWorkspace } from '../apps/server/src/forge/workspace.js';
import { evaluateDecisions, type GuardDecision } from '../packages/decision-guard/src/index.js';
import { MemoryEngine, openDatabase } from '../packages/memory-engine/src/index.js';
import type { DecisionGuardAdvisory, ForgeJob } from '../packages/shared/src/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE = join(ROOT, 'docs/hackathon-evidence/phase12c');
const SOURCE_DIR = join(EVIDENCE, 'sources');
const SHOT_DIR = join(EVIDENCE, 'screenshots');
const FIXTURE = join(ROOT, 'tests/fixtures/fake-muse.mjs');
const BASELINE_PATH = join(ROOT, 'demo/forge-baseline/index.html');
const PHASE12_A = join(ROOT, 'docs/hackathon-evidence/phase12/A-v2.html');
const PROMPT = 'A colourful farmyard memory game for children with twelve cards.';
const TERMINAL = ['succeeded', 'failed', 'cancelled', 'budget_exceeded', 'rejected'];

const CHILD_DECISION = {
  id: 'c0c0c0c0-0000-4000-8000-000000000001',
  content:
    'This children’s game must avoid flashing effects, countdown timers, and penalties for mistakes.',
};
const A11Y_DECISION = {
  id: 'c0c0c0c0-0000-4000-8000-000000000002',
  content: 'All essential game actions must remain usable without colour discrimination.',
};
// Phase 12A pilot decisions (content verbatim from apps/server/data/phase12.db).
const SUNSET_DECISION =
  'Art direction: maintain a warm sunset palette. Use #FF7E5F as the primary accent and #2D1E2F for dark text. Avoid aggressive neon colours.';
const OCEAN_DECISION =
  'Art direction: use a cool ocean palette. Primary accent #4EA8DE and dark text #102A43.';

interface CaseDefinition {
  id: string;
  category: 'A' | 'B' | 'C' | 'supplementary';
  label: string;
  sourcePath: string;
  sourceName: string;
  origin: string;
  decisionFixture: 'child' | 'a11y' | 'ocean-correction';
  notes: string[];
  mutation?: MutationRecord;
}

interface MutationRecord {
  applied_to: string;
  replacements: Array<{ find: string; replace: string }>;
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Deterministic, clearly-labelled mutation of authentic Muse output. */
function mutateBaseline(source: string): { source: string; mutation: MutationRecord } {
  const replacements = [
    {
      find: 'var moves = 0, matches = 0;',
      replace: 'var moves = 0, matches = 0, score = 100, timeLeft = 30;',
    },
    {
      find: '  function create() {\n    var s = this;',
      replace:
        '  function create() {\n    var s = this;\n    // PHASE 12C TEST MUTATION: prohibited countdown mechanic.\n    setInterval(function () { timeLeft -= 1; if (timeLeft < 0) { timeLeft = 0; } hudMsg.setText("Time: " + timeLeft); }, 1000);',
    },
    {
      find: '      hudMsg.setText("Try again! \\u{1F340}");',
      replace:
        '      // PHASE 12C TEST MUTATION: prohibited mistake penalty.\n      score -= 1;\n      hudMsg.setText("Try again! \\u{1F340}  Score: " + score);',
    },
  ];
  let mutated = source;
  for (const replacement of replacements) {
    if (!mutated.includes(replacement.find)) {
      throw new Error(`mutation anchor not found: ${replacement.find.slice(0, 60)}`);
    }
    mutated = mutated.replace(replacement.find, replacement.replace);
  }
  const banner =
    '<!-- PHASE 12C TEST MUTATION — NOT SPONTANEOUS MUSE OUTPUT. Deterministic edit of the recorded Phase 11 Spark baseline; introduces a prohibited time-limit mechanic and a mistake deduction so Decision Guard has a known violation to detect. -->\n';
  const doctype = '<!DOCTYPE html>\n';
  mutated = mutated.startsWith(doctype)
    ? `${doctype}${banner}${mutated.slice(doctype.length)}`
    : `${banner}${mutated}`;
  return {
    source: mutated,
    mutation: { applied_to: 'demo/forge-baseline/index.html', replacements },
  };
}

function decisionMemory(engine: MemoryEngine, projectId: string, content: string) {
  return engine.create({
    type: 'constraint',
    scope: 'project',
    project_id: projectId,
    content,
    source: { session_id: null, reference: 'phase12c-evaluation' },
    confidence: 0.95,
    validation_status: 'verified',
    tags: ['phase12c'],
  }).memory;
}

function decide(
  engine: MemoryEngine,
  projectId: string,
  fixture: CaseDefinition['decisionFixture'],
): { decisions: Array<{ memory_id: string; content: string; role: string }> } {
  if (fixture === 'ocean-correction') {
    const sunset = decisionMemory(engine, projectId, SUNSET_DECISION);
    const ocean = engine.correct({
      type: 'constraint',
      scope: 'project',
      project_id: projectId,
      content: OCEAN_DECISION,
      source: { session_id: null, reference: 'phase12a-pilot-correction' },
      confidence: 0.95,
      validation_status: 'verified',
      tags: ['phase12c'],
      supersedes: [sunset.id],
    }).memory;
    return {
      decisions: [
        { memory_id: ocean.id, content: OCEAN_DECISION, role: 'active (corrected)' },
        { memory_id: sunset.id, content: SUNSET_DECISION, role: 'superseded history' },
      ],
    };
  }
  const chosen = fixture === 'child' ? CHILD_DECISION : A11Y_DECISION;
  const memory = decisionMemory(engine, projectId, chosen.content);
  return {
    decisions: [{ memory_id: memory.id, content: chosen.content, role: 'active' }],
  };
}

async function waitForTerminal(manager: ForgeJobManager, jobId: string): Promise<ForgeJob> {
  for (let attempt = 0; attempt < 1_200; attempt += 1) {
    const job = manager.get(jobId);
    if (!job) throw new Error('job disappeared');
    if (TERMINAL.includes(job.status)) return job;
    await delay(25);
  }
  throw new Error('job did not finish');
}

async function screenshot(html: string, path: string): Promise<void> {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
    await page.waitForTimeout(1_400);
    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();
    if (box) {
      // Dismiss the canvas-drawn start overlay (centre, ~66% down).
      await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.66);
      await page.waitForTimeout(500);
    }
    await page.screenshot({ path });
  } finally {
    await browser.close();
  }
}

interface CaseResult {
  id: string;
  category: string;
  label: string;
  origin: string;
  source: { path: string; sha256: string; bytes: number };
  mutation: MutationRecord | null;
  decisions: Array<{ memory_id: string; content: string; role: string }>;
  memory_ids: string[];
  prompt_sha256: string | null;
  structural_validation: { ok: boolean; issues: string[] } | null;
  runtime: { ok: boolean; canvas: boolean; errors: string[] } | null;
  review_guard: DecisionGuardAdvisory | null;
  guard: DecisionGuardAdvisory | null;
  approval: { ok: boolean; version?: number | null; error?: string; issues?: string[] };
  project_state: { current_version: number | null; can_rollback: boolean };
  screenshot: string | null;
  observations: string[];
  notes: string[];
}

async function runCase(definition: CaseDefinition): Promise<CaseResult> {
  const source = await readFile(definition.sourcePath, 'utf8');
  const root = await mkdtemp(join(tmpdir(), 'phase12c-guard-'));
  const database = openDatabase({ path: join(root, 'eval.sqlite'), wal: false });
  const engine = new MemoryEngine(database.db);
  const workspace = new ForgeWorkspace(root);
  const projectId = `phase12c-${definition.id.toLowerCase()}`;
  const stagedPath = join(root, 'source.html');
  await writeFile(stagedPath, source, 'utf8');
  engine.ensureProject(projectId, projectId);
  await workspace.ensureProject(projectId);
  const { decisions } = decide(engine, projectId, definition.decisionFixture);

  let runtime: { ok: boolean; canvas: boolean; errors: string[] } | null = null;
  const manager = new ForgeJobManager({
    workspace,
    engine,
    museBin: FIXTURE,
    env: { FAKE_MUSE_MODE: 'copy', FAKE_MUSE_HTML: stagedPath },
    maxRuntimeMs: 60_000,
    maxCalls: 10,
    maxInputTokens: 10_000_000,
    reasoningEffort: 'low',
    runtimeCheck: async (html) => {
      runtime = await checkGameRuntime(html);
      return runtime;
    },
    now: () => new Date(),
  });

  try {
    const job = await manager.start({ projectId, kind: 'generate', prompt: PROMPT });
    const finished = await waitForTerminal(manager, job.id);
    if (finished.status !== 'succeeded') {
      throw new Error(
        `case ${definition.id}: generation ended ${finished.status}: ${finished.error}`,
      );
    }
    const reviewGuard = finished.decision_guard;

    const approval: CaseResult['approval'] = { ok: false };
    try {
      const applied = await manager.approve(job.id, { captureMemory: false });
      approval.ok = true;
      approval.version = applied.job.version;
    } catch (error) {
      if (error instanceof ForgeError) {
        approval.error = error.code;
        approval.issues = error.details;
      } else {
        approval.error = (error as Error).message;
      }
    }

    const state = await workspace.state(projectId);
    const shotPath = join(SHOT_DIR, `${definition.id}.png`);
    await screenshot(source, shotPath);

    // The approval-time snapshot is authoritative; it is recomputed after the
    // blocking runtime check passed.
    const guard = manager.get(job.id)?.decision_guard ?? reviewGuard;
    const observations: string[] = [];
    if (guard) {
      observations.push(`guard engine_verdict=${guard.engine_verdict}`);
      observations.push(
        `${guard.findings.length} detection finding(s), ${guard.unverified.length} unverified entr(ies)`,
      );
      observations.push(`runtime_verified_in_final_snapshot=${String(guard.runtime_verified)}`);
      if (guard.engine_verdict === 'BLOCK' && approval.ok) {
        observations.push('advisory findings did not block approval (expected in Phase 12C)');
      }
      if (guard.unverified.length > 0) {
        observations.push('no overall PASS is claimed: at least one constraint is unverified');
      }
    }

    const relativeSource = relative(ROOT, join(SOURCE_DIR, definition.sourceName));
    return {
      id: definition.id,
      category: definition.category,
      label: definition.label,
      origin: definition.origin,
      source: {
        path: relativeSource,
        sha256: sha256(source),
        bytes: Buffer.byteLength(source, 'utf8'),
      },
      mutation: definition.mutation ?? null,
      decisions,
      memory_ids: finished.memory_ids,
      prompt_sha256: finished.prompt_sha256 ?? null,
      structural_validation: finished.validation,
      runtime,
      review_guard: reviewGuard,
      guard,
      approval,
      project_state: { current_version: state.current_version, can_rollback: state.can_rollback },
      screenshot: relative(ROOT, shotPath),
      observations,
      notes: definition.notes,
    };
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  await mkdir(SOURCE_DIR, { recursive: true });
  await mkdir(SHOT_DIR, { recursive: true });

  const baseline = await readFile(BASELINE_PATH, 'utf8');
  const mutated = mutateBaseline(baseline);
  const authenticPhase12A = await readFile(PHASE12_A, 'utf8');

  await writeFile(join(SOURCE_DIR, 'A-violation-mutation.html'), mutated.source, 'utf8');
  await writeFile(join(SOURCE_DIR, 'B-compliant-baseline.html'), baseline, 'utf8');
  await writeFile(join(SOURCE_DIR, 'supplementary-A-v2-authentic.html'), authenticPhase12A, 'utf8');

  const cases: CaseDefinition[] = [
    {
      id: 'A-violation',
      category: 'A',
      label: 'Known violation — controlled test mutation (countdown + mistake penalty)',
      sourcePath: join(SOURCE_DIR, 'A-violation-mutation.html'),
      sourceName: 'A-violation-mutation.html',
      origin:
        'Deterministic mutation of the recorded real Spark baseline (demo/forge-baseline/index.html); NOT spontaneous Muse output.',
      decisionFixture: 'child',
      notes: [
        'Mutation is labelled in-file and reproduced in evaluation.json.',
        'The added mechanic is valid JavaScript, so runtime verification is expected to pass.',
      ],
      mutation: mutated.mutation,
    },
    {
      id: 'B-compliant',
      category: 'B',
      label: 'Known compliant — authentic recorded Spark baseline',
      sourcePath: BASELINE_PATH,
      sourceName: 'B-compliant-baseline.html',
      origin:
        'Recorded real Spark generation (demo/forge-baseline/index.html, sha256 79c9d67a…9ba9e41).',
      decisionFixture: 'child',
      notes: ['No countdown, flashing loop or mistake penalty is present.'],
    },
    {
      id: 'C-ambiguous',
      category: 'C',
      label: 'Ambiguous — authentic baseline against a colour-discrimination decision',
      sourcePath: BASELINE_PATH,
      sourceName: 'B-compliant-baseline.html',
      origin: 'Same authentic baseline; the decision is not deterministically checkable here.',
      decisionFixture: 'a11y',
      notes: [
        'The engine looks for an evaluable red/green pair; the baseline has neither, so compliance cannot be established.',
        'Expected and observed: UNVERIFIED, never PASS.',
      ],
    },
    {
      id: 'supplementary-palette-correction',
      category: 'supplementary',
      label: 'Known false negative — authentic Phase 12A output vs an ocean correction',
      sourcePath: join(SOURCE_DIR, 'supplementary-A-v2-authentic.html'),
      sourceName: 'supplementary-A-v2-authentic.html',
      origin:
        'Authentic Phase 12A condition-A output (docs/hackathon-evidence/phase12/A-v2.html) — generated under the sunset decision, evaluated retrospectively against the later ocean correction.',
      decisionFixture: 'ocean-correction',
      notes: [
        'A-v2 encodes the sunset accent as 0xFF7E5F; the decision uses #FF7E5F.',
        'Rule superseded-palette compares hex literals without normalising 0x/# — a documented engine gap requested for Strata review, not patched here.',
        'Expected: UNVERIFIED (cannot see the forbidden accent), not a false BLOCK.',
      ],
    },
  ];

  const results: CaseResult[] = [];
  for (const definition of cases) {
    process.stdout.write(`→ ${definition.id} … `);
    const result = await runCase(definition);
    results.push(result);
    process.stdout.write(
      `${result.guard?.engine_verdict ?? 'no guard'} / approval ${result.approval.ok ? 'approved' : (result.approval.error ?? 'failed')}\n`,
    );
  }

  const childGuard: GuardDecision = {
    id: CHILD_DECISION.id,
    content: CHILD_DECISION.content,
    status: 'active',
    supersedes: [],
  };
  const oceanGuard: GuardDecision = {
    id: 'aceff9cf-0f0a-4cdf-9465-39e98ba8d423',
    content: OCEAN_DECISION,
    status: 'active',
    supersedes: ['8de86811-dbe3-478d-92bd-9de56af53e60'],
  };
  const sunsetGuard: GuardDecision = {
    id: '8de86811-dbe3-478d-92bd-9de56af53e60',
    content: SUNSET_DECISION,
    status: 'superseded',
    supersedes: [],
  };
  const PHASER =
    '<script src="https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js"></script>';
  const engineProbes = [
    {
      id: 'probe-comment-countdown',
      kind: 'false_positive',
      description:
        'A prose comment containing the literal word "countdown" is reported as a violation.',
      source: `${PHASER}<p>This game has no countdown and no timer.</p>`,
      expected: 'BLOCK (expected false positive)',
      result: evaluateDecisions(
        [childGuard],
        `${PHASER}<p>This game has no countdown and no timer.</p>`,
      ),
    },
    {
      id: 'probe-tween-pulse',
      kind: 'false_negative',
      description:
        'A repeating alpha tween (yoyo + repeat: -1) pulses the banner but is not detected as flashing.',
      source: `${PHASER}<script>this.tweens.add({targets: banner, alpha: 0, yoyo: true, repeat: -1, duration: 120});</script>`,
      expected: 'PASS on flashing-effects (known false negative)',
      result: evaluateDecisions(
        [childGuard],
        `${PHASER}<script>this.tweens.add({targets: banner, alpha: 0, yoyo: true, repeat: -1, duration: 120});</script>`,
      ),
    },
    {
      id: 'probe-phaser-hex-encoding',
      kind: 'false_negative',
      description:
        'Phaser writes colours as 0xRRGGBB; a decision using #RRGGBB is not recognised, so a reintroduced sunset accent is UNVERIFIED rather than a finding.',
      source: `${PHASER}<script>g.fillStyle(0xFF7E5F, 1);</script>`,
      expected: 'UNVERIFIED on superseded-palette (known false negative)',
      result: evaluateDecisions(
        [oceanGuard],
        `${PHASER}<script>g.fillStyle(0xFF7E5F, 1);</script>`,
        { supersededDecisions: [sunsetGuard] },
      ),
    },
  ].map((probe) => ({
    id: probe.id,
    kind: probe.kind,
    description: probe.description,
    source_sha256: sha256(probe.source),
    expected: probe.expected,
    observed: probe.result.verdict,
    rules: probe.result.evaluations.map((evaluation) => ({
      rule: evaluation.rule,
      verdict: evaluation.verdict,
      reason: evaluation.reason,
    })),
    evidence: probe.result.findings[0]?.evidence ?? null,
  }));

  const payload = {
    phase: '12C',
    title: 'Decision Guard advisory — real-game evaluation',
    generated_at: new Date().toISOString(),
    guard_mode: 'advisory',
    engine: { package: '@mml/decision-guard', version: results[0]?.guard?.engine_version ?? null },
    model_calls: 0,
    transport:
      'tests/fixtures/fake-muse.mjs copy mode moves recorded/controlled bytes into staging; every validation, runtime check and approval is production code',
    prompt: PROMPT,
    prompt_sha256: sha256(PROMPT),
    cases: results,
    engine_probes: engineProbes,
    known_false_positives: engineProbes
      .filter((probe) => probe.kind === 'false_positive')
      .map((probe) => probe.description),
    known_false_negatives: engineProbes
      .filter((probe) => probe.kind === 'false_negative')
      .map((probe) => probe.description),
    summary: {
      a_violation_detected: results
        .find((entry) => entry.category === 'A')
        ?.guard?.findings.some((finding) => finding.rule === 'countdown-mechanics'),
      a_runtime_passed: results.find((entry) => entry.category === 'A')?.runtime?.ok ?? false,
      b_no_blocking_finding:
        (results.find((entry) => entry.category === 'B')?.guard?.findings.length ?? -1) === 0,
      b_approved: results.find((entry) => entry.category === 'B')?.approval.ok ?? false,
      c_unverified:
        results.find((entry) => entry.category === 'C')?.guard?.engine_verdict === 'UNVERIFIED',
      advisory_never_blocked:
        results.find((entry) => entry.category === 'A')?.approval.ok === true &&
        results.find((entry) => entry.category === 'A')?.guard?.engine_verdict === 'BLOCK',
    },
  };
  await writeFile(
    join(EVIDENCE, 'evaluation.json'),
    `${JSON.stringify(payload, null, 2)}\n`,
    'utf8',
  );
  console.log(`\nEvidence written to ${relative(ROOT, EVIDENCE)}`);
}

await main();
