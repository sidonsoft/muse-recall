# Cross-origin state-mutation fix

**Status:** fixed on `agent/muse-recall-release-candidate`.
**Scope:** `POST /api/forge/jobs/:jobId/approve`, `/reject`, `/cancel`,
`POST /api/forge/projects/:id/rollback`, and every other state-changing route.

## 1. The vulnerability

CORS is a **response** control. It stops a foreign page from reading a response; it does not stop
the browser from sending a request that needs no preflight. The mutating Forge routes accept a
bodyless `POST`, so a cross-site page could change project state even though it could not read the
reply.

The Host-header guard was not sufficient. It defends against DNS rebinding, and a cross-site
request still arrives with a legitimate `Host: 127.0.0.1:8787`.

The audit reproduced three variants against an isolated server:

1. `POST /api/forge/jobs/<staged>/approve` with `Origin: https://evil.example` → `200`; the staged
   job was promoted.
2. `POST /api/forge/projects/<id>/rollback` with `Origin: null` → `200`; v2 rolled back to v1.
3. A headless-Chrome chain: a staged preview navigated itself to a loopback landing page with
   `location.href`, and that page sent `fetch(…/rollback, { method: 'POST', mode: 'no-cors' })`;
   the project rolled back from v3 to v1.

JSON-bodied routes were already harder to reach (a `text/plain` body fails schema validation), but
the bodyless approve/reject/rollback/cancel routes were not.

## 2. The fix

A pure decision module, [`apps/server/src/origin-guard.ts`](../../apps/server/src/origin-guard.ts),
is applied as an `onRequest` hook in
[`apps/server/src/app.ts`](../../apps/server/src/app.ts), immediately after the Host guard and
before any handler or CORS handling.

For **safe methods** (`GET`, `HEAD`, `OPTIONS`) the guard allows the request; there is no state to
change, and CORS continues to govern reads.

For **state-changing methods** (everything else):

| Request | Decision |
|---|---|
| `Origin` equals the request's own origin, derived from the validated `Host` header | Allow (`same-origin`) |
| `Origin` equals a normalized origin in `CORS_ORIGINS` | Allow (`trusted-origin`) |
| `Origin: null` | **403 `forbidden_origin`** |
| Malformed, non-HTTP(S), multi-valued, user-info, path/query/fragment, trailing-dot or non-canonical `Origin` | **403 `forbidden_origin`** |
| Foreign scheme, host or port (including deceptive names such as `127.0.0.1.evil.example` and `localhost:5174`) | **403 `forbidden_origin`** |
| No `Origin`, no browser cross-site signal | Allow as a **non-browser client** |
| No `Origin`, but `Sec-Fetch-Site` is `cross-site` or `same-site` | **403 `forbidden_origin`** |

Nothing is changed on a rejected request: the hook returns before routing, so no handler, lock or
workspace write runs.

### Origin parsing details

- Exactly one canonical `scheme://host[:port]` is accepted. `URL` parsing is followed by a
  canonical-form check, so `http://host/`, `http://host:80`, upper-case spellings and comma- or
  space-separated lists are refused rather than normalized by guesswork.
- Scheme, host and port all participate in the comparison. `https://127.0.0.1:8787` is **not**
  same-origin with the plain-HTTP server.
- `127.0.0.1`, `localhost` and `[::1]` are distinct browser origins. They are each accepted when
  they match the `Host` header or a configured origin; they are not silently treated as
  interchangeable.
- A configured origin is normalized with the same parser; a malformed configuration entry
  contributes no trust instead of weakening the check.

### Why absence of `Origin` is not treated as same-origin

A request with no `Origin` is not assumed to come from the application. It is handled as a
**non-browser client** (curl, tests, the Vite proxy) and remains subject to the Host guard and normal
route validation. If the browser supplies `Sec-Fetch-Site: cross-site` (or `same-site`) without an
`Origin`, the request is refused. Browsers attach `Origin` to cross-origin state-changing requests;
the guard does not weaken that assumption into a same-origin claim.

