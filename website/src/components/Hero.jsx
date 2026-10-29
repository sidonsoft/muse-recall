import React from 'react';

const REPO = 'https://github.com/sidonsoft/muse-recall';

export default function Hero() {
  return (
    <section className="hero" id="top">
      <div className="container">
        <span className="eyebrow">
          <span className="dot" aria-hidden="true" /> Meta Muse hackathon · &ldquo;Push the
          Frontier&rdquo; · MIT
        </span>
        <h1>
          Correctable project memory for{' '}
          <span className="grad">AI-built software.</span>
        </h1>
        <p className="lede">
          Muse Recall is a local-first <strong>HTML Studio</strong> for Meta&apos;s Muse Spark.
          Describe a browser app and Spark writes it; ask for a change and it edits the approved
          source. Project decisions persist with identity and provenance — and you can correct
          them. Nothing becomes the approved version until <em>you</em> review and approve it.
        </p>
        <div className="hero-ctas">
          <a className="btn btn-primary" href={REPO} target="_blank" rel="noreferrer">
            View on GitHub
          </a>
          <a className="btn btn-ghost" href="#watch">
            Watch the demo
          </a>
          <a className="btn btn-ghost" href="#loop">
            Try the loop
          </a>
          <a className="btn btn-ghost" href="#quickstart">
            Run it locally
          </a>
        </div>
        <p className="hero-note">
          AI builders are fast at the first draft and slow at the second week.
          <span className="kbd-hint"> · <kbd>⌘</kbd> <kbd>K</kbd> to jump around this page</span>
        </p>

        <div className="stats hero-stats" role="list">
          <div role="listitem">
            <b>37/57 → 0/58</b>
            <span>runs breaking the rule, without → with memory (Muse Spark)</span>
          </div>
          <div role="listitem">
            <b>49/60 → 1/60</b>
            <span>same trial on Muse Spark Open</span>
          </div>
          <div role="listitem">
            <b>480</b>
            <span>pre-registered runs · exact p &lt; 10⁻¹⁹</span>
          </div>
          <div role="listitem">
            <b>0/58 · 0/60</b>
            <span>same rule retyped by hand into every request</span>
          </div>
        </div>
        <p className="hero-measured">
          <strong>What was measured:</strong> each project carried one rule (no countdowns,
          flashes or penalties in two children&apos;s games; no animation in a task planner), then
          Muse was asked for a change that could break it. A detector fixed before the first run
          checked the generated source. Six fixed tasks; source code, not runtime behaviour.{' '}
          <a href="#evidence">Full table</a> ·{' '}
          <a href={`${REPO}#reproduce-the-evidence`} target="_blank" rel="noreferrer">
            re-derive it yourself
          </a>
        </p>

        <figure className="figure reveal visible" style={{ textAlign: 'left' }}>
          <picture>
            <source
              srcSet="./assets/html-studio-820.webp 820w, ./assets/html-studio-1240.webp 1240w, ./assets/html-studio-approved-v2.webp 1600w"
              sizes="(max-width: 1140px) 94vw, 1140px"
              type="image/webp"
            />
            <img
              src="./assets/html-studio-approved-v2.jpg"
              srcSet="./assets/html-studio-approved-v2.jpg 1600w"
              sizes="(max-width: 1140px) 94vw, 1140px"
              alt="HTML Studio after approving v2 of Ocean Pairs: live preview, the remembered rule supplied to the change, Decision Guard panel, and version history"
              width="1600"
              height="807"
              loading="eager"
              {...{ fetchpriority: 'high' }}
              decoding="async"
            />
          </picture>
          <figcaption>
            HTML Studio after approving v2 of <em>Ocean Pairs</em> — the live preview, the
            remembered rule supplied to the change, the Decision Guard panel, and version history.
          </figcaption>
        </figure>

      </div>
    </section>
  );
}
