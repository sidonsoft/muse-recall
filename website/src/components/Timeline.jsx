import React, { useState } from 'react';

// Reconstructed verbatim from the seeded demo project (scripts/lib/demo-seed.ts):
// decision texts are the Phase 12A trial texts, and the version record is the
// real recorded Spark baseline promoted at seed time.

const EVENTS = [
  {
    kind: 'store',
    when: 'stored · verified · confidence 0.95',
    title: 'Child-safety constraint',
    body: 'This children’s game must avoid flashing effects, countdown timers, and penalties for mistakes.',
    meta: 'type: constraint · scope: project · ref: seed:phase14a-demo',
  },
  {
    kind: 'store',
    when: 'stored · verified · confidence 0.90',
    title: 'Art direction — sunset',
    body: 'Maintain a warm sunset palette. Use #FF7E5F as the primary accent and #2D1E2F for dark text. Avoid aggressive neon colours.',
    meta: 'type: constraint · scope: project · tags: palette, sunset',
    swatches: ['#FF7E5F', '#2D1E2F'],
  },
  {
    kind: 'approve',
    when: 'approved · 2026-10-27',
    title: 'v1 promoted — immutable',
    body: 'Demo baseline — recorded real Spark generation. Approval binds the SHA-256 of the checked bytes; v1 stays recoverable.',
    meta: 'version 1 · base: none · sha-256 recorded in state.json',
  },
  {
    kind: 'correct',
    when: 'correction · one transaction',
    title: 'Sunset → ocean (supersession)',
    body: 'Creative direction changed from a warm sunset mood to a cool ocean mood. The sunset decision becomes auditable history — superseded, excluded from retrieval — and ocean becomes the only retrievable palette decision.',
    meta: 'replacement confidence 0.90 · edges recorded · replay is idempotent',
    swatches: ['#4EA8DE', '#102A43'],
    strikes: ['#FF7E5F', '#2D1E2F'],
  },
  {
    kind: 'retrieve',
    when: 'next generate/modify job',
    title: 'Retrieval supplies the current set',
    body: 'The job receives the child-safety constraint and the ocean palette — never the sunset. The job record lists the decision ids it received and the SHA-256 of the exact prompt.',
    meta: 'budget: 8 memories · every result carries score components + evidence',
  },
];

const KIND_LABEL = {
  store: ['🪪', 'stored'],
  approve: ['✓', 'approved'],
  correct: ['🔀', 'corrected'],
  retrieve: ['🔍', 'retrieved'],
};

export default function Timeline() {
  const [open, setOpen] = useState(3); // correction open by default — the signature moment
  return (
    <div className="timeline">
      {EVENTS.map((e, i) => {
        const [icon, label] = KIND_LABEL[e.kind];
        const isOpen = open === i;
        return (
          <div className={`tl-item tl-${e.kind}`} key={e.title}>
            <div className="tl-dot" aria-hidden="true">
              {icon}
            </div>
            <button
              className="tl-card"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? -1 : i)}
            >
              <div className="tl-head">
                <b>{e.title}</b>
                <span className="tl-when">{e.when}</span>
              </div>
              {isOpen ? (
                <>
                  <p className="tl-body">{e.body}</p>
                  {(e.swatches || e.strikes) && (
                    <div className="tl-swatches" aria-hidden="true">
                      {e.strikes?.map((c) => (
                        <span className="sw strike" key={c}>
                          <i style={{ background: c }} /> {c}
                        </span>
                      ))}
                      {e.swatches?.map((c) => (
                        <span className="sw" key={c}>
                          <i style={{ background: c }} /> {c}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="tl-meta">{e.meta}</p>
                </>
              ) : (
                <p className="tl-peek">{e.body.slice(0, 84)}…</p>
              )}
              <span className={`tl-badge tl-badge-${e.kind}`}>{label}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
