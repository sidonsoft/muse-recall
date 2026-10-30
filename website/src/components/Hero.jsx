import React from 'react';
import HeroMemoryGraphic from './HeroMemoryGraphic.jsx';

const REPO = 'https://github.com/sidonsoft/muse-recall';

export default function Hero() {
  return (
    <section className="hero hero-redesign" id="top">
      <div className="container">
        <div className="hero-intro">
          <div className="hero-copy">
            <h1>Your project decisions, <span className="grad">remembered.</span></h1>
            <p className="lede">
              Muse Recall carries your decisions into later AI edits. Review each change,
              correct what has changed, and approve what becomes the next version.
            </p>
            <div className="hero-ctas">
              <a className="btn btn-primary" href="#watch">Watch the demo <span aria-hidden="true">↗</span></a>
              <a className="btn btn-ghost" href={REPO} target="_blank" rel="noreferrer">View on GitHub <span aria-hidden="true">↗</span></a>
            </div>
            <p className="hero-context">Built for Meta&apos;s Muse Spark <span aria-hidden="true">·</span> MIT licensed</p>
          </div>
          <HeroMemoryGraphic />
        </div>
        <div className="hero-path" aria-label="The Muse Recall workflow">
          <div><span>01</span><p><strong>Remember</strong> the decisions that matter.</p></div>
          <div><span>02</span><p><strong>Review</strong> the proposed change.</p></div>
          <div><span>03</span><p><strong>Correct</strong> a decision when it changes.</p></div>
        </div>
        <div className="hero-bottom"><span>Your next session shouldn&apos;t start from scratch.</span><a href="#loop">Explore the example <span aria-hidden="true">↓</span></a></div>
      </div>
    </section>
  );
}
