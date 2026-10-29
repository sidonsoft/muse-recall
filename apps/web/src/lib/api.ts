import {
  type ApiEnvelope,
  type ForgeApprovalResult,
  ForgeApprovalResultSchema,
  type ForgeArtifact,
  ForgeArtifactSchema,
  type ForgeDiff,
  ForgeDiffSchema,
  type ForgeJob,
  ForgeJobSchema,
  type ForgeProjectView,
  ForgeProjectViewSchema,
  type ForgeRecoveryReport,
  ForgeRecoveryReportSchema,
  type ForgeState,
  ForgeStateSchema,
  type HealthResponse,
  HealthResponseSchema,
  type Memory,
  type MemoryCorrectionRequestInput,
  type MemoryCorrectionResult,
  MemoryCorrectionResultSchema,
  type MemoryCreateRequest,
  type MemoryCreateResult,
  MemoryCreateResultSchema,
  type MemoryDetail,
  MemoryDetailSchema,
  type MemoryListResponse,
  MemoryListResponseSchema,
  type MemoryStats,
  MemoryStatsSchema,
  type MemoryUpdateInput,
  type ModelResponse,
  ModelResponseSchema,
  type Project,
  type RetrievalBudget,
  type RetrievalPreview,
  RetrievalPreviewSchema,
  type ServiceMeta,
  ServiceMetaSchema,
  type Session,
  type SessionDetail,
  SessionDetailSchema,
  type SessionList,
  SessionListSchema,
  SessionSchema,
  type ToolCallList,
  ToolCallListSchema,
  type ToolDecisionResult,
  ToolDecisionResultSchema,
  type ToolList,
  ToolListSchema,
  type TurnResult,
  TurnResultSchema,
} from '@mml/shared';
import {
  type UiGenerationResult,
  UiGenerationResultSchema,
  type UiSubmissionResult,
  UiSubmissionResultSchema,
  type UiSurfaceList,
  UiSurfaceListSchema,
} from '@mml/ui-protocol';
import { z } from 'zod';

