import { describe, expect, it } from 'vitest';
import {
  hexTokens,
  probeFindings,
  reloadPersistence,
  seedCollision,
  stalePublication,
} from '../../scripts/lib/artifact-probes.js';

/**
 * The human review of Palette Bench (KI-87, KI-88, KI-89) came from sequences the production capture
 * never drove, while that capture reported `issues: []` over all three. These helpers are what the
 * probes turn those sequences into. Their wording is the product here: each case pins both the finding
 * and, just as importantly, the shape that must stay quiet.
 */
describe('generated-artifact probe findings', () => {
  it('flags a published output that carries colours the screen no longer shows', () => {
    const finding = stalePublication({
      displayed: ['#c8102e', '#f8fafc', '#64748b', '#9f1239', '#0f172a'],
      published: ['#f59e0b', '#fef3c7', '#d97706', '#78350f', '#0f172a'],
    });
    expect(finding.stale).toBe(true);
    expect(finding.publishes_unseen).toHaveLength(4);
    expect(finding.omits_displayed).toHaveLength(4);
    expect(finding.note).toContain('not displaying');
  });

  it('leaves a published output that matches what is on screen alone', () => {
    const colours = ['#c8102e', '#f8fafc', '#64748b', '#9f1239', '#0f172a'];
    const finding = stalePublication({ displayed: colours, published: colours });
    expect(finding.stale).toBe(false);
    expect(probeFindings({ stale: finding })).toEqual([]);
  });

  it('does not invent staleness when nothing was published', () => {
    const finding = stalePublication({ displayed: ['#123456'], published: [] });
    expect(finding.stale).toBe(false);
    expect(finding.note).toContain('nothing to compare');
  });

  it('names a seed that folds two accepted inputs into one app decision', () => {
    expect(
      seedCollision({
        seed_a: '1',
        seed_b: String(2 ** 32 + 1),
        palette_a: ['#c8102e', '#f8fafc', '#64748b', '#9f1239', '#0f172a'],
        palette_b: ['#c8102e', '#f8fafc', '#64748b', '#9f1239', '#0f172a'],
      }),
    ).toContain('truncates');
  });

  it('stays quiet when the generator separates seeds that far apart', () => {
    expect(
      seedCollision({
        seed_a: '1',
        seed_b: String(2 ** 32 + 1),
        palette_a: ['#c8102e', '#f8fafc', '#64748b', '#9f1239', '#0f172a'],
        palette_b: ['#0ea5e9', '#f8fafc', '#64748b', '#9f1239', '#0f172a'],
      }),
    ).toBeNull();
  });

  it('treats a small output space as a measured range, not a truncation bug', () => {
    // Ten seeds and eight distinct palettes is a design choice. Calling it `Math.imul` would be a false
    // claim about the mechanism, and the whole value of this helper is that it does not make one.
    expect(
      seedCollision({
        seed_a: '1',
        seed_b: '2',
        palette_a: ['#111111'],
        palette_b: ['#222222'],
        palettes_observed: 8,
        seeds_observed: 10,
      }),
    ).toBeNull();
  });

  it('flags only a small space that actually collides inside it', () => {
    const collision = seedCollision({
      seed_a: '3',
      seed_b: '4',
      palette_a: ['#111111'],
      palette_b: ['#111111'],
      palettes_observed: 2,
      seeds_observed: 10,
    });
    // The wording must state the measurement and leave the intent to the reviewer: a narrow space is
    // a design choice, a collision inside it is a fact.
    expect(collision).toContain('inside that range can collide');
    expect(collision).toContain('may not be a bug');
  });

  it('refuses to call two seeds 2^32 apart distinct when the observation is not about that', () => {
    expect(
      seedCollision({
        seed_a: '1',
        seed_b: String(2 ** 32 + 1),
        palette_a: ['#111111'],
        palette_b: ['#111111'],
        palettes_observed: 2,
        seeds_observed: 10,
      }),
    ).toContain('truncates');
  });

  it('flags undo that vanishes across a reload while the damage stays', () => {
    const finding = reloadPersistence({
      before: ['#1', '#2'],
      after: ['#1', '#2'],
      undo_before: true,
      undo_after: false,
      uses_storage: true,
    });
    expect(finding.persisted).toBe(true);
    expect(finding.undo_survives).toBe(false);
    expect(probeFindings({ persistence: finding })).toHaveLength(1);
  });

  it('does not read an undo affordance that never existed as one that survived', () => {
    // The trap in the first draft: comparing the two booleans for equality calls "absent before,
    // absent after" a pass, and the decision "every destructive action is undoable" gets ticked on an
    // app with no undo at all.
    const finding = reloadPersistence({
      before: ['#1', '#2'],
      after: ['#1', '#2'],
      undo_before: false,
      undo_after: false,
      uses_storage: true,
    });
    expect(finding.undo_survives).toBe(false);
    expect(probeFindings({ persistence: finding })).toHaveLength(1);
  });

  it('accepts undo that genuinely survives, alongside the state', () => {
    const finding = reloadPersistence({
      before: ['#1', '#2'],
      after: ['#1', '#2'],
      undo_before: true,
      undo_after: true,
      uses_storage: true,
    });
    expect(finding.undo_survives).toBe(true);
    expect(probeFindings({ persistence: finding })).toEqual([]);
  });

  it('treats a reload that repaints cleared colours as not persistence', () => {
    const finding = reloadPersistence({
      before: [],
      after: ['#1', '#2'],
      undo_before: true,
      undo_after: true,
      uses_storage: true,
    });
    expect(finding.persisted).toBe(false);
    expect(finding.note).toContain('emptied before the reload');
    expect(probeFindings({ persistence: finding })).toHaveLength(1);
  });

  it('separates session-scoped undo from no undo at all', () => {
    // Neither case had an undo affordance on screen after the reload, so the only thing that
    // distinguishes them is whether a fresh destruction offers a way back. "Session-scoped" still
    // satisfies the decision inside a session; "no way back at all" does not.
    const scoped = reloadPersistence({
      before: ['#1'],
      after: ['#1'],
      undo_before: false,
      undo_after: false,
      undo_after_new_destruction: true,
      uses_storage: true,
    });
    expect(scoped.undo_session_scoped).toBe(true);
    expect(scoped.note).toContain('session-scoped rather than broken');

    const broken = reloadPersistence({
      before: ['#1'],
      after: ['#1'],
      undo_before: false,
      undo_after: false,
      undo_after_new_destruction: false,
      uses_storage: true,
    });
    expect(broken.undo_session_scoped).toBe(false);
    expect(broken.note).toContain('no way back at all');
  });

  it('prefers the sharper description when the state survived but the undo affordance did not', () => {
    const finding = reloadPersistence({
      before: ['#1'],
      after: ['#1'],
      undo_before: true,
      undo_after: false,
      undo_after_new_destruction: true,
      uses_storage: true,
    });
    expect(finding.note).toContain('the undo affordance did not');
  });

  it('says when an app makes no persistence claim at all', () => {
    const finding = reloadPersistence({
      before: ['#1'],
      after: [],
      undo_before: true,
      undo_after: false,
      uses_storage: false,
    });
    expect(finding.note).toContain('not a claim it makes');
  });

  it('extracts hex colours as they are spelled, and only those, folded for comparison', () => {
    // #F8FAFC and #f8fafc are the same colour to a user; a probe that treated them as different would
    // report a stale export in an artifact that simply capitalised its hex differently.
    expect(hexTokens('Primary #c8102e and #F8FAFC, plus a 4.5:1 ratio')).toEqual([
      '#c8102e',
      '#f8fafc',
    ]);
    expect(hexTokens('#12 too short, #1234567 too long')).toEqual([]);
  });
});
