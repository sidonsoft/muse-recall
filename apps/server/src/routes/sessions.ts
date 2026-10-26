import {
  AgentError,
  type AgentRuntime,
  CollectingHandler,
  SseStreamHandler,
  toAgentError,
} from '@mml/agent-core';
import {
  apiSuccess,
  CreateSessionInputSchema,
  MessageWithEvidenceSchema,
  SendMessageInputSchema,
  SessionDetailSchema,
  SessionListSchema,
  SessionSchema,
  TurnResultSchema,
  UpdateSessionInputSchema,
} from '@mml/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

/**
 * Conversation API.
 *
 * The same turn runs whether the client asks for SSE or a single JSON body;
 * only the transport differs. That keeps the streaming path honest — it is not
 * a second implementation.
 */

const SessionIdParams = z.object({ id: z.uuid() });
const MessageParams = z.object({ id: z.uuid(), messageId: z.uuid() });

const ListQuerySchema = z.object({
  status: z.enum(['active', 'archived']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

const DeleteResultSchema = z.object({ id: z.uuid(), deleted: z.literal(true) });

export interface SessionRouteDependencies {
  runtime: AgentRuntime;
}

export function registerSessionRoutes(
  app: FastifyInstance,
  dependencies: SessionRouteDependencies,
): void {
  const { runtime } = dependencies;

  app.post('/api/sessions', async (request, reply) => {
    const body = CreateSessionInputSchema.parse(request.body ?? {});
    const session = runtime.createSession(body);
    return reply.status(201).send(apiSuccess(SessionSchema.parse(session)));
  });

  app.get('/api/sessions', async (request) => {
    const query = ListQuerySchema.parse(request.query ?? {});
    const items = runtime.listSessions({ status: query.status, limit: query.limit });
    return apiSuccess(SessionListSchema.parse({ items, total: items.length }));
  });

  app.get('/api/sessions/:id', async (request) => {
    const { id } = SessionIdParams.parse(request.params);
    return apiSuccess(SessionDetailSchema.parse(runtime.getSessionDetail(id)));
  });

  app.patch('/api/sessions/:id', async (request) => {
    const { id } = SessionIdParams.parse(request.params);
    const patch = UpdateSessionInputSchema.parse(request.body ?? {});
    return apiSuccess(SessionSchema.parse(runtime.updateSession(id, patch)));
  });

  app.delete('/api/sessions/:id', async (request) => {
    const { id } = SessionIdParams.parse(request.params);
    runtime.deleteSession(id);
    return apiSuccess(DeleteResultSchema.parse({ id, deleted: true }));
  });

  /**
   * Per-turn memory usage. The session detail already embeds this, but a
   * focused endpoint makes the evidence addressable by message id.
   */
  app.get('/api/sessions/:id/messages/:messageId', async (request) => {
    const { id, messageId } = MessageParams.parse(request.params);
    const detail = runtime.getSessionDetail(id);
    const message = detail.messages.find((entry) => entry.id === messageId);
    if (!message) {
      throw new AgentError(
        'session_not_found',
        `No message with id ${messageId} in session ${id}.`,
        { session_id: id, message_id: messageId },
      );
    }
    return apiSuccess(MessageWithEvidenceSchema.parse(message));
  });

  /**
   * Send a message.
   *
   * `Accept: text/event-stream` → SSE (`retrieval`, `memory_captured`, `delta`,
   * `usage`, `completed`, `error`). Any other Accept → one JSON `TurnResult`.
   */
  app.post('/api/sessions/:id/messages', async (request, reply) => {
    const { id } = SessionIdParams.parse(request.params);
    const body = SendMessageInputSchema.parse(request.body ?? {});
    const wantsStream = /text\/event-stream/.test(request.headers.accept ?? '');

    if (!wantsStream) {
      const turn = await runtime.runTurn(id, body, new CollectingHandler());
      return apiSuccess(TurnResultSchema.parse(turn));
    }

    // Hand the socket to us: Fastify must not try to serialize a reply.
    reply.hijack();
    const raw = reply.raw;

    raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    raw.flushHeaders?.();

    const handler = new SseStreamHandler(raw);
    const controller = new AbortController();

    // A disconnected client must stop the provider call, not just stop reading.
    raw.on('close', () => {
      if (!raw.writableEnded) controller.abort();
    });

    try {
      await runtime.runTurn(id, body, handler, { signal: controller.signal });
    } catch (error) {
      await handler.error(toAgentError(error, id));
    } finally {
      handler.close();
    }

    return reply;
  });
}
