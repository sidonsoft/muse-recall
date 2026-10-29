import React from 'react';
import TimelineWidget from './Timeline.jsx';
import Lightbox from './Lightbox.jsx';

const REPO = 'https://github.com/sidonsoft/muse-recall';
const RESULTS = `${REPO}/blob/main/docs/hackathon-evidence/phase17/RESULTS.md`;
const DOCS16 = `${REPO}/blob/main/docs/hackathon-evidence/phase16/EVIDENCE_CARD.md`;
const GUIDE = `${REPO}/blob/main/docs/guide/README.md`;
const CODESPACES = 'https://codespaces.new/sidonsoft/muse-recall?quickstart=1';

export function Problem() {
  const pains = [
    {
      emoji: '🔁',
      q: 'Requirements get restated.',
      a: 'A new session starts from zero, so the user explains the same constraint again.',
    },
    {
      emoji: '🧠',
      q: 'Changes forget.',
      a: 'A generated edit can drop an earlier decision; the regression appears later, when it is expensive to find.',
    },
    {
      emoji: '🕰️',
      q: 'Stale preferences persist.',
      a: 'When you change your mind, the old preference keeps coming back — a transcript does not say which decision is current.',
    },
  ];
  return (
    <section className="block" id="problem">
      <div className="container">
        <div className="section-head">
          <p className="kicker">The problem</p>
          <h2>AI builders are fast at the first draft and slow at the second week.</h2>
          <p>
            Every session starts from zero. Decisions made last week quietly stop constraining
            this week&apos;s code — and regressions resurface exactly where they cost the most.
          </p>
        </div>
        <div className="problem-grid">
          {pains.map((p) => (
            <div className="problem-card reveal" key={p.q}>
              <span className="emoji" aria-hidden="true">
                {p.emoji}
              </span>
              <div className="q">{p.q}</div>
              <p>{p.a}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function How() {
  const steps = [
    {
      n: '01 · store',
      h: 'Decisions, not chat logs',
      p: 'Each project decision gets a stable UUID, type and scope, its source session, confidence, validation status and an append-only history. Identity and provenance from day one.',
      arrow: true,
    },
    {
      n: '02 · supply',
      h: 'Memory feeds the next generation',
      p: 'Before a generate or modify job, Recall retrieves the active decisions and renders them into the prompt as bounded, escaped reference data. The job records the decision ids it received and the SHA-256 of the exact prompt.',
      arrow: true,
    },
    {
      n: '03 · review',
      h: 'Changes are staged, never applied',
      p: 'Preview, exact source and a line diff. A load-time browser gate runs before approval is even possible; the advisory Decision Guard checks the staged source against the remembered decisions. You approve, reject — or roll back to the recorded parent.',
      arrow: true,
    },
    {
      n: '04 · correct',
      h: 'Change your mind, keep the audit',
      p: 'A correction is one transaction: insert the replacement, record the supersession edge, mark the old decision superseded. It stays auditable but stops constraining new work — and replays idempotently.',
    },
  ];
  return (
    <section className="block" id="how">
      <div className="container">
        <div className="section-head">
          <p className="kicker">How it works</p>
          <h2>Store → supply → review → correct</h2>
          <p>
            One workflow with five implemented capabilities. Persistent memory is not new —
            correctable memory wired into a reviewable change loop is.
          </p>
        </div>
        <div className="steps four">
          {steps.map((s) => (
            <div className="step reveal" key={s.n}>
              <span className="num">{s.n}</span>
              <h3>{s.h}</h3>
              <p>{s.p}</p>
              {s.arrow && <span className="arrow" aria-hidden="true">→</span>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Features() {
  const feats = [
    {
      icon: '🪪',
      h: 'Identity & provenance',
      p: 'UUIDs, scope, source reference, confidence, validation status and append-only history for every decision — so “which fact is current” is a query, not a guess.',
    },
    {
      icon: '🔀',
      h: 'Transactional supersession',
      p: 'Correction replaces and edges, never erases. The superseded record stays auditable, is excluded from active retrieval, and the same correction replays idempotently.',
    },
    {
      icon: '🧾',
      h: 'Provable context',
      p: 'One prompt builder; every job records the decision ids it received and the SHA-256 of the exact prompt. Reconstruction reproduces the bytes.',
    },
    {
      icon: '🗂️',
      h: 'Immutable versions & rollback',
      p: 'Approval binds promotion to the exact verified bytes. Every approved version is immutable; rollback follows the recorded parent, even after a non-linear history.',
    },
    {
      icon: '🛡️',
      h: 'Advisory Decision Guard',
      p: 'A deterministic, dependency-free source check over five rule families. It cites the decision and a bounded evidence excerpt — and never blocks approval.',
    },
    {
      icon: '🔒',
      h: 'Local-first & sandboxed',
      p: 'Loopback only, no accounts. Previews run in an opaque-origin iframe with a restrictive CSP; cross-origin state changes are rejected before any handler runs.',
    },
  ];
  return (
    <section className="block" id="features">
      <div className="container">
        <div className="section-head center">
          <p className="kicker">Capabilities</p>
          <h2>Deterministic infrastructure around the model</h2>
          <p>
            Muse Spark does the building. Recall makes its output reviewable without replacing
            its work.
          </p>
        </div>
        <div className="features-grid">
          {feats.map((f) => (
            <div className="feature reveal" key={f.h}>
              <div className="icon" aria-hidden="true">
                {f.icon}
              </div>
              <h3>{f.h}</h3>
              <p>{f.p}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Evidence() {
  const rows = [
    ['No memory (none)', '37/57', '49/60'],
    ['Retrieved project memory (memory)', '0/58', '1/60'],
    ['Rule retyped by hand (manual)', '0/58', '0/60'],
    ['Rule corrected first (corrected)', '41/59', '50/60'],
  ];
  return (
    <section className="block" id="evidence">
      <div className="container">
        <div className="section-head">
          <p className="kicker">Evidence, honestly labelled</p>
          <h2>A pre-registered behavioural trial, not a vibe check</h2>
          <p>
            Phase 17: 480 runs — four arms × six strata (two games and a task planner) × two
            models, detector fixed and pushed before the first run. A violation is the original
            rule appearing in generated source.
          </p>
        </div>
        <div className="evidence-wrap reveal">
          <table className="evidence">
            <thead>
              <tr>
                <th scope="col">Arm</th>
                <th scope="col">Muse Spark</th>
                <th scope="col">Muse Spark Open</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([arm, a, b], i) => (
                <tr key={arm}>
                  <td>{arm}</td>
                  <td className={i === 1 ? 'good' : i === 0 ? 'bad' : undefined}>{a}</td>
                  <td className={i === 1 ? 'good' : i === 0 ? 'bad' : undefined}>{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="footnote reveal">
          Memory vs no memory: exact two-sided p = 6.5 × 10⁻²⁰ and 1.1 × 10⁻²⁴. Memory is
          non-inferior to retyping the same rule by hand (+4.5 pp and +7.1 pp upper 90% bounds,
          inside the +15 pp margin) — the point is that <em>Recall assembles the context for
          you</em>. After a permissive correction, the original-rule detector rises as expected:
          the old restriction stops constraining output. Scope is bounded: six fixed strata,
          source code rather than runtime behaviour; 8 of 240 Muse Spark runs hit the
          pre-registered time cap (0 on Open); exact p-values are a disclosed post-run
          correction.{' '}
          <a href={RESULTS} target="_blank" rel="noreferrer" style={{ color: 'var(--cyan)' }}>
            Full results &amp; verifier →
          </a>
        </p>

        <div className="section-head" style={{ marginTop: 72 }}>
          <p className="kicker">Phase 16 / 16B — the sharper question</p>
          <h2>Does the rule help — or does any memory help?</h2>
          <p>
            A palette-only arm separates the two on both models. 48 fresh edits per run set,
            through the production Studio path; violations are original-rule patterns in the
            generated source.
          </p>
        </div>
        <div className="evidence-wrap reveal">
          <table className="evidence">
            <thead>
              <tr>
                <th scope="col">Project memory supplied</th>
                <th scope="col">Muse Spark</th>
                <th scope="col">Muse Spark Open</th>
                <th scope="col">Combined</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>None</td>
                <td className="bad">12/12</td>
                <td className="bad">16/16</td>
                <td className="bad">28/28</td>
              </tr>
              <tr>
                <td>Palette decisions only</td>
                <td className="bad">12/12</td>
                <td className="bad">6/6</td>
                <td className="bad">18/18</td>
              </tr>
              <tr>
                <td>Child-safety rule + palette</td>
                <td className="good">0/13</td>
                <td className="good">0/14</td>
                <td className="good">0/27</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="footnote reveal">
          All four pre-registered contrasts (rule vs none, rule vs palette, per model; Holm,
          α&nbsp;=&nbsp;.025) are significant — largest p = 2.6 × 10⁻⁵. So it is the{' '}
          <em>rule</em>, not mere context volume, that changes generated code. Disclosed
          correction: 12 open-model outputs truncated at the token limit had been scored as
          clean; they are now unusable. Bounded: one baseline game, one request, one rule.{' '}
          <a
            href={`${DOCS16}`}
            target="_blank"
            rel="noreferrer"
            style={{ color: 'var(--cyan)' }}
          >
            Evidence card &amp; correction →
          </a>
        </p>
      </div>
    </section>
  );
}

export function Gallery() {
  const [lb, setLb] = React.useState(-1);
  const shots = [
    {
      src: './assets/studio-review.png',
      t: 'Staged for review',
      c: 'v2 waits with its live preview, the project decisions supplied to the change and the Decision Guard advisory — nothing is current until you approve it.',
    },
    {
      src: './assets/memory-detail.png',
      t: 'Memory detail',
      c: 'The superseded sunset decision, its active ocean replacement, provenance and correction history.',
    },
    {
      src: './assets/memory-retrieval.png',
      t: 'Retrieval explainer',
      c: 'Pinned records, score components, the exact rendered context cost and what was excluded — no black box.',
    },
    {
      src: './assets/conversation.png',
      t: 'Answers from memory',
      c: 'A conversation answered from the retrieved project memory, with its evidence expanded.',
    },
  ];
  return (
    <section className="block" id="gallery">
      <div className="container">
        <div className="section-head center">
          <p className="kicker">The product</p>
          <h2>Auditable at every step</h2>
          <p>Real screens from the local-first Studio.</p>
        </div>
        <div className="gallery">
          {shots.map((s, i) => (
            <figure className="reveal" key={s.src}>
              <button
                className="lb-open"
                onClick={() => setLb(i)}
                aria-label={`View full size: ${s.t}`}
              >
                ⤢ full size
              </button>
              <picture>
                <source srcSet={s.src.replace(/\.(png|jpe?g)$/, '.webp')} type="image/webp" />
                <img
                  src={s.src}
                  alt={s.c}
                  loading="lazy"
                  decoding="async"
                  width="1600"
                  height="1000"
                  onClick={() => setLb(i)}
                />
              </picture>
              <figcaption>
                <b>{s.t}</b>
                {s.c}
              </figcaption>
            </figure>
          ))}
        </div>
        {lb >= 0 && (
          <Lightbox
            shots={shots}
            index={lb}
            onClose={() => setLb(-1)}
            onMove={(d) => setLb((lb + d + shots.length) % shots.length)}
          />
        )}
      </div>
    </section>
  );
}

export function Stack() {
  return (
    <section className="block" id="stack" style={{ paddingTop: 0 }}>
      <div className="container">
        <div className="tech reveal">
          {[
            'TypeScript pnpm workspaces',
            'Fastify 5 API',
            'React 19 · Vite 7 · Tailwind 4',
            'node:sqlite + FTS5',
            'Zod contracts',
            'Muse Code CLI (Muse Spark)',
            'Muse Spark Open on Baseten (research)',
            'Playwright-managed Chromium gate',
            'Biome · Vitest · 728 tests',
            'Offline echo provider (no account needed)',
          ].map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Quickstart() {
  const [copied, setCopied] = React.useState(false);
  const copy = (e) => {
    const pre = e.currentTarget.closest('.code-shell').querySelector('pre');
    const text = pre.innerText;
    const done = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done, () => fallback());
    } else fallback();
    function fallback() {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        done();
      } catch {}
      document.body.removeChild(ta);
    }
  };
  return (
    <section className="block" id="quickstart" style={{ paddingTop: 20 }}>
      <div className="container">
        <div className="section-head">
          <p className="kicker">Try it in 60 seconds</p>
          <h2>No Muse account? No problem.</h2>
          <p>
            The seeded demo project carries three decisions — one already superseded — with v1
            approved. The offline <code>echo</code> provider means you can inspect the whole
            workflow, memory and provenance, without any inference.
          </p>
          <p>
            Or skip the install:{' '}
            <a href={CODESPACES} target="_blank" rel="noreferrer">
              open it in GitHub Codespaces
            </a>
            , which sets up the same seeded project in your browser. The{' '}
            <a href={GUIDE} target="_blank" rel="noreferrer">
              user guide
            </a>{' '}
            walks through setup, project memory and HTML Studio.
          </p>
        </div>
        <div className="code-shell reveal">
          <button className={`copy-btn${copied ? ' copied' : ''}`} onClick={copy} aria-label="Copy setup commands">
            {copied ? '✓ copied' : '⧉ copy'}
          </button>
          <pre className="code">
            <span className="cmt"># Node ≥ 24 · pnpm 10</span>{'\n'}
            git clone {REPO} muse-recall && cd muse-recall{'\n'}
            pnpm install && cp .env.example .env{'\n'}
            <span className="hl">pnpm demo:seed</span>{'        '}
            <span className="cmt"># seeded game, three decisions, v1 approved</span>{'\n'}
            <span className="hl">MODEL_PROVIDER=echo pnpm dev</span>{'  '}
            <span className="cmt"># open http://127.0.0.1:5173</span>{'\n\n'}
            <span className="cmt"># with Muse Spark on your Meta login:</span>{'\n'}
            pnpm dev{'\n\n'}
            <span className="cmt"># verify, don't trust:</span>{'\n'}
            pnpm verify{'               '}
            <span className="cmt"># lint + typecheck + 728 tests</span>
          </pre>
        </div>
      </div>
    </section>
  );
}

export function Honesty() {
  const items = [
    ['The Guard is advisory', 'It never blocks approval, checks source patterns — not rendered behaviour — and its false positives, misses and abstentions are measured and published.'],
    ['The browser gate is load-time', 'Approval loads the staged page once in managed Chromium. It does not play the game, inspect pixels or prove correctness.'],
    ['Trials are bounded', 'Six fixed strata, two rules, two models, source code measured. No general application-correctness or transfer claim.'],
    ['Corrections need an explicit request', 'The honest failure beat from the demo: the model kept the old palette until asked for the project’s current art direction.'],
    ['Single-user, loopback-only', 'No auth, no multi-tenant hosting. An origin guard blocks cross-site mutations; it is not an authentication story.'],
    ['Exports run unsandboxed', 'The Studio preview is sandboxed. A downloaded file opened from disk is an ordinary local file — and the UI says so.'],
    ['Memory doesn’t automatically save tokens', 'Measured: the CLI carries a ~16,630-token baseline; a ~4k-character memory block adds ~877. But it removes setup turns — whole-task input roughly halved in Demo C.'],
    ['Deletion is irreversible through the API', 'That is the guarantee, not a bug. Corrections keep history; deletions remove the FTS row and hide the record everywhere.'],
  ];
  return (
    <section className="block" id="honesty">
      <div className="container">
        <div className="section-head center">
          <p className="kicker">Say it plainly</p>
          <h2>Every claim carries its limits</h2>
          <p>
            The repository ships an evidence map, known-issues list and strict verifiers
            (<code>pnpm verify:research17</code>) that re-derive every count and p-value from
            the retained records.
          </p>
        </div>
        <ul className="honesty">
          {items.map(([b, p]) => (
            <li className="reveal" key={b}>
              <b>{b}</b>
              {p}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function Guard() {
  const families = [
    ['⏱️', 'Countdown mechanics', 'setInterval timers, tick loops'],
    ['⚡', 'Flashing effects', 'full-screen flash calls'],
    ['💸', 'Mistake penalties', 'score deductions, resets'],
    ['🎨', 'Superseded palettes', 'retired colours reintroduced — including hex equivalence: #FF7E5F ≡ 0xFF7E5F'],
    ['👁️', 'Colour-only cues', 'meaning carried by hue alone'],
  ];
  return (
    <section className="block" id="guard">
      <div className="container">
        <div className="section-head">
          <p className="kicker">The advisor</p>
          <h2>Decision Guard — findings with receipts, zero authority</h2>
          <p>
            A deterministic, pure, dependency-free engine checks the staged source against{' '}
            <em>that job&apos;s own decisions</em>. It cites the decision id and a bounded
            evidence excerpt, reports what it cannot verify — and never blocks approval.
            Its independent accuracy audit (measured false positives, misses and abstentions)
            is exactly why enforcement stays human.
          </p>
        </div>
        <div className="rulefams">
          {families.map(([icon, name, ex]) => (
            <div className="rulefam reveal" key={name}>
              <span className="icon" aria-hidden="true">
                {icon}
              </span>
              <div>
                <b>{name}</b>
                <p>{ex}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="footnote reveal">
          Five supported rule families over source text — it does not claim comprehensive
          compliance, and{' '}
          <a
            href={`${REPO}/tree/main/packages/decision-guard`}
            target="_blank"
            rel="noreferrer"
            style={{ color: 'var(--cyan)' }}
          >
            the engine is pure TypeScript you can read in one sitting
          </a>
          .
        </p>
      </div>
    </section>
  );
}

export function Watch() {
  return (
    <section className="block" id="watch">
      <div className="container">
        <div className="section-head center">
          <p className="kicker">Watch the demo · 2:50</p>
          <h2>Remember, correct, review — in one live session</h2>
          <p>
            One continuous Muse Spark session, recorded 29 October 2026: save a sunset constraint
            and approve v1; correct the decision to ocean; watch the Guard flag the reintroduced
            sunset palette; approve v2 built from the <em>current</em> art direction. The honest
            failure beat is left in.
          </p>
        </div>
        <figure className="figure video-figure reveal">
          <video
            controls
            playsInline
            preload="none"
            poster="./video/muse-recall-demo-poster.jpg"
            width="1920"
            height="1080"
            aria-label="Muse Recall demo video, 2 minutes 50 seconds, with burned-in captions"
          >
            <source src="./video/muse-recall-demo.mp4" type="video/mp4" />
            <track kind="captions" srcLang="en" label="English" src="./video/muse-recall-demo.en.vtt" />
            <a href="./video/muse-recall-demo.mp4">Download the demo video (mp4, 12.7 MB)</a>
          </video>
          <figcaption>
            1080p · captions burned in ·{' '}
            <a href="./video/muse-recall-demo.mp4" download>download mp4 (12.7 MB)</a> ·{' '}
            <a href="./video/muse-recall-demo-transcript.txt">transcript</a>
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

export function ForJudges() {
  const DOCS = `${REPO}/blob/main/docs`;
  const cards = [
    {
      icon: '🎬',
      h: 'Demo video — 2:50, recorded',
      p: (
        <>
          One continuous live Muse Spark session, recorded and QA&apos;d on 29 October 2026,
          with the honest failure beat left in.{' '}
          <a href="#watch">Watch it on this page</a> or{' '}
          <a href="./video/muse-recall-demo.mp4" download>download the mp4</a> ·{' '}
          <a href="./video/muse-recall-demo-transcript.txt">transcript</a>.
        </>
      ),
    },
    {
      icon: '📊',
      h: 'Behavioural evidence — pre-registered',
      p: (
        <>
          Phase 17: 480 runs, four arms × six strata × two models, detector and protocol locked
          and pushed before the first run.{' '}
          <a href={`${DOCS}/hackathon-evidence/phase17/RESULTS.md`} target="_blank" rel="noreferrer">Results</a> ·{' '}
          <a href={`${DOCS}/hackathon-evidence/phase17/STATS_CORRECTION.md`} target="_blank" rel="noreferrer">stats correction</a> ·{' '}
          <a href={`${DOCS}/hackathon-evidence/phase17/REVIEW_DISPOSITION.md`} target="_blank" rel="noreferrer">review disposition</a>.{' '}
          <code>pnpm verify:research17</code> re-derives every count and p-value from retained
          records.
        </>
      ),
    },
    {
      icon: '🔧',
      h: 'Engineering — verify, don’t trust',
      p: (
        <>
          <code>pnpm verify</code> runs lint, typecheck and 728 passing tests. A staged change
          loads in managed Chromium before it can be approved, and approval publishes exactly
          the checked bytes. Rollback follows recorded ancestry; cross-origin requests cannot
          change state.
        </>
      ),
    },
    {
      icon: '🧠',
      h: 'How Muse is used',
      p: (
        <>
          Muse Spark (via the Muse Code CLI) generates the original app and performs every
          modification. The memory layer, retrieval, prompt construction, the browser gate and
          the Decision Guard are deterministic infrastructure around it. Muse Spark Open
          (Baseten) replicated the research — the application itself never calls it.
        </>
      ),
    },
    {
      icon: '⚖️',
      h: 'Limits, stated up front',
      p: (
        <>
          Single-user and loopback-only. The Decision Guard is advisory and never blocks
          approval. Phase 17 covers six fixed strata, two rules and two models, and measures
          source code rather than runtime safety.{' '}
          <a href={`${DOCS}/KNOWN_ISSUES.md`} target="_blank" rel="noreferrer">Known issues</a>.
        </>
      ),
    },
  ];
  return (
    <section className="block" id="judges">
      <div className="container">
        <div className="section-head center">
          <p className="kicker">For judges</p>
          <h2>Everything you need, one click away</h2>
          <p>
            The repository labels every claim by evidence class — authentic Muse output,
            synthetic fixtures, deterministic replay, independent audit — in the{' '}
            <a href={`${DOCS}/submission/EVIDENCE_MAP.md`} target="_blank" rel="noreferrer">evidence map</a>.
          </p>
        </div>
        <div className="features-grid">
          {cards.map((c) => (
            <div className="feature reveal" key={c.h}>
              <div className="icon" aria-hidden="true">
                {c.icon}
              </div>
              <h3>{c.h}</h3>
              <p>{c.p}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Engine() {
  const stages = [
    ['hard filters', 'SQL pre-filters before ranking: status (active only), scope, expiry, type.'],
    ['weighted score', 'six components, shown below — and every result carries its score breakdown.'],
    ['slots & budget', '2 slots reserved for constraints/goals; then 8 memories max, 4,000 chars total, 1,000 chars per memory (truncate, never drop).'],
    ['explain', 'results ship with component scores, an evidence sentence and the exact prompt block — <code>/api/retrieval/preview</code> reproduces what a job would receive.'],
  ];
  const weights = [
    ['relevance', 40],
    ['scope', 20],
    ['confidence', 15],
    ['validation', 10],
    ['recency', 10],
    ['type priority', 5],
  ];
  return (
    <section className="block" id="engine">
      <div className="container">
        <div className="section-head">
          <p className="kicker">Under the hood</p>
          <h2>The retrieval you can inspect</h2>
          <p>
            Keyword-first (FTS5) with deterministic weighting — no opaque embeddings.
            Budgets are configuration, not architecture, and the explainer screen shows
            exactly what a generation would receive.
          </p>
        </div>
        <div className="engine reveal">
          {stages.map(([t, d], i) => (
            <div className="engine-stage" key={t}>
              <span className="num">{String(i + 1).padStart(2, '0')}</span>
              <div>
                <b>{t}</b>
                <p dangerouslySetInnerHTML={{ __html: d }} />
              </div>
              {i < stages.length - 1 && <span className="arrow" aria-hidden="true">↓</span>}
            </div>
          ))}
        </div>
        <div className="weights reveal" aria-label="Score weights">
          {weights.map(([k, v]) => (
            <div className="weight" key={k}>
              <span>{k}</span>
              <div className="bar">
                <i style={{ width: `${v * 2.5}%` }} />
              </div>
              <span className="v">{v}%</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function BeyondGames() {
  const cards = [
    {
      icon: '🧾',
      h: 'Generated: FocusFlow v1',
      p: (
        <>
          A single-file task planner — no canvas, no game loop. Attempt 1 was{' '}
          <strong>rejected</strong>: it used a native form submit the sandbox blocks, and the
          failure record is preserved. Attempt 2 (a disclosed retake with a human-written
          sandbox instruction) passed <strong>21/21</strong> browser checks and was approved.
        </>
      ),
    },
    {
      icon: '✏️',
      h: 'Modified: FocusFlow v2',
      p: (
        <>
          Muse Spark edited the approved v1 in place — adding task priorities and a
          high-priority remaining count — passed <strong>25/25</strong> checks, and was approved
          as v2. Four remembered decisions were recorded as supplied to the job.
        </>
      ),
    },
    {
      icon: '🚫',
      h: 'Refused: the countdown request',
      p: (
        <>
          A later request asked for a countdown timer. The model returned the file{' '}
          <strong>unchanged</strong>, citing the project&apos;s remembered no-countdown rule.
          The Guard honestly reported <code>not_verified</code> with 0 findings — it neither
          detected nor blocked anything there.
        </>
      ),
    },
  ];
  return (
    <section className="block" id="beyond">
      <div className="container">
        <div className="section-head">
          <p className="kicker">Beyond games</p>
          <h2>Memory that generalizes past demos</h2>
          <p>
            The videos show games. To check HTML Studio isn&apos;t game-specific, Muse Spark
            generated, modified and governed a real non-game app — refusals and all,{' '}
            <a
              href={`${REPO}/blob/main/docs/demo/NON_GAME_HTML_VALIDATION.md`}
              target="_blank"
              rel="noreferrer"
            >
              full provenance
            </a>
            .
          </p>
        </div>
        <div className="features-grid">
          {cards.map((c) => (
            <div className="feature reveal" key={c.h}>
              <div className="icon" aria-hidden="true">
                {c.icon}
              </div>
              <h3>{c.h}</h3>
              <p>{c.p}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function ProofVsRoadmap() {
  const done = [
    'Muse Spark generation and live modification of working HTML apps (Ocean Pairs; FocusFlow after a disclosed retake)',
    'Sandboxed preview, source inspection, staged diffs',
    'Persistent decisions with identity, provenance, corrections and recorded retrieval',
    'Live memory-conflict refusals on both applications',
    'A Phase 12A correction (sunset → ocean palette) with the old decision superseded and excluded from retrieval',
    'Approval, and rollback to the recorded parent — executed live on Ocean Pairs',
    'Pre-registered Phase 17 trial on two Meta models, with a published strict verifier',
  ];
  const later = [
    'Automatic enforcement — the Guard stays advisory',
    'Gameplay, interaction or pixel verification beyond the load-time gate',
    'Verified self-contained export (asset inlining) before using that label',
    'Multi-user deployment — needs auth, CSRF and isolation first',
    'Arbitrary-provider or production open-model support (research only today)',
    'Evaluation across many tasks, games or models',
  ];
  return (
    <section className="block" id="proof">
      <div className="container">
        <div className="section-head center">
          <p className="kicker">Say it plainly, again</p>
          <h2>Demonstrated — and what is not</h2>
          <p>
            Straight from the submission copy: what has live evidence, and what must not be
            read as demonstrated.
          </p>
        </div>
        <div className="two-col">
          <div className="col-card reveal">
            <h3 className="done-h">✓ Demonstrated, with evidence</h3>
            <ul className="proof">
              {done.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </div>
          <div className="col-card reveal">
            <h3 className="future-h">○ Future work — not claimed</h3>
            <ul className="future">
              {later.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

export function MemoryTimeline() {
  return (
    <section className="block" id="timeline">
      <div className="container">
        <div className="section-head">
          <p className="kicker">Memory, made visible</p>
          <h2>Muse Recall remembers <em>why</em> the project evolved</h2>
          <p>
            Every record below is real: this is the seeded demo project
            (<code>pnpm demo:seed</code>), decision texts from the Phase 12A trial verbatim,
            created through the production memory engine — never edited into a database.
            Expand any card.
          </p>
        </div>
        <TimelineWidget />
      </div>
    </section>
  );
}

export function SiteVerified() {
  return (
    <section className="block" id="sitecheck" style={{ paddingTop: 0 }}>
      <div className="container">
        <div className="sitecheck reveal">
          <div>
            <p className="kicker">Meta, but honest</p>
            <h2>This page is held to the same bar</h2>
            <p>
              The landing page runs its own test suite, same spirit as{' '}
              <code>pnpm verify</code> upstream. Reproduce it in three commands:{' '}
              <code>npm run site</code> · <code>npm run qa</code> · <code>npm run links</code> —
              every claim on this site is re-checked against the product repo on every push.
            </p>
          </div>
          <div className="stats" role="list">
            <div role="listitem"><b>26/26</b><span>headless QA checks · local + CI</span></div>
            <div role="listitem"><b>100×4</b><span>Lighthouse, mobile and desktop presets</span></div>
            <div role="listitem"><b>12/12</b><span>upstream links audited against the repo tree</span></div>
            <div role="listitem"><b>0</b><span>claims not traceable to evidence docs</span></div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function CTA() {
  return (
    <section className="block" id="cta">
      <div className="container">
        <div className="cta-band reveal">
          <h2>Correctable, reviewable memory — not a bigger context window.</h2>
          <p>
            The bet: the next step for AI-built software is project memory you can correct and a
            change you can review before it becomes current.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <a className="btn btn-primary" href={REPO} target="_blank" rel="noreferrer">
              View the source
            </a>
            <a className="btn btn-ghost" href={RESULTS} target="_blank" rel="noreferrer">
              Read the evidence
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer>
      <div className="container footer-inner">
        <span>
          © 2026 Muse Memory Lab contributors · MIT · built for the Meta Muse hackathon
        </span>
        <span className="footnote">
          This page mirrors the product repository at{' '}
          <a href={`${REPO}/commit/aaa70ca`} target="_blank" rel="noreferrer">
            <code>aaa70ca</code>
          </a>{' '}
          — every figure and quote traces to that tree.
        </span>
        <div className="footer-links">
          <a href={REPO} target="_blank" rel="noreferrer">
            muse-recall
          </a>
          <a href={`${REPO}/blob/main/docs/submission/SUBMISSION_COPY.md`} target="_blank" rel="noreferrer">
            Submission copy
          </a>
          <a href={`${REPO}/blob/main/docs/submission/EVIDENCE_MAP.md`} target="_blank" rel="noreferrer">
            Evidence map
          </a>
        </div>
      </div>
    </footer>
  );
}
