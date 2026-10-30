import { z } from 'zod';

/**
 * Uniform HTTP envelope.
 *
 * Every endpoint returns either `{ ok: true, data }` or `{ ok: false, error }`
 * so the client has exactly one shape to handle and never has to guess
 * whether a non-2xx body is HTML, a stack trace, or JSON.
 */
export const ApiErrorBodySchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  /** Field-level validation detail, when the failure was a bad request. */
  details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;

export type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error: ApiErrorBody };

export function apiSuccess<T>(data: T): ApiEnvelope<T> {
  return { ok: true, data };
}

export function apiFailure(
  code: string,
  message: string,
  details?: ApiErrorBody['details'],
): ApiEnvelope<never> {
  return { ok: false, error: details ? { code, message, details } : { code, message } };
}

/**
 * Canonical error codes. Keeping them in one place stops the frontend from
 * string-matching prose.
 */
export const API_ERROR_CODES = {
  badRequest: 'bad_request',
  invalidHost: 'invalid_host',
  forbiddenOrigin: 'forbidden_origin',
  notFound: 'not_found',
  unauthorized: 'unauthorized',
  validationFailed: 'validation_failed',
  providerUnavailable: 'provider_unavailable',
  internal: 'internal_error',
} as const;

/**
 * Machine-readable error catalogue (roadmap §3 remainder). It MIRRORS the
 * mappings the server actually performs today — including the two known
 * asymmetries (memory_storage_failed landing on the generic 400 handler, and
 * Forge routes reporting schema failures as `invalid_request` instead of
 * `validation_failed`) — so a client can code against reality. When a mapping
 * is fixed, the catalogue and the boundary tests move together; CI compares
 * live responses against these entries.
 */
export const ERROR_CATALOG_VERSION = 1;

export const ErrorCatalogEntrySchema = z.object({
  code: z.string().min(1).max(64),
  http_status: z.number().int().min(100).max(599),
  when: z.string().min(1).max(300),
});
export type ErrorCatalogEntry = z.infer<typeof ErrorCatalogEntrySchema>;

export const ErrorCatalogSchema = z.object({
  catalog_version: z.number().int(),
  groups: z.object({
    transport: z.array(ErrorCatalogEntrySchema),
    session: z.array(ErrorCatalogEntrySchema),
    memory: z.array(ErrorCatalogEntrySchema),
    forge: z.array(ErrorCatalogEntrySchema),
    provider: z.array(ErrorCatalogEntrySchema),
  }),
});
export type ErrorCatalog = z.infer<typeof ErrorCatalogSchema>;

