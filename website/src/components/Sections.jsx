import React from 'react';
import TimelineWidget from './Timeline.jsx';
import Lightbox from './Lightbox.jsx';
import Icon from './Icon.jsx';

const REPO = 'https://github.com/sidonsoft/muse-recall';
const RELEASE = `${REPO}/releases/tag/v0.1.0`;
const RELEASE_SHA = `${REPO}/commit/707921db83a374d155d3929ef9b99092bcd4e8f1`;
const RESULTS = `${REPO}/blob/main/docs/hackathon-evidence/phase17/RESULTS.md`;
const STATS17 = `${REPO}/blob/main/docs/hackathon-evidence/phase17/STATS_CORRECTION.md`;
const DOCS16 = `${REPO}/blob/main/docs/hackathon-evidence/phase16/EVIDENCE_CARD.md`;
const GUIDE = `${REPO}/blob/main/docs/guide/README.md`;
const JUDGES = `${REPO}/blob/main/docs/guide/FOR_JUDGES.md`;
const CODESPACES = 'https://codespaces.new/sidonsoft/muse-recall?quickstart=1';
const LIMITS = `${REPO}/blob/main/docs/guide/limitations.md`;
const MEDIA = `${REPO}/blob/main/docs/MULTIMODAL_STUDIO_STATUS.md`;
const GATE = `${REPO}/blob/main/docs/beta/RELEASE-GATE.md`;
const ISSUES = `${REPO}/blob/main/docs/KNOWN_ISSUES.md`;
const DEMOQA = `${REPO}/blob/main/docs/demo/video/V21_QA.md`;
const EVMAP = `${REPO}/blob/main/docs/submission/EVIDENCE_MAP.md`;
const RUNBOOKS = `${REPO}/blob/main/docs/ops/OPERATOR_RUNBOOKS.md`;
const STUDBGUIDE = `${REPO}/blob/main/docs/guide/html-studio.md`;
const MEMORYGUIDE = `${REPO}/blob/main/docs/guide/project-memory.md`;
const RUNOTES = `${REPO}/blob/main/docs/release/notes/v0.1.0-beta.md`;
const ARCH = `${REPO}/blob/main/docs/ARCHITECTURE_OVERVIEW.md`;

/* One shared vocabulary, used everywhere the page describes footage or results:
   recorded live call · retained model output · product replay · deterministic fixture. */
const CLASSES = [
  ['Recorded live call', 'a screen recording of a real provider call made during the build'],
  ['Retained model output', 'bytes a provider already returned, reused later without a new call'],
  ['Product replay', 'the real app walking through saved data again — no inference happens'],
  ['Deterministic fixture', 'a scripted response or stub used by an offline gate'],
];

function ClassKey() {
  return (
    <p className="footnote reveal">
      <b>Evidence classes used on this page.</b>{' '}
      {CLASSES.map(([name, gloss], i) => (
        <React.Fragment key={name}>
          {i > 0 && <span> · </span>}
          <b>{name}</b> — {gloss}
        </React.Fragment>
      ))}
      . Every demo beat, screenshot and number below is tagged with one of them.
    </p>
  );
}

/* ── The three-minute beta demo ──────────────────────────────────────────────
   The player, four links and one scope line. Beat-by-beat evidence classes,
   caption counts, narration production and the earlier cuts live in
   docs/demo/video/V21_QA.md — the labels that matter to a viewer are carried
   inside the video itself. */
export function Watch() {
  return (
    <section className="block" id="watch">
      <div className="container">
        <div className="section-head center">
          <p className="kicker">Watch the beta demo · 3:00</p>
          <h2>Remember the brief. Bring the references. Review the change.</h2>
          <p>
            Watch Muse Recall turn project decisions into a reviewable application workflow, with
            correctable memory, media references and Meta SAM — including the one correction the
            model did not apply until it was asked for explicitly.
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
            aria-label="Muse Recall beta demo, three minutes. Captions are burned into the video; the same text is also available as a WebVTT track and a plain-text transcript below."
          >
            <source src="./video/muse-recall-demo.mp4" type="video/mp4" />
            {/* Captions are burned into the picture, so the sidecar track is offered but not
                switched on by default: showing both would double-render the same text. */}
            <track kind="captions" srcLang="en" label="English (same text as burned in)" src="./video/muse-recall-demo.en.vtt" />
            <a href="./video/muse-recall-demo.mp4">Download the demo video</a>
          </video>
          <figcaption>
            Captions are burned into the picture, and the player offers the same text as a caption
            track.{' '}
            <a href="./video/muse-recall-demo.mp4" download>Download video</a> ·{' '}
            <a href="./video/muse-recall-demo.en.vtt" download>Captions</a> ·{' '}
            <a href="./video/muse-recall-demo-transcript.txt">Transcript</a> ·{' '}
            <a href={DEMOQA} target="_blank" rel="noreferrer">
              Recording details
            </a>
          </figcaption>
        </figure>
        <p className="footnote reveal">
          The demo combines recorded live model calls with retained outputs and labelled replays or
          fixtures.
        </p>
      </div>
    </section>
  );
}

