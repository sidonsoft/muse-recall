# Limitations

Muse Recall is a local beta, not a hosted product. This page states the boundaries that matter when
evaluating or demonstrating it. It does not repeat measured results; those are linked with their
scope and corrections.

[Guide](README.md) · [Getting started](getting-started.md) · [Project memory](project-memory.md) · [HTML Studio](html-studio.md) · [Architecture](architecture.md) · [Limitations](limitations.md)

## Deployment and security

- **Single-user and loopback-only.** The API binds `127.0.0.1` by default. A non-loopback bind
  requires an `ACCESS_TOKEN`; with one set, every `/api` route except the open `GET /api/health`
  liveness probe demands the bearer header (see [security](../SECURITY.md)). There is no account
  model, per-user namespace, rate limiting or CSRF token: the token is one shared secret for the
  whole instance, not identity. Do not expose this build to the public internet.
- The Host and Origin guards are browser-confusion controls, not authentication. A non-browser
  client can send no `Origin` or forge one; a compromised local process or extension is outside the
  threat model.
- Forge and chat children run as the server's local user. The Forge child gets a scrubbed
  environment, a staging working directory and the CLI's own sandbox/approval flags, but the app
  does not own a container, VM or separate OS user. `--workspace` is not an OS isolation boundary.
- The API key stays server-side and is delivered to the CLI over stdin. There is no browser provider
  path. This does not make a compromised local machine safe.
- Request bodies are capped at 1 MiB at the HTTP layer (`bodyLimit` in the Fastify constructor);
  oversized payloads are refused before any route handler runs.
- There is no hosted deployment. The application is not reachable at a public URL. The
  recorded 2:50 submission cut is committed under [`docs/demo/video/`](../demo/video/). See the
  [demo note](../demo/CORRECTABLE_MEMORY_DEMO.md).

## Load-time verification limits

Approval loads the staged document **once** in headless Chromium, waits briefly for rendering, and
fails on page errors, relevant console errors, blocked network requests, a blank render, or a Phaser
document that creates no canvas. That is the entire automated gate.

It does **not**:

- click controls, submit forms, or exercise application state;
- play a game, inspect pixels, or compare screenshots;
- test accessibility, responsive breakpoints, or cross-browser behavior;
- prove that the application is correct, safe, honest, or free of malicious UI logic;
- keep sandboxing the document after export.

A page that passes can still be broken on the next interaction or misleading in its content. Reading
the diff, using the preview and judging the design remain manual review steps. Syntax/structure
checks (`node --check` and file/content checks) are also not semantic verification.

Runtime verification defaults to Playwright-managed Chromium. `FORGE_RUNTIME_BROWSER=chrome`
explicitly selects system Chrome. There is **no automatic fallback** after a failed launch; approval
fails with a bounded, redacted diagnostic instead. Browser coverage in the verification suite is
representative, not an exhaustive UI, visual-regression, gameplay or accessibility audit.

Approval telemetry is forward-only: versions approved before it existed show “not recorded,” never
“passed.” Missing telemetry is not inferred as success.

## Decision Guard is advisory

**A Guard `BLOCK` is a finding, not enforcement.** The server keeps the Guard outside
`validation.ok`, never uses it to authorise or deny approval, and never disables the human's
decision. A reviewer can approve a staged change after reading a `BLOCK · violation_detected`
finding. The human is the enforcement layer.

- The supported checks cover five source-pattern families: countdown mechanics, flashing effects,
  mistake penalties, superseded palettes and colour-only cues. They inspect source text, not rendered
  behavior.
- `no_violation_detected` means the supported checks did not find a violation among the decisions
  they could map to a rule. It is **not** a compliance certificate and says nothing about
  unsupported constraints or aspects of a decision that no rule linked to.
- If a constraint cannot be checked, or no decision was recorded for the job, the honest assessment
  is `not_verified`, not `PASS`. `evaluation_unavailable` means no result exists.
