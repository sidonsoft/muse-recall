import React from 'react';

const REPO = 'https://github.com/sidonsoft/muse-recall';

export default function Nav() {
  return (
    <header className="nav">
      <div className="container nav-inner">
        <a className="brand" href="#top" aria-label="Muse Recall home">
          <span className="brand-mark" aria-hidden="true" />
          Muse&nbsp;<em>Recall</em>
        </a>
        <nav className="nav-links" aria-label="Primary">
          <a href="#loop">The loop</a>
          <a href="#how">How it works</a>
          <a href="#evidence">Evidence</a>
          <a href="#quickstart">Run it</a>
          <a className="btn btn-primary btn-sm" href={REPO} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </nav>
      </div>
    </header>
  );
}
