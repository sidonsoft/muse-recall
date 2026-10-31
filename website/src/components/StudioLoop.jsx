import React, { useState } from 'react';
import { DECISION_OLD, DECISION_NEW, REQUEST, SNIPPETS, guardFor } from '../loopData.js';
import Icon from './Icon.jsx';

const WHY = {
  supplied:
    'The saved rule is supplied with the request. This example keeps the calm game mechanics.',
  off: 'The rule was left out of the prompt. This example adds the timer, penalty and flashing effect.',
  corrected:
    'The old rule is retired. The corrected decision now allows timers and penalties.',
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
          <div className="memory-controls">
          <div className="loop-toggle">
            <button
              className="switch"
              role="switch"
              aria-checked={memoryOn}
              onClick={() => setMemoryOn((v) => !v)}
            >
              Include saved decisions
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
              Correct the rule
              <span className="track" aria-hidden="true" />
            </button>
          </div>

          {corrected && (
            <div className="decision-card">
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
        </div>

        <div className="loop-main" aria-live="polite">
          <h3>The change you ask for</h3>
          <div className="request-pictures" role="img" aria-label={`Your request: ${REQUEST}. Muse Spark prepares an edit to the approved v2 source.`}>
            <div className="request-feature"><Icon name="timer" /><strong>3s</strong><span>countdown</span></div>
            <span className="request-plus" aria-hidden="true">+</span>
            <div className="request-feature"><Icon name="banknote" /><strong>−3</strong><span>per miss</span></div>
            <span className="request-arrow" aria-hidden="true"><Icon name="right" /></span>
            <div className="request-result"><Icon name="pencil" /><strong>AI edit</strong><span>v2 → v3</span></div>
          </div>
          <div className="snippet" key={`snip-${memoryOn}-${corrected}`}>
            {snippet.map((l, i) => (
              <div key={i} className={l.kind}>
                {l.t}
              </div>
            ))}
          </div>
          <div className={`guard-panel guard-compact ${guard.findings.length ? 'has-conflicts' : ''}`}>
            <div className="guard-overview">
              <span className="guard-overview-icon"><Icon name="shield" /></span>
              <div><h4>Decision Guard</h4><p>{guard.findings.length ? '3 possible conflicts' : corrected && memoryOn ? 'Old rule retired' : 'No supported conflicts found'}</p></div>
              <strong className="guard-count">{guard.findings.length}</strong>
            </div>
            {guard.findings.length > 0 && (
              <div className="guard-chips">
                <span><Icon name="timer" /> Countdown</span><span><Icon name="banknote" /> Penalty</span><span><Icon name="zap" /> Flash</span>
              </div>
            )}
            <div className="guard-bottom"><span>Advice only. You approve.</span><details><summary>Details</summary><div><p>{guard.note}</p>{guard.findings.map(([finding, cite]) => <p key={finding}>{finding} · {cite}</p>)}</div></details></div>
          </div>
          <p className="advisory-note" style={{ marginTop: 14 }}>
            Interactive example based on the recorded demo. In the Studio, you review and approve the staged source.
          </p>
          <p className="why" key={`why-${memoryOn}-${corrected}`}>
            {!memoryOn ? WHY.off : corrected ? WHY.corrected : WHY.supplied}
          </p>
        </div>
      </div>
    </div>
  );
}