export const API_ERROR_CATALOG: ErrorCatalog = {
  catalog_version: ERROR_CATALOG_VERSION,
  groups: {
    transport: [
      {
        code: 'unauthorized',
        http_status: 401,
        when: 'Token mode only: bearer token missing or mismatched on any /api route except GET /api/health.',
      },
      {
        code: 'invalid_host',
        http_status: 400,
        when: 'Host header names a host the loopback/host guard does not accept (port must also match in token mode).',
      },
      {
        code: 'forbidden_origin',
        http_status: 403,
        when: 'State-changing request from a foreign Origin, or Sec-Fetch-Site declares cross-site.',
      },
      { code: 'bad_request', http_status: 400, when: 'Request body is not valid JSON.' },
      {
        code: 'validation_failed',
        http_status: 400,
        when: 'Body/params/query failed its schema; details list field paths and messages.',
      },
      { code: 'not_found', http_status: 404, when: 'No route matched this path and method.' },
      { code: 'internal_error', http_status: 500, when: 'Unhandled server-side failure.' },
    ],
    session: [
      { code: 'session_not_found', http_status: 404, when: 'Session id does not exist.' },
      {
        code: 'session_archived',
        http_status: 409,
        when: 'The session is archived and read-only.',
      },
      {
        code: 'session_busy',
        http_status: 409,
        when: 'Another turn is already running in this session.',
      },
      {
        code: 'turn_cancelled',
        http_status: 408,
        when: 'The in-flight turn was cancelled by the client.',
      },
      {
        code: 'context_overflow',
        http_status: 400,
        when: 'Context assembly exceeded the prompt budget.',
      },
      {
        code: 'message_too_long',
        http_status: 400,
        when: 'Message exceeds the configured character cap.',
      },
      {
        code: 'invalid_request',
        http_status: 400,
        when: 'Runtime-level request rejection (e.g. empty message).',
      },
      {
        code: 'provider_failure',
        http_status: 502,
        when: 'The model provider call failed during a turn.',
      },
    ],
    memory: [
      {
        code: 'memory_not_found',
        http_status: 404,
        when: 'Memory id does not exist (or was deleted).',
      },
      {
        code: 'memory_conflict',
        http_status: 409,
        when: 'Edit/correct/review conflicts with current state, e.g. expected_revision mismatch or an already-superseded target.',
      },
      {
        code: 'memory_invalid',
        http_status: 400,
        when: 'Structurally invalid memory or export envelope (cycle, bad snapshot).',
      },
      {
        code: 'memory_storage_failed',
        http_status: 400,
        when: 'Durable write failed. Asymmetry pinned by the catalogue: the generic handler currently maps this to 400; a 5xx mapping is open roadmap work.',
      },
    ],
    forge: [
      { code: 'invalid_job_id', http_status: 404, when: 'Job id is unknown for this project.' },
      { code: 'invalid_project_id', http_status: 400, when: 'Project id fails the id pattern.' },
      {
        code: 'path_escape',
        http_status: 400,
        when: 'A requested path would leave the project workspace.',
      },
      {
        code: 'decision_required',
        http_status: 400,
        when: 'The action needs an explicit Decision Guard acknowledgement.',
      },
      {
        code: 'invalid_screenshot',
        http_status: 400,
        when: 'Preview capture is not a usable PNG data URL.',
      },
      {
        code: 'runtime_failed',
        http_status: 422,
        when: 'The staged page failed managed-runtime verification.',
      },
      {
        code: 'too_many_jobs',
        http_status: 429,
        when: 'Per-project queued/running job budget exhausted.',
      },
      {
        code: 'persistence_failed',
        http_status: 503,
        when: 'Durable job/version writes are failing and the operation cannot commit.',
      },
      {
        code: 'shutting_down',
        http_status: 503,
        when: 'Server is draining; no new Forge work accepted.',
      },
      {
        code: 'state_corrupt',
        http_status: 500,
        when: 'Project state.json is malformed; use the recovery endpoints (GET recovery/state, POST recovery/repair).',
      },
      { code: 'state_valid', http_status: 409, when: 'Repair refused: the state file is valid.' },
      { code: 'invalid_staged', http_status: 409, when: 'Staged change is missing or malformed.' },
      {
        code: 'invalid_job_state',
        http_status: 409,
        when: 'Operation is illegal for the job status (e.g. approve a failed job).',
      },
      {
        code: 'version_conflict',
        http_status: 409,
        when: 'Expected base version no longer current.',
      },
      {
        code: 'version_corrupt',
        http_status: 409,
        when: 'A stored version file fails its recorded hash.',
      },
      { code: 'unsafe_file', http_status: 409, when: 'A staged file is outside policy.' },
      {
        code: 'nothing_to_rollback',
        http_status: 409,
        when: 'Rollback requested with no rollbackable ancestry.',
      },
      {
        code: 'no_current_version',
        http_status: 409,
        when: 'Operation needs a current version; project has none.',
      },
      {
        code: 'staged_changed',
        http_status: 409,
        when: 'Staged bytes changed between staging and approval (exact SHA mismatch).',
      },
      {
        code: 'invalid_request',
        http_status: 400,
        when: 'Forge routes report schema failures as invalid_request (first issue message) — asymmetry vs validation_failed, pinned here until unified.',
      },
    ],
    provider: [
      {
        code: 'provider_unavailable',
        http_status: 503,
        when: '/api/bench: provider binary missing or not executable.',
      },
      {
        code: 'provider_auth_failed',
        http_status: 503,
        when: '/api/bench: provider rejected the call (auth, quota, region).',
      },
      {
        code: 'provider_timeout',
        http_status: 503,
        when: '/api/bench: call exceeded the wall-clock budget.',
      },
      {
        code: 'provider_cancelled',
        http_status: 503,
        when: '/api/bench: call aborted by the caller signal.',
      },
      {
        code: 'provider_crashed',
        http_status: 503,
        when: '/api/bench: provider exited non-zero without a terminal event.',
      },
      {
        code: 'provider_invalid_output',
        http_status: 503,
        when: '/api/bench: non-empty output failed schema validation.',
      },
      {
        code: 'invalid_request',
        http_status: 503,
        when: '/api/bench: ProviderError flagged a request bug; bench still maps every provider failure to 503 with its code.',
      },
    ],
  },
};
