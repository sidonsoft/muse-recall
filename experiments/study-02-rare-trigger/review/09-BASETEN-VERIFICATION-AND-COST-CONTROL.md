# Study 02 — D-02 Baseten verification procedure and qualification cost-control design

**Owner:** `baseten-reviewer` (AI review, not human validation)
**Date:** 2026-11-01 (Australia/Brisbane) · **Branch:** `study02/qual-prep` (immutable review-gate base `dc104b9`)
**Status:** offline design only. **No API call was made, no credential was read or printed, no
qualification request was sent, no commit was created.** This file operationalises the Director's
CONDITIONAL GO: Baseten qualification is authorised **up to $6 USD**, conditional on verified
credentials, billing and account limits — and **must not run** until those exist.

**Companion documents:** `review/02-BASETEN-CONTRACT.md` (contract evidence tags),
`review/03-QUALIFICATION-PLAN.md` (32-request plan, token ceilings, stop conditions),
`review/00-FREEZE-READINESS-REPORT.md` §8 (D-01…D-14), `_internal/PLAN-QUALIFICATION-PREP.md`.

**2026-11-01 amendment (confirmed hackathon constraints).** The authorized model is already
configured in Pi as `baseten-muse` → `meta-models/muse-spark-open-1026` (context 1,048,576; output
32,768; costs 1.25/4.25/0.15) and the **existing hackathon key** is reused from that configuration;
**credits are supplied** for hackathon use. No dedicated key, purchase, account creation or rotation
is required. Offline validation of the configuration is complete (`design/provider-config-pin.json`;
`scripts/study02/provider_config.mjs`; tests pass). The remaining execution gate is the Director's
**final qualification authorization** (32 requests, ≤$6). This supersedes the credential/billing
prerequisites in §1/§2 and §0; see
`review/13-CONFIRMED-ENVIRONMENT-AND-QUALIFICATION-AMENDMENT.md`.

**Evidence class:** every artefact produced under this procedure belongs to
`experiments/study-02-rare-trigger/qualification-baseten/` and is **excluded** from the exploratory
Dell pilot and from any confirmatory dataset. Nothing is pooled.

---

## 0. Summary