/**
 * Typed API client.
 *
 * Responses are re-validated with the same Zod schemas the server writes
 * with, so a contract drift surfaces immediately in development instead of
 * becoming a silently blank panel during the demo.
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

/** Prefix an API path with the configured base URL (empty for same-origin). */
export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

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

    response = await fetch(apiUrl(path), { ...init, headers });
  } catch (cause) {
    throw new ApiError(
      'network_unreachable',
      'Cannot reach the Muse Recall server. Is it running on port 8787?',
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

/** Envelope shapes the client validates but the server does not need to share. */
const DeleteResultSchema = z.object({ id: z.uuid(), deleted: z.literal(true) });
const HistoryResultSchema = z.object({ entries: z.array(z.unknown()) });
const ProjectListSchema = z.object({ items: z.array(z.unknown()) });

export interface MemoryListParams {
  project_id?: string;
  all_projects?: boolean;
  include_global?: boolean;
  q?: string;
  type?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

function toQuery(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded.length > 0 ? `?${encoded}` : '';
}

export const api = {
  health: () =>
    request<HealthResponse>('/api/health', { method: 'GET' }, (data) =>
      HealthResponseSchema.parse(data),
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

  // --- Memory -------------------------------------------------------------

  listMemories: (params: MemoryListParams = {}) =>
    request<MemoryListResponse>(
      `/api/memories${toQuery({ ...params })}`,
      { method: 'GET' },
      (data) => MemoryListResponseSchema.parse(data),
    ),

  memoryStats: () =>
    request<MemoryStats>('/api/memories/stats', { method: 'GET' }, (data) =>
      MemoryStatsSchema.parse(data),
    ),

  projects: () =>
    request<Project[]>(
      '/api/projects',
      { method: 'GET' },
      (data) => ProjectListSchema.parse(data).items as Project[],
    ),

  memory: (id: string) =>
    request<MemoryDetail>(`/api/memories/${id}`, { method: 'GET' }, (data) =>
      MemoryDetailSchema.parse(data),
    ),

  memoryHistory: (id: string) =>
    request<unknown[]>(
      `/api/memories/${id}/history`,
      { method: 'GET' },
      (data) => HistoryResultSchema.parse(data).entries,
    ),

  createMemory: (input: MemoryCreateRequest) =>
    request<MemoryCreateResult>(
      '/api/memories',
      { method: 'POST', body: JSON.stringify(input) },
      (data) => MemoryCreateResultSchema.parse(data),
    ),

  updateMemory: (id: string, input: MemoryUpdateInput) =>
    request<Memory>(
      `/api/memories/${id}`,
      { method: 'PATCH', body: JSON.stringify(input) },
      (data) => MemoryCreateResultSchema.shape.memory.parse(data),
    ),

  correctMemory: (id: string, input: MemoryCorrectionRequestInput) =>
    request<MemoryCorrectionResult>(
      `/api/memories/${id}/correct`,
      { method: 'POST', body: JSON.stringify(input) },
      (data) => MemoryCorrectionResultSchema.parse(data),
    ),

  deleteMemory: (id: string, reason?: string) =>
    request<{ id: string; deleted: true }>(
      `/api/memories/${id}`,
      { method: 'DELETE', body: JSON.stringify(reason ? { reason } : {}) },
      (data) => DeleteResultSchema.parse(data),
    ),

  // --- Conversations ------------------------------------------------------

  createSession: (input: { project_id: string | null; title?: string }) =>
    request<Session>('/api/sessions', { method: 'POST', body: JSON.stringify(input) }, (data) =>
      SessionSchema.parse(data),
    ),

  listSessions: (params: { status?: string; limit?: number } = {}) =>
    request<SessionList>(`/api/sessions${toQuery({ ...params })}`, { method: 'GET' }, (data) =>
      SessionListSchema.parse(data),
    ),

  session: (id: string) =>
    request<SessionDetail>(`/api/sessions/${id}`, { method: 'GET' }, (data) =>
      SessionDetailSchema.parse(data),
    ),

  updateSession: (id: string, patch: { title?: string; status?: 'active' | 'archived' }) =>
    request<Session>(
      `/api/sessions/${id}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
      (data) => SessionSchema.parse(data),
    ),

  deleteSession: (id: string) =>
    request<{ id: string; deleted: true }>(`/api/sessions/${id}`, { method: 'DELETE' }, (data) =>
      DeleteResultSchema.parse(data),
    ),

  /** Non-streaming turn; the streaming path lives in lib/turn-stream.ts. */
  sendMessage: (id: string, input: { content: string; capture_memories?: boolean }) =>
    request<TurnResult>(
      `/api/sessions/${id}/messages`,
      { method: 'POST', body: JSON.stringify(input) },
      (data) => TurnResultSchema.parse(data),
    ),

  // --- Generated interfaces ----------------------------------------------

  sessionSurfaces: (id: string) =>
    request<UiSurfaceList>(`/api/sessions/${id}/ui`, { method: 'GET' }, (data) =>
      UiSurfaceListSchema.parse(data),
    ),

  generateSurface: (id: string, intent: string) =>
    request<UiGenerationResult>(
      `/api/sessions/${id}/ui`,
      { method: 'POST', body: JSON.stringify({ intent }) },
      (data) => UiGenerationResultSchema.parse(data),
    ),

  submitSurface: (
    id: string,
    surfaceId: string,
    input: { action_id: string; values: Record<string, string | number | boolean | string[]> },
  ) =>
    request<UiSubmissionResult>(
      `/api/sessions/${id}/ui/${surfaceId}/events`,
      { method: 'POST', body: JSON.stringify(input) },
      (data) => UiSubmissionResultSchema.parse(data),
    ),

  // --- Forge --------------------------------------------------------------

  forgeProject: (projectId: string, name?: string) =>
    request<ForgeProjectView>(
      '/api/forge/projects',
      {
        method: 'POST',
        body: JSON.stringify({ project_id: projectId, ...(name ? { name } : {}) }),
      },
      (data) => ForgeProjectViewSchema.parse(data),
    ),

  forgeState: (projectId: string) =>
    request<ForgeProjectView>(`/api/forge/projects/${projectId}`, { method: 'GET' }, (data) =>
      ForgeProjectViewSchema.parse(data),
    ),

  forgeAcknowledgeRecovery: (projectId: string, issueIds: string[]) =>
    request<ForgeRecoveryReport>(
      `/api/forge/projects/${projectId}/recovery/ack`,
      { method: 'POST', body: JSON.stringify({ issue_ids: issueIds }) },
      (data) => ForgeRecoveryReportSchema.parse(data),
    ),

  forgeStorageCheck: (projectId: string) =>
    request<ForgeRecoveryReport>(
      `/api/forge/projects/${projectId}/storage-check`,
      { method: 'POST' },
      (data) => ForgeRecoveryReportSchema.parse(data),
    ),

  forgeGenerate: (projectId: string, prompt: string) =>
    request<ForgeJob>(
      `/api/forge/projects/${projectId}/generate`,
      { method: 'POST', body: JSON.stringify({ prompt }) },
      (data) => ForgeJobSchema.parse(data),
    ),

  forgeModify: (projectId: string, changeRequest: string, screenshotDataUrl?: string | null) =>
    request<ForgeJob>(
      `/api/forge/projects/${projectId}/modify`,
      {
        method: 'POST',
        body: JSON.stringify({
          request: changeRequest,
          ...(screenshotDataUrl ? { screenshot_data_url: screenshotDataUrl } : {}),
        }),
      },
      (data) => ForgeJobSchema.parse(data),
    ),

  forgeJob: (jobId: string) =>
    request<ForgeJob>(`/api/forge/jobs/${jobId}`, { method: 'GET' }, (data) =>
      ForgeJobSchema.parse(data),
    ),

  forgeCancel: (jobId: string) =>
    request<ForgeJob>(`/api/forge/jobs/${jobId}/cancel`, { method: 'POST' }, (data) =>
      ForgeJobSchema.parse(data),
    ),

  forgeArtifact: (projectId: string, jobId?: string) =>
    request<ForgeArtifact>(
      `/api/forge/projects/${projectId}/artifact${jobId ? `?job=${jobId}` : ''}`,
      { method: 'GET' },
      (data) => ForgeArtifactSchema.parse(data),
    ),

  forgeDiff: (jobId: string) =>
    request<ForgeDiff>(`/api/forge/jobs/${jobId}/diff`, { method: 'GET' }, (data) =>
      ForgeDiffSchema.parse(data),
    ),

  forgeApprove: (jobId: string, captureMemory: boolean, decision?: string) =>
    request<ForgeApprovalResult>(
      `/api/forge/jobs/${jobId}/approve`,
      {
        method: 'POST',
        body: JSON.stringify({
          capture_memory: captureMemory,
          ...(decision ? { decision } : {}),
        }),
      },
      (data) => ForgeApprovalResultSchema.parse(data),
    ),

  forgeReject: (jobId: string) =>
    request<ForgeJob>(`/api/forge/jobs/${jobId}/reject`, { method: 'POST' }, (data) =>
      ForgeJobSchema.parse(data),
    ),

  forgeRollback: (projectId: string) =>
    request<ForgeState>(`/api/forge/projects/${projectId}/rollback`, { method: 'POST' }, (data) =>
      ForgeStateSchema.parse(data),
    ),

  forgePreviewUrl: (projectId: string, jobId?: string) =>
    apiUrl(`/api/forge/projects/${projectId}/preview${jobId ? `?job=${jobId}` : ''}`),

  // --- Tools --------------------------------------------------------------

  toolRegistry: () =>
    request<ToolList>('/api/tools', { method: 'GET' }, (data) => ToolListSchema.parse(data)),

  sessionTools: (id: string) =>
    request<ToolCallList>(`/api/sessions/${id}/tools`, { method: 'GET' }, (data) =>
      ToolCallListSchema.parse(data),
    ),

  decideTool: (id: string, callId: string, decision: 'approve' | 'deny') =>
    request<ToolDecisionResult>(
      `/api/sessions/${id}/tools/${callId}/decision`,
      { method: 'POST', body: JSON.stringify({ decision }) },
      (data) => ToolDecisionResultSchema.parse(data),
    ),

  // --- Retrieval ----------------------------------------------------------

  retrievalPreview: (input: {
    project_id: string | null;
    query: string;
    budget?: Partial<RetrievalBudget>;
  }) =>
    request<RetrievalPreview>(
      '/api/retrieval/preview',
      { method: 'POST', body: JSON.stringify(input) },
      (data) => RetrievalPreviewSchema.parse(data),
    ),
};