- False positives, false negatives and abstentions are possible. That is why enforcement is left to
  the reviewer, and why a passing Guard result must not be marketed as safety certification.
- The Guard is not a runtime sandbox, a security scanner, a content moderator or a substitute for
  testing. It does not inspect the rendered page or network behavior.

See [HTML Studio](html-studio.md) for the review workflow and the seven rules.

## Memory behavior

- **Retrieval is keyword-based.** FTS5 `bm25` over content and tags, with precise → relaxed →
  recency-fallback query modes. There are no embeddings. A query using different vocabulary from the
  stored decision can miss it; the evidence and `query_mode` make the miss visible and diagnosable.
- **Budgets are bounded.** The default profile selects at most 8 memories and 4,000 rendered
  characters; Forge selects at most 6 and 3,000. A record that does not fit the rendered budget is
  skipped, and an individual record is truncated at the per-memory cap. These are configuration
  values, not knowledge guarantees.
- **Correction is retroactive for retrieval, not for generated files.** A correction supersedes the
  old record and changes later prompts. It does not rewrite an approved application; after a
  correction you must request the application change explicitly and review it. This is the recorded
  F6 behavior and remains by design.
- **Memory does not automatically save tokens.** The Muse CLI has a substantial per-call baseline,
  and a memory block adds tokens. Whether memory is a net saving over a multi-turn workflow depends
  on the history it replaces. Measured detail is in the [evaluation](../evaluation.md) and the
  [Muse overhead benchmark](../benchmarks/muse-overhead-latest.md); no benchmark is asserted on
  this page.
- **Deletion is irreversible through the API.** `DELETE` removes the record from reads and the FTS
  index; there is no restore endpoint. The tombstone exists for database integrity, not user undo.
- **Expiry is swept at startup.** Retrieval always filters expired records, and
  `MEMORY_SWEEP_ON_START` marks stale records when the server starts. There is no background
  scheduler.
- **Capture heuristics can misfire.** Explicit `remember …` commands are honoured; suggestions are
  never written automatically. Automatic correction targeting can create a new record instead of
  superseding the intended one when wording is unusual. The inspector exists so this is visible and
  correctable.
- SQLite writes are single-writer by design (`BEGIN IMMEDIATE`). This is correct and simple for one
  local user; it is not a multi-user database design.

## HTML Studio and Forge

- **One `index.html` only.** No multi-file project, package installation, build step, server-side
  execution or arbitrary host, and no remote asset: a game asks for Phaser 3 with one CDN tag and
  the product inlines the copy of the engine it carries, so the artifact boots with no network at
  all. That costs about 1.18 MB per game artifact. Artifacts approved before D059 keep their CDN
  reference and still need that host reachable; KI-53 records the measurement behind the decision.
- **One vendored engine version.** Only Phaser 3.80.1 is carried. A document that asks for a
  different version, or writes the tag in a form the product will not rewrite (`defer`, `integrity`,
  a script body), keeps its network dependency and is reported as a named gap; it is never silently
  given a different engine. Refreshing the pin means re-fetching and re-verifying the hash
  (`pnpm run vendor:phaser`) and re-running the runtime gate; `pnpm run vendor:phaser -- --check`
  verifies the committed copy offline, and `-- --against-remote` asks the pinned URL whether it
  still serves those bytes (neither writes anything).
- **Export is the artifact as-is**, sandbox stripped: a game built after D059 is genuinely
  self-contained and opens offline from disk; an older one still asks the CDN. Opening either from
  disk runs it **without** the Studio sandbox — that is the point of the export, and the reason the
  approval-time runtime check exists.
- **Preview storage is temporary.** The sandboxed preview installs an in-document storage shim
  because real Web Storage access throws in an opaque origin. Data written there resets when the
  preview reloads and is never written into the artifact. The exported file keeps data normally,
  subject to the browser.
