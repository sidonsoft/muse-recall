import React, { useState } from 'react';
import { DECISION_OLD, DECISION_NEW, REQUEST, SNIPPETS, guardFor } from '../loopData.js';

export default function StudioLoop() {
  const [memoryOn, setMemoryOn] = useState(true);
  const [corrected, setCorrected] = useState(false);

  const snippet = !memoryOn ? SNIPPETS.noMemory : corrected ? SNIPPETS.corrected : SNIPPETS.withMemory;
  const guard = guardFor({ memoryOn, corrected });

  return (
    <div className="demo-shell reveal">
      <div className="demo-top">
        <span className="lamp on" />
        <span className="lamp" />
        <span className="lamp" />
        <span className="title">html studio — one change request, three memory states</span>
      </div>
      <div className="loop-grid">
        <div className="loop-side">
          <h3>Project memory</h3>
          <div className="loop-toggle">
            <button
              className="switch"
              aria-pressed={memoryOn}
              onClick={() => setMemoryOn((v) => !v)}
            >
              Supply decisions to this generation
              <span className="track" aria-hidden="true" />
            </button>
            <button
              className="switch"
              aria-pressed={corrected}
              disabled={!memoryOn}
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

        <div className="loop-main">
          <h3>Staged change — preview · source · diff</h3>
          <div className="request-line">
            you: <b>“{REQUEST}”</b> → Muse Spark edits the approved v2 source
          </div>
          <div className="snippet" key={`${memoryOn}-${corrected}`}>
            {snippet.map((l, i) => (
              <div key={i} className={l.kind}>
                {l.t}
              </div>
            ))}
          </div>
          <div className="guard-panel">
            <div className="head">
              🛡 Decision Guard — {guard.status}
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
        </div>
      </div>
    </div>
  );
}
