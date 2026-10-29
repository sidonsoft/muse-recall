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
        <details className="nav-menu">
          <summary>Menu</summary>
          <div className="nav-menu-panel" onClick={(e) => { if (e.target.tagName === 'A') e.currentTarget.closest('details').removeAttribute('open'); }}>
            <a href="#watch">Demo video</a>
            <a href="#loop">The loop</a>
            <a href="#timeline">Timeline</a>
            <a href="#how">How it works</a>
            <a href="#engine">Retrieval engine</a>
            <a href="#guard">Decision Guard</a>
            <a href="#evidence">Evidence</a>
            <a href="#judges">For judges</a>
            <a href="#beyond">Beyond games</a>
            <a href="#gallery">Screenshots</a>
            <a href="#quickstart">Run it</a>
            <a href="#proof">Demonstrated vs future</a>
            <a href="#honesty">Known limitations</a>
          </div>
        </details>
        <nav className="nav-links" aria-label="Primary">
          <a href="#watch">Demo</a>
          <a href="#loop">The loop</a>
          <a href="#timeline">Timeline</a>
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
