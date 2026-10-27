/**
 * Phase 14A — deterministic demo rehearsal and evidence capture.
 *
 * Runs the *production* Forge pipeline (staging → structural validation →
 * headless-Chrome runtime verification → Decision Guard advisory → approval →
 * rollback) against:
 *
 *   1. a labelled deterministic mutation of authentic Muse/Spark source, which
 *      is rejected (never approved) during the demonstration,
 *   2. the recorded authentic Phase 12A condition-C modification, which is
 *      approved and then rolled back.
 *
 * Also reproduces the director's rollback-ancestry regression against the real
 * workspace, verifies the demo seed (including idempotence), and writes the
 * memory-influence presentation from the authentic Phase 12A pilot record.
 *
 *   pnpm evidence:phase14a
 *
 * No live Muse call is made. The fake-Muse fixture only transports recorded
 * bytes; validation, runtime verification, the advisory and promotion are the
 * production code paths.
 */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright-core';
import { ForgeJobManager } from '../apps/server/src/forge/runner.js';
import { checkGameRuntime } from '../apps/server/src/forge/runtime-check.js';
import { ForgeError, ForgeWorkspace } from '../apps/server/src/forge/workspace.js';
import { MemoryEngine, openDatabase } from '../packages/memory-engine/src/index.js';
import type { ForgeJob } from '../packages/shared/src/index.js';
import {
  CHILD_SAFETY_DECISION,
  OCEAN_DECISION,
  SUNSET_DECISION,
  seedForgeDemo,
} from './lib/demo-seed.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE = join(ROOT, 'docs/hackathon-evidence/phase14a');
const SHOTS = join(EVIDENCE, 'screenshots');
const FIXTURE = join(ROOT, 'tests/fixtures/fake-muse.mjs');
const BASELINE = join(ROOT, 'demo/forge-baseline/index.html');
const MUTATION = join(ROOT, 'docs/hackathon-evidence/phase12e/sources/A-violation-mutation.html');
const AUTHENTIC_C = join(ROOT, 'docs/hackathon-evidence/phase12/C-v2.html');
const PILOT = join(ROOT, 'docs/hackathon-evidence/phase12/pilot.json');
const REQUEST = 'Add a Next Level button beneath the Restart button.';
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'budget_exceeded', 'rejected']);

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForJob(manager: ForgeJobManager, id: string): Promise<ForgeJob> {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const job = manager.get(id);
    if (!job) throw new Error(`job ${id} disappeared`);
    if (TERMINAL.has(job.status)) return job;
    await delay(100);
  }
  throw new Error(`job ${id} did not finish`);
}

function managerFor(workspace: ForgeWorkspace, engine: MemoryEngine, htmlPath: string) {
  return new ForgeJobManager({
    workspace,
    engine,
    museBin: FIXTURE,
    env: { FAKE_MUSE_MODE: 'copy', FAKE_MUSE_HTML: htmlPath },
    maxRuntimeMs: 120_000,
    maxCalls: 25,
    maxInputTokens: 1_500_000,
    reasoningEffort: 'low',
    runtimeCheck: checkGameRuntime,
  });
}

function guardDigest(job: ForgeJob) {
  const advisory = job.decision_guard;
  return {
    assessment: advisory?.assessment ?? null,
    assessment_reason: advisory?.assessment_reason ?? null,
    engine_version: advisory?.engine_version ?? null,
    runtime_verified: advisory?.runtime_verified ?? null,
    finding_count: advisory?.findings.length ?? 0,
    unverified_count: advisory?.unverified.length ?? 0,
    findings:
      advisory?.findings.map((finding) => ({
        rule: finding.rule,
        severity: finding.severity,
        decision_id: finding.decision_id,
        decision_ref: finding.decision_ref,
        evidence: finding.evidence,
        explanation: finding.explanation,
      })) ?? [],
    evaluated_memory_ids: advisory?.evaluated_memory_ids ?? [],
    superseded_memory_ids: advisory?.superseded_memory_ids ?? [],
    source_sha256: advisory?.source_sha256 ?? null,
  };
}