| Question | Answer |
|---|---|
| Can qualification run today? | **Offline ready; execution awaits the Director's final authorization.** The configured Pi provider/model and existing hackathon key are verified offline; credits are supplied. D-02 is resolved to the configured identity with a documented snapshot limitation. |
| What does this file enable? | The moment a credential + spend authorisation exists, the operator can run §2 (D-02 checks, read-only), §4 (ledger simulation), then the 32 requests under the §5 checklist without any new design work. |
| Hard cap | **$6.00 = 6,000,000 micro-USD (µUSD)**, enforced **before dispatch** by `spent_actual + reserved_outstanding + next_reservation ≤ cap`, with actual usage settled from every response and conservative worst-case reservations held for every outstanding request. |
| Worst-case plan arithmetic | Per-request reservations (each request's actual `max_tokens`) = **4,294,065 µUSD = $4.294065**, headroom **$1.705935** → up to **11 full-cap retries**. The implemented `cost_cap.mjs` conservative plan-fit (uniform 24,000-char/32,000-output, `review/10` §2) = **$4.672**, headroom **$1.328** → **9 full-cap retries**. Both fit the $6 cap. Expected spend ≈ **$2.2517**. |
| Biggest unresolved risks | Slug/version identity for `meta-models/muse-spark-open-1026` is [NOT PUBLIC]; account TPM may be below the 4-in-flight requirement; the account rate card may differ from the public card. See §6. |
| What must the Director provide? | **Only the final qualification execution authorization** (32 requests, ≤$6). The earlier credential/billing/account prerequisites are satisfied by the confirmed hackathon environment; the snapshot/version limitation is recorded and does not block execution. See §6.1 as amended. |

---

## 1. Credential provisioning checklist

### 1.1 Preconditions (all must be true before a key is created)

- [ ] Director has recorded **D-01** approval and a named **key owner** and **revocation owner**.
- [ ] Workspace ID, account tier and billing state are known (see §2, P5/P9; do not create a key in an
      unverified workspace).
- [ ] The operator confirms the historical credential path (`/Users/burnz/.zshrc`, mode `600`) will
      **not** be used for Study 02 and no shell profile is edited.
- [ ] The execution shell is a clean, dedicated shell; no `set -x`, no shell-history capture of the key.
- [ ] `umask 077` is set before any file is written.

### 1.2 Key specification — least privilege

| Property | Required value | Why |
|---|---|---|
| Env var name | **`S02_BASETEN_API_KEY`** (never `BASETEN_API_KEY`) | Study-02-specific attribution, independent revocation, no accidental reuse of the legacy/general key. |
| Key type | **Team API key** with **"Call Model APIs"** permission (inference-only). If the org cannot issue a team key, a **personal key labelled `s02-qualification`** is an approved fallback for the qualification only. | Least privilege: no deploy/manage/metrics rights; no organisation/API-key-management key. |
| Environment scoping | If the org supports it: environment-scoped to the Model API environment used for Study 02. | Further reduces blast radius. |
| Prefix / format | `b10_[A-Za-z0-9]{8}\.[A-Za-z0-9]{32}`; record only the **visible prefix** (`b10_xxxxxxxx`) in artefacts. | Enables secret-scanning detection; prefix is safe to log. |
| Creation time | Immediately before the qualification run (Baseten auto-revokes keys unused for 30 days). | Avoids stale-key revocation mid-study. |
| Lifetime | Revoked immediately after the qualification run completes/stops; a **new** key for any future confirmatory run. | Independent spend attribution and minimal exposure window. |

### 1.3 Injection and file-mode rules

1. The user exports the key **only** in the execution shell:
   `export S02_BASETEN_API_KEY='…'` (typed/pasted by the user; never in a command that is logged).
2. The runner reads it from the environment. It must **never** appear in:
   - command-line arguments (visible in `ps`); use an env var or a mode-600 header file read by
     `curl -H @file`, never `-H "Authorization: Bearer $KEY"` on the argv;
   - `.env` files, shell profiles, git-committed files, JSON request captures, notes, chat, or tickets;
   - `curl -v` / `--trace` output (prohibited against the inference host).
3. Any temporary header file is `chmod 600`, lives under `qualification-baseten/preflight/tmp/`
   (excluded by the redaction gate), and is deleted immediately after use.
4. `umask 077`; all run directories mode `700`; `ledger.jsonl`, `prices.json`, and preflight artefacts
   mode `600`.
5. If the key is ever written to disk by mistake: stop, revoke it first, then rotate (§1.6).

### 1.4 Redaction rules (applied to every log, record, console write and error)

A single `redact()` function runs before any write and must remove:
- the exact value of `S02_BASETEN_API_KEY`;
- `Authorization` header values (any scheme: `Bearer …`, `Api-Key …`, `Basic …`);
- any pattern `b10_[A-Za-z0-9]{8}\.[A-Za-z0-9]{32}`;
- URL query parameters that could carry a key (none expected, but redact `api_key`, `token`,
  `key`, `authorization` query keys).

Header logging is **allow-list only**: `x-baseten-request-id`, `x-ratelimit-*`, `retry-after`,
`content-type`, `date`, `server`. Never log the full header set. The post-run gate is:

```bash
grep -RInE 'b10_[A-Za-z0-9]{8}\.|Authorization[[:space:]]*:|Bearer [A-Za-z0-9]|Api-Key [A-Za-z0-9]' \
  qualification-baseten/ && { echo 'REDACTION FAILURE'; exit 3; } || echo 'redaction clean'
```

That gate must pass before the Lead commits or hands over any artefact.

### 1.5 Dry-run mode (zero inference requests)

A required `--dry-run` mode that:
- validates the frozen 32-request plan and all scenario/arm IDs against `corpus/` and the arm plan;
- builds every prompt through the pinned production path and records `prompt_sha256`, chars and the
  8,000-token ceiling estimate — **without** sending any request to an inference host;
- checks `S02_BASETEN_API_KEY` presence **by length only** (`${#S02_BASETEN_API_KEY}`, never the value)
  and exits non-zero if absent or if it equals a known-placeholder;
- prints the reservation table, expected/worst-case cost and the `--max-usd` value, and refuses to run
  if `--max-usd` is not exactly ≤ `6000000` µUSD ($6);
- performs **zero** DNS/TLS/HTTP calls to `inference.baseten.co` (network egress can be checked with the
  existing runner's dry-run path; no ad-hoc code changes are required by this document).

Pass criterion for dry-run: exit 0, 32 request specs, Σ reservation `4,294,065 µUSD`, and no key
material in the output tree.

### 1.6 Revocation, rotation and incident procedure

| Event | Action (in order) |
|---|---|
| Qualification run completed or stopped | Revoke the key in the Baseten dashboard; record revocation timestamp and prefix in `qualification-baseten/manifest.json`; confirm the revoked state in the dashboard. Optionally, a **non-inference** management-API call with the revoked key must return 401 (no inference request, no charge); skip it if the dashboard already shows revoked. |
| Suspected exposure in any log/artefact | **Revoke first**, then rotate (new key, update env, never reuse the exposed one), then run the redaction gate and record an incident note; if exposure is external, notify the Director and provider support. |
| Key expiry/auto-revocation (>30 days unused) | Issue a new key before resuming; do not extend the qualification across the 30-day boundary. |
| Runner crash with the key exported | Revoke/rotate before any restart if the crash artefact could contain the key; otherwise re-run the redaction gate before restart. |
| Account/billing anomaly | Stop, do not create another key until billing is verified (§2 P5). |

### 1.7 Current blocker (recorded, not worked around)

| Item | Recorded state (2026-11-01) |
|---|---|
| `$S02_BASETEN_API_KEY` | **unset** |
| `$BASETEN_API_KEY` | **unset** |
| Historical credential file | `/Users/burnz/.zshrc`, mode `-rw-------` (0600, owner `burnz`); repository history shows Phase 16B/17 read `BASETEN_API_KEY` from it. **Path/mode only recorded; content never read. Must not be reused.** |
| Consequence | No paid request, no D-02 verification, no qualification execution. Everything in §2–§5 remains offline until D-01 is satisfied. |

---

## 2. D-02 model-identity / limits verification procedure (executable later, offline now)

**Purpose:** resolve D-02 before request 1 — exact slug, version/snapshot identity, context/output
limits, per-model rate limits, account quotas, billing/rate card, and confirmation that the model is
usable from this workspace. All checks below are **read-only and non-inference**; they do not consume
the $6 qualification budget (inference charges only start with the smoke request in §5).

**Security:** every command reads the key from the environment via a mode-600 header file (not argv);
capture to files, not stdout; redact before storing.

```bash
# Operator shell — offline until D-01 exists. NEVER echo the value.
test -n "${S02_BASETEN_API_KEY:-}" || { echo 'BLOCKED: S02_BASETEN_API_KEY unset'; exit 2; }
umask 077
export OUT=experiments/study-02-rare-trigger/qualification-baseten/preflight
mkdir -p "$OUT/tmp"
chmod 700 "$OUT" "$OUT/tmp"
HDR="$OUT/tmp/headers.txt"
printf 'Authorization: Bearer %s\n' "$S02_BASETEN_API_KEY" > "$HDR"
chmod 600 "$HDR"
trap 'rm -f "$HDR"' EXIT
```

### 2.1 Evidence sources (official, accessed 2026-11-01)

| Source | Endpoint / command | What it establishes |
|---|---|---|
| Model-API catalog (workspace overlay) | `GET https://api.baseten.co/v1/model_apis?added_only=false&limit=1000` | `name`, `release_date`, `model_family`, `context_length`, `cost_per_million_input_tokens`, `cost_per_million_output_tokens`, `rate_limits[{type,unit,threshold}]`, `org_details{added_at,last_used_at}` |
| Single Model-API lookup | `GET https://api.baseten.co/v1/model_apis/{url-encoded-slug}` | Same fields for the exact slug; workspace-specific rate-limit overrides |
| Inference catalog | `GET https://inference.baseten.co/v1/models` | Published model catalog/pricing/context/features (read the exact shape from the response; do not assume) |
| Model-API usage | `GET https://api.baseten.co/v1/model_apis/usage?start_time=…&end_time=…&bucket_width=1h&group_by=model` | `input_tokens`, `cached_input_tokens`, `uncached_input_tokens`, `output_tokens`, `request_count` |
| Model-API costs | `GET https://api.baseten.co/v1/billing/model_apis?start_date=…&end_date=…&group_by=model&api_key_prefixes=…` | Daily `subtotal` as an exact decimal string; cost data from 2026-08-05; may differ from final invoice |
| Billing summary | `GET https://api.baseten.co/v1/billing/usage_summary?start_date=…&end_date=…` (both required) | Workspace `model_apis_usage.total`, credits/subtotal |
| CLI equivalents | `baseten model-api list --output json`, `baseten model-api describe --model <slug> --output json`, `baseten org billing usage --output json` | Same data without hand-written JSON parsing |
| Monthly budget / enforcement | Dashboard `https://app.baseten.co/settings/billing` (no documented API) | Notification-only vs **Enforce budget** (rejects Model API requests after spend reaches budget; Model APIs only) |
| Contract docs | `review/02-BASETEN-CONTRACT.md` §1–§2, sources with access dates | Verified platform contract and [NOT PUBLIC] list |

### 2.2 Step-by-step verification

**P1 — Auth + key scope.** Send a single non-inference management call; expect HTTP 200. Record the key
prefix (from the operator's record, not from a response), key type and owner. A `401/403` stops D-02.
Do **not** print the key.

```bash
curl -sS --max-time 30 -H @"$HDR" \
  "https://api.baseten.co/v1/model_apis?added_only=false&limit=1000" \
  -o "$OUT/model_apis_catalog.json" -D "$OUT/model_apis_catalog.headers.txt"
# allow-list the saved headers, then remove Authorization if present:
grep -iE '^(x-|content-type|date|server|retry-after)' "$OUT/model_apis_catalog.headers.txt" \
  > "$OUT/model_apis_catalog.allowlisted.txt" || true
rm -f "$OUT/model_apis_catalog.headers.txt"
```

**P2 — Slug resolution (the D-02 question).** Search the catalog for every slug containing
`muse-spark`, and query the exact candidates separately:

```bash
python3 - "$OUT/model_apis_catalog.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
for m in d.get('items',[]):
    if 'muse-spark' in (m.get('name') or '') or 'Muse Spark' in (m.get('display_name') or ''):
        print(json.dumps({k:m.get(k) for k in ('name','display_name','model_family','release_date',
              'invoke_url','context_length','cost_per_million_input_tokens',
              'cost_per_million_output_tokens','rate_limits','org_details')}, indent=2))
PY
for slug in \
  "meta-models/muse-spark-open-1026" \
  "meta-models/muse-spark-open"; do
  enc=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$slug")
  curl -sS --max-time 30 -H @"$HDR" "https://api.baseten.co/v1/model_apis/$enc" \
    -o "$OUT/d02_$(echo "$slug" | tr '/.' '__').json" -w '%{http_code}\n' \
    > "$OUT/d02_$(echo "$slug" | tr '/.' '__').status"
done
```

**Decision (pre-registered, no discretion):**
- If the **exact `-1026` slug** returns 200 → it exists in this workspace; record its fields; still
  require a written provider statement that it is a **fixed dated snapshot** (P10) or explicitly record
  "identity pinned by slug + date + request IDs, no snapshot guarantee" as a limitation.
- If it returns 404 → **`-1026` does not resolve**. STOP D-02. Do not silently call the public
  `meta-models/muse-spark-open` alias. The Director must either obtain a provider statement binding a
  usable slug (dated snapshot or contractual alias stability) or explicitly decide to change the
  approved model identity before qualification; that decision is a new D-02 approval.

**P3 — Context / output limits.** From the resolved slug's record, record `context_length`. The plan
needs `prompt_ceiling (8,000) + max_tokens (32,000) = 40,000` tokens per request. PASS if
`context_length ≥ 40,000` (expected ≈1,000,000). The catalog exposes **no output-token field**; output
limit is confirmed by (a) provider/support statement of the maximum `max_tokens` for the slug and
(b) the empirical truncation probes in the run (P3 is **CONDITIONAL** until the core block shows 0
truncations at 32,000).

**P4 — Rate limits / account quotas.** Read `rate_limits` for the exact slug. Required minimum for the
planned 4-in-flight block, computed from worst-case tokens:

```
required_TPM ≈ concurrency × (prompt_ceiling + max_tokens) × 60 / expected_wall_s
             = 4 × 40,000 × 60 / 52 ≈ 184,615 TPM  (Phase 17 prior wall; unverified)
```

- PASS: a `TOKEN`/`MINUTE` threshold ≥ **200,000** and a `REQUEST`/`MINUTE` threshold ≥ **10**
  (RPM is not the binding limit); if `CONCURRENT_REQUEST` is present it must be ≥ **4**.
- CONDITIONAL: TPM 100,000–200,000 → 4-in-flight may throttle; only 2-in-flight is safe
  (2 × 40,000 × 60/52 ≈ 92,308 TPM). The 4-request repeat block cannot run as planned; the Director
  must approve 2-in-flight (still within the 32 requests) before execution.
- FAIL: TPM < 100,000 or `CONCURRENT_REQUEST` < 2 → the planned rate-limit feasibility gate fails; do
  not run until the Director resizes the plan or the account tier is raised.
Also record workspace tier if discoverable (Basic unverified/verified/Pro defaults: 15/100k, 120/500k,
120/1M RPM/TPM) — the actual slug record overrides the default. No separate account-quota endpoint is
documented; if the organisation has custom capacity/quota limits, obtain a written statement from the
account team and record it with the rate limits (this is part of P4's evidence).

**P5 — Billing and rate card.** Verify there is a live billing relationship and that Model API spend is
attributable to the dedicated key prefix:

```bash
START=$(date -u -v-7d '+%Y-%m-%d'); END=$(date -u '+%Y-%m-%d')   # GNU date: --date='7 days ago'
curl -sS --max-time 30 -H @"$HDR" \
  "https://api.baseten.co/v1/billing/model_apis?start_date=$START&end_date=$END&group_by=model&group_by=api_key_prefix&api_key_prefixes=$KEY_PREFIX" \
  -o "$OUT/billing_model_apis.json"
curl -sS --max-time 30 -H @"$HDR" \
  "https://api.baseten.co/v1/model_apis/usage?bucket_width=1d&group_by=model" \
  -o "$OUT/usage_7d.json"
```
- PASS: both return 200; the resolved slug appears with `subtotal` as an exact decimal; the per-million
  rates from P2 (or the provider's account rate card supplied by the Director) are recorded in
  `prices.json`; a payment method or sufficient credits are visible on the billing dashboard.
- FAIL: no payment method/credits, no attributable key, or `cost_per_million_*` null/unknown. Do not
  dispatch without a known rate.
- If the account rate differs from the public card ($1.25 input / $0.15 cached / $4.25 output per 1M),
  record the account values and apply the **higher** rate in the ledger (§4.2). If the higher rate makes
  the plan's Σ reservation exceed $6, D-02 fails and the plan must be reduced or the cap raised by the
  Director.

**P6 — Provider-side budget guardrail (optional but recommended).** In the billing dashboard set a
monthly budget and, **only with Director approval**, enable **Enforce budget** at
`current workspace month-to-date spend + $6`. The budget covers the workspace's combined dedicated +
Model API + training usage, while enforcement rejects **Model API requests** once combined spend reaches
the budget — so for the $6 Model API cap this is conservative (Model API spend can only be lower when
other categories also accrue). It is workspace-wide; it must not be enabled if the workspace runs other
Model API workloads whose service would be disrupted. Record the setting and a screenshot hash in
`qualification-baseten/preflight/budget-setting.json`. If enforcement is not approved, the local ledger
(§4) is the sole hard stop and the qualification report must say so.

**P7 — Smoke identity check (still pre-plan? No — this is the first inference request).** The smoke
request is **request R00 of the 32-request plan** and the first paid action. It verifies:
HTTP 200; echoed `model` equals the resolved slug; `id` and `x-baseten-request-id` present;
`usage.prompt_tokens`/`completion_tokens` present; `finish_reason` present; `[DONE]`. Any mismatch is a
stop condition (S2/S9 in `review/03` §7).

**P8 — Version/snapshot identity (D-02 core).** There is **no API that returns a weights digest or model
revision**. The only admissible evidence is:
1. the catalog record (`name`, `release_date`, `description`) for the exact slug;
2. a **written provider statement** (support ticket/email) that the slug is a fixed snapshot or an
   alias with a stated stability window;
3. the per-request provider IDs (`x-baseten-request-id`) and `created` timestamps for the run;
4. an explicit record of what is *not* available (`system_fingerprint` absent, no revision field).

PASS = (1)+(2) recorded, or (1)+(3)+(4) with the Director accepting the "unpinned identity" limitation.
FAIL = the slug cannot be resolved or no stability statement exists and the Director has not accepted
the limitation.

**P9 — Data handling / region.** Confirm ZDR for synchronous inference (verified in `review/02` §1.10)
and record whether a compliance/region policy applies. PASS = ZDR accepted and no region requirement
blocks the run.

### 2.3 Pass/fail summary (D-02 gate)

| # | Check | PASS | CONDITIONAL | FAIL |
|---|---|---|---|---|
| P1 | Dedicated key authenticates; inference-only scope | 200 + key type confirmed | — | 401/403, wrong key type |
| P2 | Exact slug resolves | exact `-1026` 200 | public alias + written stability statement (Director approval) | 404 and no approved substitute |
| P3 | Context ≥ 40,000; output cap ≥ 32,000 | context ≥ 40k and provider/stated cap ≥ 32,000 | output cap unstated; empirical probe in core block | context < 40k or cap < 32,000 |
| P4 | Rate limits support 4 in flight | TPM ≥ 200k, RPM ≥ 10, concurrency ≥ 4 | TPM 100k–200k → 2 in flight with approval | TPM < 100k or concurrency < 2 |
| P5 | Billing live; rate card known | attributable key, payment/credits, exact rates | rate card pending but not null | no billing / null rates |
| P6 | Budget guardrail | enforced budget set with approval | notification-only + local ledger, documented | none configured and local ledger not approved |
| P7 | Smoke identity | 200, echo matches, IDs/usage present | — | any mismatch |
| P8 | Version/snapshot identity | written statement recorded | "unpinned identity" limitation accepted in writing | unresolved slug, no statement, no acceptance |
| P9 | Data handling | ZDR accepted, no region block | — | region/compliance block |

**D-02 verdict rule:** PASS only if P1, P2, P5, P7, P8, P9 pass and P3/P4 are PASS or CONDITIONAL with
the required approval; otherwise **NO-GO** for qualification. D-02 must be re-run if the account,
workspace, key or provider announcement changes.

### 2.4 Artefacts and what remains unverified

Write to `qualification-baseten/preflight/` (mode 700/600): `d02-verification.json`,
`d02-verification.md`, `model_apis_catalog.json`, per-slug lookups/status, `billing_model_apis.json`,
`usage_7d.json`, `prices.json`, `budget-setting.json`, redacted allow-listed headers, and the
`d02-verdict` line. No credential, no raw headers.

**Still unverified until executed:** actual slug resolution; enforced context/output limits; actual
workspace RPM/TPM/concurrency; account rate card and billing line items; snapshot/alias stability;
reasoning-control and sampler honouring on the slug; real tokenizer/token counts; latency; and the
provider's behaviour when the enforced budget is hit. None of these may be asserted in the
freeze-readiness report before the D-02 artefacts exist.

---

## 3. Endpoint identity as a scientific variable

### 3.1 Pre-registered feasibility/validity gates only

Endpoint choice is **never** based on treatment effects. Before anything is executed, the following
gates are fixed (from `review/03` §8/§12 and `review/00` §6). Qualification analyses are descriptive
only; **no arm contrast, violation rate, or effect direction may be computed or consulted to decide
whether to continue, stop, or select an endpoint**.

| Gate | Pass criterion (fixed before execution) | Effect-based? |
|---|---|---|
| G1 Contract | D-02 PASS (P1–P9 as above) | No |
| G2 Identity | exact slug + version statement recorded; no silent alias | No |
| G3 Completeness | ≥20/24 core requests produce complete extractable HTML (target 24/24) | No |
| G4 Scoring compatibility | frozen scorer runs on qualification outputs: 0 consistency failures, deterministic re-score, no reasoning text scored | No |
| G5 Truncation | 0/24 core `finish_reason:"length"` at `max_tokens: 32,000` | No |
| G6 Transport/rate limits | 4-in-flight completes without persistent 429/529; request IDs/usage captured | No |
| G7 Latency/cost feasibility | p95 ≤ 300 s; worst-case spend ≤ approved cap; measured token use consistent with ceilings | No |
| G8 Data handling | ZDR accepted; no region/compliance block | No |

Any failure is a **technical** no-go; none may be overridden because a result "looks interesting".

### 3.2 Per-request logging (identity is data, not an assumption)

Every request record (extending `review/03` §10.2) must contain:

`requested_model`, `returned_model` (from `choices` response/stream), `response_id` (`id`),
`x_baseten_request_id`, `created`, `usage {prompt_tokens, completion_tokens, reasoning_tokens,
cached_tokens}`, `finish_reason`, `stop_reason` if present, `stream_done_marker`, `ttft_s`, `wall_s`,
`http_status`, `attempt`, rate-limit headers, `prompt_sha256`, `provider_date`, `key_prefix`,
`price_version`, `identity_phase` (see §3.3), and an explicit field
**`provider_version_metadata_available: false`** (no `system_fingerprint`/revision is exposed).

The report must state that identity is evidenced by **slug + request IDs + timestamps + provider
statement**, not by a weights digest.

### 3.3 If the provider changes the model/version

**Detection signals (metadata only, never output quality):**
- `returned_model` differs from `requested_model` or from the D-02 resolved name;
- the slug returns 404 / disappears from the catalog, or `release_date`/`description` changes;
- billing line item changes model identifier or rate;
- provider deprecation/changelog notice, or any written notice of a new snapshot;
- provider response `id` prefix/format or rate-limit configuration changes in a way the provider
  confirms is a version change.

**Mid-qualification:** halt immediately (stop condition S9), settle all in-flight requests in the
ledger, record `identity_phase: 2`, do **not** substitute the alias, re-run D-02, and report both
phases separately. Do not pool phase-1 and phase-2 outputs silently; if the Director wants to continue,
that is a new D-02 approval.

**Mid-confirmatory (pre-declared rule to be frozen before any confirmatory run):**
1. Halt at detection; do not continue "to keep the sample size".
2. Preserve the frozen execution order; mark every affected record with the identity-phase tag.
3. Resume only after a written provider statement and a Director decision.
4. If the weights changed, the run is **not one endpoint**; do not silently pool. Either (a) restart the
   affected portion under the new identity, or (b) pre-declare identity as a stratifier/limitation with a
   sensitivity analysis — decided before unblinding, never after seeing effects.
5. No silent substitution, no re-pointing the slug, no mixing aliases in one dataset.

### 3.4 Human-validation independence (Director requirement #3)

This entire file — and every check in §1–§5 — is **AI review/engineering verification, not human
validation**. Rules:

- No AI agent may code, pre-label, adjudicate, or otherwise generate the human-validation data; AI may
  only prepare materials/manifests and deterministic fixtures (e.g. the 200-case seeded known-truth
  panel) that human coders then code **without seeing any AI-derived label**.
- Human validation means the two independent blinded human coders + independent adjudicator specified
  in `review/04-HUMAN-VALIDATION-PROTOCOL.md`; arm/condition is hidden; disagreement is retained; an
  independence attestation is signed.
- The qualification report must never label AI checks as human validation, and no qualification
  artefact may be counted toward the κ/agreement gate.
- If human coders cannot be resourced, the compliant path is to remove/demote all exposure-conditioned
  analyses (`review/00` §5), not to substitute AI review.

---

## 4. Cost-control design (Director requirement #1)

### 4.1 Principles

1. **Cap is absolute:** $6.00 = **6,000,000 µUSD**; no request is dispatched unless its worst-case cost
   plus all outstanding reservations plus actual spend is ≤ cap.
2. **Actual usage settles, reservation governs.** Dispatch uses a conservative worst-case reservation
   (prompt ceiling + `max_tokens` at the highest known rate); settlement uses the response's actual
   `usage`. Actual can only reduce the charge, never exceed the reservation unless the provider
   over-delivers (then it is an overrun → hard stop).
3. **Conservative on every uncertainty:** all input treated as uncached for reservation; unknown usage or
   missing response is charged the full reservation; account rate is used only if higher than public and
   only via `max(public, account)`.
4. **Durable and single-writer:** append-only journal + atomic state snapshot + file lock; crash
   recovery replays the journal and charges any unresolved dispatch at full reservation.
5. **Independent provider guardrail where possible:** enforced workspace budget (§2 P6) is a second
   hard stop; the local ledger remains primary.

### 4.2 Price inputs and fallback

| Price | Public rate (verified 2026-11-01) | Ledger constant (µUSD/token) |
|---|---:|---:|
| Input, uncached | $1.25 / 1M tokens | `125` |
| Input, cached | $0.15 / 1M tokens | `15` |
| Output | $4.25 / 1M tokens | `425` |

`cost_µUSD = ceil((125×input_tokens + 15×cached_tokens + 425×output_tokens) / 100)` (exact integer
arithmetic; `ceil` per request so rounding never understates).

**Fallback:** if the account rate card differs, set `P_in = max(1.25, account_in)`,
`P_cached = max(0.15, account_cached)`, `P_out = max(4.25, account_out)` and record
`price_version = "ACCOUNT-YYYY-MM-DD"`. If the account rate is unknown or any needed value is null →
**no dispatch** (D-02 P5 fail). If the recomputed Σ reservation > $6, the plan is NO-GO until the
Director reduces the request plan or raises the cap. The public card is never silently substituted for a
known higher account rate.

### 4.3 Ledger state and persistence

Files under `qualification-baseten/cost/` (mode 600):

| File | Content |
|---|---|
| `prices.json` | Public + account rates, source URL/date, `price_version`, cap µUSD |
| `ledger.jsonl` | Append-only event journal (one JSON object per line) |
| `ledger.state.json` | Atomic snapshot: `seq`, `spent`, `reserved`, `cap`, `status`, `price_version`, `last_request_ids` |
| `ledger.lock` | `flock` target for single-writer |
| `reconciliation.json` | Post-run provider-billing comparison |

Write protocol: acquire `flock` on `ledger.lock`; append event; `fdatasync`; write
`ledger.state.json.tmp`; `fsync`; `rename()`; release lock. Reject a second concurrent runner (lock
held). Crash recovery: read snapshot + journal tail; any `dispatch` event without a matching
`settle`/`fail` is treated as an **unknown-cost attempt** and settled at full reservation before any new
admission.

### 4.4 Reservation formula (before dispatch)

```
R_i = ceil( (P_in × prompt_ceiling_i + P_out × max_tokens_i + P_cached × 0) / 100 )
```

- `prompt_ceiling_i` = **8,000** tokens for every full prompt (expected ≈6,200; `review/03` §4.3),
  **500** for the smoke prompt; never the expected value.
- `max_tokens_i` = 32,000 for core/repeats/reasoning probe; 1,024 and 8,192 for truncation probes; 64
  for smoke.
- No cached-token credit in the reservation (cached tokens only reduce the settlement charge).
- Integer µUSD, rounded up. `R` is held from `admit` until `settle`.

### 4.5 Admission rule and hard stop

At each admission, under the lock:

```
if state.status != "running": reject
if state.spent + state.reserved + R_i + 0 <= CAP:      # all integers, µUSD
    state.reserved += R_i; state.seq += 1
    append admit event; persist; dispatch
else:
    state.status = "cap-stop"; persist
    stop dispatching; begin in-flight drain (bounded by the 900 s per-request timeout)
    write stop record; exit non-zero
```

**Hard stop with in-flight drain:** once `cap-stop` is set, no new or retried request is admitted. Wait
for outstanding ≤ 0 (bounded 900 s + 60 s); each in-flight request settles (actual if reported, else its
reservation); verify `spent ≤ CAP`; write `cost/cap-stop.json` with the triggering values. The runner
exits non-zero and the qualification report records the cap as the reason.

**Other hard stops:** missing price version; a failed redaction check; provider 401/403/404; a response
whose `usage` exceeds its reservation (overrun) — settle actual first, then stop; enforced-budget
rejection.

### 4.6 Settlement, retries and unknown usage

| Case | Charge | Notes |
|---|---|---|
| Complete response with `usage` | actual = `ceil((125×p + 15×c + 425×o)/100)` | `p` includes cached tokens; cached portion is billed at 15; never below 0. |
| Session cache hit reported (`cached_tokens>0`) | actual as above | Reservation assumed 0 cache, so actual ≤ reservation for input. |
| HTTP 200/stream started but no `usage` (partial/aborted stream) | **full reservation `R_i`** | Conservative; `usage_missing=true`; may retry only via a new admission. |
| Connection failure before any request bytes were accepted | full reservation `R_i` | Billing status unknown; do not release (cap safety over optimistic accounting). |
| Failure before dispatch (admission rejected) | 0 | No dispatch event exists. |
| Retry | new admission + new `R_i` + a new attempt record; attempt count ≤ 2 per request | No silent retries; every retry is separately reserved and settled. |
| Actual > reservation (overrun) | charge actual; flag `overrun`; hard stop | Prevents an under-reserved request from hiding in the ledger. |

### 4.7 Reconciliation against provider billing

After the run (and after billing data is available — current-day buckets can still be updated; API costs
"may differ from finalized invoice amounts"):

1. Query `GET /v1/billing/model_apis` with `group_by=api_key_prefix&group_by=model`,
   `api_key_prefixes=<prefix>`, `models=<resolved slug>`, `start_date=<run date (UTC)>`,
   `end_date=<run date+1>`; sum `subtotal` (exact decimal strings → integer µUSD via decimal arithmetic).
2. Also query `/v1/model_apis/usage` for token totals and `/v1/billing/usage_summary` for the workspace
   `model_apis_usage.total`.
3. Compare: **PASS** if provider subtotal ≤ $6.00 **and** `|provider − ledger_spent| ≤
   max(50,000 µUSD ($0.05), 2 % of ledger_spent)`. **PENDING** if cost data for the run day is not yet
   present (record and re-check; the report marks cap evidence provisional). **FAIL** if provider >
   $6.00 (breach), or the difference exceeds tolerance (investigate rate/usage mismatch, do not proceed
   to confirmatory planning).
4. Store `reconciliation.json`: timestamps, query URLs (no key), summed subtotal, ledger spent,
   difference, tolerance, verdict, and any lag note.

### 4.8 Failure modes

| Failure | Detection | Handling |
|---|---|---|
| Partial response / truncated stream | no `[DONE]`/finish reason | settle at `R_i`; attempt recorded; retry via new admission; count as failed request |
| Unknown usage after 200 | `usage` absent | settle at `R_i`; flag `usage_missing` |
| Price mismatch (account > public) | D-02 P5 + `prices.json` | recompute `R`; if Σ > cap → NO-GO; never dispatch on stale prices |
| Overrun (actual > reserved) | settlement | charge actual, flag, hard stop |
| Rounding | integer µUSD `ceil` | never undercharge; audited |
| Concurrent writers / second runner | `flock` | reject the second runner |
| Crash / power loss | journal + snapshot | replay; unresolved dispatch settled at `R_i` |
| Duplicate request ID/retry double-charge | journal idempotency key `run_id:attempt` | settle each attempt once |
| Enforced budget rejection | provider rejection once budget is reached (record the actual status; docs do not name it — 4xx expected) | stop, record, reconcile |
| Billing lag | reconciliation query | PENDING; re-check before confirmatory planning |
| Key exposure | redaction grep | revoke first, then stop/rotate (§1.6) |

### 4.9 Worked arithmetic for the 32-request plan

**Reservations (µUSD, $1 = 1,000,000 µUSD):**

| Class | n | prompt ceiling | `max_tokens` | `R` per request | Total |
|---|---:|---:|---:|---:|---:|
| Core full-file | 24 | 8,000 | 32,000 | 146,000 | 3,504,000 |
| Repeats (4-in-flight) | 4 | 8,000 | 32,000 | 146,000 | 584,000 |
| Truncation probes | 2 | 8,000 | 1,024 / 8,192 | 14,352 / 44,816 | 59,168 |
| Reasoning probe | 1 | 8,000 | 32,000 | 146,000 | 146,000 |
| Smoke | 1 | 500 | 64 | 897 | 897 |
| **Total** | **32** | | | | **4,294,065** |

`R_core = ceil((125×8,000 + 425×32,000)/100) = 146,000 µUSD = $0.146`.
`R_trunc1k = 14,352 µUSD`; `R_trunc8k = 44,816 µUSD`; `R_smoke = 897 µUSD`.
**Σ = $4.294065 worst case; cap headroom = 6,000,000 − 4,294,065 = 1,705,935 µUSD = $1.705935.**

**Expected settlement (prompt ≈6,200 tokens, completion ≈16,000 tokens, no cache benefit):**
per full request `ceil((125×6,200 + 425×16,000)/100) = 75,750 µUSD = $0.07575`.
29 full-cap requests = 2,196,750; truncation (expected 1,024 / 8,192 completion) =
12,102 + 42,566; smoke ≈297 → **Σ expected = 2,251,715 µUSD = $2.251715** (matches `review/03`
§4.2's ≈$2.25). Expected headroom = $3.748285.

**Admission at concurrency 1 (worst case; smoke is the first request):**

| Point (dispatch order) | `spent` | `reserved` | `R_next` | Sum | ≤ 6,000,000? |
|---|---:|---:|---:|---:|---|
| Smoke R00 | 0 | 0 | 897 | 897 | yes |
| First core R01 | 897 | 0 | 146,000 | 146,897 | yes |
| Last core R24 | 3,358,897 | 0 | 146,000 | 3,504,897 | yes (free 2,495,103) |
| First truncation probe | 3,504,897 | 0 | 14,352 | 3,519,249 | yes |
| 8,192 truncation probe | 3,519,249 | 0 | 44,816 | 3,564,065 | yes |
| Reasoning probe | 3,564,065 | 0 | 146,000 | 3,710,065 | yes |
| After all 28 non-repeat requests (settled at reservation) | 3,710,065 | 0 | — | — | yes |

**Reservation held while N requests are in flight** (full-cap requests, `R = 146,000`):
1 → 146,000; 2 → 292,000; 3 → 438,000; 4 → 584,000 µUSD.

**Admission at 4 in flight (repeat block, worst case):**

| Point | `spent` | `reserved_outstanding` | next `R` | Sum | ≤ cap? |
|---|---:|---:|---:|---:|---|
| Dispatch 4 repeats | 3,710,065 | 4 × 146,000 = 584,000 | 0 (batch admitted) | 4,294,065 | yes; free 1,705,935 |
| One completes / three outstanding | 3,856,065 | 438,000 | — | 4,294,065 | yes (identical worst case) |

**Retry headroom:** after the planned worst case, `1,705,935 / 146,000 = 11.68` → **11 full-cap retries
can be admitted; the 12th is rejected and triggers the cap stop.** In the expected case
(`spent ≈2,251,715`), reservation-basis headroom admits **25 full-cap retries** before the cap binds.
This is intentional: the cap is a ceiling on **attempts**, not a promise that every failure can be
retried; the retry policy (≤1 per request) can still be cut short by the cap, and the report must say
so.

**Implementation alignment (`scripts/study02/cost_cap.mjs`, `review/10` §2).** The operative module uses
integer µUSD, the same admission rule `spent + reserved + reservation_next ≤ cap`, and a per-request
reservation of `ceil(promptChars/3) × inputRate + max_tokens × outputRate`; its settlement charges
actual usage, charges the reservation when usage is missing, hard-stops on overrun, and persists
atomically. For the actual 32 prompts (~20,518 chars → `ceil(chars/3)` ≈ 6,840 input tokens) its
per-request reservations are **at or below** the 8,000-token ceiling used here, so the execution-day
ledger total is ≤ $4.294065 for the requests with per-request `max_tokens`. Its separate
`assertPlanFits` check deliberately assumes a uniform 24,000-char prompt and 32,000 output for every
attempt, giving the more conservative **$4.672** plan-fit ceiling (headroom $1.328, 9 full-cap
retries). Both pass `--max-usd 6000000`; the qualification report must quote the **actual ledger**
figures and the module's plan-fit figure side by side, and neither may exceed $6.

**Provider-side guardrail:** if enforced budget = current workspace month-to-date spend + $6, the provider rejects
requests once the workspace reaches it; this is a second, independent stop (workspace-wide — Director
approval required, §2 P6).

### 4.10 Audit fields (every ledger event)

`seq`, `ts_utc`, `event` (`init|admit|dispatch|settle|fail|retry|cap-stop|stop|reconcile`), `run_id`,
`attempt`, `class`, `prompt_ceiling`, `max_tokens`, `R_µUSD`, `prompt_tokens`, `completion_tokens`,
`cached_tokens`, `charged_µUSD`, `spent_after`, `reserved_after`, `cap`, `price_version`,
`prices_source`, `requested_model`, `returned_model`, `response_id`, `x_baseten_request_id`,
`http_status`, `finish_reason`, `usage_missing`, `overrun`, `note`. No credential, no raw headers.

---

## 5. Execution checklist (qualification day)

**Preconditions (all must hold; else STOP):** D-01 credential issued; D-02 PASS (§2); Director spend
authorisation reference for $6 recorded; D-04 isolation approved; branch `study02/qual-prep` (base
`dc104b9`) clean and untouched by the operator; dry-run validated.

| Step | Action | Evidence | Stop if |
|---|---|---|---|
| 0 | Fresh shell; `umask 077`; confirm `S02_BASETEN_API_KEY` present (length only); confirm no other Baseten key exported | shell transcript (no values) | any key absent or a general key present |
| 1 | Record commit hash, plan hash (`review/03`), prompt-builder pin hash | `preflight/environment.json` | plan/pin hash mismatch |
| 2 | Run dry-run (§1.5) | `preflight/dry-run.json`, 32 specs, Σ reserve 4,294,065 µUSD | non-zero exit; Σ ≠ 4,294,065; key in output |
| 3 | D-02 verification (§2); compute P1–P9; write verdict | `preflight/d02-*.json/.md` | any required P FAIL; any CONDITIONAL without approval |
| 4 | Initialise ledger: cap 6,000,000 µUSD; `prices.json` from verified rate card; simulate all admissions | `cost/ledger.state.json`, simulation log | Σ reserve > cap; price unknown |
| 5 | Optional: set/confirm provider budget (§2 P6) | `preflight/budget-setting.json` | not approved/configured as decided |
| 6 | Smoke R00 (first paid request): admission → dispatch → settle | `records/R00.json`, ledger events | identity/usage/ID mismatch (S2/S9) |
| 7 | Sequential core R01–R24; probes R25–R27 | per-request records, raw SSE, outputs | any stop condition S1–S12 in `review/03` §7 |
| 8 | Repeats R28–R31 launched 4-in-flight; capture rate-limit headers/429 | records + headers | persistent 429/529 (S3) |
| 9 | Settle all; cap evidence: final spent, max committed (`max(spent+reserved)`), headroom, cap-stop flag | `cost/ledger.state.json`, `cost/cap-report.md` | spent > cap; outstanding > 0 |
| 10 | Redaction gate (§1.4); hash artefacts; update `qualification-baseten/README.md` and `manifest.json` | grep clean; hashes | any `b10_`/`Authorization` hit (S10) |
| 11 | Reconciliation (§4.7) | `cost/reconciliation.json` | provider > $6 or beyond tolerance |
| 12 | Qualification report: contract/identity evidence, request accounting, tokens/latency, truncation, repeatability, **cap evidence**, go/no-go recommendation | `qualification-baseten/REPORT.md` | any unresolved blocking item |

**How the $6 cap is evidenced in the report:** the per-event ledger (R, actual, cumulative spent,
reserved outstanding), the maximum committed amount, the final spent, the provider billing subtotal for
the run day and the tolerance verdict, plus the enforced-budget screenshot hash if used. If
reconciliation is PENDING (billing lag), the report must say **"cap evidenced by ledger; provider
billing reconciliation pending"** and schedule the re-check before any confirmatory planning.

**Stop handling:** on any stop, drain in-flight, settle, write `cost/cap-stop.json` or the relevant stop
record, and **do not** continue or retry outside the ledger. Resume requires a new Director approval.

---

## 6. Remaining blockers and decisions for the Director

### 6.1 Exact verification steps needed from the Director

| # | Needed from Director | Why it blocks | Evidence produced |
|---|---|---|---|
| 1 | **Issue D-01**: dedicated `S02_BASETEN_API_KEY` (team, inference-only, least privilege), named owner + revocation owner; provide only via the execution shell/env | No key → D-02 and qualification cannot start | `preflight/credential.json` (prefix, type, owner, creation date only) |
| 2 | **Confirm billing**: payment method/credits sufficient for ≤$6; authorise the management-API read of `/v1/model_apis` and `/v1/billing/model_apis` | Without billing the run is unpayable/ambiguous; rate card unknown | `preflight/billing_model_apis.json`, `prices.json` |
| 3 | **Account limits**: confirm workspace tier and authorise reading RPM/TPM/concurrency; state whether 4-in-flight is acceptable if TPM ≥ 200k, or approve 2-in-flight if 100k–200k | 4-in-flight is part of the 32-request plan; TPM may force a plan change | `preflight/d02-verification.json` P4 |
| 4 | **Resolve D-02 identity**: obtain provider/support written answer on whether `meta-models/muse-spark-open-1026` resolves as a fixed dated snapshot, or approve the public alias + stability statement, or change the approved model identity | The exact slug is [NOT PUBLIC]; silent substitution would be an unpinned endpoint | `preflight/d02-...json/.md`, provider statement file/hash |
| 5 | **Spend authorisation reference** for the $6 hard cap (cost centre/PO/decision ID) and confirmation that the cap is a ceiling on the qualification, not a target | Authority to incur the charge; audit trail | `preflight/spend-authorization.json` |
| 6 | **Budget enforcement decision**: approve (or decline) enabling **Enforce budget** = current workspace month-to-date spend + $6 (workspace-wide; conservative for the Model API cap) or accept notification-only + local ledger | Provider-side guardrail has workspace-wide blast radius | `preflight/budget-setting.json` + rationale |
| 7 | **D-04 isolation**: confirm outputs only under `qualification-baseten/`, excluded from pilot/confirmatory; no commit by the operator; Lead commits | Evidence-class separation; immutable `dc104b9` | `manifest.json`, branch state |
| 8 | **Human-validation independence**: resource two blinded human coders + adjudicator (D-05) or approve the compliant fallback (remove/demote exposure analyses); **AI cannot substitute** | Separate freeze blocker; not part of qualification authorisation | `review/04` package + attestation (future) |

### 6.2 Risk register

| ID | Risk | Likelihood / impact | Mitigation | Owner |
|---|---|---|---|---|
| R1 | `-1026` is an alias, not a snapshot; weights move between qualification and confirmatory | Medium / high (identity) | Written provider statement; re-run D-02 at confirmatory start; identity phase tags; no silent pooling | Director + provider |
| R2 | Account rate > public rate → Σ reservation > $6 | Medium / high (cap) | Require known rate card; `max(public, account)`; NO-GO if Σ > cap; Director reduces plan or raises cap | Director |
| R3 | Account TPM < 200k → 4-in-flight throttles | Medium / medium | D-02 P4; run 2-in-flight only with approval; record `CONDITIONAL` | Director |
| R4 | Billing data lag / no line item → cap cannot be reconciled on the day | Medium / low | Ledger is primary; mark PENDING; re-check before confirmatory; enforced budget if approved | Operator + Lead |
| R5 | Failed attempt with unknown usage → conservative full-reservation charge consumes headroom | Medium / low | 11 full-cap retries available worst case; stop and report; no overrun | Runner |
| R6 | Enforced budget rejects other workspace workloads | Low / medium | Director decision; only enable if workspace is dedicated; else notification-only | Director |
| R7 | Prompt token ceiling under-estimated (>8,000) → overrun | Low / high | 8,000 vs expected 6,200 (29 % headroom); settle-overrun hard stop; re-plan if seen | Runner |
| R8 | Credential appears in argv/logs (e.g. `curl -H` expansion, `-v`) | Low / high | Header file mode 600 via `-H @file`, no `-v`, allow-listed headers, redaction grep before commit | Operator |
| R9 | AI verification mistaken for human validation | Medium / high (claims) | §3.4 labelling; no AI coding; human gate per `review/04`; fallback = demote exposure analyses | Lead / Director |
| R10 | Qual outputs mistaken for pilot/confirmatory data | Low / high | Isolated directory, README label, manifest, no pooling, analysis plan must not read it | Lead |

### 6.3 Current status (recorded)

- **Credential:** absent (`$S02_BASETEN_API_KEY`, `$BASETEN_API_KEY` unset). Historical key path recorded
  by path/mode only; not read, not reused.
- **D-02:** not executed → all identity/limits/billing/rate items remain **unverified**.
- **Qualification:** not executed; `qualification-baseten/` contains only `README.md`; no paid call.
- **Cap:** designed but not armed; no ledger exists until a run is authorised.
- **Confirmatory/freeze:** NO-GO (Director) and unchanged by this document.

---

## 7. Sources

Official pages read on **2026-11-01** (Australia/Brisbane):

- Model APIs overview (slug public form, determinism statement, ZDR): https://docs.baseten.co/inference/model-apis/overview
- Chat Completions schema/params: https://docs.baseten.co/reference/inference-api/chat-completions
- Pricing and limits (rate limits, headers, usage/attribution): https://docs.baseten.co/inference/model-apis/pricing-and-limits
- List all Model APIs (`GET /v1/model_apis`, fields incl. `context_length`, `rate_limits`): https://docs.baseten.co/reference/management-api/model-apis/gets-all-model-apis
- Get a Model API by name: https://docs.baseten.co/reference/management-api/model-apis/gets-a-model-api-by-name
- Model API usage: https://docs.baseten.co/reference/management-api/model-apis/gets-model-apis-token-usage
- Model API costs (`GET /v1/billing/model_apis`, exact-decimal subtotals, date limits): https://docs.baseten.co/reference/management-api/billing/gets-model-apis-costs
- Billing and usage (payment method, credits, monthly budget + **Enforce budget** semantics, usage summary endpoint): https://docs.baseten.co/organization/billing
- Inference errors (`x-baseten-request-id`, 429/529, streaming-after-200): https://docs.baseten.co/inference/errors
- Streaming (SSE, `[DONE]`, `include_usage`): https://docs.baseten.co/inference/streaming
- API keys (`b10_` format, key types/scopes, 30-day revocation, Bearer + Api-Key): https://docs.baseten.co/organization/api-keys
- Secure model inference / ZDR: https://docs.baseten.co/observability/security
- Muse Spark Open model library (public slug, public rates): https://www.baseten.co/library/muse-spark-open/
- Muse Spark Open launch blog (1M context, NVFP4, ZDR): https://www.baseten.co/blog/muse-spark-open-launch/

Repository evidence: `review/02-BASETEN-CONTRACT.md` §7 (Phase 17 priors: 240 Open runs, mean 51.7 s,
max 177.1 s, prompt mean 5,001, completion mean 15,876 with 51.7 % reasoning, max 29,368 of 32,000);
`review/03-QUALIFICATION-PLAN.md` (32-request composition, 8,000 prompt ceiling, 248,500/937,280 token
ceilings, stop conditions S1–S12); `review/00-FREEZE-READINESS-REPORT.md` §4/§6/§8;
`_internal/PLAN-QUALIFICATION-PREP.md`; `docs/hackathon-evidence/phase17/*`.
