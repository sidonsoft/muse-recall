import { type AgentRuntime, CollectingHandler } from '@mml/agent-core';
import type { MemoryEngine } from '@mml/memory-engine';
import {
  ToolCallListSchema,
  ToolDecisionInputSchema,
  ToolDecisionResultSchema,
  ToolListSchema,
  type TurnResult,
} from '@mml/shared';
import type { ToolCallStore, ToolRegistry } from '@mml/tool-runtime';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

/**
 * Tool inspection and approval.
 *
 * Pending writes are executed only here, after an explicit user decision. The
 * model has no path to approve its own call.
 */

const SessionParams = z.object({ id: z.uuid() });
const CallParams = z.object({ id: z.uuid(), callId: z.uuid() });

export interface ToolRouteDependencies {
  runtime: AgentRuntime;
  engine: MemoryEngine;
  registry: ToolRegistry;
  store: ToolCallStore;
}

export function registerToolRoutes(
  app: FastifyInstance,
  dependencies: ToolRouteDependencies,
): void {
  const { runtime, engine, registry, store } = dependencies;

  app.get('/api/tools', async () => {
    return envelope(ToolListSchema.parse({ items: registry.list() }));
  });

  app.get('/api/sessions/:id/tools', async (request) => {
    const { id } = SessionParams.parse(request.params);
    runtime.getSession(id);
    return envelope(ToolCallListSchema.parse({ items: store.listBySession(id) }));
  });

  app.post('/api/sessions/:id/tools/:callId/decision', async (request, reply) => {
    const { id, callId } = CallParams.parse(request.params);
    const body = ToolDecisionInputSchema.parse(request.body ?? {});
    const session = runtime.getSession(id);

    const call = store.get(callId);
    if (!call || call.session_id !== id) {
      return reply.status(404).send({
        ok: false,
        error: { code: 'tool_call_not_found', message: 'No such tool call in this session.' },
      });
    }
    if (call.status !== 'pending') {
      return reply.status(409).send({
        ok: false,
        error: {
          code: 'tool_call_not_pending',
          message: `This tool call is already ${call.status}.`,
        },
      });
    }

    if (body.decision === 'deny') {
      const denied = store.decide(callId, 'denied');
      return envelope(ToolDecisionResultSchema.parse({ call: denied, turn: null }));
    }

    const tool = registry.get(call.tool);
    let updated = call;
    let turn: TurnResult | null = null;

    if (!tool) {
      updated = store.complete(callId, {
        status: 'failed',
        error: 'Tool is no longer registered.',
      });
    } else {
      const invocation = await registry.invoke(tool.id, call.arguments, {
        db: engine.connection,
        memory: engine,
        sessionId: id,
        projectId: session.project_id,
        now: () => new Date(),
      });

      updated =
        invocation.status === 'executed'
          ? store.complete(callId, {
              status: 'executed',
              result: invocation.output,
              durationMs: invocation.durationMs,
            })
          : store.complete(callId, {
              status: 'failed',
              error: invocation.error ?? 'Tool failed.',
              durationMs: invocation.durationMs,
            });

      const resultSummary =
        invocation.status === 'executed'
          ? JSON.stringify(invocation.output).slice(0, 1_500)
          : (invocation.error ?? 'unknown error');

      const content =
        invocation.status === 'executed'
          ? `The user approved the tool call "${call.tool}". Result: ${resultSummary}. Continue the work and summarise what changed.`
          : `The user approved the tool call "${call.tool}", but it failed: ${resultSummary}. Explain the failure and continue without it.`;

      turn = await runtime.runTurn(
        id,
        { content, capture_memories: false },
        new CollectingHandler(),
        { tools: 'off' },
      );

      store.attachMessage([callId], turn.assistant_message.id);
      updated = store.get(callId) ?? updated;
    }

    return envelope(ToolDecisionResultSchema.parse({ call: updated, turn }));
  });
}

function envelope<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}
