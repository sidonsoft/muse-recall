# 13 — Confirmed hackathon environment and qualification-plan amendment

**Status:** offline configuration evidence and plan amendment. **No API request, paid or credit-consuming
call was made; no credential value was read into any output, printed, logged or committed; no confirmatory
run; no preregistration freeze.** Branch `study02/qual-prep` (review-gate commit `dc104b9` preserved).

This document records the Director-confirmed hackathon constraints and supersedes the corresponding
assumptions in `review/03-QUALIFICATION-PLAN.md`, `review/09-BASETEN-VERIFICATION-AND-COST-CONTROL.md`
and the blockers in `review/11-QUALIFICATION-PREP-STATUS.md`.

## 1. Exact existing provider/model configuration (no secrets)

Inspection source: the Pi agent configuration (`~/.pi/agent/models.json`, mode 600, SHA-256 recorded in
the key-free pin) and `~/.pi/agent/settings.json`; Pi CLI version **1.4.0**. The authorized entry is
**already configured** and is used exactly as found. Nothing was added, changed or invented.

| Field | Configured value |
|---|---|
| Provider key | `baseten-muse` |
| Provider display name | Muse Open (Baseten) |
| Base URL | `https://inference.baseten.co/v1` |
| API style | `openai-completions` |
| **Model identifier** | **`meta-models/muse-spark-open-1026`** |
| Model display name | Muse Spark Open 1026 |
| Reasoning | `true` (provider/model supports reasoning) |
| Input modalities | text, image |
| Context window | **1,048,576** tokens |
| Max output tokens | **32,768** |
| Configured price (USD / 1M tokens) | input **1.25**, output **4.25**, cached input **0.15**, cache write 0 |
| Credential | **Existing hackathon key**, stored in the Pi provider configuration (`providers.baseten-muse.apiKey`, mode 600). Fingerprint (non-reversible, first 16 hex of SHA-256 with a domain separator): **`700791232a0c87b1`**. The value is never exported, printed or written to the evidence files. |
| Pi default provider/model | `strata` / `qwen3.8-flash-next-iq3_s` — **not used for Study 02 and not changed** |

Key-free pin: `design/provider-config-pin.json`. Loader/tests:
`scripts/study02/provider_config.mjs`, `scripts/study02/test_provider_config.mjs`,
`scripts/study02/pin_provider_config.mjs`.

**Offline checks completed (no network).** The loader parses the exact Pi provider entry, refuses any
other provider or lookalike model (including the public alias `meta-models/muse-spark-open`), validates
base URL, API style, context window, output limit and all four cost fields against the authorized
configuration, confirms the existing hackathon key is present (fingerprint/length only), proves the key
is non-enumerable and absent from `JSON.stringify()` and from the public snapshot, and records the Pi
version and configuration file hashes. Tests: **all pass** without printing the credential.

## 2. Confirmed constraints applied

1. **One existing hackathon key is used.** There is no dedicated replacement key and none is required.
   The qualification harness reads the configured key into memory through `provider_config.mjs`; it
   records only the source, mode and fingerprint. No env-var export, purchase, account creation or key
   rotation is required. (If the configured key is absent or invalid at execution time, the harness
   fails closed; it never falls back to another key.)
2. **Provider credits are supplied for hackathon use.** No purchasing, credit-card or account-creation
   step remains. Bounded usage accounting and stop conditions are retained unchanged: token ceilings,
   pre-dispatch reservation, actual-usage settlement, hard stop and provider-billing reconciliation.
3. **This is the only authorized model and it will not be changed.** The identifier above is used
   as-is; no fallback model, no alias substitution and no configuration edits.
4. **Version metadata is limited.** The local configuration exposes only id/name/context/output/cost;
   there is no snapshot, revision or system-fingerprint field, and public documentation does not
   publish a dated snapshot guarantee for this slug. **Reproducibility limitation:** the provider may
   route the configured identifier to a different underlying snapshot; model identity must be
   treated as endpoint metadata observed per request, not as a frozen scientific constant. The
   qualification and every future run must log the requested and returned model id and any provider
   metadata available, and a change must halt/report rather than be silently substituted.

## 3. Remaining technical blockers

**There are no remaining credential or account blockers.** The only gate for qualification execution
is the Director's **final execution authorization** (below). Runtime checks that must pass during
qualification itself (not preconditions):

- returned model id equals the configured identifier and any observable provider metadata is recorded;
- full-file outputs are complete and the frozen scorer accepts them;
- truncation behaviour at the configured `max_tokens` 32,768 is characterised;
- latency/usage/rate-limit behaviour is measured; concurrency starts at 1 and attempts 4-in-flight,
  falling back to 1–2 if the account rate-limits (no pre-verification of TPM is required);
- the reservation ledger never exceeds the authorized bucket, and the provider billing subtotal is
  reconciled (or marked PENDING for lag) before the confirmatory decision.

## 4. Bounded 32-request qualification plan (unchanged composition)

| Block | Requests | Purpose |
|---|---:|---|
| Core cells (6 strata × 4 arms) | 24 | Every confirmatory cell/condition-assignment path; full-file completeness; scoring compatibility |
| Same-prompt repeats (2 cells × 2) | 4 | Repeatability (not determinism) + 4-in-flight/rate-limit observation |
| Truncation probes (`max_tokens` 1,024 / 8,192) | 2 | Cap semantics; no false success |
| Reasoning-control probe | 1 | Check provider-side reasoning behaviour/limits |
| Smoke | 1 | Auth/identity/transport |
| **Total** | **32** | No additional requests without new approval |

**Usage ceiling (unchanged):** prompt/input ceiling **248,500 tokens**; completion/output ceiling
**937,280 tokens**. At the configured prices this is a worst-case reservation of **$4.294065** with
**$1.705935** headroom under the **$6.00** cap (≈11 full-cap retries on a per-request-`max_tokens`
basis; the more conservative uniform reservation gives $4.672 with $1.328 headroom). Expected spend
≈**$2.25**. Enforcement is by `scripts/study02/cost_cap.mjs` (admission before dispatch using actual +
reserved + worst-case reservation; hard stop on breach/overrun). No purchase/credit action is required.

## 5. Authorization requested

> **Please authorize execution of the bounded 32-request Baseten qualification against the already
> configured `baseten-muse` / `meta-models/muse-spark-open-1026` entry, using the existing hackathon
> key and supplied credits, within the stated usage ceiling and a hard $6.00 spend cap, with outputs
> confined to `qualification-baseten/`.**

No call will be made until that authorization is given. Confirmatory execution and the preregistration
freeze remain separately gated and are not requested here.
