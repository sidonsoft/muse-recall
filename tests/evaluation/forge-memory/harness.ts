/**
 * Phase 11B — Forge creative-memory A/B/C evaluation harness.
 *
 * Deterministic, dependency-free evidence collection for the claim
 * "AI creative decisions survive between sessions and influence future
 * changes". Mirrors the exact retrieval + prompt-injection path of
 * apps/server/src/forge/runner.ts (lines 145-159, 605-633) without
 * touching the Forge runtime. Real-model trials are NOT run here; the
 * harness emits structured JSON plus a metrics template to be filled
 * by an authorised real-Muse run (see docs/PHASE11_MEMORY_EVALUATION.md).
 *
 * Reproduce:  pnpm tsx tests/evaluation/forge-memory/harness.ts [--json]
 *             pnpm vitest run tests/evaluation/forge-memory
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { MemoryEngine, openDatabase } from '../../../packages/memory-engine/src/index.js';
import type { MemoryCreateInput } from '../../../packages/shared/src/index.js';

export type Condition = 'A' | 'B' | 'C';

export const CONDITIONS: Record<Condition, string> = {
  A: 'memory-enabled (approved sunset constraint retrievable)',
  B: 'memory-unavailable (same project, constraint not available)',
  C: 'memory-corrected (sunset superseded by ocean palette)',
};

export const PROJECT_ID = 'forge-eval-phase11';

export const APPROVED_CONSTRAINT =
  'Art direction: maintain a warm sunset palette. Use #FF7E5F as the primary accent and #2D1E2F for dark text. Avoid aggressive neon colours.';

export const CORRECTED_CONSTRAINT =
  'Art direction: use a cool ocean palette. Primary accent #4EA8DE and dark text #102A43.';

export const MODIFICATION_REQUEST = 'Add a Next Level button beneath the Restart button.';

/** Palette contract per condition, used by the compliance evaluator. B is
 * scored against the approved palette (A) so conditions stay comparable. */
const PALETTES: Record<
  Condition,
  { accent: string; dark: string; supersededAccent: string | null }
> = {
  A: { accent: '#FF7E5F', dark: '#2D1E2F', supersededAccent: null },
  B: { accent: '#FF7E5F', dark: '#2D1E2F', supersededAccent: null },
  C: { accent: '#4EA8DE', dark: '#102A43', supersededAccent: '#FF7E5F' },
};

const NEON_RE = /#00FF00|#FF00FF|#00FFFF|#39FF14|#FE00FE|\bneon\b/i;

export function constraintInput(condition: Condition): MemoryCreateInput {
  return {
    type: 'constraint',
    scope: 'project',
    project_id: PROJECT_ID,
    content: condition === 'C' ? CORRECTED_CONSTRAINT : APPROVED_CONSTRAINT,
  };
}

export interface ConditionSetup {
  engine: MemoryEngine;
  db: DatabaseSync;
  close: () => void;
  approvedId: string | null;
  correctedId: string | null;
  directory: string;
}

/** Repeatable setup per condition; file-backed so cross-session reopening is real. */
export function setupCondition(condition: Condition): ConditionSetup {
  const directory = mkdtempSync(join(tmpdir(), 'forge-memory-eval-'));
  const { db, close } = openDatabase({ path: join(directory, 'memory.db') });
  const engine = new MemoryEngine(db);
  let approvedId: string | null = null;
  let correctedId: string | null = null;
  if (condition === 'A') {
    approvedId = engine.create(constraintInput('A')).memory.id;
  } else if (condition === 'C') {
    approvedId = engine.create(constraintInput('A')).memory.id;
    correctedId = engine.correct({ ...constraintInput('C'), supersedes: [approvedId] }).memory.id;
  }
  return { engine, db, close: () => close(), approvedId, correctedId, directory };
}