- **Jobs are durable but single-process.** Each job is one atomically replaced JSON file under
  `WORKSPACE_ROOT`. There is no database lease or multi-process lock; two servers must not share a
  workspace. Intermediate writes are coalesced, and there is no `fsync`, so a sudden power loss is
  not a durability guarantee.
- **`Idempotency-Key` replay is per-database, and in-flight locking is per-process.** A replay
  record lives in SQLite (schema v8), scoped to `METHOD /concrete/path` + key, expires after 24
  hours, and is deliberately **excluded from the export envelope** so a replay window cannot survive
  a data restore. That is sound for the single-server deployment this beta is designed around, and
  unsound in two other shapes: servers behind a load balancer with **separate** databases replay
  nothing at all, so a client that retried after a timeout can pay twice — most expensively for a
  paid vision review or a coding job; and servers **sharing** one database share replay records but
  not the in-process in-flight set, so two concurrent copies of the same key can both run and one
  answer wins. Horizontal scaling needs a shared lease (the same problem the job store has, see
  above); it is documented as out of scope for beta rather than assumed safe.
- **Interrupted jobs are not resumed.** A `queued`/`running` job found at startup becomes
  `interrupted`; staged files and logs are kept for inspection. A graceful shutdown cancels active
  jobs and waits for terminal persistence, but an ungraceful death can leave an interrupted record.
- **Concurrency is bounded.** At most two active jobs per project; approval and rejection are
  serialised by a project lock. That is a local single-user design, not a queue service.
- **Runtime browser choice is explicit.** Managed Chromium is the default; system Chrome requires an
  explicit setting and never silently replaces a failed managed launch.
- **Generation timeout and budgets are hard stops.** Defaults are 10 minutes, 25 observed calls and
  1.5M observed input tokens. Token counts inside the CLI are observational, not an enforcement
  mechanism.
- **The Studio model identity is configured, not observed.** The UI shows the configured
  `FORGE_MUSE_MODEL` (or “CLI default (configured)”). The pipeline does not persist an
  independently observed execution model id.
- **The default chat model is not Muse Spark.** `.env.example` ships `muse-wonder-1.0`; the live
  demonstrations explicitly configured a Spark model. Check the model shown in the top bar before
  recording or drawing conclusions.

## Provider support

Only two providers are shipped:

| Provider | What it is |
| --- | --- |
| `muse-cli` | The real Meta Muse Code CLI. Chat calls it through the `ModelProvider` adapter; HTML Studio spawns the CLI directly. |
| `echo` | A deterministic offline provider used by tests and CI. It is not a model and does not impersonate Muse. |

Muse Spark Open on Baseten was used to replicate research; **the application does not call
Baseten**. There is no OpenAI, Anthropic, Google or arbitrary-provider support in the product. The
`ModelProvider` boundary is an extension seam, not evidence that other providers work. Unknown Muse
model ids can silently fall back to the CLI default; the adapter reports what the CLI says it
resolved, and the Studio does not independently observe it.

HTML Studio always spawns the Muse CLI. `MODEL_PROVIDER=echo` enables offline browsing and chat but
does **not** provide an offline HTML Studio.

## Evidence scope

The repository contains measured evidence, but none of it establishes general application
correctness or runtime safety:

- [Phase 17](../hackathon-evidence/phase17/RESULTS.md) is a pre-registered four-arm trial over six
  fixed strata, two rules and two models. It measures source-code patterns, not runtime behavior, and
  its correction result is easy to misread: Phase 17's correction was permissive, so a higher
  original-rule rate suggests the restriction was released; it does not show that a replacement
  requirement is followed.
- [Phase 16 / 16B](../hackathon-evidence/phase16/EVIDENCE_CARD.md) is bounded to one baseline game,
  one request, one rule and two models, and measures code, not runtime behavior. Its rule arm also
  carries the palette.
- [Phase 15B](../hackathon-evidence/phase15b/EVIDENCE_CARD.md) is one model, one game, one rule and
  one request; its corrected coding was produced after unblinding and is not confirmatory.
