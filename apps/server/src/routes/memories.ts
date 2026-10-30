import { formatMemoryContext, type MemoryEngine } from '@mml/memory-engine';
import {
  apiSuccess,
  DEFAULT_RETRIEVAL_WEIGHTS,
  type MemoryCorrectionRequest,
  MemoryCorrectionRequestSchema,
  type MemoryCorrectionResult,
  MemoryCorrectionResultSchema,
  type MemoryCreateInput,
  MemoryCreateInputSchema,
  type MemoryCreateResult,
  MemoryCreateResultSchema,
  type MemoryDetail,
  MemoryDetailSchema,
  type MemoryHistoryEntry,
  MemoryHistoryEntrySchema,
  MemoryImportResultSchema,
  type MemoryListResponse,
  MemoryListResponseSchema,
  MemoryQuerySchema,
  type MemoryStats,
  MemoryStatsSchema,
  type MemoryStatus,
  type MemoryType,
  MemoryUpdateInputSchema,
  type Project,
  ProjectSchema,
  RetrievalPreviewSchema,
  RetrievalRequestSchema,
  ReviewQueueSchema,
  type ServiceMeta,
} from '@mml/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { type IdempotencyStore, idempotent } from '../idempotency.js';

/**
 * Memory API.
 *
 * Thin transport over the engine: parse with the shared schema, call one
 * engine method, validate the response shape. All invariants (scope, dedupe,
 * supersession, deletion) live in the engine and are tested there; this layer
 * only decides status codes and envelopes.
 */

const IdParamsSchema = z.object({ id: z.uuid() });

/**
 * Proposal decisions carry an optional human-readable reason. The proposal
 * body itself reuses MemoryCreateInputSchema plus an explicit actor split
 * out in the route handler.
 */
const ProposalDecisionSchema = z.object({ reason: z.string().max(1_000).optional() });

/** Query-string booleans arrive as `"true"`/`"false"`. */
const Booleanish = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => value === true || value === 'true');