/** Mirror of runner.ts:147-159 — same request shape and budget. */
export function retrieveForModification(engine: MemoryEngine, request = MODIFICATION_REQUEST) {
  return engine.retrieve({
    project_id: PROJECT_ID,
    query: `${PROJECT_ID}\n${request}`,
    budget: { max_memories: 6, max_characters: 3_000 },
  });
}

export function memoryBlockFor(retrieval: ReturnType<typeof retrieveForModification>): string {
  return retrieval.results.length > 0
    ? retrieval.results.map((result) => `- ${result.injected_content}`).join('\n')
    : '';
}

/** Mirror of the modify branch of buildPrompt in runner.ts:621-632. */
export function buildForgePrompt(memoryBlock: string, request = MODIFICATION_REQUEST): string {
  const memory = memoryBlock
    ? `\nProject design decisions from previous sessions (authoritative unless contradicted):\n${memoryBlock}\n`
    : '';
  return [
    'The current approved game is already in this workspace at index.html.',
    'Edit that file in place: keep every part of the existing implementation that the request does not ask you to change.',
    'Modify index.html only; do not regenerate the game from scratch.',
    'The attached screenshot is the current rendered preview. Use it to understand the visual result.',
    'Apply the requested visual change while preserving gameplay: cards, matching, score, restart, win condition, mouse/touch, and responsive layout.',
    'Keep the existing Phaser 3 CDN and Phaser.Game initialisation. Do not replace the engine with vanilla JavaScript and do not add libraries.',
    'Do not add other files or dependencies. After editing, run node --check on the inline script.',
    memory,
    'Requested change:',
    request,
  ].join('\n');
}

export interface CaptureResult {
  condition: Condition;
  condition_label: string;
  project_id: string;
  modification_request: string;
  memory_ids: string[];
  injected_contents: string[];
  prompt_chars: number;
  prompt_contains: {
    approved_constraint: boolean;
    corrected_constraint: boolean;
    approved_accent_hex: boolean;
    corrected_accent_hex: boolean;
  };
  prompt: string;
}

/** Retrieval + prompt-inclusion capture for one condition (no model call). */
export function captureCondition(condition: Condition): CaptureResult {
  const setup = setupCondition(condition);
  try {
    return captureWithEngine(setup.engine, condition);
  } finally {
    setup.close();
    rmSync(setup.directory, { recursive: true, force: true });
  }
}

export function captureWithEngine(engine: MemoryEngine, condition: Condition): CaptureResult {
  const retrieval = retrieveForModification(engine);
  const block = memoryBlockFor(retrieval);
  const prompt = buildForgePrompt(block);
  return {
    condition,
    condition_label: CONDITIONS[condition],
    project_id: PROJECT_ID,
    modification_request: MODIFICATION_REQUEST,
    memory_ids: retrieval.results.map((result) => result.memory.id),
    injected_contents: retrieval.results.map((result) => result.injected_content),
    prompt_chars: prompt.length,
    prompt_contains: {
      approved_constraint: prompt.includes(APPROVED_CONSTRAINT),
      corrected_constraint: prompt.includes(CORRECTED_CONSTRAINT),
      approved_accent_hex: prompt.includes('#FF7E5F'),
      corrected_accent_hex: prompt.includes('#4EA8DE'),
    },
    prompt,
  };
}

export interface PaletteCompliance {
  approved_accent_present: boolean;
  approved_dark_present: boolean;
  forbidden_superseded_accent_present: boolean;
  neon_detected: boolean;
  compliant: boolean;
}

/**
 * Source-level palette check. NOTE: necessary but not sufficient — real
 * compliance also needs rendered-pixel verification (documented procedure).
 */
export function evaluatePalette(sourceHtml: string, condition: Condition): PaletteCompliance {
  const palette = PALETTES[condition];
  const approvedAccentPresent = containsHex(sourceHtml, palette.accent);
  const approvedDarkPresent = containsHex(sourceHtml, palette.dark);
  const supersededPresent =
    palette.supersededAccent !== null && containsHex(sourceHtml, palette.supersededAccent);
  const neon = NEON_RE.test(sourceHtml);
  return {
    approved_accent_present: approvedAccentPresent,
    approved_dark_present: approvedDarkPresent,
    forbidden_superseded_accent_present: supersededPresent,
    neon_detected: neon,
    compliant: approvedAccentPresent && approvedDarkPresent && !supersededPresent && !neon,
  };
}