- The [A/B/C memory-influence trial](../PHASE12_MEMORY_VALIDATION.md) is directional, one run per
  condition.
- The FocusFlow non-game validation is a demonstration, not a causal experiment. Retrieved memory is
  proven to have been supplied; it does not prove that memory caused a particular visual choice.

No benchmark, provider capability or uploaded demo URL is invented on this page. Where numbers
matter, follow the linked evidence and its stated limits.

## N1–N3 follow-up fixes

These fixes are on `main` and are reflected in this guide:

| ID | Current behavior |
| --- | --- |
| N1 | `POST /api/retrieval/preview` supports `mode: "forge"` and returns the same pinned types, 6 / 3,000 budget, and exact two-block prompt text Forge injects. The explainer defaults to Forge mode. |
| N2 | `finished_at` records generation completion; approval time is `approval_verification.recorded_at`; rejection preserves the generation finish; a runtime failure records the failure time. |
| N3 | The correction response re-reads superseded targets after the update, so `status`, `superseded_by` and `updated_at` match a fresh `GET`; the replay path does too. |

The residual behavior is F6: a correction does not apply itself to an approved artifact. Some
generated mistakes also remain possible by design — for example a hidden long timer that the Guard
reports as `UNVERIFIED`, leaving the decision to a human.

## Beta release scope

The beta documents (`docs/beta/READINESS.md`, `docs/beta/RELEASE-GATE.md`, `docs/beta/RELEASE-NOTES.md`,
`docs/beta/DEMO-CHECKLIST.md`) carry measurements. What those measurements do **not** cover:

- **One generated application has been reviewed by a person.** The second review round re-measured that
  same brief on a newer build. That is two observations of one brief, not a sample, and no defect rate for
  generated applications may be inferred from it.
- **KI-88, KI-89, KI-90 and KI-91 are findings about one file.** The probe battery describes what happened
  in that artifact's sequences. It does not estimate how often other applications behave that way, and the
  battery's own report does not claim a rate.
- **The journey gates run a scripted coding CLI.** `verify:beta-journey` and `verify:studio-workflow` prove
  the product's plumbing around a generation — approval, versions, rollback, handover, preview, phone
  layout — and say nothing about what a model would generate. Their reports name the fixture CLI so the
  distinction survives the copy-paste.
- **The probe battery drives sequences, using names a person gave it.** It reports four outcomes —
  `finding`, `clean`, `not_tested`, `incomplete` — and a control it cannot find is reported as *not run*
  rather than as a pass. The interaction names are the reviewer's words, not a language the battery
  understands, so a renamed control in a generated artifact produces `not_tested`, which is honest and not
  a clean result.
- **Packet mode does not fail the product gate.** Findings inside a generated application are measurements
  of that application, and they enter reviewer evidence and `docs/KNOWN_ISSUES.md`. Turning them into
  product failures would hide the distinction between what shipped and what was generated.
- **Product reproducibility is not model determinism.** The same brief through the same product on the same
  commit is reproducible; the same brief through a model on a different day is not promised to be.
- **A judgement sheet is not a gate.** The review packet's five quality rows and its decision-compliance
  rows are blank on purpose. No harness result, including a green release gate, fills them in.

## Related references

- [Known issues](../KNOWN_ISSUES.md) — the granular list, including single-writer SQLite and capture
  heuristics
- [Security model](../security.md) — threat model and residual security risks
- [HTML Studio assessment](../HTML_STUDIO_ASSESSMENT.md) — what the Studio contract covers
- [Cross-origin security fix](../release/CROSS_ORIGIN_SECURITY_FIX.md) — what the Origin guard does
  and does not establish
- [Submission evidence map](../submission/EVIDENCE_MAP.md) — claims and their sources
- [README known limitations](../../README.md#known-limitations) — product-level summary

---

[Guide](README.md) · [Getting started](getting-started.md) · [Project memory](project-memory.md) · [HTML Studio](html-studio.md) · [Architecture](architecture.md) · [Limitations](limitations.md)
