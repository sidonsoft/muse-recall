import type { DatabaseSync } from 'node:sqlite';
import cors from '@fastify/cors';
import { AgentError, AgentRuntime } from '@mml/agent-core';
import { type MemoryEngine, MemoryError, probeDatabase } from '@mml/memory-engine';
import { ProviderError } from '@mml/muse-provider';
import {
  API_ERROR_CODES,
  apiFailure,
  apiSuccess,
  HealthResponseSchema,
  LivenessResponseSchema,
  type ModelProvider,
  ServiceMetaSchema,
  type ServiceStatus,
} from '@mml/shared';
import {
  createDefaultToolRegistry,
  type ToolCallStore,
  ToolCallStore as ToolCallStoreImpl,
  type ToolRegistry,
} from '@mml/tool-runtime';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from './config.js';
import { SERVICE_NAME } from './config.js';
import { ForgeJobManager } from './forge/runner.js';
import { ForgeWorkspace } from './forge/workspace.js';
import { isAllowedHostHeader } from './host-guard.js';
import { ProviderHealthTracker } from './provider-health.js';
import { registerForgeRoutes } from './routes/forge.js';
import { memoryMeta, registerMemoryRoutes } from './routes/memories.js';
import { registerSessionRoutes } from './routes/sessions.js';
import { registerToolRoutes } from './routes/tools.js';
import { registerUiRoutes } from './routes/ui.js';

export interface AppDependencies {
  config: AppConfig;
  /** Live SQLite handle. */
  db: DatabaseSync;
  /** Path reported in health output (may be ':memory:'). */
  dbPath: string;
  provider: ModelProvider;
  /** Persistent memory engine bound to the same database. */
  engine: MemoryEngine;
  /** Conversation runtime. Created from `engine`/`provider` when omitted. */
  runtime?: AgentRuntime;
  /** Injectable for tests; created by default. */
  toolRegistry?: ToolRegistry;
  toolStore?: ToolCallStore;
  /** Forge workspace/job manager; created under WORKSPACE_ROOT when omitted. */
  forgeWorkspace?: ForgeWorkspace;
  forgeManager?: ForgeJobManager;
  /** Injectable so tests can share or reset the tracker. */
  providerHealth?: ProviderHealthTracker;
  /** Monotonic-ish process start time, used for uptime. */
  startedAt?: number;
}

const HealthQuerySchema = z.object({
  /** `live` performs (or reuses a recent) real model round-trip. */
  probe: z.enum(['live']).optional(),
});

/**
 * Input contract for the provider test bench.
 *
 * Bounded on purpose: this endpoint lets a browser spend model quota, so the
 * prompt length and output cap are enforced server-side rather than trusted
 * from the client.
 */
const GenerateBodySchema = z.object({
  prompt: z.string().min(1).max(4_000),
  system: z.string().max(4_000).optional(),
  max_output_tokens: z.number().int().min(1).max(1_024).default(384),
});

/**
 * Assemble the HTTP application.
 *
 * Built as a factory rather than at import time so integration tests can run
 * a real server over an in-memory database and the deterministic provider,
 * exercising the same code path the browser uses.
 */
