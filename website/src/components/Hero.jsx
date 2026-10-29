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
          <a className="btn btn-ghost" href="#loop">
            Try the loop
          </a>
          <a className="btn btn-ghost" href="#quickstart">
            Run it locally
          </a>
        </div>
        <p className="hero-note">
          AI builders are fast at the first draft and slow at the second week.
        </p>

        <figure className="figure reveal visible" style={{ textAlign: 'left' }}>
          <img
            src="/assets/html-studio-approved-v2.jpg"
            alt="HTML Studio after approving v2 of Ocean Pairs: live preview, the remembered rule supplied to the change, Decision Guard panel, and version history"
            width="1600"
            height="807"
            loading="eager"
            fetchPriority="high"
            decoding="async"
          />
          <figcaption>
            HTML Studio after approving v2 of <em>Ocean Pairs</em> — the live preview, the
            remembered rule supplied to the change, the Decision Guard panel, and version history.
          </figcaption>
        </figure>

        <div className="container stats reveal" style={{ marginTop: 56 }}>
          <div>
            <b style={{ fontFamily: 'var(--mono)', fontSize: 22 }}>37/57 → 0/58</b>
            <span>rule violations with memory (Muse Spark)</span>
          </div>
          <div>
            <b style={{ fontFamily: 'var(--mono)', fontSize: 22 }}>49/60 → 1/60</b>
            <span>same trial on Muse Spark Open</span>
          </div>
          <div>
            <b>480</b>
            <span>pre-registered runs · exact p &lt; 10⁻¹⁹</span>
          </div>
          <div>
            <b>721</b>
            <span>passing tests · pnpm verify</span>
          </div>
        </div>
      </div>
    </section>
  );
}