function containsHex(source: string, hex: string): boolean {
  return new RegExp(hex, 'i').test(source);
}

/** Structural checks every condition must satisfy after the modification. */
export function structurallyValidate(sourceHtml: string): {
  phaser_cdn_kept: boolean;
  next_level_button_added: boolean;
  restart_preserved: boolean;
  ok: boolean;
} {
  const phaser = /phaser@3\.80\.1\/dist\/phaser\.min\.js/.test(sourceHtml);
  const nextLevel = /next[\s_-]?level/i.test(sourceHtml);
  const restart = /restart/i.test(sourceHtml);
  return {
    phaser_cdn_kept: phaser,
    next_level_button_added: nextLevel,
    restart_preserved: restart,
    ok: phaser && nextLevel && restart,
  };
}

/** Line-multiset diff size: no external dependency, sufficient for reporting. */
export function diffSize(base: string, modified: string): { added: number; removed: number } {
  const baseLines = splitLines(base);
  const modifiedLines = splitLines(modified);
  const inBase = countLines(baseLines);
  const inModified = countLines(modifiedLines);
  let added = 0;
  for (const [line, count] of inModified) added += Math.max(0, count - (inBase.get(line) ?? 0));
  let removed = 0;
  for (const [line, count] of inBase) removed += Math.max(0, count - (inModified.get(line) ?? 0));
  return { added, removed };
}

function splitLines(text: string): string[] {
  return text.split('\n').filter((line) => line.trim().length > 0);
}

function countLines(lines: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1);
  return counts;
}

/** Metric record for one eventual real-model trial (docs §5). */
export function realRunMetricsTemplate(condition: Condition, capture: CaptureResult) {
  return {
    condition,
    model_identifier: null,
    job_id: null,
    memory_ids: capture.memory_ids,
    prompt_inclusion: capture.prompt_contains,
    wall_clock_ms: null,
    model_calls: null,
    input_tokens: null,
    output_tokens: null,
    diff_added_lines: null,
    diff_removed_lines: null,
    palette_compliance_source: null,
    palette_compliance_rendered: null,
    structural_validation: null,
    runtime_verification: null,
    outcome: null,
  };
}

export interface DeterministicReport {
  generated_at: string;
  base_commit: string;
  modification_request: string;
  conditions: CaptureResult[];
  metrics_templates: ReturnType<typeof realRunMetricsTemplate>[];
}

/** Run all three conditions and emit the deterministic evidence report. */
export function buildReport(baseCommit: string): DeterministicReport {
  const conditions = (['A', 'B', 'C'] as Condition[]).map((condition) =>
    captureCondition(condition),
  );
  return {
    generated_at: new Date().toISOString(),
    base_commit: baseCommit,
    modification_request: MODIFICATION_REQUEST,
    conditions,
    metrics_templates: conditions.map((capture) =>
      realRunMetricsTemplate(capture.condition, capture),
    ),
  };
}

// CLI entry: `pnpm tsx tests/evaluation/forge-memory/harness.ts [--json]`
if (import.meta.url === `file://${process.argv[1]}`) {
  const baseCommit =
    process.env.PHASE11_BASE_COMMIT ??
    (process.argv.includes('--base')
      ? process.argv[process.argv.indexOf('--base') + 1]
      : 'unknown');
  const report = buildReport(baseCommit);
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    for (const capture of report.conditions) {
      process.stdout.write(
        `${capture.condition}: memories=[${capture.memory_ids.join(',')}] ` +
          `approved=${capture.prompt_contains.approved_constraint} ` +
          `corrected=${capture.prompt_contains.corrected_constraint} ` +
          `request="${capture.modification_request}"\n`,
      );
    }
  }
}