async function renderGame(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  html: string,
  path: string,
): Promise<void> {
  const page: Page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  try {
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
    await page.locator('canvas').waitFor({ timeout: 20_000 });
    await page.waitForTimeout(1_200);
    await page.screenshot({ path });
  } finally {
    await page.close();
  }
}

async function main(): Promise<void> {
  await mkdir(SHOTS, { recursive: true });
  const mutationSource = await readFile(MUTATION, 'utf8');
  if (!mutationSource.includes('PHASE 12C TEST MUTATION — NOT SPONTANEOUS MUSE OUTPUT')) {
    throw new Error('the mutation source is missing its provenance label');
  }

  const root = await mkdtemp(join(tmpdir(), 'phase14a-rehearsal-'));
  const databasePath = join(root, 'demo.db');
  const workspaceRoot = join(root, 'workspaces');

  try {
    // -- Seed, twice, to prove idempotence -------------------------------
    const firstSeed = await seedForgeDemo({ workspaceRoot, databasePath });
    const stateAfterFirst = await readFile(join(firstSeed.workspaceDir, 'state.json'), 'utf8');
    const secondSeed = await seedForgeDemo({ workspaceRoot, databasePath });
    const stateAfterSecond = await readFile(join(secondSeed.workspaceDir, 'state.json'), 'utf8');

    const database = openDatabase({ path: databasePath, wal: false });
    const engine = new MemoryEngine(database.db);
    try {
      const all = engine.list({
        project_id: firstSeed.projectId,
        status: ['active', 'superseded'],
        limit: 200,
      });
      const retrieval = engine.retrieve({
        project_id: firstSeed.projectId,
        query: 'palette accent art direction',
        budget: { max_memories: 6, max_characters: 3_000 },
      });
      const seedEvidence = {
        project_id: firstSeed.projectId,
        database: 'temporary file (removed after the run)',
        workspace_dir: 'temporary workspace (removed after the run)',
        baseline_sha256: firstSeed.baselineSha256,
        version: firstSeed.version,
        memory_count: all.total,
        memories: all.items.map((memory) => ({
          id: memory.id,
          type: memory.type,
          scope: memory.scope,
          project_id: memory.project_id,
          status: memory.status,
          validation_status: memory.validation_status,
          superseded_by: memory.superseded_by,
          content: memory.content,
        })),
        retrieval_ids: retrieval.results.map((result) => result.memory.id),
        retrieval_excludes_superseded:
          !retrieval.results.some(
            (result) => result.memory.id === firstSeed.supersededPalette.id,
          ) && retrieval.results.some((result) => result.memory.id === firstSeed.activePalette.id),
        idempotent: {
          second_run_created: secondSeed.created,
          same_memory_ids:
            secondSeed.constraint.id === firstSeed.constraint.id &&
            secondSeed.activePalette.id === firstSeed.activePalette.id &&
            secondSeed.supersededPalette.id === firstSeed.supersededPalette.id,
          memory_count_after_second_seed: engine.list({
            project_id: firstSeed.projectId,
            status: ['active', 'superseded'],
            limit: 200,
          }).total,
          state_json_identical: stateAfterFirst === stateAfterSecond,
        },
        expected: {
          child_safety: CHILD_SAFETY_DECISION,
          sunset_superseded: SUNSET_DECISION,
          ocean_active: OCEAN_DECISION,
        },
      };

      if (!seedEvidence.retrieval_excludes_superseded) {
        throw new Error('seeded retrieval returned the superseded palette');
      }
      if (seedEvidence.memory_count !== 3 || !seedEvidence.idempotent.state_json_identical) {
        throw new Error('demo seed is not deterministic');
      }
      await writeFile(
        join(EVIDENCE, 'demo-seed.json'),
        `${JSON.stringify(seedEvidence, null, 2)}\n`,
        'utf8',
      );

      // -- Director reproduction: rollback ancestry ----------------------
      const workspace = new ForgeWorkspace(workspaceRoot);
      const ancestryProject = 'rollback-regression';
      await workspace.ensureProject(ancestryProject);
      const baseline = await readFile(BASELINE, 'utf8');
      const variants = {
        1: baseline,
        2: `${baseline}\n<!-- ancestry probe: v2 -->\n`,
        3: `${baseline}\n<!-- ancestry probe: v3 -->\n`,
      };
      const jobIds: Record<number, string> = {
        1: '10000000-0000-4000-8000-000000000001',
        2: '10000000-0000-4000-8000-000000000002',
        3: '10000000-0000-4000-8000-000000000003',
      };
      const promote = async (version: 1 | 2 | 3, base: number | null) => {
        const id = jobIds[version] as string;
        const staging = await workspace.createStaging(ancestryProject, id);
        await writeFile(join(staging, 'index.html'), variants[version], 'utf8');
        const result = await workspace.promote(ancestryProject, id, `ancestry v${version}`, {
          baseVersion: base,
          jobId: id,
        });
        return result.version;
      };

      await promote(1, null);
      await promote(2, 1);
      const undoV2 = await workspace.rollback(ancestryProject);
      await promote(3, 1);
      const beforeFix = await workspace.state(ancestryProject);
      const undoV3 = await workspace.rollback(ancestryProject);
      let repeated: string;
      try {
        await workspace.rollback(ancestryProject);
        repeated = 'unexpectedly_succeeded';
      } catch (error) {
        repeated = error instanceof ForgeError ? error.code : 'unexpected_error';
      }
      const ancestry = {
        scenario: [
          'approve v1',
          'approve v2 from v1',
          'undo v2 -> v1',
          'approve v3 from v1',
          'undo v3 -> must restore v1 (not the v2 array neighbour)',
          'undo again -> nothing to roll back',
        ],
        versions: beforeFix.versions.map((entry) => ({
          version: entry.version,
          base_version: entry.base_version ?? null,
          sha256: entry.sha256 ?? null,
        })),
        undo_v2: undoV2,
        approved_v3_from: 1,
        restored_by_undo_v3: undoV3.version,
        expected_restore: 1,
        can_rollback_before_undo: beforeFix.can_rollback,
        can_rollback_after_undo: (await workspace.state(ancestryProject)).can_rollback,
        repeated_undo: repeated,
        pass: undoV3.version === 1 && repeated === 'nothing_to_rollback',
      };
      if (!ancestry.pass) throw new Error('rollback ancestry regression did not pass');
      await writeFile(
        join(EVIDENCE, 'rollback-ancestry.json'),
        `${JSON.stringify(ancestry, null, 2)}\n`,
        'utf8',
      );

      // -- Demonstration: labelled mutation, then authentic C -----------
      const mutationManager = managerFor(workspace, engine, MUTATION);
      const mutationJob = await mutationManager.start({
        projectId: firstSeed.projectId,
        kind: 'modify',
        prompt: REQUEST,
        request: REQUEST,
      });
      const mutationFinished = await waitForJob(mutationManager, mutationJob.id);
      if (mutationFinished.status !== 'succeeded') {
        throw new Error(`mutation rehearsal job failed: ${mutationFinished.status}`);
      }
      const mutationGuard = guardDigest(mutationFinished);
      const citesChild = mutationGuard.findings.some(
        (finding) => finding.decision_id === firstSeed.constraint.id,
      );
      if (!citesChild) throw new Error('guard did not cite the child-safety decision');
      await mutationManager.reject(mutationFinished.id);
      const stateAfterReject = await workspace.state(firstSeed.projectId);

      const authenticManager = managerFor(workspace, engine, AUTHENTIC_C);
      const authenticJob = await authenticManager.start({
        projectId: firstSeed.projectId,
        kind: 'modify',
        prompt: REQUEST,
        request: REQUEST,
      });
      const authenticFinished = await waitForJob(authenticManager, authenticJob.id);
      if (authenticFinished.status !== 'succeeded') {
        throw new Error(`authentic rehearsal job failed: ${authenticFinished.status}`);
      }
      const authenticReviewGuard = guardDigest(authenticFinished);
      const diff = await authenticManager.diff(authenticFinished.id);

      const approval = await authenticManager.approve(authenticFinished.id, {
        captureMemory: false,
      });
      const authenticGuard = guardDigest(approval.job);
      const approvedHtml = await workspace.currentHtml(firstSeed.projectId);
      if (!approvedHtml) throw new Error('approved version could not be read');
      const rollback = await authenticManager.rollback(firstSeed.projectId);
      const v1Html = await workspace.currentHtml(firstSeed.projectId);

      const browser = await chromium.launch({ channel: 'chrome', headless: true });
      try {
        await renderGame(browser, baseline, join(SHOTS, 'render-v1-baseline.png'));
        await renderGame(browser, approvedHtml, join(SHOTS, 'render-v2-authentic-c.png'));
      } finally {
        await browser.close();
      }

      const demoRun = {
        request: REQUEST,
        mutation: {
          label:
            'deterministic labelled mutation of authentic source (Phase 12C/12E), not model output',
          source: relative(ROOT, MUTATION),
          source_sha256: sha256(mutationSource),
          job_id: mutationFinished.id,
          status: mutationFinished.status,
          base_version: mutationFinished.base_version,
          prompt_sha256: mutationFinished.prompt_sha256 ?? null,
          memory_ids: mutationFinished.memory_ids,
          validation: mutationFinished.validation,
          decision_guard: mutationGuard,
          cites_child_safety_decision: citesChild,
          rejected: true,
          approved: false,
          state_after_reject: {
            current_version: stateAfterReject.current_version,
            can_rollback: stateAfterReject.can_rollback,
          },
        },
        authentic: {
          label:
            'recorded authentic Muse/Spark output — Phase 12A condition C (corrected ocean memory), transported by the fake-Muse fixture',
          source: relative(ROOT, AUTHENTIC_C),
          source_sha256: sha256(await readFile(AUTHENTIC_C, 'utf8')),
          job_id: authenticFinished.id,
          status: authenticFinished.status,
          base_version: authenticFinished.base_version,
          prompt_sha256: authenticFinished.prompt_sha256 ?? null,
          memory_ids: authenticFinished.memory_ids,
          validation: authenticFinished.validation,
          decision_guard: authenticGuard,
          diff_summary: diff.summary,
          diff_line_count: diff.files[0]?.diff.split('\n').length ?? 0,
          approved_version: approval.job.version,
          approved_sha256: approval.job.decision_guard?.source_sha256 ?? null,
          approval_guard: authenticGuard,
          review_guard_finding_count: authenticReviewGuard.finding_count,
          rollback_state: rollback,
          rolled_back_to_v1: v1Html === baseline,
        },
      };

      if (rollback.current_version !== 1 || !demoRun.authentic.rolled_back_to_v1) {
        throw new Error('authentic approval/rollback rehearsal failed');
      }
      if (authenticReviewGuard.finding_count > 0) {
        // Not fatal — but the rehearsal script is the demo guarantee, so fail
        // loudly rather than present a finding-bearing build as the clean case.
        throw new Error('the authentic compliant case unexpectedly produced guard findings');
      }

      await writeFile(
        join(EVIDENCE, 'guard-advisory.json'),
        `${JSON.stringify(
          {
            mode: 'advisory',
            approval_never_blocked: true,
            mutation: demoRun.mutation,
            authentic: demoRun.authentic,
          },
          null,
          2,
        )}\n`,
        'utf8',
      );

      // -- Memory-influence presentation (authentic Phase 12A) ----------
      const pilot = JSON.parse(await readFile(PILOT, 'utf8')) as {
        conditions: Array<Record<string, unknown>>;
        request: string;
        request_sha256: string;
        baseline_sha256: string;
        model: string;
      };
      const byCondition = new Map(
        pilot.conditions.map((condition) => [String(condition.condition), condition]),
      );
      const conditionDigest = (name: 'A' | 'B' | 'C') => {
        const condition = byCondition.get(name);
        if (!condition) throw new Error(`pilot is missing condition ${name}`);
        const visible = condition.rendered_palette_visible as {
          accent_pct: number;
          dark_pct: number;
        };
        const source = (condition.source_palette_v2 ?? {}) as Record<string, number>;
        return {
          condition: name,
          project: condition.project,
          job_id: condition.job_id,
          memory_ids: condition.memory_ids,
          prompt_sha256: condition.prompt_sha256,
          prompt_reconstructed_sha256: condition.prompt_reconstructed_sha256,
          prompt_matches_job: condition.prompt_matches_job,
          source_palette: source,
          rendered_accent_pct: visible.accent_pct,
          rendered_dark_pct: visible.dark_pct,
          screenshot: `../phase12/${name}-v2-visible.png`,
        };
      };
      const influence = {
        provenance: {
          kind: 'authentic model output',
          phase: '12A',
          model: pilot.model,
          note: 'One controlled A/B/C trial, run once per condition. Not repeated, not extrapolated.',
          request: pilot.request,
          request_sha256: pilot.request_sha256,
          baseline_sha256: pilot.baseline_sha256,
          recorded_memory_row_source: 'apps/server/data/phase12.db (read-only verification)',
        },
        memories: {
          sunset: {
            id: '8de86811-dbe3-478d-92bd-9de56af53e60',
            status: 'superseded',
            content: SUNSET_DECISION,
            accent: '0xFF7E5F',
            dark_text: '#2D1E2F',
          },
          ocean: {
            id: 'aceff9cf-0f0a-4cdf-9465-39e98ba8d423',
            status: 'active',
            content: OCEAN_DECISION,
            accent: '0x4EA8DE',
            dark_text: '#102A43',
          },
        },
        conditions: [conditionDigest('A'), conditionDigest('B'), conditionDigest('C')],
        interpretation: [
          'A (sunset decision active): the rendered game contains the sunset accent 0xFF7E5F at 1.082% visible coverage.',
          'B (no memory): neither palette accent appears; 0.005% is background noise.',
          'C (sunset superseded by ocean): the ocean accent 0x4EA8DE appears at 0.879% visible coverage and the source contains no sunset hex.',
          'The remembered text colour was not applied in A or C; this is a partial palette result, not full constraint adherence.',
        ],
        limits: [
          'n = 1 per condition; exploratory, not statistically significant.',
          'Single palette vocabulary; the only measured causal claim is palette accent selection.',
        ],
      };
      await writeFile(
        join(EVIDENCE, 'memory-influence.json'),
        `${JSON.stringify(influence, null, 2)}\n`,
        'utf8',
      );
      await writeFile(
        join(EVIDENCE, 'memory-influence.html'),
        memoryInfluenceHtml(influence),
        'utf8',
      );
      await writeFile(
        join(EVIDENCE, 'memory-influence.md'),
        memoryInfluenceMarkdown(influence),
        'utf8',
      );

      // -- Rehearsal record ---------------------------------------------
      const rehearsal = {
        generated_at: new Date().toISOString(),
        environment: {
          node: process.version,
          platform: `${process.platform} ${process.arch}`,
          chrome_channel: 'chrome',
        },
        live_muse_calls: 0,
        recorded_source_transport: 'tests/fixtures/fake-muse.mjs (FAKE_MUSE_MODE=copy)',
        baseline: {
          repository: 'sidonsoft/muse-recall',
          phase12e_branch: 'agent/phase12e-release-hardening',
          phase12e_sha: '156c65c9a55833e00f6764f4fee20d93eec17e49',
          phase14a_branch: 'agent/phase14a-demo-production',
          baseline_sha256: firstSeed.baselineSha256,
          baseline_path: 'demo/forge-baseline/index.html',
        },
        seed: {
          project_id: firstSeed.projectId,
          memory_count: seedEvidence.memory_count,
          idempotent: seedEvidence.idempotent,
          retrieval_excludes_superseded: seedEvidence.retrieval_excludes_superseded,
        },
        rollback_ancestry: ancestry,
        demonstration: demoRun,
        recording_assets: [
          'screenshots/render-v1-baseline.png',
          'screenshots/render-v2-authentic-c.png',
        ],
      };
      await writeFile(
        join(EVIDENCE, 'rehearsal.json'),
        `${JSON.stringify(rehearsal, null, 2)}\n`,
        'utf8',
      );

      console.log('Rehearsal complete:');
      console.log(
        `  seed memories: ${seedEvidence.memory_count} (idempotent: ${String(seedEvidence.idempotent.state_json_identical)})`,
      );
      console.log(
        `  rollback ancestry: v3 -> v${undoV3.version} (expected 1), repeated undo: ${repeated}`,
      );
      console.log(
        `  mutation advisory: ${mutationGuard.assessment}, ${mutationGuard.finding_count} findings`,
      );
      console.log(
        `  authentic C advisory: ${authenticGuard.assessment}, ${authenticGuard.finding_count} findings`,
      );
      console.log(
        `  approved v${String(approval.job.version)}, rolled back to v${String(rollback.current_version)}`,
      );
      console.log(`  evidence written to ${relative(ROOT, EVIDENCE)}`);
    } finally {
      database.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

interface InfluenceRecord {
  provenance: { model: string; request: string; note: string };
  memories: {
    sunset: { id: string; status: string; content: string; accent: string };
    ocean: { id: string; status: string; content: string; accent: string };
  };
  conditions: Array<{
    condition: string;
    job_id: string;
    memory_ids: string[];
    prompt_matches_job: boolean;
    source_palette: Record<string, number>;
    rendered_accent_pct: number;
    rendered_dark_pct: number;
    screenshot: string;
  }>;
  interpretation: string[];
  limits: string[];
}

function memoryInfluenceMarkdown(influence: InfluenceRecord): string {
  const lines = [
    '# Authentic memory influence — A/B/C (Phase 12A)',
    '',
    `Recorded with **${influence.provenance.model}**. One trial per condition. ${influence.provenance.note}`,
    '',
    `Request (byte-identical in all three conditions): "${influence.provenance.request}"`,
    '',
    '## Remembered decisions',
    '',
    `- **Sunset (${influence.memories.sunset.status})** — \`${influence.memories.sunset.id}\` — ${influence.memories.sunset.content}`,
    `- **Ocean (${influence.memories.ocean.status})** — \`${influence.memories.ocean.id}\` — ${influence.memories.ocean.content}`,
    '',
    '## Conditions',
    '',
    '| Condition | Retrieved memories | Accent in source | Rendered accent coverage | Evidence |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const condition of influence.conditions) {
    const memories =
      condition.memory_ids.length === 0 ? 'none (control)' : condition.memory_ids.join(', ');
    const accent =
      condition.condition === 'A'
        ? '`0xFF7E5F` (sunset)'
        : condition.condition === 'C'
          ? '`0x4EA8DE` (ocean)'
          : 'neither';
    lines.push(
      `| ${condition.condition} | ${memories} | ${accent} | ${condition.rendered_accent_pct.toFixed(3)}% | \`${condition.screenshot}\` |`,
    );
  }
  lines.push(
    '',
    '## Reading',
    '',
    ...influence.interpretation.map((line) => `- ${line}`),
    '',
    '## Limits',
    '',
    ...influence.limits.map((line) => `- ${line}`),
    '',
  );
  return lines.join('\n');
}

function memoryInfluenceHtml(influence: InfluenceRecord): string {
  const cards = influence.conditions
    .map((condition) => {
      const accent =
        condition.condition === 'A'
          ? '<code>0xFF7E5F</code> sunset'
          : condition.condition === 'C'
            ? '<code>0x4EA8DE</code> ocean'
            : 'neither palette';
      return `
      <figure>
        <img src="${condition.screenshot}" alt="Condition ${condition.condition} rendered game" />
        <figcaption>
          <strong>${condition.condition}</strong>
          <span>${condition.condition === 'A' ? 'sunset memory active' : condition.condition === 'C' ? 'ocean memory active (sunset superseded)' : 'no memory (control)'}</span>
          <span>accent: ${accent}</span>
          <span>rendered coverage: ${condition.rendered_accent_pct.toFixed(3)}%</span>
          <span class="mono">job ${condition.job_id.slice(0, 8)}…</span>
        </figcaption>
      </figure>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Authentic memory influence — Phase 12A A/B/C</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 40px; background: #14101a; color: #ece7f2;
         font-family: ui-sans-serif, -apple-system, "Segoe UI", sans-serif; }
  header { max-width: 1500px; margin: 0 auto 28px; }
  .badge { display: inline-block; padding: 4px 10px; border-radius: 999px;
           background: #2f7d4f; color: #fff; font-size: 12px; letter-spacing: .08em;
           text-transform: uppercase; }
  .synthetic { background: #8a5a00; }
  h1 { font-size: 34px; margin: 14px 0 6px; }
  p { color: #b9b0c7; max-width: 1100px; line-height: 1.5; }
  .decision { border: 1px solid #2d2638; border-radius: 12px; padding: 14px 18px;
              margin: 10px 0; background: #1b1622; }
  .decision b { color: #fff; }
  .active { border-color: #2f7d4f; }
  .superseded { border-color: #6b5a2a; opacity: .9; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px;
          max-width: 1500px; margin: 26px auto 0; }
  figure { margin: 0; background: #1b1622; border: 1px solid #2d2638;
           border-radius: 14px; overflow: hidden; }
  figure img { width: 100%; display: block; }
  figcaption { display: flex; flex-direction: column; gap: 4px; padding: 12px 14px;
               font-size: 13px; color: #b9b0c7; }
  figcaption strong { color: #fff; font-size: 15px; }
  code { color: #9fd6ff; }
  footer { max-width: 1500px; margin: 26px auto 0; font-size: 12px; color: #8f859f; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
</style>
</head>
<body>
  <header>
    <span class="badge">authentic model output — phase 12A</span>
    <h1>The remembered decision changed the generated game</h1>
    <p>${influence.provenance.model} · one controlled A/B/C trial, run once per condition ·
       byte-identical request “${influence.provenance.request}” · identical baseline.</p>
    <div class="decision superseded"><b>Sunset decision (superseded)</b> — <code>${influence.memories.sunset.id}</code><br />${influence.memories.sunset.content}</div>
    <div class="decision active"><b>Ocean decision (active after correction)</b> — <code>${influence.memories.ocean.id}</code><br />${influence.memories.ocean.content}</div>
  </header>
  <div class="grid">${cards}</div>
  <footer>
    Authentic recorded screenshots (overlay dismissed) from docs/hackathon-evidence/phase12.
    A: 1.082% sunset accent coverage. B: 0.005% (no palette). C: 0.879% ocean accent, no sunset hex in source.
    The remembered dark text colour was not applied; n = 1 per condition; exploratory only.
  </footer>
</body>
</html>`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
