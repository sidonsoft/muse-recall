import React from 'react';

const MODELS = [
  { name: 'Muse Spark', rows: [['No memory', 37, 57], ['Recall memory', 0, 58], ['Retyped by hand', 0, 58]] },
  { name: 'Muse Spark Open', rows: [['No memory', 49, 60], ['Recall memory', 1, 60], ['Retyped by hand', 0, 60]] },
];

export default function EvidenceSection({ children }) {
  return (
    <section className="block" id="evidence">
      <div className="container">
        <div className="section-head">
          <p className="kicker">The evidence</p>
          <h2>What happened when the rule was remembered?</h2>
          <p>Fewer rule-breaking outputs on both models. Retyping the rule helped too; Recall supplies it for you.</p>
        </div>
        <div className="trial-chart-caption"><strong>Outputs breaking the saved rule</strong><span>Lower is better <span aria-hidden="true">↓</span></span></div>
        <div className="trial-charts">
          {MODELS.map(({ name, rows }) => (
            <div className="trial-chart" key={name}>
              <h3>{name}</h3>
              {rows.map(([label, count, total], index) => {
                const rate = count / total * 100;
                const formattedRate = Number(rate.toFixed(1));
                return (
                  <div className={`trial-bar trial-bar-${index}`} key={label}>
                    <div className="trial-bar-label"><span>{label}</span><span><strong>{formattedRate}%</strong><small>{count}/{total}</small></span></div>
                    <div className="trial-bar-track" aria-hidden="true"><span style={{ width: `${rate}%` }} /></div>
                  </div>
                );
              })}
              <div className="trial-axis" aria-hidden="true"><span>0%</span><span>100%</span></div>
            </div>
          ))}
        </div>
        <p className="trial-scope">Counts show violations / usable runs. The pre-registered trial attempted 480 edits across six fixed task strata and four conditions. Detection checked generated source, not runtime behaviour.</p>
        <div className="trial-links"><a href="https://github.com/sidonsoft/muse-recall/blob/main/docs/hackathon-evidence/phase17/RESULTS.md" target="_blank" rel="noreferrer">Read the results <span aria-hidden="true">↗</span></a><a href="https://github.com/sidonsoft/muse-recall#reproduce-the-evidence" target="_blank" rel="noreferrer">Reproduce the trial <span aria-hidden="true">↗</span></a></div>
        <details className="evidence-details">
          <summary>Full comparisons, corrections and study limits</summary>
          <div className="evidence-details-body">{children}</div>
        </details>
      </div>
    </section>
  );
}