export async function buildApp(dependencies: AppDependencies): Promise<FastifyInstance> {
  const { config, db, dbPath, provider, engine } = dependencies;
  const toolRegistry = dependencies.toolRegistry ?? createDefaultToolRegistry();
  const toolStore = dependencies.toolStore ?? new ToolCallStoreImpl(db);

  const runtime =
    dependencies.runtime ??
    new AgentRuntime({
      engine,
      provider,
      config: {
        budgets: config.agent.budgets,
        memoryBudget: config.memoryBudget,
        autoCapture: config.agent.autoCapture,
        includeCorrectionHistory: config.agent.includeCorrectionHistory,
        maxOutputTokens: config.agent.maxOutputTokens,
        tools: config.agent.tools,
      },
      tools: { registry: toolRegistry, store: toolStore },
    });
  const forgeWorkspace = dependencies.forgeWorkspace ?? new ForgeWorkspace(config.workspaceRoot);
  const forgeManager =
    dependencies.forgeManager ??
    new ForgeJobManager({
      workspace: forgeWorkspace,
      engine,
      ...(config.forge?.museBin ? { museBin: config.forge.museBin } : {}),
      ...(config.forge?.apiKey ? { apiKey: config.forge.apiKey } : {}),
      ...(config.forge?.model ? { model: config.forge.model } : {}),
      ...(config.forge?.fallbackApiKey ? { fallbackApiKey: config.forge.fallbackApiKey } : {}),
      ...(config.forge?.fallbackModel ? { fallbackModel: config.forge.fallbackModel } : {}),
      ...(config.forge
        ? {
            maxRuntimeMs: config.forge.maxRuntimeMs,
            maxCalls: config.forge.maxCalls,
            maxInputTokens: config.forge.maxInputTokens,
            reasoningEffort: config.forge.reasoningEffort,
          }
        : {}),
    });
  const providerHealth = dependencies.providerHealth ?? new ProviderHealthTracker(provider, 60_000);
  const startedAt = dependencies.startedAt ?? Date.now();

  const app = Fastify({
    logger:
      config.logLevel === 'silent'
        ? false
        : {
            level: config.logLevel,
          },
    trustProxy: false,
    bodyLimit: 1_048_576,
  });

  // Reject requests whose Host header does not name a loopback host on an
  // expected local port. Binding to 127.0.0.1 does not stop DNS rebinding.
  app.addHook('onRequest', async (request, reply) => {
    const allowed = isAllowedHostHeader(request.headers.host, {
      port: config.port,
      corsOrigins: config.corsOrigins,
    });
    if (allowed) return;
    return reply
      .status(400)
      .send(apiFailure(API_ERROR_CODES.invalidHost, 'Unexpected Host header.'));
  });

  await app.register(cors, {
    origin: (origin, callback) => {
      // Allow non-browser clients (curl, tests) that send no Origin header.
      if (!origin) return callback(null, true);
      if (config.corsOrigins.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: false,
  });

  // Treat an empty JSON body as `{}`. Bodyless POSTs commonly announce
  // application/json, and rejecting them as malformed is a footgun rather than
  // a safeguard — the route schema still validates whatever is present.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    const raw = typeof body === 'string' ? body.trim() : '';
    if (raw.length === 0) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(raw));
    } catch {
      // Malformed JSON is a client error, not a server fault.
      const failure = new Error('Request body is not valid JSON.');
      done(Object.assign(failure, { statusCode: 400 }), undefined);
    }
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    request.log.error({ err: error }, 'request failed');

    if (AgentError.isAgentError(error)) {
      const status =
        error.code === 'session_not_found'
          ? 404
          : error.code === 'session_busy' || error.code === 'session_archived'
            ? 409
            : error.code === 'turn_cancelled'
              ? 408
              : error.code === 'provider_failure'
                ? 502
                : 400;
      return reply.status(status).send(apiFailure(error.code, error.message));
    }

    if (MemoryError.isMemoryError(error)) {
      const status =
        error.code === 'memory_not_found' ? 404 : error.code === 'memory_conflict' ? 409 : 400;
      return reply
        .status(status)
        .send(apiFailure(error.code, error.message, error.details as never));
    }

    if (error instanceof z.ZodError) {
      const details = error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      return reply
        .status(400)
        .send(
          apiFailure(
            API_ERROR_CODES.validationFailed,
            'The request did not match the expected schema.',
            details,
          ),
        );
    }

    const fastifyError = error as { statusCode?: number; validation?: unknown; message?: string };

    if (fastifyError.validation) {
      return reply
        .status(400)
        .send(
          apiFailure(
            API_ERROR_CODES.validationFailed,
            'The request did not match the expected schema.',
          ),
        );
    }

    const statusCode =
      fastifyError.statusCode && fastifyError.statusCode >= 400 ? fastifyError.statusCode : 500;
    return reply
      .status(statusCode)
      .send(
        apiFailure(
          statusCode === 404 ? API_ERROR_CODES.notFound : API_ERROR_CODES.internal,
          statusCode >= 500
            ? 'An internal error occurred.'
            : (fastifyError.message ?? 'Request failed.'),
        ),
      );
  });

  app.setNotFoundHandler((request, reply) =>
    reply
      .status(404)
      .send(apiFailure(API_ERROR_CODES.notFound, `No route for ${request.method} ${request.url}`)),
  );

  // --- Memory CRUD, correction, deletion, retrieval preview ---------------
  registerMemoryRoutes(app, { engine, config });
  registerSessionRoutes(app, { runtime });
  registerUiRoutes(app, { runtime, engine, provider, config });
  registerToolRoutes(app, { runtime, engine, registry: toolRegistry, store: toolStore });
  registerForgeRoutes(app, { manager: forgeManager, workspace: forgeWorkspace, engine });

  // --- Liveness: cheap, no dependencies touched. ---------------------------
  app.get('/api/live', async () => {
    return apiSuccess(
      LivenessResponseSchema.parse({ status: 'ok', timestamp: new Date().toISOString() }),
    );
  });

  // --- Health: database round-trip + provider state. ----------------------
  app.get('/api/health', async (request) => {
    const query = HealthQuerySchema.parse(request.query ?? {});
    if (query.probe === 'live') {
      await providerHealth.check();
    }

    const databaseProbe = probeDatabase(db, dbPath);
    const providerState = providerHealth.current();
    const capabilities = provider.capabilities();

    const providerStatus: ServiceStatus | 'skipped' = !providerState.checked_at
      ? 'skipped'
      : providerState.ok
        ? 'ok'
        : 'error';

    let status: ServiceStatus = 'ok';
    if (databaseProbe.status === 'error') status = 'error';
    else if (databaseProbe.status === 'degraded' || providerStatus === 'error') status = 'degraded';

    const payload = HealthResponseSchema.parse({
      status,
      service: SERVICE_NAME,
      version: config.serviceVersion,
      environment: config.environment,
      uptime_seconds: (Date.now() - startedAt) / 1000,
      timestamp: new Date().toISOString(),
      database: {
        status: databaseProbe.status,
        detail: databaseProbe.detail,
        latency_ms: databaseProbe.latency_ms,
        engine: databaseProbe.engine,
        path: databaseProbe.path,
        schema_version: databaseProbe.schema_version,
        write_verified: databaseProbe.write_verified,
      },
      provider: {
        status: providerStatus,
        detail: providerState.message,
        latency_ms: providerState.latency_ms,
        provider_id: provider.id,
        provider_name: provider.name,
        model: providerState.model ?? config.provider.museModel ?? null,
        verified_with_live_call: providerState.verified_with_live_call,
        capabilities: {
          streaming: capabilities.streaming,
          tool_calling: capabilities.tool_calling,
          structured_output: capabilities.structured_output,
          max_context_tokens: capabilities.max_context_tokens,
        },
      },
    });

    return apiSuccess(payload);
  });

  // --- Live Muse probe: the button that proves the integration. -----------
  app.post('/api/health/muse', async (request) => {
    const state = await providerHealth.check({ force: true });
    request.log.info({ ok: state.ok, latency_ms: state.latency_ms }, 'muse live probe');
    return apiSuccess(state);
  });

  // --- Provider test bench -------------------------------------------------
  // A deliberately raw, bounded model call. It exists to prove the
  // browser -> API -> Muse path works and to let a reviewer see the model
  // respond; it performs no memory retrieval and no tool execution.
  app.post('/api/provider/generate', async (request, reply) => {
    const body = GenerateBodySchema.parse(request.body ?? {});
    try {
      const response = await provider.generate({
        messages: [
          ...(body.system ? [{ role: 'system' as const, content: body.system }] : []),
          { role: 'user' as const, content: body.prompt },
        ],
        max_output_tokens: body.max_output_tokens,
      });
      return apiSuccess(response);
    } catch (error) {
      // Any failure while producing a completion is a provider-side problem:
      // surface it as 503 so the client can distinguish "the model is
      // unavailable" from "this server is broken".
      const code = ProviderError.isProviderError(error)
        ? error.code
        : API_ERROR_CODES.providerUnavailable;
      request.log.warn({ code, err: error }, 'provider bench call failed');
      return reply
        .status(503)
        .send(apiFailure(code, error instanceof Error ? error.message : String(error)));
    }
  });

  // --- Service metadata: provider capabilities + honest build status. -----
  app.get('/api/meta', async () => {
    const capabilities = provider.capabilities();
    const meta = ServiceMetaSchema.parse({
      service: SERVICE_NAME,
      version: config.serviceVersion,
      environment: config.environment,
      phase: 5,
      provider: {
        id: provider.id,
        name: provider.name,
        configured_model: config.provider.museModel ?? null,
        capabilities,
      },
      modules: {
        memory_engine: 'complete',
        agent_runtime: 'complete',
        muse_integration: 'complete',
        ui_protocol: 'complete',
        agent_tools: 'complete',
        evaluation: 'partial',
      },
      memory: memoryMeta(config),
      safety: {
        tool_approval_policy: config.toolApprovalPolicy,
        generated_code_execution: false,
      },
    });
    return apiSuccess(meta);
  });

  return app;
}
