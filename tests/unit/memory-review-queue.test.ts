import { MemoryEngine, openDatabase } from '@mml/memory-engine';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * The review queue is derived, not stored (gap G-9). These pin the exact
 * membership rules and reason computation against a clock the engine owns.
 */

const openDatabases: { close: () => void }[] = [];
afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
});

function seeded(): MemoryEngine {
  const database = openDatabase({ path: ':memory:', wal: false });
  openDatabases.push(database);
  const day = 86_400_000;
  const now = new Date('2026-10-30T12:00:00Z');
  const engine = new MemoryEngine(database.db, { now: () => now });
  const stamp = (offset: string) => new Date(now.getTime() + offset).toISOString();
  const add = (
    content: string,
    options: { validation?: 'unverified' | 'verified' | 'disputed'; expires?: number } = {},
  ) =>
    engine.create(
      {
        type: 'contextual_fact',
        scope: 'project',
        project_id: 'alpha',
        content,
        validation_status: options.validation ?? 'unverified',
        expires_at: options.expires === undefined ? null : stamp(options.expires),
      },
      'user',
    );

  add('needs verification');
  add('all clear', { validation: 'verified' });
  add('contested', { validation: 'disputed' });
  add('expiring soon', { validation: 'verified', expires: 5 * day });
  add('expiring far', { validation: 'verified', expires: 30 * day });
  add('already gone', { validation: 'verified', expires: -2 * day });
  return engine;
}

describe('engine.reviewQueue (G-9)', () => {
  it('selects exactly the memories needing a decision, with computed reasons', () => {
    const engine = seeded();
    const queue = engine.reviewQueue();
    const byContent = new Map(queue.items.map((item) => [item.memory.content, item]));
    expect([...byContent.keys()].sort()).toEqual(
      ['already gone', 'contested', 'expiring soon', 'needs verification'].sort(),
    );
    expect(byContent.get('needs verification')?.reasons).toEqual(['unverified']);
    expect(byContent.get('contested')?.reasons).toEqual(['disputed']);
    expect(byContent.get('expiring soon')?.reasons).toEqual(['expiring']);
    expect(byContent.get('expiring soon')?.days_until_expiry).toBe(5);
    expect(byContent.get('already gone')?.reasons).toEqual(['expired']);
    expect(byContent.get('already gone')?.days_until_expiry).toBe(-2);
    expect(queue.total).toBe(4);
    expect(queue.horizon_days).toBe(7);
  });

  it('horizon_days narrows the window but never drops unverified claims', () => {
    const engine = seeded();
    const queue = engine.reviewQueue({ horizon_days: 0 });
    // Past expiry is a now-problem: it stays in the queue at any horizon.
    expect(queue.items.map((item) => item.memory.content).sort()).toEqual(
      ['already gone', 'contested', 'needs verification'].sort(),
    );
  });

  it('scoping to a project excludes other scopes; verified+current stays out', () => {
    const engine = seeded();
    const queue = engine.reviewQueue({ project_id: 'alpha' });
    expect(queue.total).toBe(4);
    const other = engine.reviewQueue({ project_id: 'beta' });
    expect(other.total).toBe(0);
    const contents = engine.reviewQueue({ project_id: 'alpha' }).items.map((i) => i.memory.content);
    expect(contents).not.toContain('all clear');
    expect(contents).not.toContain('expiring far');
  });

  it('verifying clears an item; paginating is stable', () => {
    const engine = seeded();
    const page1 = engine.reviewQueue({ limit: 2, offset: 0 });
    const page2 = engine.reviewQueue({ limit: 2, offset: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page2.items).toHaveLength(2);
    expect(new Set([...page1.items, ...page2.items].map((i) => i.memory.id)).size).toBe(4);

    // Pick the item that is ONLY unverified: verifying it is the one triage
    // that must remove it from the queue (expiring items stay by design).
    const pending = engine
      .reviewQueue()
      .items.find((item) => item.reasons.length === 1 && item.reasons[0] === 'unverified');
    if (!pending) throw new Error('expected an unverified-only item');
    engine.update(pending.memory.id, { validation_status: 'verified' }, 'user');
    const after = engine.reviewQueue();
    expect(after.items.some((item) => item.memory.id === pending.memory.id)).toBe(false);
    expect(after.total).toBe(3);
  });
});
