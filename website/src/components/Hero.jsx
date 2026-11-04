import React from 'react';

const REPO = 'https://github.com/sidonsoft/muse-recall';
const RELEASE = `${REPO}/releases/latest`;

export default function Hero() {
  return (
    <section className="hero" id="top">
      <div className="container">
        <span className="eyebrow">
          <span className="dot" aria-hidden="true" /> v0.1.2 beta · local-first · single-user ·
          MIT ·{' '}
          <a href={RELEASE} target="_blank" rel="noreferrer">
            release notes
          </a>
        </span>
        <h1>
          The memory your project keeps — <span className="grad">and you can correct.</span>
        </h1>
        <p className="lede">
          <strong>Muse Recall is a local-first studio for building small browser applications with
          correctable project memory.</strong> Record the decisions a project runs on, bring in
          images, reference cutouts, recordings and screenshots, generate with the Muse Code CLI, and
          review every proposed change before it becomes the current version. Nothing becomes current
          until <em>you</em> approve it.
        </p>
        <p className="hero-note">
          <strong>Remember the brief. Bring the references. Review the change. Keep control.</strong>
          <span className="kbd-hint"> · <kbd>⌘</kbd> <kbd>K</kbd> to jump around this page</span>
        </p>
        <div className="hero-ctas">
          <a className="btn btn-primary" href={REPO} target="_blank" rel="noreferrer">
            View on GitHub
          </a>
          <a className="btn btn-ghost" href="#watch">
            Watch the 3:00 demo
          </a>
          <a className="btn btn-ghost" href="#quickstart">
            Run it locally
          </a>
          <a className="btn btn-ghost" href="#loop">
            Try the loop
          </a>
        </div>

        <div className="stats hero-stats" role="list">
          <div role="listitem">
            <b>37/57 → 0/58</b>
            <span>runs breaking the rule, memory off → on (Phase 17, Muse Spark)</span>
          </div>
          <div role="listitem">
            <b>480</b>
            <span>pre-registered runs · six fixed tasks · exact p &lt; 10⁻¹⁹</span>
          </div>
          <div role="listitem">
            <b>3:00</b>
            <span>beta demo — live calls, retained outputs, replays and fixtures, each labelled</span>
          </div>
          <div role="listitem">
            <b>7 + 7</b>
            <span>advisory Guard rule families · shared application/MCP tools</span>
          </div>
        </div>
        <p className="hero-measured">
          <strong>What was measured:</strong> each research project carried one rule (no countdowns,
          flashes or penalties in two children&apos;s games; no animation in a task planner), then the
          model was asked for a change that could break it. A detector fixed before the first run
          checked the generated source. Six fixed tasks; source code, not runtime behaviour — and not
          a verdict on general application quality or the newer media workflows.{' '}
          <a href="#evidence">Full tables</a> ·{' '}
          <a href={`${REPO}#what-is-verified`} target="_blank" rel="noreferrer">
            re-derive it yourself
          </a>
        </p>

        <figure className="figure reveal visible" style={{ textAlign: 'left' }}>
          <picture>
            <source
              srcSet="./assets/studio-beta-820.webp 820w, ./assets/studio-beta-1240.webp 1240w, ./assets/studio-beta-1600.webp 1600w"
              sizes="(max-width: 1140px) 94vw, 1140px"
              type="image/webp"
            />
            <img
              src="./assets/studio-beta.jpg"
              srcSet="./assets/studio-beta.jpg 1600w"
              sizes="(max-width: 1140px) 94vw, 1140px"
              alt="The v0.1.0 beta Studio showing the retained Palette Bench application: staged preview, media panels, the decisions supplied to a generation with their provenance, Decision Guard findings and version history."
              width="1600"
              height="900"
              loading="eager"
              {...{ fetchpriority: 'high' }}
              decoding="async"
            />
          </picture>
          <figcaption>
            The current beta Studio displaying <em>Palette Bench</em>, a retained live generation
            shown through a disposable replay of the saved project — no new model call. That
            application still carries four disclosed review findings, stated under{' '}
            <a href="#honesty">Known limitations</a>.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