const ListQuerySchema = z.object({
  q: z.string().max(500).optional(),
  project_id: z.string().min(1).max(128).optional(),
  include_global: Booleanish.optional(),
  all_projects: Booleanish.optional(),
  status: z.string().max(200).optional(),
  type: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const ReviewQueryStrings = z.object({
  project_id: z.string().min(1).max(128).optional(),
  all_projects: Booleanish.optional(),
  horizon_days: z.coerce.number().int().min(0).max(365).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const DeleteBodySchema = z.object({
  reason: z.string().max(1_000).optional(),
});

const DeleteResultSchema = z.object({
  id: z.uuid(),
  deleted: z.literal(true),
});

const HistoryResultSchema = z.object({
  entries: z.array(MemoryHistoryEntrySchema),
});

const ProjectListSchema = z.object({
  items: z.array(ProjectSchema),
});

function csv(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : undefined;
}

export interface MemoryRouteDependencies {
  engine: MemoryEngine;
  config: AppConfig;
  idempotency: IdempotencyStore;
}

export function registerMemoryRoutes(
  app: FastifyInstance,
  dependencies: MemoryRouteDependencies,
): void {
  const { engine, config, idempotency } = dependencies;

  // --- Stats: aggregate counts for the inspector header. -------------------
  app.get('/api/memories/stats', async () => {
    const stats: MemoryStats = MemoryStatsSchema.parse(engine.stats());
    return apiSuccess(stats);
  });

  // --- Export / import (roadmap §6 "Make changes safe") --------------------
  // The export is the raw envelope (not an apiSuccess wrapper) so the body
  // round-trips into POST /api/memories/import unchanged. Tombstones and
  // audit history are included by design: dropping them would erase the
  // audit guarantees the trail exists to provide.
  app.get('/api/memories/export', async (_request, reply) => {
    const envelope = engine.exportMemories();
    reply.header(
      'content-disposition',
      `attachment; filename="memory-export-${envelope.exported_at.slice(0, 10)}.json"`,
    );
    return envelope;
  });

  app.post('/api/memories/import', async (request) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const result = engine.importExport(body, { dryRun: body.dry_run === true });
    return apiSuccess(MemoryImportResultSchema.parse(result));
  });

  // --- Projects: scope anchors and the inspector's filter source. ----------
  app.get('/api/projects', async () => {
    const items: Project[] = engine.listProjects();
    return apiSuccess(ProjectListSchema.parse({ items }));
  });

  // --- List / search -------------------------------------------------------
  app.get('/api/memories', async (request) => {
    const query = ListQuerySchema.parse(request.query ?? {});
    const statuses = csv(query.status);
    const types = csv(query.type);

    const list: MemoryListResponse = MemoryListResponseSchema.parse(
      engine.list(
        MemoryQuerySchema.parse({
          ...(query.project_id ? { project_id: query.project_id } : {}),
          ...(query.include_global === undefined ? {} : { include_global: query.include_global }),
          ...(query.all_projects === undefined ? {} : { all_projects: query.all_projects }),
          ...(statuses ? { status: statuses as MemoryStatus[] } : {}),
          ...(types ? { types: types as MemoryType[] } : {}),
          ...(query.q ? { text: query.q } : {}),
          limit: query.limit,
          offset: query.offset,
        }),
      ),
    );

    return apiSuccess(list);
  });

  // --- Review queue (roadmap §7 / gap G-9) ---------------------------------
  // Derived, never stored: unverified, disputed, or expiry inside the horizon
  // (expired items have a negative days_until_expiry). Static route, so it
  // wins over /api/memories/:id regardless of registration order.
  app.get('/api/memories/review', async (request) => {
    const query = ReviewQueryStrings.parse(request.query ?? {});
    const list = ReviewQueueSchema.parse(
      engine.reviewQueue({
        ...(query.project_id ? { project_id: query.project_id } : {}),
        ...(query.all_projects === undefined ? {} : { all_projects: query.all_projects }),
        ...(query.horizon_days === undefined ? {} : { horizon_days: query.horizon_days }),
        limit: query.limit,
        offset: query.offset,
      }),
    );
    return apiSuccess(list);
  });

  // --- Detail --------------------------------------------------------------
  app.get('/api/memories/:id', async (request) => {
    const { id } = IdParamsSchema.parse(request.params);
    const detail: MemoryDetail = MemoryDetailSchema.parse(engine.getDetail(id));
    return apiSuccess(detail);
  });

  // --- Create --------------------------------------------------------------
  // Idempotency-Key support (D049): a client that retried after a timeout
  // replays the recorded response instead of creating a second memory.
  app.post('/api/memories', async (request, reply) => {
    return idempotent(request, reply, idempotency, async () => {
      const input: MemoryCreateInput = MemoryCreateInputSchema.parse(request.body ?? {});
      const result: MemoryCreateResult = MemoryCreateResultSchema.parse(engine.create(input));
      // 201 only when a row was actually written; a deduplicated replay is 200.
      return { status: result.created ? 201 : 200, body: apiSuccess(result) };
    });
  });

  // --- Proposals (roadmap §6: candidates kept apart from established facts) --
  // Proposals never enter retrieval; they are listed explicitly with
  // `?status=proposed` and decided through the routes below. A browser is a
  // `user` when deciding, while the proposal body names the originating
  // actor explicitly (default: an agent candidate).
  app.post('/api/memories/proposals', async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const { actor = 'agent', ...memoryFields } = body;
    const parsedActor = z.enum(['agent', 'system']).parse(actor);
    const input: MemoryCreateInput = MemoryCreateInputSchema.parse(memoryFields);
    const result: MemoryCreateResult = MemoryCreateResultSchema.parse(
      engine.propose(input, parsedActor),
    );
    return reply.status(result.created ? 201 : 200).send(apiSuccess(result));
  });

  app.post('/api/memories/:id/accept', async (request) => {
    const { id } = IdParamsSchema.parse(request.params);
    const body = ProposalDecisionSchema.parse(request.body ?? {});
    return apiSuccess(engine.acceptProposal(id, { reason: body.reason }));
  });

  app.post('/api/memories/:id/reject', async (request) => {
    const { id } = IdParamsSchema.parse(request.params);
    const body = ProposalDecisionSchema.parse(request.body ?? {});
    engine.rejectProposal(id, { reason: body.reason });
    return apiSuccess(DeleteResultSchema.parse({ id, deleted: true }));
  });

  // --- Update --------------------------------------------------------------
  app.patch('/api/memories/:id', async (request) => {
    const { id } = IdParamsSchema.parse(request.params);
    const input = MemoryUpdateInputSchema.parse(request.body ?? {});
    return apiSuccess(engine.update(id, input));
  });

  // --- Correct / supersede -------------------------------------------------
  app.post('/api/memories/:id/correct', async (request) => {
    const { id } = IdParamsSchema.parse(request.params);
    const body: MemoryCorrectionRequest = MemoryCorrectionRequestSchema.parse(request.body ?? {});

    // The addressed memory is always a target; extra targets may be supplied
    // so one correction can replace several contradictory records.
    const supersedes = [...new Set([id, ...(body.supersedes ?? [])])];
    const result: MemoryCorrectionResult = MemoryCorrectionResultSchema.parse(
      engine.correct({ ...body, supersedes }),
    );
    return apiSuccess(result);
  });

  // --- Delete (soft) -------------------------------------------------------
  app.delete('/api/memories/:id', async (request) => {
    const { id } = IdParamsSchema.parse(request.params);
    const body = DeleteBodySchema.parse(request.body ?? {});
    engine.softDelete(id, { reason: body.reason });
    return apiSuccess(DeleteResultSchema.parse({ id, deleted: true }));
  });

  // --- History -------------------------------------------------------------
  app.get('/api/memories/:id/history', async (request) => {
    const { id } = IdParamsSchema.parse(request.params);
    const entries: MemoryHistoryEntry[] = engine.history(id);
    return apiSuccess(HistoryResultSchema.parse({ entries }));
  });

  // --- Retrieval preview: ranking, evidence, and the exact prompt block ----
  app.post('/api/retrieval/preview', async (request) => {
    const body = RetrievalRequestSchema.parse(request.body ?? {});

    // Installation defaults apply to the default profile. Forge mode uses the
    // shared Forge profile (pinned types and 6/3,000 budget) unless the caller
    // explicitly overrides the budget for an experiment.
    const budget = {
      ...(body.mode === 'forge' ? {} : config.memoryBudget),
      ...(body.budget ?? {}),
    };
    const retrieval = engine.retrieve({ ...body, budget });

    // Preview the block the selected consumer actually injects. Forge uses its
    // own two-section layout, while default preview callers keep the canonical
    // `<retrieved_memories>` block. Format the selection we already made rather
    // than retrieving a second time, so ids and text cannot drift.
    const context = formatMemoryContext(
      retrieval,
      retrieval.metadata.mode === 'forge' ? 'forge' : 'canonical',
    );

    return apiSuccess(RetrievalPreviewSchema.parse({ retrieval, context }));
  });
}

/** Shape used by `/api/meta` for the memory configuration block. */
export function memoryMeta(config: AppConfig): ServiceMeta['memory'] {
  return {
    default_budget: config.memoryBudget,
    weights: DEFAULT_RETRIEVAL_WEIGHTS,
  };
}
