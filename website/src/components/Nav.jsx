import React from 'react';

const REPO = 'https://github.com/sidonsoft/muse-recall';
const RELEASE = `${REPO}/releases/latest`;

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
            <a href="#watch">Beta demo (3:00)</a>
            <a href="#loop">The loop</a>
            <a href="#timeline">Memory timeline</a>
            <a href="#how">The workflow</a>
            <a href="#beta">What the beta does</a>
            <a href="#studio">HTML Studio</a>
            <a href="#media">References &amp; media</a>
            <a href="#sam">Meta SAM cutouts</a>
            <a href="#engine">Retrieval engine</a>
            <a href="#guard">Decision Guard</a>
            <a href="#models">Which model, where</a>
            <a href="#integrate">Tools, MCP, REST, backups</a>
            <a href="#evidence">Evidence</a>
            <a href="#judges">For judges</a>
            <a href="#beyond">Beyond games</a>
            <a href="#gallery">Screenshots</a>
            <a href="#quickstart">Run it</a>
            <a href="#proof">Demonstrated vs not claimed</a>
            <a href="#honesty">Known limitations</a>
            <a href={RELEASE} target="_blank" rel="noreferrer">
              Latest beta release
            </a>
          </div>
        </details>
        <nav className="nav-links" aria-label="Primary">
          <a href="#watch">Demo</a>
          <a href="#loop">The loop</a>
          <a href="#beta">Capabilities</a>
          <a href="#sam">SAM cutouts</a>
          <a href="#evidence">Evidence</a>
          <a href="#judges">For judges</a>
          <a href="#quickstart">Run it</a>
          <a className="btn btn-primary btn-sm" href={REPO} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </nav>
      </div>
    </header>
  );
}