export function Problem() {
  const pains = [
    {
      emoji: 'repeat',
      q: 'Requirements get restated.',
      a: 'A new session starts from zero, so the user explains the same constraint again.',
    },
    {
      emoji: 'brain',
      q: 'Changes forget.',
      a: 'A generated edit can drop an earlier decision; the regression appears later, when it is expensive to find.',
    },
    {
      emoji: 'history',
      q: 'Stale preferences persist.',
      a: 'When you change your mind, the old preference keeps coming back — a transcript does not say which decision is current.',
    },
    {
      emoji: 'layers',
      q: 'References stay outside the brief.',
      a: 'The image, the recording and the screenshot you keep re-explaining never make it into the request that builds the app.',
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
            this week&apos;s code — regressions resurface where they cost the most, and the
            references you keep re-explaining never reach the request that builds the application.
          </p>
        </div>
        <div className="problem-grid">
          {pains.map((p) => (
            <div className="problem-card reveal" key={p.q}>
              <span className="emoji" aria-hidden="true">
                <Icon name={p.emoji} />
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

/* ── The working workflow: what a session actually looks like ───────────────── */
export function How() {
  const steps = [
    {
      n: '01 · remember',
      h: 'Record the decision once',
      p: '“No countdown timers or flashing effects.” “Art direction: cool ocean palette.” Each decision keeps a stable id, its type and scope, the session that stored it, confidence, validation status and an append-only history.',
      arrow: true,
    },
    {
      n: '02 · bring the brief',
      h: 'Add the references you keep re-explaining',
      p: 'Generate or upload image assets, isolate an object out of a reference image, record or upload voice and video, and ask for decision drafts from a frame. Suggested decisions wait for you — nothing is written without your confirmation.',
      arrow: true,
    },
    {
      n: '03 · supply & generate',
      h: 'Retrieval assembles the context',
      p: 'Before a generate or modify job, Recall retrieves the active decisions and renders them into the prompt as bounded, escaped reference data. The job records which decisions and which revisions it received, plus the SHA-256 of the exact prompt.',
      arrow: true,
    },
    {
      n: '04 · review & correct',
      h: 'Nothing becomes current without you',
      p: 'Preview, exact source and a line diff. A load-time browser check runs before approval is even possible. Approve, reject, or roll a version back to its recorded parent. Correct a decision and the replacement is active while the old record stays auditable.',
    },
  ];
  return (
    <section className="block" id="how">
      <div className="container">
        <div className="section-head">
          <p className="kicker">The workflow</p>
          <h2>Remember → bring the brief → supply and generate → review and correct</h2>
          <p>
            This is the loop the beta runs, from the first request to the change that conflicts
            with something the project already decided. Memory supplies context for the next
            generation; you still decide what becomes the approved version.
          </p>
        </div>
        <div className="steps four">
          {steps.map((s) => (
            <div className="step reveal" key={s.n}>
              <span className="num">{s.n}</span>
              <h3>{s.h}</h3>
              <p>{s.p}</p>
              {s.arrow && (
                <span className="arrow" aria-hidden="true">
                  <Icon name="right" />
                </span>
              )}
            </div>
          ))}
        </div>
        <div className="advisory-note reveal">
          <b>The correction that did not apply itself.</b> In the recorded session the demo opens
          with, the corrected decision made the old sunset palette stale — and the next generated
          proposal used it anyway. The Guard flagged it as a finding, the reviewer rejected the
          proposal, and only an explicit request to follow the project&apos;s current decisions
          produced the corrected source. A memory correction changes what future generations
          receive; it does not rewrite an approved application on its own.
        </div>
      </div>
    </section>
  );
}

/* ── What the beta can do, at a glance ─────────────────────────────────────── */
export function Features() {
  const feats = [
    {
      icon: 'idcard',
      h: 'Correctable memory, with provenance',
      p: 'UUIDs, type, scope, source reference, confidence, validation status and append-only history for every decision. Supersession is one transaction: insert the replacement, record the edge, mark the old record superseded and stop retrieving it. “Which fact is current” is a query, not a guess.',
    },
    {
      icon: 'receipt',
      h: 'Generation context you can read back',
      p: 'Each job records the decision ids it was supplied and the exact revision of each one, alongside the SHA-256 of the prompt it was given. A retrieval preview reproduces the block a job would receive — later edits stay distinguishable from what that job actually saw.',
    },
    {
      icon: 'history',
      h: 'Memory tools for a project that keeps changing',
      p: 'A review queue for proposed decisions, a timeline of how decisions evolved, and a relationship map of what superseded what. Versioned export/import carries records, history and supersession links between installs.',
    },
    {
      icon: 'wrench',
      h: 'Staged HTML Studio',
      p: 'The Muse Code CLI generates or modifies one index.html. Preview, source and changes; approve or reject; immutable versions; rollback that follows recorded ancestry. Copy source and Download HTML hand over the exact served bytes.',
    },
    {
      icon: 'palette',
      h: 'Images that end up inside the application',
      p: 'Generate or edit an asset, review its versions, approve one, then insert it as an asset reference into a request. Approved references are embedded in the published HTML with integrity records.',
    },
    {
      icon: 'search',
      h: 'Meta SAM: cut an object out of a reference image',
      p: 'Name an object, get matches with boxes and masks, inspect each preview, keep the transparent cutout as a versioned asset with segmentation provenance, approve it, and insert it into an application request.',
    },
    {
      icon: 'video',
      h: 'Voice and video as project sources',
      p: 'Record or upload, play back through the API, download, transcribe speech, and ask for timed observations about a clip. Reference workflows — the beta does not generate audio or video.',
    },
    {
      icon: 'eye',
      h: 'Two advisory reviewers',
      p: 'Decision Guard checks staged source across seven supported rule families. Screenshot review compares a captured frame against the decision revisions you pin. Both report findings; neither changes the application, publishes a version or writes memory.',
    },
    {
      icon: 'layers',
      h: 'One contract, several doors',
      p: 'Seven shared tools behind both the application and an MCP stdio server; a REST API with a machine-readable error catalogue and idempotent replay on supported writes; database and media backup, restore drills, recovery summaries and a damaged-state repair path.',
    },
  ];
  return (
    <section className="block" id="beta">
      <div className="container">
        <div className="section-head center">
          <p className="kicker">v0.1.0 beta · what it does</p>
          <h2>Deterministic infrastructure around the model</h2>
          <p>
            The coding CLI writes the application; Meta media APIs carry images, segmentation,
            speech and vision tasks. Muse Recall is what makes the result inspectable — with
            memory, references and review in one local workspace.
          </p>
        </div>
        <div className="features-grid">
          {feats.map((f) => (
            <div className="feature reveal" key={f.h}>
              <div className="icon" aria-hidden="true">
                <Icon name={f.icon} />
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

/* ── HTML Studio ───────────────────────────────────────────────────────────── */
export function Studio() {
  const items = [
    ['Generate and modify', 'Forge is the generation workflow behind HTML Studio: the Muse Code CLI is handed the request plus the retrieved decisions, and returns one index.html with inline CSS and JavaScript. “Change this app” and “New app” are separate rails.'],
    ['Staged, never applied', 'Preview, Source and Changes. A proposal waits for your decision; rejecting it leaves the approved version exactly as it was.'],
    ['A check before approval is possible', 'Syntax and structure checks, then a load-time browser check: page errors, relevant console errors, blocked requests, a blank render, or a Phaser document that creates no canvas. That is the whole automated gate — it does not click, play, judge design or prove correctness.'],
    ['Approve the bytes you read', 'Approval publishes the exact prepared bytes that were checked, including resolved assets and bundled dependencies — not a re-render of them.'],
    ['History, ancestry, rollback', 'Every approved version is immutable and listed. Restore follows the recorded parent, even after a non-linear history, and says plainly that the restore itself is not undoable from that screen.'],
    ['Copy and download are exact', 'Copy source and Download HTML hand over the bytes the endpoint serves, checked byte for byte by the release gate. A human review once found a copy control that handed over output the application was no longer displaying (KI-88), and the gate now refuses that class of drift.'],
    ['Restart recovery', 'Interrupted or damaged jobs are reported rather than hidden: recovery state, a storage check, and an inspect/repair path for a damaged workspace.'],
  ];
  const deps = [
    ['Bundled', 'The engine is inside the bytes being approved. The supported pin is Phaser 3.80.1 and it is the only engine carried, at a cost of about 1.18 MB per game artifact.'],
    ['Fetched', 'These bytes will ask a remote host when they run. Artifacts approved before the bundling decision keep their CDN reference and stay valid under the older per-document network policy.'],
    ['Blocked', 'A remote request was refused during verification.'],
    ['No record', 'Versions approved before the record existed are reported as “no dependency record was kept for these bytes” — nothing reconstructs a picture the approver never saw.'],
  ];
  return (
    <section className="block" id="studio">
      <div className="container">
        <div className="section-head">
          <p className="kicker">HTML Studio</p>
          <h2>Every application change is staged, checked and reversible</h2>
          <p>
            Generation and modification run through the <b>Muse Code CLI</b> (<code>muse</code>),
            which runs as the server&apos;s local user under its own policy controls. What follows
            is the deterministic path a proposal travels before it can become the current version.
          </p>
        </div>
        <div className="features-grid">
          {items.map(([h, p]) => (
            <div className="feature reveal" key={h}>
              <h3>{h}</h3>
              <p>{p}</p>
            </div>
          ))}
        </div>

        <h3 className="sub-h reveal">What the approval panel discloses about dependencies</h3>
        <div className="features-grid grid-4">
          {deps.map(([h, p]) => (
            <div className="feature reveal" key={h}>
              <h3>{h}</h3>
              <p>{p}</p>
            </div>
          ))}
        </div>
        <p className="footnote reveal">
          The disclosure reads the bytes it would write, not what the model claimed, and it states
          its own limit next to the list: a request whose URL is assembled at runtime cannot be
          enumerated. <a href={STUDBGUIDE} target="_blank" rel="noreferrer">HTML Studio guide →</a>{' '}
          · <a href={ISSUES} target="_blank" rel="noreferrer">KI-53, KI-74 and KI-88 →</a>
        </p>

        <figure className="figure reveal">
          <picture>
            <source srcSet="./assets/screenshot-review.webp" type="image/webp" />
            <img
              src="./assets/screenshot-review.png"
              alt="The expanded beta Studio: selected decision revisions, screenshot-review findings, the staged preview, Decision Guard findings and the dependency disclosure."
              loading="lazy"
              decoding="async"
              width="1440"
              height="1000"
            />
          </picture>
          <figcaption>
            The real beta interface from the deterministic screenshot-review browser test. Both the
            application and the review response are a <b>deterministic fixture</b>: this shows the
            interface and the boundaries it enforces, not live model judgement.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

/* ── References, images, voice, video ──────────────────────────────────────── */
export function Media() {
  const cards = [
    {
      icon: 'palette',
      h: 'Image assets: generate, edit, approve, embed',
      p: 'Describe an image and generate it, upload your own, or edit an approved asset into a new version of the same asset. Each version is a candidate until you approve it. Insert reference puts a muse-asset:// reference into a request, and the approved asset is embedded into the published HTML with an integrity record — the live chain check kept one image byte-identical across a server restart and a rollback.',
    },
    {
      icon: 'video',
      h: 'Voice and video: sources, not generations',
      p: 'Record from the browser or upload a file, then play it back, download it, transcribe speech, or request timed observations about a clip. Playback goes through the API and plays from blob URLs, so an access token never appears in a URL and is never logged. These features assemble the brief; they do not approve anything.',
    },
    {
      icon: 'eye',
      h: 'Vision-proposed decision drafts',
      p: 'Send a reference image to a vision model and it proposes decision drafts. They arrive in the memory review queue as drafts: accept, edit or dismiss. Dismissing leaves no memory record; rejecting leaves an unaddressable tombstone. Their value over asking the coding model directly has not been measured, and the product says so.',
    },
    {
      icon: 'search',
      h: 'Screenshot review against pinned revisions',
      p: 'Capture the preview and compare that frame against the decision revisions you select — pinned, so the finding can be audited against the exact text that was supplied. Findings and uncertainty only: no new version, no staged file, no memory write, at most one paid call, and a replay with the same key returns byte-identical output at no cost.',
    },
    {
      icon: 'receipt',
      h: 'Versioned sources and provenance',
      p: 'Media sources, assets and versions are stored with provenance: what was uploaded, what a provider returned, what a cutout came from and which parent version it derives from. Retained provider bytes can be reused later without spending a new call, and the UI keeps saying which is which.',
    },
    {
      icon: 'shield',
      h: 'Media needs its own credential',
      p: 'Image generation and editing, segmentation, transcription, clip observation and screenshot review call the media API and need a server-side FORGE_MUSE_API_KEY; a CLI login alone does not configure them. Provider operations spend quota and can cost money, and a quota failure surfaces as a provider error rather than a silent success.',
    },
  ];
  return (
    <section className="block" id="media">
      <div className="container">
        <div className="section-head">
          <p className="kicker">References &amp; media</p>
          <h2>The brief stops living in the chat transcript</h2>
          <p>
            Images, reference cutouts, recordings and screenshots join the same workflow that
            builds the application — each one stored with provenance, staged for approval and
            inserted into a request only after you approve it.
          </p>
        </div>
        <div className="features-grid">
          {cards.map((c) => (
            <div className="feature reveal" key={c.h}>
              <div className="icon" aria-hidden="true">
                <Icon name={c.icon} />
              </div>
              <h3>{c.h}</h3>
              <p>{c.p}</p>
            </div>
          ))}
        </div>

        <div className="media-pair reveal">
          <figure className="figure">
            <picture>
              <source srcSet="./assets/image-generated.webp" type="image/webp" />
              <img
                src="./assets/image-generated.png"
                alt="A generated image asset returned by the media image API: a field scene dominated by green with red accents."
                loading="lazy"
                decoding="async"
                width="800"
                height="800"
              />
            </picture>
            <figcaption>
              <b>Generated</b> — one dispatch on the images generation path; the stored bytes decode
              to 1600×1600 (the model chose the canvas), 1,376 distinct colours, and the measured
              colour mix matches the subject asked for. <b>Retained live model output</b>.
            </figcaption>
          </figure>
          <figure className="figure">
            <picture>
              <source srcSet="./assets/image-edited.webp" type="image/webp" />
              <img
                src="./assets/image-edited.png"
                alt="The edited version of the same image asset, now with a blue circular element while the original green field and red accents remain."
                loading="lazy"
                decoding="async"
                width="800"
                height="800"
              />
            </picture>
            <figcaption>
              <b>Edited</b> — a new version of the same asset: blue-dominant pixels appear (2.4%)
              while red (19.1%) and green (78.5%) survive, so the edit added what was asked without
              discarding the scene. <b>Retained live model output</b>.
            </figcaption>
          </figure>
        </div>
        <p className="footnote reveal">
          One successful asset workflow from the 2 November measurement, not a quality benchmark.
          The live records and their scope — including the failed attempts and the total paid calls
          — are in the{' '}
          <a href={MEDIA} target="_blank" rel="noreferrer">
            multimodal status record →
          </a>
        </p>
      </div>
    </section>
  );
}

/* ── Meta SAM, in its own visible place ────────────────────────────────────── */
export function Sam() {
  const steps = [
    ['Pick a reference version', 'Upload or select an image asset version in the Media panel, then open that version’s reference actions and choose the segmentation mode.'],
    ['Name the object', 'Type the concept you want isolated — a plain phrase, not a mask. The request is a segmentation call against that one version, and the response records the model, the latency and the attempts.'],
    ['Inspect every match', 'SAM returns matches with a bounding box, mask dimensions, confidence and raster. Each match renders as an inspectable preview image, so selection is a review, not a guess. A genuine zero-match response is treated as a valid empty result, never as an error.'],
    ['Keep the transparent cutout', 'Saving a match writes a new asset version: RGBA PNG with the alpha channel preserved, segment provenance (concept, box, parent asset and version) and a link back to the reference it came from.'],
    ['Approve, then insert', 'The cutout is a candidate until approved. Insert reference puts its muse-asset:// asset-and-version pointer into the change request. Starting the coding job is still a separate, explicit action.'],
  ];
  return (
    <section className="block" id="sam">
      <div className="container">
        <div className="section-head">
          <p className="kicker">Reference cutouts · Meta SAM</p>
          <h2>Select the object. Keep the transparency. Approve it. Insert it.</h2>
          <p>
            <b>Meta&apos;s SAM isolates an object from a reference image.</b> Bring a screenshot or
            photo into the project, name the thing you want out of it, and the isolated cutout
            becomes a versioned asset in the same panel as generated images — with its alpha channel
            intact, ready to be approved and referenced by an application request.
          </p>
        </div>
        <div className="engine reveal">
          {steps.map(([t, d], i) => (
            <div className="engine-stage" key={t}>
              <span className="num">{String(i + 1).padStart(2, '0')}</span>
              <div>
                <b>{t}</b>
                <p>{d}</p>
              </div>
              {i < steps.length - 1 && (
                <span className="arrow" aria-hidden="true">
                  <Icon name="down" />
                </span>
              )}
            </div>
          ))}
        </div>

        <div className="media-pair reveal">
          <figure className="figure">
            <picture>
              <source srcSet="./assets/demo-sam-cutout.webp" type="image/webp" />
              <img
                src="./assets/demo-sam-cutout.jpg"
                alt="Demo still at 1:45: a reference image of a farm-animal memory game beside the isolated Restart button cutout shown on a transparency checkerboard."
                loading="lazy"
                decoding="async"
                width="1920"
                height="1080"
              />
            </picture>
            <figcaption>
              <b>Demo card at 1:45</b>, assembled around the retained output: the reference image is
              an approved generated page, and the object SAM isolated from it is that page&apos;s
              Restart button, shown on transparency. <b>Retained live SAM output</b> — the card is
              labelled &quot;actual retained Meta SAM result&quot; in the cut, and building it made
              no new call.
            </figcaption>
          </figure>
          <figure className="figure">
            <picture>
              <source srcSet="./assets/demo-sam-insert.webp" type="image/webp" />
              <img
                src="./assets/demo-sam-insert.jpg"
                alt="Demo still at 1:53: the Media panel with approved asset versions and insert-reference controls, next to a change request containing a muse-asset reference."
                loading="lazy"
                decoding="async"
                width="1920"
                height="1080"
              />
            </picture>
            <figcaption>
              <b>Still from the demo at 1:53</b> — the approved cutout and its asset versions in the
              Media panel, and a change request carrying{' '}
              <code>muse-asset://…/v1</code> in the Development rail. <b>Product replay</b> of the
              retained bytes: the approval and insertion were re-shown in the current UI, and no new
              SAM call was made.
            </figcaption>
          </figure>
        </div>

        <div className="advisory-note reveal">
          <b>What the live record shows.</b> One <code>sam-3.1</code> call returned one match at box{' '}
          <code>{'{x1:931,y1:135,x2:1123,y2:201}'}</code>; the saved cutout is asset{' '}
          <code>5bc77b15</code> v1, 192 × 66 RGBA, checksummed. A single{' '}
          <code>muse-wonder-1.0</code> coding job in the same run (6 calls, one job) produced a
          staged artifact in which that cutout is byte-identical, and the version HTML that shipped
          through the chain is checksummed. Genuine zero-match responses were also observed live and
          are stored as valid empties. A later run hit a subscription quota error and surfaced it as
          a provider failure — which is exactly why every media workflow also has an offline path.{' '}
          <a href={MEDIA} target="_blank" rel="noreferrer">
            Live capability record and its limits →
          </a>
        </div>
      </div>
    </section>
  );
}

/* ── Retrieval internals ───────────────────────────────────────────────────── */
export function Engine() {
  const stages = [
    ['hard filters', 'SQL pre-filters before ranking: status (active only), scope, expiry, type. Wrong-scope records never reach ranking.'],
    ['weighted score', 'six components, listed below — and every result carries its own score breakdown, plus an evidence sentence saying why it matched.'],
    ['slots & budget', 'two slots reserved for constraints and goals, then at most 8 memories inside 4,000 rendered characters, with 1,000 characters per record. The Forge profile that feeds a coding job is tighter: 6 memories inside 3,000 rendered characters.'],
    ['explain', 'results carry component scores, an evidence sentence and the exact rendered prompt block. A retrieval preview reproduces the bytes a job would receive, in chat or Forge layout.'],
    ['account honestly', 'records excluded by the count budget or the character budget are counted and reported, and an individual record is truncated rather than silently dropped. Exclusions are visible, so a miss is diagnosable.'],
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
          <h2>Bounded retrieval you can read, not an opaque embedding</h2>
          <p>
            Keyword-first (SQLite FTS5 <code>bm25</code>) with deterministic weighting and precise →
            relaxed → recency-fallback query modes; the mode is reported, so a miss caused by
            different vocabulary is visible rather than guessed at. Budgets are configuration, not
            architecture — and the explainer shows exactly what a generation would receive.
          </p>
        </div>
        <div className="engine reveal">
          {stages.map(([t, d], i) => (
            <div className="engine-stage" key={t}>
              <span className="num">{String(i + 1).padStart(2, '0')}</span>
              <div>
                <b>{t}</b>
                <p>{d}</p>
              </div>
              {i < stages.length - 1 && (
                <span className="arrow" aria-hidden="true">
                  <Icon name="down" />
                </span>
              )}
            </div>
          ))}
        </div>
        <div className="weights reveal" aria-label="Retrieval score weights">
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
        <p className="footnote reveal">
          Retrieved text is bounded reference data, never permission to execute tools. Supplied
          context does not guarantee compliance, and it does not automatically save tokens: the
          coding CLI carries its own large per-call baseline, and a memory block adds to it.{' '}
          <a href={MEMORYGUIDE} target="_blank" rel="noreferrer">
            Project memory guide →
          </a>
        </p>
      </div>
    </section>
  );
}

/* ── Decision Guard ────────────────────────────────────────────────────────── */
export function Guard() {
  const families = [
    ['timer', 'Countdown mechanics', 'setInterval timers and tick loops — executable code, distinguishing comments and documentation'],
    ['zap', 'Flashing effects', 'full-screen flash calls'],
    ['banknote', 'Mistake penalties', 'score deductions and resets'],
    ['palette', 'Superseded palettes', 'retired colours reintroduced, including hex equivalence: #FF7E5F ≡ 0xFF7E5F, and hue-family classification of saturated hexes'],
    ['eye', 'Colour-only cues', 'meaning carried by hue alone'],
    ['video', 'Autoplaying media', 'declared autoplay on media elements, or a play call that static reading cannot attribute to user action'],
    ['external', 'External assets', 'remote references in staged source — the same families the dependency disclosure reports as fetched'],
  ];
  const statuses = [
    ['finding · violation_detected', 'A supported pattern matched. It cites the decision id and a bounded evidence excerpt. A reviewer can still approve after reading it.'],
    ['no_violation_detected', 'The supported checks found nothing among the decisions they could map to a rule. Not a compliance certificate.'],
    ['not_verified', 'The constraint cannot be checked, or no decision was recorded for the job. The honest answer, and the one the product prefers.'],
    ['evaluation_unavailable', 'No result exists. Never rendered as a pass.'],
  ];
  return (
    <section className="block" id="guard">
      <div className="container">
        <div className="section-head">
          <p className="kicker">The advisor</p>
          <h2>Decision Guard — findings with receipts, zero authority</h2>
          <p>
            A deterministic, pure, dependency-free engine checks the staged source against{' '}
            <em>that job&apos;s own decisions</em>. Its result deliberately stays outside{' '}
            <code>validation.ok</code>: the server never uses it to authorise or deny approval, and
            a reviewer can approve after reading a violation finding. The human is the enforcement
            layer.
          </p>
        </div>
        <div className="rulefams grid-5">
          {families.map(([icon, name, ex]) => (
            <div className="rulefam reveal" key={name}>
              <span className="icon" aria-hidden="true">
                <Icon name={icon} />
              </span>
              <div>
                <b>{name}</b>
                <p>{ex}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="features-grid grid-4">
          {statuses.map(([h, p]) => (
            <div className="feature reveal" key={h}>
              <h3>{h}</h3>
              <p>{p}</p>
            </div>
          ))}
        </div>
        <p className="footnote reveal">
          Seven supported source-pattern families, and no claim of comprehensive coverage:
          constraints no rule maps to are reported as unverified rather than passed. Its independent
          accuracy audit — measured false positives, misses and abstentions — is published, and is
          exactly why enforcement stays human. The{' '}
          <a
            href={`${REPO}/tree/main/packages/decision-guard`}
            target="_blank"
            rel="noreferrer"
            style={{ color: 'var(--cyan)' }}
          >
            engine is pure TypeScript you can read in one sitting
          </a>
          .
        </p>
      </div>
    </section>
  );
}

/* ── Integrations & operations ─────────────────────────────────────────────── */
export function Integrate() {
  const tools = [
    'memory.search',
    'memory.graph',
    'memory.create',
    'project.get',
    'project.update',
    'task.create',
    'task.list',
  ];
  const cards = [
    {
      icon: 'layers',
      h: 'Seven shared tools, one registry',
      p: 'The same tool registry backs the application surface and the MCP stdio server — one memory engine, not a second store. MCP starts read-only; enabling writes at startup authorizes writes for that process, without a per-write review dialog. The count is verified against the registry, not against marketing copy.',
    },
    {
      icon: 'copy',
      h: 'A REST API with a machine-readable error catalogue',
      p: 'Memory CRUD plus proposals, accept/reject, correction, history, graph, review queue and export/import; retrieval preview; Forge projects, generations, jobs, diff, approve, reject, rollback, artifact, verification and preview; media sources, jobs, generate, edit, suggest, segment and cutout. Errors come from a versioned catalogue so a client can branch on the code instead of the message.',
    },
    {
      icon: 'repeat',
      h: 'Idempotent replay where a retry would cost money',
      p: 'Supported writes accept an Idempotency-Key and replay the original answer instead of paying twice. Replay records are scoped to the concrete method and path, expire after 24 hours and are deliberately excluded from the memory export envelope. That guarantee is per database, with in-flight locking per process — the single-server shape this beta is designed around, and unsound behind a load balancer.',
    },
    {
      icon: 'shield',
      h: 'Backups, restore drills and recovery',
      p: 'Database and media backup/restore tools with drills that actually restore, an alert prober over health, recovery summaries for interrupted jobs, and an inspect/repair path for a damaged workspace. Memory export/import is portability for decisions and their history — it is not a backup of application files and media.',
    },
  ];
  return (
    <section className="block" id="integrate">
      <div className="container">
        <div className="section-head">
          <p className="kicker">Integration &amp; operations</p>
          <h2>The same memory, through the app, MCP and REST</h2>
          <p>
            Local-first does not mean closed: the contract is shared, readable and checkable from
            outside the UI. Operations exist because a project is meant to outlive one session.
          </p>
        </div>
        <div className="chips reveal" aria-label="The seven shared tool names">
          {tools.map((t) => (
            <span className="chip" key={t}>
              <code>{t}</code>
            </span>
          ))}
        </div>
        <div className="features-grid">
          {cards.map((c) => (
            <div className="feature reveal" key={c.h}>
              <div className="icon" aria-hidden="true">
                <Icon name={c.icon} />
              </div>
              <h3>{c.h}</h3>
              <p>{c.p}</p>
            </div>
          ))}
        </div>
        <p className="footnote reveal">
          Single-user beta: the API binds to loopback by default, and an optional shared bearer
          token gates every <code>/api</code> route except the open health probe. There are no
          accounts, per-user namespaces or hosted collaboration — the token is one shared secret for
          the whole instance, not identity.{' '}
          <a href={RUNBOOKS} target="_blank" rel="noreferrer">Operator runbooks →</a> ·{' '}
          <a href={`${REPO}/blob/main/SECURITY.md`} target="_blank" rel="noreferrer">
            security model →
          </a>
        </p>
      </div>
    </section>
  );
}

/* ── Evidence ──────────────────────────────────────────────────────────────── */
export function Evidence() {
  const rows = [
    ['No project memory', '37/57', '49/60'],
    ['Retrieved project memory', '0/58', '1/60'],
    ['Same rule retyped by hand', '0/58', '0/60'],
    ['Rule corrected first (permissive)', '41/59', '50/60'],
  ];
  return (
    <section className="block" id="evidence">
      <div className="container">
        <div className="section-head">
          <p className="kicker">Evidence, honestly labelled</p>
          <h2>A pre-registered behavioural trial — with its scope stated on the card</h2>
          <p>
            Phase 17: 480 retained runs — four arms × six fixed strata (two games and a task
            planner) × two models, with the detector fixed and pushed before the first run. A
            violation is the <em>original</em> rule appearing in generated source. Counts are among
            usable runs: 8 of 240 Muse Spark runs hit the pre-registered time cap, none on Open.
          </p>
        </div>
        <div className="evidence-wrap reveal">
          <table className="evidence">
            <caption>Original-rule violations by condition (Phase 17, retained runs)</caption>
            <thead>
              <tr>
                <th scope="col">Condition</th>
                <th scope="col">Muse Spark</th>
                <th scope="col">Muse Spark Open (research only)</th>
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
          Memory vs no memory: exact two-sided p = 6.5 × 10⁻²⁰ and 1.1 × 10⁻²⁴ (a disclosed post-run
          correction replaced the originally planned test). Memory is non-inferior to retyping the
          same rule by hand (+4.5 pp and +7.1 pp upper 90% bounds, inside the +15 pp margin) — the
          point is that the context gets assembled for you. The corrected arm released a restriction,
          so a higher original-rule rate is expected; it did not test compliance with a replacement
          requirement. <b>What it does not cover:</b> runtime behaviour, Guard effectiveness, general
          application quality, or the newer media workflows.{' '}
          <a href={RESULTS} target="_blank" rel="noreferrer" style={{ color: 'var(--cyan)' }}>
            Full results &amp; verifier →
          </a>{' '}
          ·{' '}
          <a href={STATS17} target="_blank" rel="noreferrer" style={{ color: 'var(--cyan)' }}>
            statistical correction →
          </a>
        </p>

        <div className="section-head" style={{ marginTop: 72 }}>
          <p className="kicker">Phase 16 / 16B — the sharper question</p>
          <h2>Does the rule help — or does any memory help?</h2>
          <p>
            A palette-only arm separates the two on both models. 48 fresh edits per run set, through
            the production Studio path; violations are original-rule patterns in generated source.
          </p>
        </div>
        <div className="evidence-wrap reveal">
          <table className="evidence">
            <caption>Original-rule violations by memory supplied (Phase 16B)</caption>
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
          α&nbsp;=&nbsp;.025) are significant — largest p = 2.6 × 10⁻⁵. So it is the <em>rule</em>,
          not context volume, that changes generated code. Disclosed correction: 12 open-model
          outputs truncated at the token limit had been scored clean and are now unusable. Bounded to
          one baseline game, one request, one rule.{' '}
          <a href={DOCS16} target="_blank" rel="noreferrer" style={{ color: 'var(--cyan)' }}>
            Evidence card &amp; correction →
          </a>
        </p>

        <div className="section-head" style={{ marginTop: 72 }}>
          <p className="kicker">Beta engineering evidence — a different class</p>
          <h2>Offline gates prove the workflow, not the model</h2>
          <p>
            The v0.1.0 beta ships with ten offline gates that run against production bundles with no
            provider credential in the room, refusing to start if one is present. Their reports name
            the commit, the bundle hashes and the fixture coding CLI, so a green run cannot be
            mistaken for a model-quality result.
          </p>
        </div>
        <div className="evidence-wrap reveal">
          <table className="evidence">
            <caption>What each class of evidence proves, and what it cannot</caption>
            <thead>
              <tr>
                <th scope="col">Evidence class</th>
                <th scope="col">What it covers</th>
                <th scope="col">What it cannot establish</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Ten offline release gates</td>
                <td>
                  Approval and version workflows, origin and runtime controls, form sandboxing,
                  media persistence and playback, screenshot-review boundaries, artifact probes, the
                  beta journey on production bundles, byte-checked copy/download
                </td>
                <td>That anything a model generated is good, correct, accessible or safe</td>
              </tr>
              <tr>
                <td>Live media capability runs</td>
                <td>
                  One image generate and one edit measured in pixels; one transcription that returned
                  9 of 9 content words from locally generated speech; four timed clip observations
                  naming what the fixture renders; one screenshot review on a frame whose contents
                  were known by construction; SAM segmentation and a cutout carried byte-identically
                  into a staged artifact
                </td>
                <td>General media quality, or review quality where “correct” was precomputed</td>
              </tr>
              <tr>
                <td>Retained research records</td>
                <td>
                  480 Phase 17 runs with a fixed detector; <code>pnpm verify:research17</code>{' '}
                  re-derives every count and p-value from the retained files, and the locked
                  inventory is re-verified on <code>main</code>
                </td>
                <td>Transfer to other tasks, models, rules or runtime behaviour</td>
              </tr>
              <tr>
                <td>Human review</td>
                <td>
                  One generated application reviewed twice (accept with conditions) with four open
                  findings about that file: stale published output, seed values that produce one
                  application, session-scoped undo, and five swatches stacked on a phone
                </td>
                <td>
                  Any defect rate for generated applications — two observations of one brief are not
                  a sample. The quality rows in that packet are blank on purpose
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="footnote reveal">
          A retained gate pass applies to its recorded commit and bytes, not automatically to a later
          checkout, and human acceptance is a separate decision that stays open.{' '}
          <a href={GATE} target="_blank" rel="noreferrer" style={{ color: 'var(--cyan)' }}>
            Gate scope →
          </a>{' '}
          ·{' '}
          <a href={MEDIA} target="_blank" rel="noreferrer" style={{ color: 'var(--cyan)' }}>
            Live capability records →
          </a>{' '}
          ·{' '}
          <a href={EVMAP} target="_blank" rel="noreferrer" style={{ color: 'var(--cyan)' }}>
            claim-by-claim evidence map →
          </a>
        </p>
      </div>
    </section>
  );
}

/* ── For judges / reviewers ────────────────────────────────────────────────── */
export function ForJudges() {
  const cards = [
    {
      icon: 'check',
      h: 'Run it yourself — three paths, two minutes to check yours',
      p: (
        <>
          <code>pnpm judge:check</code> prints which paths this machine can finish and the exact
          fix for anything missing: <b>coding CLI</b>, <b>media API configured</b>,{' '}
          <b>browser validation</b> and the seeded offline demo — with no model call and no
          credential. Exploring offline needs nothing; generating needs a logged-in Muse Code
          CLI; media and SAM need their own server-side key.{' '}
          <b>Codespaces runs the exploration path only</b> — its Generate buttons are disabled,
          because the container has no logged-in CLI.{' '}
          <a href={JUDGES} target="_blank" rel="noreferrer">
            For judges: start here
          </a>{' '}
          carries the commands, the expected results and troubleshooting.
        </>
      ),
    },
    {
      icon: 'video',
      h: 'Beta demo — 3:00, every beat labelled on screen',
      p: (
        <>
          Correctable decisions, generation context and memory export, images, a SAM cutout,
          voice/video sources, screenshot review and version approval — mixing{' '}
          <b>recorded live calls</b>, <b>retained model outputs</b>, <b>product replays</b> and{' '}
          <b>deterministic fixtures</b>.{' '}
          <a href="#watch">Watch it here</a> · <a href="./video/muse-recall-demo.mp4" download>mp4</a> ·{' '}
          <a href="./video/muse-recall-demo.en.vtt">captions (WebVTT)</a> ·{' '}
          <a href="./video/muse-recall-demo-transcript.txt">transcript</a> ·{' '}
          <a href={DEMOQA} target="_blank" rel="noreferrer">
            recording scope and checksum
          </a>
          .
        </>
      ),
    },
    {
      icon: 'wrench',
      h: 'Engineering — verify, don’t trust',
      p: (
        <>
          <code>pnpm verify</code> runs lint, product/test typechecks and unit/integration tests;{' '}
          <code>pnpm verify:release-gate</code> runs the ten offline gates against production bundles
          and refuses an exported provider credential. A staged change loads in managed Chromium
          before approval is possible, and approval publishes exactly the checked bytes.
        </>
      ),
    },
    {
      icon: 'chart',
      h: 'Research — pre-registered and re-derivable',
      p: (
        <>
          Phase 17: 480 runs, four arms × six strata × two models, detector and protocol locked
          before the first run.{' '}
          <a href={RESULTS} target="_blank" rel="noreferrer">Results</a> ·{' '}
          <a href={STATS17} target="_blank" rel="noreferrer">stats correction</a> ·{' '}
          <a
            href={`${REPO}/blob/main/docs/hackathon-evidence/phase17/REVIEW_DISPOSITION.md`}
            target="_blank"
            rel="noreferrer"
          >
            review disposition
          </a>
          . <code>pnpm verify:research17</code> re-derives every count and p-value from the retained
          records.
        </>
      ),
    },
    {
      icon: 'brain',
      h: 'How Meta models are used — and where the deterministic parts are',
      p: (
        <>
          The <b>Muse Code CLI</b> generates and modifies applications (<code>FORGE_MUSE_BIN</code>{' '}
          selects the binary, <code>FORGE_MUSE_MODEL</code> the coding model). Separate{' '}
          <b>Meta media APIs</b> handle image generation and editing, SAM segmentation, transcription,
          clip observation and vision review. Retrieval, the source-pattern Guard, the load-time
          check and the byte checks are deterministic product code, not model calls.
        </>
      ),
    },
    {
      icon: 'scale',
      h: 'Limits, stated up front',
      p: (
        <>
          A single-user local beta: loopback by default, an optional shared bearer token, no accounts
          and no hosted collaboration; one generated HTML file per application. This website is a
          static landing page, not a running product.{' '}
          <a href={LIMITS} target="_blank" rel="noreferrer">Full limitations</a> ·{' '}
          <a href={ISSUES} target="_blank" rel="noreferrer">known issues</a>.
        </>
      ),
    },
  ];
  return (
    <section className="block" id="judges">
      <div className="container">
        <div className="section-head center">
          <p className="kicker">For judges and reviewers</p>
          <h2>Everything you need, one click away</h2>
          <p>
            <b>v0.1.0 is published</b> at{' '}
            <a href={RELEASE_SHA} target="_blank" rel="noreferrer">
              commit <code>707921d</code>
            </a>{' '}
            with the release notes, a source
            archive, checksums and a ten-gate report measured at that exact commit —{' '}
            <a href={RELEASE} target="_blank" rel="noreferrer">
              the v0.1.0 release
            </a>{' '}
            ·{' '}
            <a href={RUNOTES} target="_blank" rel="noreferrer">
              beta release notes
            </a>
            . Every claim on this page carries an evidence class in the{' '}
            <a href={EVMAP} target="_blank" rel="noreferrer">evidence map</a>.
          </p>
        </div>
        <div className="features-grid grid-6">
          {cards.map((c) => (
            <div className="feature reveal" key={c.h}>
              <div className="icon" aria-hidden="true">
                <Icon name={c.icon} />
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

/* ── Which model, where ────────────────────────────────────────────────────── */
export function Models() {
  const rows = [
    ['Generate / modify an application', 'Muse Code CLI (muse)', 'Coding model is configured per surface: FORGE_MUSE_MODEL, or the CLI default. The shipped model list is muse-wonder-1.0, muse-spark-1.3 and muse-spark-1.2; the default chat model is muse-wonder-1.0, so do not assume every surface is Spark.'],
    ['Chat and memory answers', 'Muse Code CLI (muse)', 'MUSE_MODEL, default muse-wonder-1.0; a configured fallback is reported when used.'],
    ['Image generation and editing', 'Meta images API', 'muse-image-1.0 by default.'],
    ['Object isolation (cutouts)', 'Meta segmentation API', 'sam-3.1 by default.'],
    ['Speech transcription', 'Meta speech API', 'muse-voice-transcribe-1.0 by default.'],
    ['Vision: drafts, clips, screenshot review', 'Meta responses / vision API', 'muse-spark-1.3 by default.'],
    ['Retrieval, Guard, load-time check, byte checks', 'No model — deterministic product code', 'SQLite FTS5 ranking, a pure TypeScript rule engine, managed Chromium and SHA-256 comparisons.'],
  ];
  return (
    <section className="block" id="models">
      <div className="container">
        <div className="section-head">
          <p className="kicker">Meta, precisely</p>
          <h2>Where a model is called, and which one</h2>
          <p>
            Model names below are the defaults the product ships with, read from its own
            configuration (<code>.env.example</code> and <code>packages/shared/src/media.ts</code>) —
            not from marketing material. Each is overridable by the operator.
          </p>
        </div>
        <div className="evidence-wrap reveal">
          <table className="evidence">
            <caption>Task → rail → configured model default</caption>
            <thead>
              <tr>
                <th scope="col">Task in the product</th>
                <th scope="col">Rail that runs it</th>
                <th scope="col">Configured model default</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([task, rail, model]) => (
                <tr key={task}>
                  <td>{task}</td>
                  <td>{rail}</td>
                  <td>{model}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="footnote reveal">
          Identity is <em>configured</em>, not always observed: the Studio shows the configured
          <code>FORGE_MUSE_MODEL</code> (or “CLI default (configured)”), live provider logs report the
          model they resolved, and an unknown model id can fall back to the CLI default silently.
          Media calls need a server-side <code>FORGE_MUSE_API_KEY</code>; a CLI login alone does not
          configure them. Muse Spark Open on Baseten existed only inside the research replication —
          the product never calls it, and there is no OpenAI, Anthropic, Google or
          arbitrary-provider support. <a href={ARCH} target="_blank" rel="noreferrer">Architecture →</a>
        </p>
      </div>
    </section>
  );
}

/* ── Beyond games ──────────────────────────────────────────────────────────── */
export function BeyondGames() {
  const cards = [
    {
      icon: 'receipt',
      h: 'Generated: FocusFlow v1',
      p: (
        <>
          A single-file task planner — no canvas, no game loop. Attempt 1 was{' '}
          <strong>rejected</strong>: it used a native form submit the sandbox blocks, and the failure
          record is preserved. Attempt 2 (a disclosed retake with a human-written sandbox
          instruction) passed <strong>21/21</strong> browser checks and was approved.
        </>
      ),
    },
    {
      icon: 'pencil',
      h: 'Modified: FocusFlow v2',
      p: (
        <>
          The coding model edited the approved v1 in place — adding task priorities and a
          high-priority remaining count — passed <strong>25/25</strong> checks, and was approved as
          v2. Four remembered decisions were recorded as supplied to that job.
        </>
      ),
    },
    {
      icon: 'ban',
      h: 'Refused: the countdown request',
      p: (
        <>
          A later request asked for a countdown timer. The model returned the file{' '}
          <strong>unchanged</strong>, citing the project&apos;s remembered no-countdown rule. The
          Guard honestly reported <code>not_verified</code> with 0 findings — it neither detected nor
          blocked anything there.
        </>
      ),
    },
  ];
  return (
    <section className="block" id="beyond">
      <div className="container">
        <div className="section-head">
          <p className="kicker">Beyond games</p>
          <h2>The workflow is not game-specific</h2>
          <p>
            To check HTML Studio isn&apos;t game-specific, a real non-game application was generated,
            modified and reviewed — refusals and all, with{' '}
            <a href={`${REPO}/blob/main/docs/demo/NON_GAME_HTML_VALIDATION.md`} target="_blank" rel="noreferrer">
              full provenance
            </a>
            . It is a demonstration, not a causal experiment: retrieved memory is proven to have been
            supplied, which does not prove memory caused a particular visual choice.
          </p>
        </div>
        <div className="features-grid">
          {cards.map((c) => (
            <div className="feature reveal" key={c.h}>
              <div className="icon" aria-hidden="true">
                <Icon name={c.icon} />
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

/* ── Screenshots ───────────────────────────────────────────────────────────── */
export function Gallery() {
  const [lb, setLb] = React.useState(-1);
  const shots = [
    {
      src: './assets/studio-beta.jpg',
      w: 1600,
      h: 900,
      t: 'The current beta Studio',
      c: 'Palette Bench, a retained live generation with its media panels, decision provenance and version history. Captured from a disposable replay of the saved project — no new model call — and the application still carries the open review findings disclosed on this page.',
    },
    {
      src: './assets/studio-review.png',
      w: 1600,
      h: 1000,
      t: 'Staged for review · captured 29 October',
      c: 'v2 waits with its live preview, the project decisions supplied to the change and the Decision Guard advisory — nothing is current until you approve it. This surface is unchanged in the beta; the media rails arrived later.',
    },
    {
      src: './assets/memory-detail.png',
      w: 1600,
      h: 1000,
      t: 'Memory detail · captured 29 October',
      c: 'The superseded sunset decision, its active ocean replacement, provenance and correction history.',
    },
    {
      src: './assets/memory-retrieval.png',
      w: 1600,
      h: 1000,
      t: 'Retrieval explainer · captured 29 October',
      c: 'Pinned records, score components, the exact rendered context cost and what was excluded — no black box.',
    },
    {
      src: './assets/conversation.png',
      w: 1600,
      h: 1000,
      t: 'Answers from memory · captured 29 October',
      c: 'A conversation answered from the retrieved project memory, with its evidence expanded.',
    },
  ];
  return (
    <section className="block" id="gallery">
      <div className="container">
        <div className="section-head center">
          <p className="kicker">The product</p>
          <h2>Auditable at every step</h2>
          <p>
            Real screens from the local-first Studio, each tagged with when it was captured. Click
            any of them for full size.
          </p>
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
                  width={s.w}
                  height={s.h}
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
            'Zod contracts and a versioned error catalogue',
            'Muse Code CLI for coding · Meta media APIs for image, SAM, speech and vision',
            'MCP stdio server over the shared tool registry',
            'Playwright-managed Chromium load-time check',
            'Vendored Phaser 3.80.1 (the only bundled engine)',
            'Biome · Vitest · ten offline production-bundle gates',
            'Offline echo provider (no account needed for browsing and chat)',
          ].map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Quick start ───────────────────────────────────────────────────────────── */
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
          <p className="kicker">Run the beta</p>
          <h2>Browse the whole workflow without a Muse account</h2>
          <p>
            The seeded project carries decisions — one already superseded — with version 1 approved,
            so provenance, correction and version history are all inspectable. The offline{' '}
            <code>echo</code> provider covers browsing and chat with no outbound request outside
            loopback. It does <b>not</b> generate Studio applications: real generation needs a working,
            logged-in <b>Muse Code CLI</b>, and media features need a separate server-side media
            credential.
          </p>
          <p>
            Prefer no install at all?{' '}
            <a href={CODESPACES} target="_blank" rel="noreferrer">
              Open it in GitHub Codespaces
            </a>{' '}
            — a browser-based setup for the same seeded browsing project (needs a GitHub account,
            about three minutes to set up, and VS Code will ask whether to trust the workspace). The{' '}
            <a href={GUIDE} target="_blank" rel="noreferrer">
              user guide
            </a>{' '}
            covers setup, project memory and HTML Studio.
          </p>
        </div>
        <div className="code-shell reveal">
          <button
            className={`copy-btn${copied ? ' copied' : ''}`}
            onClick={copy}
            aria-label="Copy setup commands"
          >
            {copied ? (
              <>
                <Icon name="check" /> copied
              </>
            ) : (
              <>
                <Icon name="copy" /> copy
              </>
            )}
          </button>
          <pre className="code">
            <span className="cmt"># v0.1.0 beta · Node 24+ · pnpm 10 (the workspace pins 10.32.1)</span>{'\n'}
            <span className="hl">git clone --branch v0.1.0 {REPO}.git</span>{'\n'}
            cd muse-recall{'\n'}
            pnpm install --frozen-lockfile{'\n'}
            <span className="hl">pnpm demo:seed</span>{'         '}
            <span className="cmt"># seeds/resets the forge-demo project — run it first</span>{'\n'}
            <span className="hl">MODEL_PROVIDER=echo pnpm dev</span>{'  '}
            <span className="cmt"># UI 127.0.0.1:5173 · API 127.0.0.1:8787</span>{'\n\n'}
            <span className="cmt"># real application generation needs the Muse Code CLI:</span>{'\n'}
            muse --version && muse login{'\n'}
            pnpm exec playwright-core install chromium{'   '}
            <span className="cmt"># the load-time approval check</span>{'\n'}
            MODEL_PROVIDER=muse-cli pnpm dev{'\n\n'}
            <span className="cmt"># media features are separate: copy .env.example to .env once, then</span>{'\n'}
            <span className="cmt"># FORGE_MUSE_API_KEY=… for image, SAM, speech and vision calls</span>{'\n\n'}
            <span className="cmt"># verify, don't trust:</span>{'\n'}
            pnpm verify{'               '}
            <span className="cmt"># lint + typechecks + unit/integration tests</span>{'\n'}
            pnpm verify:release-gate{' '}
            <span className="cmt"># ten offline gates on production bundles</span>{'\n'}
            pnpm verify:research17{'   '}
            <span className="cmt"># re-derive every Phase 17 count and p-value (python3)</span>
          </pre>
        </div>
        <p className="footnote reveal">
          A retained gate pass belongs to the commit it ran on; the{' '}
          <a href={RELEASE} target="_blank" rel="noreferrer">
            v0.1.0 release
          </a>{' '}
          attaches the report and evidence{' '}
          <a href={RELEASE_SHA} target="_blank" rel="noreferrer">
            measured at <code>707921d</code>
          </a>
          . Generation defaults are
          hard stops: a 10-minute timeout, 25 observed calls and 1.5M observed input tokens per job.
          Full instructions:{' '}
          <a href={`${REPO}#quick-start`} target="_blank" rel="noreferrer">
            README quick start
          </a>{' '}
          ·{' '}
          <a href={`${REPO}#what-is-verified`} target="_blank" rel="noreferrer">
            reproduce the evidence
          </a>{' '}
          ·{' '}
          <a href={REPO} target="_blank" rel="noreferrer">
            source on GitHub
          </a>
          .
        </p>
      </div>
    </section>
  );
}

/* ── Demonstrated vs not claimed ───────────────────────────────────────────── */
export function ProofVsRoadmap() {
  const done = [
    'Correctable memory with identity, provenance, revisions, supersession and append-only history — including a correction whose old record stays auditable but stops constraining new work',
    'Retrieval that reports what it supplied, what it excluded and the exact rendered context, and jobs that record the decision revisions they received',
    'Generation and live modification of working single-file applications through the Muse Code CLI, with staged Preview / Source / Changes, rejection, immutable versions and ancestry-based rollback',
    'Byte-checked Copy source and Download HTML; dependency disclosure for bundled, fetched and blocked references; the pinned Phaser 3.80.1 engine carried inside game artifacts',
    'Image generate/edit with approved versions embedded in published HTML, SAM cutouts carried byte-identically into a staged artifact, voice/video playback, transcription and clip observations — each with its own recorded live run',
    'Vision-proposed decision drafts through the review queue, and screenshot review pinned to selected decision revisions that writes no version, job or memory',
    'Seven shared tools over the app and MCP, a REST API with an error catalogue and idempotent replay, and backup/restore with drills and recovery reporting',
    'A pre-registered Phase 17 trial over 480 retained runs on two models, with a published strict verifier that re-derives every count and p-value',
  ];
  const later = [
    'Automatic enforcement — the Guard stays advisory, and approval checks loading rather than correctness, accessibility or every interaction',
    'Memory that updates an application by itself — a correction changes future context; the application change still has to be requested and reviewed',
    'Any claim about general generated-application quality: one application has been reviewed by a person, twice, and its quality sheet is deliberately unscored',
    'Media or review quality benchmarks — the live records are successful examples with measured details, not a scored sample',
    'Multi-user deployment — needs accounts, CSRF, isolation and a shared lease for idempotency and job locking first',
    'Hosted deployment — there is no public URL for the product; this site is a static landing page',
    'Support for anything but the Muse Code CLI and the deterministic echo provider, and evaluation across many tasks, games or models',
    'A completed human acceptance decision — the repository keeps that item open on its checklist rather than closing it quietly',
  ];
  return (
    <section className="block" id="proof">
      <div className="container">
        <div className="section-head center">
          <p className="kicker">Say it plainly, again</p>
          <h2>Demonstrated — and what must not be read as demonstrated</h2>
          <p>
            Left: behaviour with evidence in the repository. Right: what a green gate, a live call or
            a screenshot does not prove.
          </p>
        </div>
        <div className="two-col">
          <div className="col-card reveal">
            <h3 className="done-h">
              <Icon name="check" /> Demonstrated, with evidence
            </h3>
            <ul className="proof">
              {done.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </div>
          <div className="col-card reveal">
            <h3 className="future-h">
              <Icon name="circle" /> Not claimed
            </h3>
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

/* ── Memory timeline ───────────────────────────────────────────────────────── */
export function MemoryTimeline() {
  return (
    <section className="block" id="timeline">
      <div className="container">
        <div className="section-head">
          <p className="kicker">Memory, made visible</p>
          <h2>Muse Recall remembers <em>why</em> the project evolved</h2>
          <p>
            Every record below is real: this is the seeded demo project (<code>pnpm demo:seed</code>),
            decision texts from the Phase 12A trial verbatim, created through the production memory
            engine — never edited into a database. Expand any card.
          </p>
        </div>
        <TimelineWidget />
      </div>
    </section>
  );
}

/* ── Limitations ───────────────────────────────────────────────────────────── */
export function Honesty() {
  const items = [
    ['Memory supplies context; it does not guarantee compliance', 'A corrected decision changes what later generations receive. In the recorded session the stale palette came back anyway, and only an explicit follow-up request produced the corrected application. Corrections never rewrite an approved artifact by themselves.'],
    ['Both review paths are advisory', 'The Guard reads source patterns across seven supported families — not rendered behaviour — and never blocks approval. Screenshot review reads one frame, which cannot establish dynamic behaviour. Neither is a compliance certificate.'],
    ['Approval checks loading, not correctness', 'The staged document is loaded once in managed Chromium and fails on page errors, relevant console errors, blocked requests, a blank render, or a Phaser document with no canvas. It does not click controls, play the game, test accessibility or responsive breakpoints, or prove an application is safe or honest.'],
    ['Single-user beta, loopback by default', 'The API binds to 127.0.0.1. An optional shared bearer token gates every /api route except the open health probe — one shared secret, not identity. No accounts, per-user permissions, rate limiting or hosted collaboration, and no public deployment of the product. This website is a static landing page.'],
    ['Offline setup is browsing and chat only', 'MODEL_PROVIDER=echo gives a working offline workspace for memory, decisions, provenance and version history. Studio generation always spawns the Muse Code CLI, and media features need their own server-side credential. Local-first means state stays on your machine; it does not mean live inference stays offline.'],
    ['Phase 17 is bounded on purpose', '480 retained runs, six fixed strata, two rules, two models, source-code patterns rather than runtime behaviour, with disclosed post-run statistical corrections and 8 time-capped runs. It supports supplying relevant memory instead of retyping a rule; it validates neither general application quality nor the newer media features.'],
    ['Open findings stay open', 'One generated application carries four disclosed findings — stale published output, seed values that produce one application, session-scoped undo, and five swatches stacked on a phone — and the retained human quality sheet is unscored. Passing platform gates does not remove them, and two reviews of one brief are not a defect rate.'],
    ['Exports run unsandboxed', 'The Studio preview is an opaque-origin sandbox with temporary storage. A downloaded file opened from disk is an ordinary local file with normal browser storage — that is the point of the export, and the reason the approval-time load check exists.'],
    ['Deletion is irreversible through the API', 'DELETE removes the record from reads and the search index; there is no restore endpoint. Corrections keep history; deletions do not. The tombstone serves database integrity, not user undo.'],
    ['Memory does not automatically save tokens', 'Measured: the coding CLI carries a ~16,630-token baseline and a ~4k-character memory block adds ~877. What memory removes is setup turns — whole-task input roughly halved in one measured session — not a guaranteed per-call saving.'],
    ['A pass belongs to its commit', 'Gate, probe and live reports record the commit, bundle hashes and their own limits. A retained pass is evidence about those bytes, not about a later checkout, and human acceptance is recorded as a separate decision.'],
  ];
  return (
    <section className="block" id="honesty">
      <div className="container">
        <div className="section-head center">
          <p className="kicker">Say it plainly</p>
          <h2>Every claim carries its limits</h2>
          <p>
            The repository ships an evidence map, a known-issues register and strict verifiers. If a
            number matters, follow the linked record and read its scope on the same page.
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
        <p className="footnote reveal">
          <a href={LIMITS} target="_blank" rel="noreferrer">
            Full limitations
          </a>{' '}
          ·{' '}
          <a href={ISSUES} target="_blank" rel="noreferrer">
            known issues
          </a>{' '}
          ·{' '}
          <a href={RUNOTES} target="_blank" rel="noreferrer">
            v0.1.0 beta release notes
          </a>
        </p>
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
              The landing page runs its own test suite, in the same spirit as <code>pnpm verify</code>{' '}
              upstream: <code>npm run site</code> · <code>npm run qa</code> · <code>npm run links</code>,
              on a second browser engine in CI. Every figure, screenshot and quote on this page is
              re-checked against the product repository on every push — including the demo video,
              whose served bytes must match the file and the checksum recorded in its QA record.
            </p>
            <ClassKey />
          </div>
          <div className="stats" role="list">
            <div role="listitem">
              <b>34/34</b>
              <span>headless QA checks · local + CI (the badge is checked against the suite total)</span>
            </div>
            <div role="listitem">
              <b>100 · 97</b>
              <span>
                Lighthouse 12.8.2, four categories each: desktop 100 across the board; mobile 100 for
                accessibility, best practices and SEO, 97 for performance under simulated mobile
                throttling (CLS 0, TBT 0 ms)
              </span>
            </div>
            <div role="listitem">
              <b>0</b>
              <span>broken upstream links, checked against the repository tree and the v0.1.0 tag</span>
            </div>
            <div role="listitem">
              <b>1</b>
              <span>static page — the product itself is never hosted here</span>
            </div>
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
            The bet: the next step for AI-built software is project memory you can inspect and
            correct, references that reach the request, and a change you can review before it becomes
            current.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <a className="btn btn-primary" href={RELEASE} target="_blank" rel="noreferrer">
              Get v0.1.0
            </a>
            <a className="btn btn-ghost" href={REPO} target="_blank" rel="noreferrer">
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
          © 2026 Muse Recall contributors · MIT · built during the Meta Muse hackathon (“Push the
          Frontier”); v0.1.0 is a published beta
        </span>
        <span className="footnote">
          This page is built from the{' '}
          <a href={`${REPO}/tree/main/website`} target="_blank" rel="noreferrer">
            <code>website/</code>
          </a>{' '}
          folder of the product repository — every figure, screenshot and quote traces to that tree.
          The demo video, its captions and its transcript are the same bytes published under{' '}
          <a href={`${REPO}/tree/main/docs/demo/video`} target="_blank" rel="noreferrer">
            <code>docs/demo/video/</code>
          </a>
          .
        </span>
        <div className="footer-links">
          <a href={REPO} target="_blank" rel="noreferrer">
            muse-recall on GitHub
          </a>
          <a href={RELEASE} target="_blank" rel="noreferrer">
            v0.1.0 release
          </a>
          <a href={`${REPO}#what-is-verified`} target="_blank" rel="noreferrer">
            Reproduce the evidence
          </a>
          <a href={EVMAP} target="_blank" rel="noreferrer">
            Evidence map
          </a>
          <a href={`${REPO}/blob/main/docs/submission/SUBMISSION_COPY.md`} target="_blank" rel="noreferrer">
            Submission copy
          </a>
        </div>
      </div>
    </footer>
  );
}