## 3. CSRF / authentication evaluation

This deployment is a **single-user loopback tool**. It has no cookies, no login and no ambient
credentials, so a classic double-submit CSRF token would add a second mechanism without changing the
threat model: the attacker's leverage is the browser's ability to send a bodyless request, not a
stolen session.

The proportionate control is therefore the Origin guard plus the existing Host guard. That is
sufficient for the documented deployment.

It is **not** sufficient for a multi-user or network-exposed deployment. Before that:

- add authentication (session cookie with `SameSite=Lax`/`Strict` or a bearer token);
- add a CSRF token for cookie-authenticated mutations (or require a custom header that forces a
  preflight);
- terminate TLS and configure the exact public origins in `CORS_ORIGINS`;
- keep the Host guard and add an explicit allowlist for proxied hosts.

This is documented as a residual limit rather than implemented, because adding an auth system is
outside the authorised release scope.

## 4. Preserved protections

The fix does not touch:

- the iframe `sandbox="allow-scripts"` policy;
- the preview CSP (`default-src 'none'`, `sandbox allow-scripts`, `form-action 'none'`,
  `connect-src` limited to jsDelivr, etc.);
- runtime network restrictions or the approval-time load check;
- artifact authorisation, project-id validation, realpath containment or promotion hashing;
- the Host-header guard;
- API semantics for legitimate clients.

## 5. Regression tests

### Unit — `tests/unit/origin-guard.test.ts` (17 tests)

Canonical parsing; rejection of `null`, empty, non-HTTP, paths, queries, user-info, trailing dots,
lists and deceptive hosts/ports; scheme mismatch; IPv6; safe methods; same-origin; configured dev
origin; missing-Origin non-browser clients; missing-Origin cross-site refusal; malformed configured
origins.

### Integration — `tests/integration/forge-origin-guard.test.ts` (14 tests)

1. Trusted same-origin POST.
2. Trusted development origin.
3. Foreign HTTPS origin.
4. `Origin: null`.
5. Malformed `Origin`.
6. Deceptive hostname.
7. Deceptive port.
8. Legitimate approval.
9. Legitimate rejection.
10. Legitimate rollback.
11. Legitimate cancellation.
12. Foreign-origin attempts on approve, reject, cancel and rollback leave state, job status and
    approved version unchanged.
13. No-Origin request marked `Sec-Fetch-Site: cross-site` is refused.
14. No-Origin non-browser client still works.

### Browser reproduction — `pnpm verify:security`

`scripts/verify-origin-guard.ts` starts an isolated API with the deterministic fake-Muse fixture and
an approved v1/v2, serves a hostile page from a **different loopback origin**, and drives real
headless Chrome:

- the hostile page's `no-cors` rollback POST receives **403**, and the approved version stays **v2**;
- a legitimate same-origin browser POST receives **200**, and the project rolls back to **v1**.

Observed during release verification:

```
PASS foreign-origin rollback rejected (403); state still v2
PASS same-origin rollback accepted (200); state rolled back to v1
```

## 6. Residual risks

- A **public** hostile origin under Chrome Local Network Access was not tested; the browser
  reproduction used a loopback hostile origin, matching the audit's tested path. The server-side
  Origin check is independent of that browser policy, but the browser path from a public origin is
  unverified.
- A non-browser client can forge any `Origin`; this guard is a browser-confusion control, not
  authentication. That is acceptable for loopback single-user use and is not safe for exposure.
- Browser extensions or compromised local processes are outside the threat model.
- Preview self-navigation to an arbitrary origin remains possible (CSP has no navigation directive).
  It no longer enables state mutation, but it remains a data-exposure surface for the generated
  document and job id.
- WebRTC/DNS-prefetch side channels were not tested.
- `script-src https://cdn.jsdelivr.net` remains a supply-chain trust decision, unchanged.
