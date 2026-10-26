import type { MemoryEngine } from '@mml/memory-engine';
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
  type ServiceMeta,
} from '@mml/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '../config.js';

/**
 * Memory API.
 *
 * Thin transport over the engine: parse with the shared schema, call one
 * engine method, validate the response shape. All invariants (scope, dedupe,
 * supersession, deletion) live in the engine and are tested there; this layer
 * only decides status codes and envelopes.
 */

const IdParamsSchema = z.object({ id: z.uuid() });

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
}

export function registerMemoryRoutes(
  app: FastifyInstance,
  dependencies: MemoryRouteDependencies,
): void {
  const { engine, config } = dependencies;

  // --- Stats: aggregate counts for the inspector header. -------------------
  app.get('/api/memories/stats', async () => {
    const stats: MemoryStats = MemoryStatsSchema.parse(engine.stats());
    return apiSuccess(stats);
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

  // --- Detail --------------------------------------------------------------
  app.get('/api/memories/:id', async (request) => {
    const { id } = IdParamsSchema.parse(request.params);
    const detail: MemoryDetail = MemoryDetailSchema.parse(engine.getDetail(id));
    return apiSuccess(detail);
  });

  // --- Create --------------------------------------------------------------
  app.post('/api/memories', async (request, reply) => {
    const input: MemoryCreateInput = MemoryCreateInputSchema.parse(request.body ?? {});
    const result: MemoryCreateResult = MemoryCreateResultSchema.parse(engine.create(input));
    // 201 only when a row was actually written; a deduplicated replay is 200.
    return reply.status(result.created ? 201 : 200).send(apiSuccess(result));
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

    // Installation defaults apply unless the caller asks for a specific budget.
    const budget = { ...config.memoryBudget, ...(body.budget ?? {}) };
    const retrieval = engine.retrieve({ ...body, budget });
    const context = engine.renderContext({ ...body, budget });

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
