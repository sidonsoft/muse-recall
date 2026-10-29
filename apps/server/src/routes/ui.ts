import { AgentError, type AgentRuntime, CollectingHandler } from '@mml/agent-core';
import type { MemoryEngine } from '@mml/memory-engine';
import type { ModelProvider } from '@mml/shared';
import {
  buildPlanningPrompt,
  GenerateUiInputSchema,
  PLANNING_FORM_JSON_SCHEMA,
  planningFormToSurface,
  SubmitUiInputSchema,
  UiGenerationResultSchema,
  UiProtocolError,
  UiSubmissionResultSchema,
  type UiSurface,
  UiSurfaceListSchema,
  validateSubmission,
} from '@mml/ui-protocol';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { UiSurfaceStore } from '../ui-store.js';

/**
 * Generative interface routes.
 *
 * Generation is a bounded structured-output call: Muse chooses the fields of a
 * planning form, the server validates the result against the closed protocol,
 * and only then is anything stored or rendered. Submission goes through the
 * same authorization-free path as chat today (no tools yet), but it is
 * validated against the surface that produced it and then becomes a normal
 * agent turn.
 */

const SessionParams = z.object({ id: z.uuid() });
const SurfaceParams = z.object({ id: z.uuid(), surfaceId: z.uuid() });

export interface UiRouteDependencies {
  runtime: AgentRuntime;
  engine: MemoryEngine;
  provider: ModelProvider;
  config: AppConfig;
}

export function registerUiRoutes(app: FastifyInstance, dependencies: UiRouteDependencies): void {
  const { runtime, engine, provider, config } = dependencies;
  const store = new UiSurfaceStore(engine.connection);

  app.get('/api/sessions/:id/ui', async (request) => {
    const { id } = SessionParams.parse(request.params);
    runtime.getSession(id);
    return apiPayload(UiSurfaceListSchema.parse({ items: store.listBySession(id) }));
  });

  /**
   * Generate an interface for an intent.
   *
   * One retry is allowed for malformed model output; provider failures are
   * surfaced as-is rather than being retried into a confusing state.
   */
  app.post('/api/sessions/:id/ui', async (request, reply) => {
    const { id } = SessionParams.parse(request.params);
    const body = GenerateUiInputSchema.parse(request.body ?? {});
    const session = runtime.getSession(id);
    if (session.status === 'archived') {
      throw new AgentError('session_archived', 'This session is archived.', { session_id: id });
    }

    const retrieval = engine.retrieve(
      { project_id: session.project_id, query: body.intent, budget: config.memoryBudget },
      { now: new Date() },
    );

    const prompt = buildPlanningPrompt({
      intent: body.intent,
      projectId: session.project_id,
      memories: retrieval.results.map((entry) => entry.injected_content),
    });

    const startedAt = performance.now();
    let surface: UiSurface | null = null;
    let model = provider.capabilities().models[0] ?? 'unknown';
    let lastError = '';

    // A disconnected browser must cancel the model run, not leave it spending
    // quota after the surface can no longer be delivered.
    const controller = new AbortController();
    const onDisconnect = () => controller.abort();
    reply.raw.once('close', onDisconnect);

    try {
      for (let attempt = 0; attempt < 2 && !surface; attempt += 1) {
        const response = await provider.generate(
          {
            messages: [{ role: 'user', content: prompt }],
            response_schema: PLANNING_FORM_JSON_SCHEMA as unknown as Record<string, unknown>,
            max_output_tokens: 1_500,
          },
          { signal: controller.signal },
        );
        model = response.model;
        try {
          surface = planningFormToSurface(JSON.parse(response.text));
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }
    } finally {
      reply.raw.off('close', onDisconnect);
    }

    if (!surface) {
      return reply.status(502).send({
        ok: false,
        error: {
          code: 'ui_generation_failed',
          message: `Muse did not return a valid interface: ${lastError}`,
        },
      });
    }

    // A short assistant note anchors the surface in the transcript.
    const message = runtime.store.appendMessage({
      sessionId: id,
      role: 'assistant',
      content: `I've prepared an interface to help with that: "${surface.title}". Fill it in and submit to continue.`,
      status: 'complete',
    });

    // A generation-only conversation has no user message to derive a title
    // from, so name it after the interface.
    if (!session.title) {
      runtime.updateSession(id, { title: `Interface: ${surface.title}`.slice(0, 200) });
    }

    const record = store.create({ sessionId: id, messageId: message.id, spec: surface });

    return reply.status(201).send(
      apiPayload(
        UiGenerationResultSchema.parse({
          surface: record,
          model,
          latency_ms: Number((performance.now() - startedAt).toFixed(2)),
        }),
      ),
    );
  });

  /**
   * Submit an interface.
   *
   * Values are validated against the stored spec (not against anything the
   * client claims), recorded, optionally persisted as project memory, and then
   * passed to the agent as the next turn.
   */
  app.post('/api/sessions/:id/ui/:surfaceId/events', async (request, reply) => {
    const { id, surfaceId } = SurfaceParams.parse(request.params);
    const body = SubmitUiInputSchema.parse(request.body ?? {});

    const session = runtime.getSession(id);
    if (session.status === 'archived') {
      throw new AgentError('session_archived', 'This session is archived.', { session_id: id });
    }

    const record = store.get(surfaceId);
    if (!record || record.session_id !== id) {
      return reply.status(404).send({
        ok: false,
        error: { code: 'surface_not_found', message: 'No such interface in this session.' },
      });
    }
    if (record.status === 'submitted') {
      return reply.status(409).send({
        ok: false,
        error: {
          code: 'surface_already_submitted',
          message: 'This interface was already submitted.',
        },
      });
    }

    let normalised: ReturnType<typeof validateSubmission>;
    try {
      normalised = validateSubmission(record.spec, body);
    } catch (error) {
      if (UiProtocolError.isUiProtocolError(error)) {
        return reply.status(400).send({
          ok: false,
          error: {
            code: error.code,
            message: error.message,
            details: error.issues,
          },
        });
      }
      throw error;
    }

    // A submitted plan is an explicit request to act: let the agent use
    // project tools (writes still require a separate approval). Run the
    // follow-up turn before recording the submission so a provider failure
    // leaves the surface active and the form resubmittable.
    const turn = await runtime.runTurn(
      id,
      {
        content: `${normalised.summary}\n\nUse the available project tools to record follow-up work such as tasks.`,
        capture_memories: false,
      },
      new CollectingHandler(),
      { tools: 'force' },
    );

    store.recordEvent(surfaceId, normalised.form.id, normalised.values);
    store.markSubmitted(surfaceId);

    let memory = null;
    const capture = normalised.form.save_to_memory;
    if (capture) {
      const created = engine.create({
        type: capture.type,
        scope: session.project_id ? 'project' : 'global',
        project_id: session.project_id,
        content: normalised.summary.slice(0, 2_000),
        source: { session_id: id, reference: `ui:${surfaceId}` },
        confidence: 0.9,
        validation_status: 'verified',
        tags: [],
        expires_at: null,
      });
      memory = created.memory;
    }

    const updated = store.get(surfaceId);
    if (!updated) throw new Error('interface disappeared after submission');

    return apiPayload(UiSubmissionResultSchema.parse({ surface: updated, memory, turn }));
  });
}

/** Local envelope helper so this module does not depend on route ordering. */
function apiPayload<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}
