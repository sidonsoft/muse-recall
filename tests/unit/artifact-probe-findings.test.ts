import { describe, expect, it } from 'vitest';
import {
  errorThenRetry,
  findingsOf,
  hexTokens,
  inputDomainCollision,
  narrowViewport,
  type ProbeResult,
  reloadPersistence,
  renderProbeResults,
  stalePublication,
  undoWithinSession,
} from '../../scripts/lib/artifact-probes.js';

/**
 * The human review of Palette Bench (KI-88, KI-89, KI-90) came from sequences the production capture
 * never drove, while that capture reported `issues: []` over all three. These helpers decide what each
 * driven sequence is allowed to claim, so the wording is the product under test here: every case pins
 * both a finding and the shape that must stay quiet.
 */
describe('sequence probe judgements', () => {
  it('flags handed-over output that carries colours the screen no longer shows', () => {
    const finding = stalePublication({
      displayed: ['#c8102e', '#f8fafc', '#64748b', '#9f1239', '#0f172a'],
      published: ['#f59e0b', '#fef3c7', '#d97706', '#78350f', '#0f172a'],
    });
    expect(finding.stale).toBe(true);
    expect(finding.publishes_unseen).toHaveLength(4);
    expect(finding.omits_displayed).toHaveLength(4);
    expect(finding.note).toContain('not displaying');
  });

  it('leaves handed-over output that matches the screen alone', () => {
    const colours = ['#c8102e', '#f8fafc', '#64748b', '#9f1239', '#0f172a'];
    const finding = stalePublication({ displayed: colours, published: colours });
    expect(finding.stale).toBe(false);
    expect(finding.note).toContain('exactly the colours');
  });

  it('refuses to call an empty hand-over staleness', () => {
    // Describing this as stale would report a comparison that never happened. It is its own finding:
    // either the app claimed to export/copy and did not, or it never claimed to.
    const finding = stalePublication({ displayed: ['#123456'], published: [] });
    expect(finding.stale).toBe(false);
    expect(finding.nothing_handed_over).toBe(true);
    expect(finding.note).toContain('nothing was handed over');
  });

  it('names a seed domain wider than the generator can represent', () => {
    expect(
      inputDomainCollision({
        accepted_a: '1',
        accepted_b: String(2 ** 32 + 1),
        output_a: ['#c8102e'],
        output_b: ['#c8102e'],
      }),
    ).toContain('cannot represent');
  });

  it('says when the input control itself, not the generator, lost the distinction', () => {
    const note = inputDomainCollision({
      accepted_a: '1',
      accepted_b: '1',
      output_a: ['#c8102e'],
      output_b: ['#c8102e'],
    });
    expect(note).toContain('the field did not keep the two values apart');
  });

  it('treats a small output space as a measured range, not a truncation defect', () => {
    // Eight outputs from ten inputs is a design choice. Calling it a 2^32 fold would be a false claim
    // about the mechanism, and the whole value of this helper is that it does not make one.
    expect(
      inputDomainCollision({
        accepted_a: '1',
        accepted_b: '2',
        output_a: ['#111111'],
        output_b: ['#222222'],
        outputs_observed: 8,
        inputs_observed: 10,
      }),
    ).toBeNull();
  });

  it('flags a collision inside a small space without asserting the mechanism', () => {
    const collision = inputDomainCollision({
      accepted_a: '3',
      accepted_b: '4',
      output_a: ['#111111'],
      output_b: ['#111111'],
      outputs_observed: 2,
      inputs_observed: 10,
    });
    const collapsed = String(collision).replace(/\s+/g, ' ');
    expect(collapsed).toContain('inside that range can collide');
    expect(collapsed).toContain('may not be a defect');
    expect(collapsed).not.toContain('multiple of 2^32');
  });

  it('still names the 2^32 fold when a small space was also sampled', () => {
    expect(
      inputDomainCollision({
        accepted_a: '1',
        accepted_b: String(2 ** 32 + 1),
        output_a: ['#111111'],
        output_b: ['#111111'],
        outputs_observed: 2,
        inputs_observed: 10,
      }),
    ).toContain('multiple of 2^32');
  });

  it('accepts an undo affordance that puts the discarded state back', () => {
    const finding = undoWithinSession({
      before_destruction: ['#1', '#2'],
      after_destruction: [],
      after_undo: ['#1', '#2'],
      undo_offered: true,
    });
    expect(finding).toMatchObject({ destroyed: true, undo_offered: true, restored: true });
  });

  it('flags an undo affordance that exists but does not restore', () => {
    // An undo button that does nothing is worse than no button, and a probe that only counts controls
    // reports it as available.
    const finding = undoWithinSession({
      before_destruction: ['#1', '#2'],
      after_destruction: [],
      after_undo: [],
      undo_offered: true,
    });
    expect(finding.undo_offered).toBe(true);
    expect(finding.restored).toBe(false);
    expect(finding.note).toContain('not the state that was discarded');
  });

  it('flags a destructive action with no way back inside the session', () => {
    const finding = undoWithinSession({
      before_destruction: ['#1', '#2'],
      after_destruction: [],
      after_undo: [],
      undo_offered: false,
    });
    expect(finding.note).toContain('no way back inside a session');
  });

  it('proves nothing when the destructive action changed nothing', () => {
    const finding = undoWithinSession({
      before_destruction: ['#1', '#2'],
      after_destruction: ['#1', '#2'],
      after_undo: ['#1', '#2'],
      undo_offered: true,
    });
    expect(finding.destroyed).toBe(false);
    expect(finding.note).toContain('proves nothing about recovery');
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
    expect(finding.note).toContain('the undo affordance did not');
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
    expect(finding.note).toContain('both survived the reload');
  });

  it('separates session-scoped undo from no undo at all', () => {
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
  });

  it('says when an application makes no persistence claim at all', () => {
    const finding = reloadPersistence({
      before: ['#1'],
      after: [],
      undo_before: true,
      undo_after: false,
      uses_storage: false,
    });
    expect(finding.note).toContain('not a claim it makes');
  });

  it('flags a document that scrolls sideways at phone width', () => {
    const finding = narrowViewport({
      width: 390,
      document_scroll_width: 900,
      controls_visible: 5,
      controls_clipped: 3,
      controls_unusable: 0,
      interaction_changed_output: true,
      control_reachable: true,
    });
    expect(finding.overflow).toBe(true);
    expect(finding.note).toContain('scrolls sideways');
    expect(finding.note).toContain('partly outside the viewport');
  });

  it('flags a control that is named but has no usable box at that width', () => {
    const finding = narrowViewport({
      width: 390,
      document_scroll_width: 390,
      controls_visible: 4,
      controls_clipped: 0,
      controls_unusable: 2,
      interaction_changed_output: true,
      control_reachable: true,
    });
    expect(finding.note).toContain('no usable box');
  });

  it('flags an interaction that stops working when the window is narrow', () => {
    const finding = narrowViewport({
      width: 390,
      document_scroll_width: 390,
      controls_visible: 5,
      controls_clipped: 0,
      controls_unusable: 0,
      interaction_changed_output: false,
      control_reachable: true,
    });
    expect(finding.interaction_worked).toBe(false);
    expect(finding.note).toContain('without changing what is displayed');
  });

  it('leaves a document that fits phone width and still works alone', () => {
    const finding = narrowViewport({
      width: 390,
      document_scroll_width: 388,
      controls_visible: 5,
      controls_clipped: 0,
      controls_unusable: 0,
      interaction_changed_output: true,
      control_reachable: true,
    });
    expect(finding.overflow).toBe(false);
    expect(finding.note).toContain('every control the probe could name');
  });

  it('flags invalid input that reaches the rendered output as a non-value', () => {
    const finding = errorThenRetry({
      value_after_invalid_input: '',
      displayed_before_invalid: ['#1'],
      displayed_after_invalid: ['#2'],
      status_after_invalid: 'Generated from .',
      claims_success: true,
      displayed_after_retry: ['#3'],
      renders_non_values: true,
    });
    expect(finding.defective).toBe(true);
    expect(finding.note).toContain('non-value (NaN or undefined)');
  });

  it('flags a success claim attached to an unchanged result', () => {
    const finding = errorThenRetry({
      value_after_invalid_input: '',
      displayed_before_invalid: ['#1'],
      displayed_after_invalid: ['#1'],
      status_after_invalid: 'Generated.',
      claims_success: true,
      displayed_after_retry: ['#2'],
      renders_non_values: false,
    });
    expect(finding.defective).toBe(true);
    expect(finding.note).toContain('while still displaying the previous result');
  });

  it('flags a retry that cannot recover inside the application', () => {
    const finding = errorThenRetry({
      value_after_invalid_input: 'x',
      displayed_before_invalid: ['#1'],
      displayed_after_invalid: ['#2'],
      status_after_invalid: 'Enter a number.',
      claims_success: false,
      displayed_after_retry: ['#2'],
      renders_non_values: false,
    });
    expect(finding.defective).toBe(true);
    expect(finding.note).toContain('cannot recover');
  });

  it('does not invent a defect just because invalid input was rejected quietly', () => {
    // Silent rejection may be poor design; it is not automatically a defect, and this helper must not
    // overstate. What it can say is what the application did and that a valid retry changed things.
    const finding = errorThenRetry({
      value_after_invalid_input: '',
      displayed_before_invalid: ['#1'],
      displayed_after_invalid: ['#1'],
      status_after_invalid: '',
      claims_success: false,
      displayed_after_retry: ['#2'],
      renders_non_values: false,
    });
    expect(finding.defective).toBe(false);
    expect(finding.note).toContain('gave no message');
  });

  it('keeps the four outcome words distinct, because "no findings" is not one of them', () => {
    const results: ProbeResult[] = [
      { probe: 'a', sequence: 'ran and broke', status: 'finding', detail: 'broke' },
      { probe: 'b', sequence: 'ran fine', status: 'clean', detail: 'fine' },
      { probe: 'c', sequence: 'skipped', status: 'not_tested', detail: 'no such control' },
      {
        probe: 'd',
        sequence: 'started, stalled',
        status: 'incomplete',
        detail: 'clipboard unreadable',
      },
    ];
    expect(findingsOf(results).map((result) => result.probe)).toEqual(['a']);
    const rendered = renderProbeResults(results).join('\n');
    for (const word of ['FINDING', 'CLEAN', 'NOT TESTED', 'INCOMPLETE']) {
      expect(rendered).toContain(word);
    }
    expect(rendered).not.toContain('no findings');
  });

  it('extracts hex colours as they are spelled, and only those, folded for comparison', () => {
    // #F8FAFC and #f8fafc are one colour to a user; a probe treating them as different would report a
    // stale export in an artifact that simply capitalised its hex differently.
    expect(hexTokens('Primary #c8102e and #F8FAFC, plus a 4.5:1 ratio')).toEqual([
      '#c8102e',
      '#f8fafc',
    ]);
    expect(hexTokens('#12 too short, #1234567 too long')).toEqual([]);
  });
});
