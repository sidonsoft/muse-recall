import type { DatabaseSync } from 'node:sqlite';
import { apiFailure } from '@mml/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * POST idempotency keys (roadmap §3 remainder, decision D049).
 *
 * A client that retried after a network timeout must not pay twice — most
 * concretely for Forge generation, where a duplicate means real model quota.
 * Replay records live in SQLite (schema v8) scoped per `METHOD /concrete/path`
 * + key, expire after 24 hours, and are deliberately absent from the export
 * envelope (a replay window must not survive a data restore). In-flight
 * de-duplication is in-process only: this is a single-server beta, and the
 * error catalogue says so.
 */

export const IDEMPOTENCY_HEADER = 'idempotency-key';
const KEY_MIN = 8;
const KEY_MAX = 128;
const TTL_MS = 24 * 60 * 60 * 1_000;

export interface ReplayRecord {
  status: number;
  body: unknown;
}

export class IdempotencyStore {
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private static id(route: string, key: string): string {
    return route + ' ' + key;
  }

  purgeExpired(): void {
    const cutoff = new Date(this.now().getTime() - TTL_MS).toISOString();
    this.db.prepare('DELETE FROM idempotency_keys WHERE created_at < ?').run(cutoff);
  }

  lookup(route: string, key: string): ReplayRecord | undefined {
    const row = this.db
      .prepare('SELECT status, response FROM idempotency_keys WHERE route = ? AND key = ?')
      .get(route, key) as { status: number; response: string } | undefined;
    if (!row) return undefined;
    return { status: row.status, body: JSON.parse(row.response) };
  }

  /** True when this process can take the key; false means another request holds it. */
  begin(route: string, key: string): boolean {
    const id = IdempotencyStore.id(route, key);
    if (this.inFlight.has(id)) return false;
    this.inFlight.add(id);
    return true;
  }

  release(route: string, key: string): void {
    this.inFlight.delete(IdempotencyStore.id(route, key));
  }

  record(route: string, key: string, status: number, body: unknown): void {
    this.db
      .prepare(
        `INSERT INTO idempotency_keys (route, key, status, response, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(route, key) DO UPDATE SET status = excluded.status, response = excluded.response`,
      )
      .run(route, key, status, JSON.stringify(body), this.now().toISOString());
  }
}

export type IdemDecision =
  | { state: 'no_key' }
  | { state: 'bad_key'; message: string }
  | { state: 'replay'; record: ReplayRecord }
  | { state: 'in_progress' }
  | { state: 'run'; route: string; key: string };

export function beginIdempotency(store: IdempotencyStore, request: FastifyRequest): IdemDecision {
  const presented = request.headers[IDEMPOTENCY_HEADER];
  if (presented === undefined) return { state: 'no_key' };
  // A comma inside the value means the client (or a proxy) sent the header
  // more than once — Node joins duplicates on the wire. Treat that as
  // ambiguous rather than silently picking one key.
  if (
    typeof presented !== 'string' ||
    presented.length < KEY_MIN ||
    presented.length > KEY_MAX ||
    presented.includes(',')
  ) {
    return {
      state: 'bad_key',
      message: `Idempotency-Key must be a single ${KEY_MIN}-${KEY_MAX} character string.`,
    };
  }
  const route = `${request.method} ${request.url.split('?')[0]}`;
  store.purgeExpired();
  const hit = store.lookup(route, presented);
  if (hit) return { state: 'replay', record: hit };
  if (!store.begin(route, presented)) return { state: 'in_progress' };
  return { state: 'run', route, key: presented };
}

/** Shared wrapper for routes whose handler can return {status, body}. */
export async function idempotent(
  request: FastifyRequest,
  reply: FastifyReply,
  store: IdempotencyStore,
  run: () => Promise<{ status: number; body: unknown }>,
): Promise<FastifyReply> {
  const decision = beginIdempotency(store, request);
  switch (decision.state) {
    case 'no_key': {
      const result = await run();
      return reply.status(result.status).send(result.body as never);
    }
    case 'bad_key':
      return reply.status(400).send(apiFailure('bad_request', decision.message));
    case 'replay':
      reply.header('idempotent-replayed', '1');
      return reply.status(decision.record.status).send(decision.record.body as never);
    case 'in_progress':
      return reply
        .status(409)
        .send(
          apiFailure(
            'idempotency_in_progress',
            'A request with this Idempotency-Key is still being processed.',
          ),
        );
    case 'run':
      try {
        const result = await run();
        store.record(decision.route, decision.key, result.status, result.body);
        return reply.status(result.status).send(result.body as never);
      } finally {
        store.release(decision.route, decision.key);
      }
  }
}
