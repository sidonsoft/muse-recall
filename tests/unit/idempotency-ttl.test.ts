import { openDatabase } from '@mml/memory-engine';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { beginIdempotency, IdempotencyStore } from '../../apps/server/src/idempotency.js';

/**
 * The inventory describes idempotency_keys as "transient replay records"
 * (v8 row, D049) and the store carries a 24h purgeExpired() run before every
 * decision — yet NO test had ever advanced the clock. The TTL is the only
 * thing keeping the table transient; an off-by-units bug (ms vs s) or a
 * dropped purge call would grow the "transient" table forever with zero
 * signal. The store's injectable `now` makes the whole contract cheap to pin.
 */

const HOUR = 60 * 60 * 1_000;

function req(key: string): FastifyRequest {
  return {
    method: 'POST',
    url: '/api/memories',
    headers: { 'idempotency-key': key },
  } as unknown as FastifyRequest;
}

describe('idempotency TTL (transient by design)', () => {
  it('replays within 24h, boundary-inclusively, and stops after', () => {
    const opened = openDatabase({ path: ':memory:' });
    let now = new Date('2026-06-01T12:00:00.000Z');
    const store = new IdempotencyStore(opened.db, () => now);
    try {
      const first = beginIdempotency(store, req('ttl-key-aaaaaaaa'));
      expect(first.state).toBe('run');
      if (first.state === 'run') {
        store.record(first.route, first.key, 201, { ok: true });
        store.release(first.route, first.key); // mirrors the wrapper releasing at response end
      }

      now = new Date(now.getTime() + 23 * HOUR);
      const warm = beginIdempotency(store, req('ttl-key-aaaaaaaa'));
      expect(warm.state).toBe('replay');
      if (warm.state === 'replay') expect(warm.record.status).toBe(201);

      // Exactly 24h old: cutoff compares created_at < cutoff, so the exact
      // boundary instant is still replayable (inclusive).
      now = new Date('2026-06-02T12:00:00.000Z');
      expect(beginIdempotency(store, req('ttl-key-aaaaaaaa')).state).toBe('replay');

      // One second past: purged; a retry now RUNS again instead of replaying,
      // and the row is gone from storage.
      now = new Date('2026-06-02T12:00:01.000Z');
      expect(beginIdempotency(store, req('ttl-key-aaaaaaaa')).state).toBe('run');
      expect(store.lookup('POST /api/memories', 'ttl-key-aaaaaaaa')).toBeUndefined();
    } finally {
      opened.close();
    }
  });

  it('purgeExpired is age-exact: older rows die, younger ones survive', () => {
    const opened = openDatabase({ path: ':memory:' });
    let now = new Date('2026-06-01T12:00:00.000Z');
    const store = new IdempotencyStore(opened.db, () => now);
    try {
      store.record('POST /api/memories', 'ttl-key-aaaaaaaa', 201, { a: 1 });
      now = new Date(now.getTime() + 12 * HOUR);
      store.record('POST /api/memories', 'ttl-key-bbbbbbbb', 201, { b: 2 });

      now = new Date('2026-06-02T12:00:01.000Z'); // 24h+1s after A, 12h+1s after B
      store.purgeExpired();
      expect(store.lookup('POST /api/memories', 'ttl-key-aaaaaaaa')).toBeUndefined();
      expect(store.lookup('POST /api/memories', 'ttl-key-bbbbbbbb')?.status).toBe(201);
    } finally {
      opened.close();
    }
  });
});
