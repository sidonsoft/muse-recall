import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon.jsx';

const REPO = 'https://github.com/sidonsoft/muse-recall';

const COMMANDS = [
  ['Watch the beta demo (3:00)', '#watch'],
  ['The interactive loop', '#loop'],
  ['Memory timeline', '#timeline'],
  ['The working workflow', '#how'],
  ['What the v0.1.0 beta does', '#beta'],
  ['HTML Studio: stage, verify, approve, roll back', '#studio'],
  ['References: images, voice, video, screenshot review', '#media'],
  ['Meta SAM: isolate an object from a reference image', '#sam'],
  ['Retrieval engine', '#engine'],
  ['Decision Guard', '#guard'],
  ['Which model runs what', '#models'],
  ['Shared tools, MCP, REST, backups', '#integrate'],
  ['Evidence — Phase 17, Phase 16, beta gates', '#evidence'],
  ['For judges', '#judges'],
  ['Beyond games (FocusFlow)', '#beyond'],
  ['Screenshots', '#gallery'],
  ['Run the beta locally', '#quickstart'],
  ['Demonstrated vs not claimed', '#proof'],
  ['Known limitations', '#honesty'],
  ['This page, verified', '#sitecheck'],
  ['Source code on GitHub', REPO],
  ['v0.1.0 release', `${REPO}/releases/tag/v0.1.0`],
  ['Phase 17 results', `${REPO}/blob/main/docs/hackathon-evidence/phase17/RESULTS.md`],
  ['Recording provenance for the demo', `${REPO}/blob/main/docs/demo/video/V21_QA.md`],
];

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQ('');
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const items = useMemo(
    () => COMMANDS.filter(([l]) => l.toLowerCase().includes(q.trim().toLowerCase())),
    [q]
  );

  const go = (href) => {
    setOpen(false);
    if (href.startsWith('http')) window.open(href, '_blank', 'noopener');
    else document.querySelector(href)?.scrollIntoView({
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  };

  if (!open) return null;
  return (
    <div className="palette-backdrop" onClick={() => setOpen(false)}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Site navigation"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={q}
          aria-label="Filter site sections"
          placeholder="Jump to a section… (Enter opens the first)"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && items[0]) go(items[0][1]);
          }}
        />
        <ul>
          {items.map(([label, href]) => (
            <li key={label}>
              <button onClick={() => go(href)}>
                {label}
                {href.startsWith('http') && <span className="ext"><Icon name="external" /></span>}
              </button>
            </li>
          ))}
          {items.length === 0 && <li className="none">Nothing matches “{q}”.</li>}
        </ul>
      </div>
    </div>
  );
}
