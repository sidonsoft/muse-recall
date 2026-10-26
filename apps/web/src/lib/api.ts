import {
  type ApiEnvelope,
  type HealthResponse,
  HealthResponseSchema,
  type ModelResponse,
  ModelResponseSchema,
  type ServiceMeta,
  ServiceMetaSchema,
} from '@mml/shared';

/**
 * Typed API client.
 *
 * Responses are re-validated with the same Zod schemas the server writes
 * with, so a contract drift surfaces immediately in development instead of
 * becoming a silently blank panel during the demo.
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

async function request<T>(
  path: string,
  init: RequestInit,
  validate: (value: unknown) => T,
): Promise<T> {
  let response: Response;
  try {
    // Only declare a JSON content type when a body is actually sent: Fastify
    // rejects an empty payload announced as application/json.
    const headers: Record<string, string> = { ...((init.headers as Record<string, string>) ?? {}) };
    if (init.body !== undefined && init.body !== null) {
      headers['content-type'] = 'application/json';
    }

    response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  } catch (cause) {
    throw new ApiError(
      'network_unreachable',
      'Cannot reach the Muse Memory Lab server. Is it running on port 8787?',
      0,
      { cause },
    );
  }

  const text = await response.text();
  let envelope: ApiEnvelope<unknown>;
  try {
    envelope = JSON.parse(text) as ApiEnvelope<unknown>;
  } catch {
    throw new ApiError(
      'invalid_response',
      `Server returned a non-JSON response (HTTP ${response.status}).`,
      response.status,
    );
  }

  if (!envelope || typeof envelope !== 'object' || !('ok' in envelope)) {
    throw new ApiError(
      'invalid_response',
      'Server returned an unexpected envelope.',
      response.status,
    );
  }

  if (!envelope.ok) {
    throw new ApiError(envelope.error.code, envelope.error.message, response.status);
  }

  try {
    return validate(envelope.data);
  } catch (cause) {
    throw new ApiError(
      'contract_mismatch',
      `Response did not match the shared schema: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      response.status,
    );
  }
}

export interface ProviderProbeState {
  checked_at: string | null;
  ok: boolean;
  latency_ms: number | null;
  model: string | null;
  message: string;
  verified_with_live_call: boolean;
}

export const api = {
  health: (options: { live?: boolean } = {}) =>
    request<HealthResponse>(
      `/api/health${options.live ? '?probe=live' : ''}`,
      { method: 'GET' },
      (data) => HealthResponseSchema.parse(data),
    ),

  meta: () =>
    request<ServiceMeta>('/api/meta', { method: 'GET' }, (data) => ServiceMetaSchema.parse(data)),

  probeProvider: () =>
    request<ProviderProbeState>(
      '/api/health/muse',
      { method: 'POST' },
      (data) => data as ProviderProbeState,
    ),

  generate: (input: { prompt: string; system?: string; max_output_tokens?: number }) =>
    request<ModelResponse>(
      '/api/provider/generate',
      { method: 'POST', body: JSON.stringify(input) },
      (data) => ModelResponseSchema.parse(data),
    ),
};
