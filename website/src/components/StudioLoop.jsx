import React, { useState } from 'react';
import { DECISION_OLD, DECISION_NEW, REQUEST, SNIPPETS, guardFor } from '../loopData.js';

const WHY = {
  supplied:
    'Why it matters: the remembered rule survives a brand-new session — you never restate the constraint, and the violation rate collapses (37/57 → 0/58 in Phase 17).',
  off: 'Why it matters: this is the “no memory” arm — the model cannot know what you already decided, so old constraints silently return (49/60 violations on Muse Spark Open without memory).',
  corrected:
    'Why it matters: one transaction retires the old rule — the audit trail stays, but the superseded restriction stops constraining new work.',
};

export default function StudioLoop() {
  const [memoryOn, setMemoryOn] = useState(true);
  const [corrected, setCorrected] = useState(false);

  const snippet = !memoryOn ? SNIPPETS.noMemory : corrected ? SNIPPETS.corrected : SNIPPETS.withMemory;
  const guard = guardFor({ memoryOn, corrected });

  return (
    <div className="demo-shell reveal">
      <div className="demo-top">
        <span className="lamp on" aria-hidden="true" />
        <span className="lamp" aria-hidden="true" />
        <span className="lamp" aria-hidden="true" />
        <span className="title">html studio — one change request, three memory states</span>
      </div>
      <div className="loop-grid">
        <div className="loop-side">
          <ol className="guide" aria-label="Guided tour">
            <li>1 · flip a switch</li>
            <li>2 · read the staged diff</li>
            <li>3 · check the Guard</li>
          </ol>
          <h3>Project memory</h3>
          <div className="loop-toggle">
            <button
              className="switch"
              role="switch"
              aria-checked={memoryOn}
              aria-label="Supply the project's remembered decisions to this generation"
              onClick={() => setMemoryOn((v) => !v)}
            >
              Supply decisions to this generation
              <span className="track" aria-hidden="true" />
            </button>
            <button
              className="switch"
              role="switch"
              aria-checked={corrected}
              disabled={!memoryOn}
              aria-label="Correct the rule by superseding it"
              onClick={() => setCorrected((v) => !v)}
            >
              Correct the rule (supersede)
              <span className="track" aria-hidden="true" />
            </button>
          </div>

          {corrected && (
            <div className="decision-card" style={{ marginTop: 16 }}>
              <div className="id">
                <span>{DECISION_NEW.id}</span>
                <span className="state active">active</span>
              </div>
              <p>{DECISION_NEW.text}</p>
              <small>{DECISION_NEW.provenance}</small>
            </div>
          )}
          <div className="decision-card" style={corrected ? { opacity: 0.75 } : undefined}>
            <div className="id">
              <span>{DECISION_OLD.id}</span>
              <span className={`state ${corrected ? 'superseded' : 'active'}`}>
                {corrected ? 'superseded' : memoryOn ? 'retrieved' : 'not supplied'}
              </span>
            </div>
            <p style={corrected ? { textDecoration: 'line-through' } : undefined}>
              {DECISION_OLD.text}
            </p>
            <small>{DECISION_OLD.provenance}</small>
          </div>
        </div>

        <div className="loop-main" aria-live="polite">
          <h3>Staged change — preview · source · diff</h3>
          <div className="request-line">
            you: <b>“{REQUEST}”</b> → Muse Spark edits the approved v2 source
          </div>
          <div className="snippet" key={`snip-${memoryOn}-${corrected}`}>
            {snippet.map((l, i) => (
              <div key={i} className={l.kind}>
                {l.t}
              </div>
            ))}
          </div>
          <div className="guard-panel">
            <div className="head">
              <span aria-hidden="true">🛡</span> Decision Guard — {guard.status}
            </div>
            {guard.findings.map(([f, cite]) => (
              <div className="finding" key={f}>
                <span className="sev">flag</span>
                <span>
                  {f} · <span style={{ color: 'var(--muted)' }}>{cite}</span>
                </span>
              </div>
            ))}
            {guard.findings.length === 0 && (
              <div className="finding clear">✓ no supported-pattern conflicts</div>
            )}
            <p className="advisory-note">{guard.note}</p>
          </div>
          <p className="advisory-note" style={{ marginTop: 14 }}>
            Reconstructed from the recorded demo and the Phase 16/17 arms — illustrative. In the
            real Studio nothing is applied until a load-time browser check passes and{' '}
            <em>you</em> approve the exact staged bytes.
          </p>
          <p className="why" key={`why-${memoryOn}-${corrected}`}>
            {!memoryOn ? WHY.off : corrected ? WHY.corrected : WHY.supplied}
          </p>
        </div>
      </div>
    </div>
  );
}
