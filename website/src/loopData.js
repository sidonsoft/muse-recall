// Reconstruction of the recorded demo / Phase 16–17 arms for the interactive widget.
// Not a live capture: illustrative of the real Studio flow.

export const DECISION_OLD = {
  id: 'dec-41f2c9',
  type: 'constraint',
  scope: 'project:ocean-pairs',
  text: 'Child safety: no countdown timers, no full-screen flashing, no mistake penalties.',
  provenance: 'stored by you · 2026-10-27 · session s-88 · confidence 1.0',
};

export const DECISION_NEW = {
  id: 'dec-9c31e7',
  type: 'constraint',
  scope: 'project:ocean-pairs',
  text: 'Correction: the child-safety restriction is lifted; penalties are allowed again.',
  provenance: 'correction transaction · replays idempotent · old edge recorded',
};

export const REQUEST = 'add a 3-second countdown and a −3 penalty for misses';

export const SNIPPETS = {
  withMemory: [
    { kind: 'ctx', t: 'index.html · staged change v3 (base v2)' },
    { kind: 'ctx', t: '  const reveal = (card) => {' },
    { kind: 'ctx', t: '    flip(card);            // calm reveal, no timer' },
    { kind: 'ctx', t: '  };' },
    { kind: 'add', t: '+ // countdown requested — the project\'s remembered rule forbids it' },
    { kind: 'ctx', t: '  // model kept the approved mechanics unchanged' },
  ],
  noMemory: [
    { kind: 'ctx', t: 'index.html · staged change v3 (base v2)' },
    { kind: 'bad-add', t: '+ const countdown = setInterval(tick, 1000);   // timer' },
    { kind: 'bad-add', t: '+ if (wrong) score = Math.max(0, score - 3);   // penalty' },
    { kind: 'bad-add', t: "+ flash('WRONG!', 'fullscreen');               // flash" },
    { kind: 'ctx', t: '  // three reintroduced patterns the project had ruled out' },
  ],
  corrected: [
    { kind: 'ctx', t: 'index.html · staged change v3 (base v2)' },
    { kind: 'add', t: '+ const countdown = setInterval(tick, 1000);   // allowed again' },
    { kind: 'add', t: '+ if (wrong) score = Math.max(0, score - 3);   // allowed again' },
    { kind: 'ctx', t: '  // superseded rule excluded from retrieval' },
  ],
};

export function guardFor({ memoryOn, corrected }) {
  if (memoryOn && !corrected) {
    return {
      status: '0 findings · 3 rule families checked',
      findings: [],
      note: 'Checked against 2 active decisions · advisory — never blocks approval.',
    };
  }
  if (!memoryOn) {
    return {
      status: '3 findings',
      findings: [
        ['countdown reintroduced', 'cites dec-41f2c9 · “no countdown”'],
        ['mistake penalty', 'cites dec-41f2c9 · “no penalties”'],
        ['full-screen flash', 'cites dec-41f2c9 · “no flashing”'],
      ],
      note: 'Guard checks staged source against remembered decisions. The human still decides.',
    };
  }
  return {
    status: '0 findings',
    findings: [],
    note: 'dec-41f2c9 is superseded — it is kept for audit but excluded from active retrieval and guard checks.',
  };
}
