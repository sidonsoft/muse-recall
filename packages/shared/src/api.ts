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
  validationFailed: 'validation_failed',
  providerUnavailable: 'provider_unavailable',
  internal: 'internal_error',
} as const;
