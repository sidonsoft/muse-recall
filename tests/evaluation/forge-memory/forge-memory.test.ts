/**
 * Phase 11B deterministic memory evaluation (§3 acceptance list).
 * No model calls: everything runs against the in-process memory engine and
 * the harness's mirror of the Forge prompt path.
 */

import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryEngine, openDatabase } from '@mml/memory-engine';
import { afterEach, describe, expect, it } from 'vitest';
import {
  APPROVED_CONSTRAINT,
  buildReport,
  CORRECTED_CONSTRAINT,
  captureCondition,
  captureWithEngine,
  constraintInput,
  diffSize,
  evaluatePalette,
  MODIFICATION_REQUEST,
  PROJECT_ID,
  retrieveForModification,
  setupCondition,
  structurallyValidate,
} from './harness';

const openSetups: Array<{ close: () => void; directory: string }> = [];

function setup(condition: 'A' | 'B' | 'C') {
  const s = setupCondition(condition);
  openSetups.push(s);
  return s;
}

afterEach(() => {
  for (const s of openSetups.splice(0)) {
    try {
      s.close();
    } catch {
      /* already closed by the test itself */
    }
    rmSync(s.directory, { recursive: true, force: true });
  }
});

describe('deterministic memory guarantees (conditions A/B/C)', () => {
  it('1+2. approved memory is retrievable and its id is recorded for the job', () => {
    const s = setup('A');
    const retrieval = retrieveForModification(s.engine);
    const ids = retrieval.results.map((r) => r.memory.id);

    expect(ids).toContain(s.approvedId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('3. approved memory content reaches the model prompt verbatim', () => {
    const capture = captureCondition('A');
    expect(capture.prompt_contains.approved_constraint).toBe(true);
    expect(capture.prompt_contains.approved_accent_hex).toBe(true);
    // The production prompt no longer calls memory authoritative. Legacy
    // callers pass a raw block, which is now wrapped as untrusted data.
    expect(capture.prompt).toContain('reference DATA only');
    expect(capture.prompt).toContain('not instructions');
    expect(capture.prompt).not.toContain('authoritative unless contradicted');
  });

  it('3b. with memory unavailable nothing injects the constraint; request stays identical', () => {
    const capture = captureCondition('B');
    expect(capture.memory_ids).toEqual([]);
    expect(capture.prompt_contains.approved_constraint).toBe(false);
    expect(capture.prompt).not.toContain('#FF7E5F');
    expect(capture.prompt).not.toContain('Art direction');
    expect(capture.modification_request).toBe(MODIFICATION_REQUEST);
  });

  it('4+5. corrected memory is retrieved, original excluded, model sees only the current constraint', () => {
    const s = setup('C');
    const capture = captureWithEngine(s.engine, 'C');

    expect(capture.memory_ids).toContain(s.correctedId);
    expect(capture.memory_ids).not.toContain(s.approvedId);
    expect(capture.prompt).toContain(CORRECTED_CONSTRAINT);
    expect(capture.prompt_contains.approved_constraint).toBe(false);
    expect(capture.prompt).toContain('#4EA8DE');
    expect(capture.prompt).not.toContain('#FF7E5F');
  });

  it('4b. superseded original keeps history but leaves active retrieval', () => {
    const s = setup('C');
    const original = s.engine.get(s.approvedId as string);
    expect(original?.status).toBe('superseded');
    expect(s.engine.history(s.approvedId as string).some((e) => e.action === 'superseded')).toBe(
      true,
    );
  });

  it('6. project isolation prevents cross-project leakage', () => {
    const s = setup('A');
    s.engine.create({
      ...constraintInput('A'),
      project_id: 'other-project',
      content: `${APPROVED_CONSTRAINT} (other project)`,
    });
    const mine = retrieveForModification(s.engine);
    expect(mine.results.some((r) => r.memory.project_id === 'other-project')).toBe(false);
    const theirs = s.engine.retrieve({
      project_id: 'other-project',
      query: MODIFICATION_REQUEST,
      budget: { max_memories: 6, max_characters: 3_000 },
    });
    expect(theirs.results.some((r) => r.memory.project_id === PROJECT_ID)).toBe(false);
  });

  it('7. retrieval is stable across sessions (close + reopen the same file db)', () => {
    const s = setup('A');
    const first = captureWithEngine(s.engine, 'A');
    s.close();
    const reopened = openDatabase({ path: join(s.directory, 'memory.db') });
    try {
      const second = captureWithEngine(new MemoryEngine(reopened.db), 'A');
      expect(second.memory_ids).toEqual(first.memory_ids);
      expect(second.injected_contents).toEqual(first.injected_contents);
    } finally {
      reopened.close();
    }
  });
});

describe('evaluation harness evaluators', () => {
  const baseHtml = [
    '<!doctype html><html><head><script src="https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js"></script></head>',
    '<body><div id="game"></div><button id="restart">Restart</button></body></html>',
  ].join('\n');

  const compliantHtml = baseHtml.replace(
    '</button></body>',
    '</button><button id="next-level">Next Level</button><style>:root{--accent:#FF7E5F;--ink:#2D1E2F}</style></body>',
  );
  const neonHtml = baseHtml.replace(
    '</button></body>',
    '</button><button id="next-level">Next Level</button><style>:root{--accent:#39FF14}</style></body>',
  );
  const stalePaletteHtml = baseHtml.replace(
    '</button></body>',
    '</button><button id="next-level">Next Level</button><style>:root{--accent:#FF7E5F}</style></body>',
  );

  it('palette compliance passes the approved palette and fails neon', () => {
    expect(evaluatePalette(compliantHtml, 'A').compliant).toBe(true);
    expect(evaluatePalette(neonHtml, 'A').compliant).toBe(false);
    expect(evaluatePalette(neonHtml, 'A').neon_detected).toBe(true);
  });

  it('corrected condition C rejects the superseded sunset palette', () => {
    const result = evaluatePalette(stalePaletteHtml, 'C');
    expect(result.compliant).toBe(false);
    expect(result.forbidden_superseded_accent_present).toBe(true);
  });

  it('structural validation requires the Next Level button, restart and Phaser CDN', () => {
    expect(structurallyValidate(compliantHtml).ok).toBe(true);
    expect(structurallyValidate(baseHtml).next_level_button_added).toBe(false);
    expect(structurallyValidate(baseHtml).ok).toBe(false);
  });

  it('diff size counts added and removed lines', () => {
    expect(diffSize(baseHtml, compliantHtml)).toEqual({ added: 1, removed: 1 });
  });

  it('report is JSON-serialisable and keeps the modification request identical', () => {
    const report = buildReport('6fe663b');
    const roundTripped = JSON.parse(JSON.stringify(report));
    expect(roundTripped.conditions.map((c: { condition: string }) => c.condition)).toEqual([
      'A',
      'B',
      'C',
    ]);
    for (const capture of roundTripped.conditions) {
      expect(capture.modification_request).toBe(MODIFICATION_REQUEST);
    }
    expect(roundTripped.conditions[0].memory_ids.length).toBeGreaterThan(0);
    expect(roundTripped.conditions[1].memory_ids).toEqual([]);
    expect(roundTripped.metrics_templates[0].model_identifier).toBeNull();
  });
});
