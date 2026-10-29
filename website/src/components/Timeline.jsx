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
    why: 'Child-safety rules are exactly what a model silently breaks two sessions later. Stored as a verified constraint, it reaches every future generation without being restated.',
    meta: 'type: constraint · scope: project · ref: seed:phase14a-demo',
  },
  {
    kind: 'store',
    when: 'stored · verified · confidence 0.90',
    title: 'Art direction — sunset',
    body: 'Maintain a warm sunset palette. Use #FF7E5F as the primary accent and #2D1E2F for dark text. Avoid aggressive neon colours.',
    why: 'A creative direction stated once becomes a project fact with identity and provenance — not just a line lost in someone’s chat history.',
    meta: 'type: constraint · scope: project · tags: palette, sunset',
    swatches: ['#FF7E5F', '#2D1E2F'],
  },
  {
    kind: 'approve',
    when: 'approved · 2026-10-27',
    title: 'v1 promoted — immutable',
    body: 'Demo baseline — recorded real Spark generation. Approval binds the SHA-256 of the checked bytes; v1 stays recoverable.',
    why: 'Approval is a content hash, not a vibe: the exact bytes you reviewed are the bytes you can restore. Nothing gets quietly swapped afterwards.',
    meta: 'version 1 · base: none · sha-256 recorded in state.json',
  },
  {
    kind: 'correct',
    when: 'correction · one transaction',
    title: 'Sunset → ocean (supersession)',
    body: 'Creative direction changed from a warm sunset mood to a cool ocean mood. The sunset decision becomes auditable history — superseded, excluded from retrieval — and ocean becomes the only retrievable palette decision.',
    why: 'Correcting a memory is a transaction, not a delete: the once-true decision stays auditable while the retrieval set flips to the new truth atomically.',
    meta: 'replacement confidence 0.90 · edges recorded · replay is idempotent',
    swatches: ['#4EA8DE', '#102A43'],
    strikes: ['#FF7E5F', '#2D1E2F'],
  },
  {
    kind: 'retrieve',
    when: 'next generate/modify job',
    title: 'Retrieval supplies the current set',
    body: 'The job receives the child-safety constraint and the ocean palette — never the sunset. The job record lists the decision ids it received and the SHA-256 of the exact prompt.',
    why: 'Inference is auditable after the fact: every job names the decisions it was given and hashes the exact prompt — the opposite of context-window roulette.',
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
                  <p className="tl-why">{e.why}</p>
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
                <>
                  <p className="tl-peek">{e.body.slice(0, 84)}…</p>
                  <p className="tl-body tl-printonly">{e.body}</p>
                  <p className="tl-why tl-printonly">{e.why}</p>
                  <p className="tl-meta tl-printonly">{e.meta}</p>
                </>
              )}
              <span className={`tl-badge tl-badge-${e.kind}`}>{label}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
