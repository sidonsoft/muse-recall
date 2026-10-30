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
  redactSecrets,
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
import { evaluateRequestOrigin } from './origin-guard.js';
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

  // Constructed after Fastify so a failed probe can log its detail server-side
  // while the API returns generic text.
  const providerHealth =
    dependencies.providerHealth ?? new ProviderHealthTracker(provider, 60_000, app.log);

  // Stop Forge before the rest of the app closes: reject new jobs, terminate
  // owned children with bounded escalation, await terminal persistence, then
  // flush any remaining writes.
  app.addHook('onClose', async () => {
    await forgeManager.shutdown();
  });

  // Reload durable Forge jobs before any request can list a project. The
  // report is logged and exposed through the project API; a malformed record
  // is never reported as an empty project.
  const forgeRecovery = await forgeManager.recover();
  if (forgeRecovery.issues.length > 0 || !forgeRecovery.storage.ok) {
    app.log.warn(
      {
        loaded_jobs: forgeRecovery.startup.loaded_jobs,
        interrupted_jobs: forgeRecovery.startup.interrupted_jobs,
        issues: forgeRecovery.issues.length,
        storage_ok: forgeRecovery.storage.ok,
        storage_scope: forgeRecovery.storage.scope,
      },
      'Forge recovery reported issues',
    );
  }

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

  // Reject state-changing requests that a foreign page can send without a
  // preflight. CORS hides the response but does not stop the mutation; the
  // host guard only proves the request reached a loopback host. `Origin: null`
  // and malformed origins are refused, and a browser that declares itself
  // cross-site is refused even if the Origin header is missing.
  app.addHook('onRequest', async (request, reply) => {
    const verdict = evaluateRequestOrigin({
      method: request.method,
      origin: request.headers.origin,
      host: request.headers.host,
      corsOrigins: config.corsOrigins,
      secFetchSite: request.headers['sec-fetch-site'],
    });
    if (verdict.allowed) return;
    // Name the refused origin so a misconfigured CORS_ORIGINS is diagnosable
    // from the server log alone.
    request.log.warn({ origin: request.headers.origin, reason: verdict.reason }, 'origin refused');
    return reply
      .status(403)
      .send(
        apiFailure(
          API_ERROR_CODES.forbiddenOrigin,
          'Cross-origin state-changing request rejected.',
        ),
      );
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

  // --- Health: read-only DB check + provider state. -----------------------
  // A live model call is a POST (/api/health/muse) so the origin guard covers
  // it; a plain GET never writes to the database or spends model quota.
  app.get('/api/health', async () => {
    const databaseProbe = probeDatabase(db, dbPath, { readOnly: true });
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
      // Store-wide Forge recovery summary for the System screen (P1 #8).
      // Read-only; the Studio project view stays the place to acknowledge or
      // act on issues. Bounded to five issues so health stays small.
      forge: (() => {
        const report = forgeManager.recovery();
        return {
          storage_ok: report.storage.ok,
          unacknowledged_issues: report.issues.length,
          acknowledged_issues: report.acknowledged_issues,
          interrupted_jobs_current: report.current_interrupted_jobs,
          interrupted_jobs_startup: report.startup.interrupted_jobs,
          loaded_jobs_startup: report.startup.loaded_jobs,
          issues: report.issues.slice(0, 5),
        };
      })(),
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
      // unavailable" from "this server is broken". The detail is logged (and
      // redacted) server-side; the response carries only generic text so a
      // credential embedded in an upstream error can never reach the browser.
      const code = ProviderError.isProviderError(error)
        ? error.code
        : API_ERROR_CODES.providerUnavailable;
      const detail = error instanceof Error ? error.message : String(error);
      request.log.warn({ code, detail: redactSecrets(detail) }, 'provider bench call failed');
      return reply.status(503).send(apiFailure(code, 'The provider is currently unavailable.'));
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
      forge: {
        provider: 'muse-cli',
        configured_model: config.forge?.model ?? null,
        cli_available: forgeManager.cliAvailable(),
        // Forge does not currently persist an independently observed model id.
        observed_model: null,
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
