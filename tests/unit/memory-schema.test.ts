import {
  MemoryCorrectionInputSchema,
  MemoryCreateInputSchema,
  MemoryQuerySchema,
  MemorySchema,
  TagSchema,
} from '@mml/shared';
import { describe, expect, it } from 'vitest';

/**
 * Contract tests for the memory schemas.
 *
 * These run before any engine code exists on purpose: the memory engine's
 * write path is only as trustworthy as the shape it accepts.
 */
describe('MemoryCreateInputSchema', () => {
  const valid = {
    type: 'technical_decision' as const,
    scope: 'project' as const,
    project_id: 'demo-game',
    content: 'Use SQLite for persistent storage',
  };

  it('fills defaults for an otherwise minimal memory', () => {
    const parsed = MemoryCreateInputSchema.parse(valid);
    expect(parsed.confidence).toBe(0.7);
    expect(parsed.validation_status).toBe('unverified');
    expect(parsed.tags).toEqual([]);
    expect(parsed.source).toEqual({ session_id: null, reference: null });
  });

  it('rejects a project-scoped memory with no project_id', () => {
    const result = MemoryCreateInputSchema.safeParse({ ...valid, project_id: null });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes('project_id'))).toBe(true);
    }
  });

  it('allows a global memory with no project_id', () => {
    const result = MemoryCreateInputSchema.safeParse({
      ...valid,
      scope: 'global',
      project_id: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects confidence outside [0, 1]', () => {
    expect(MemoryCreateInputSchema.safeParse({ ...valid, confidence: 1.5 }).success).toBe(false);
    expect(MemoryCreateInputSchema.safeParse({ ...valid, confidence: -0.1 }).success).toBe(false);
  });

  it('rejects empty content', () => {
    expect(MemoryCreateInputSchema.safeParse({ ...valid, content: '' }).success).toBe(false);
  });

  it('rejects an unknown memory type', () => {
    expect(MemoryCreateInputSchema.safeParse({ ...valid, type: 'vibes' }).success).toBe(false);
  });

  it('rejects malformed tags', () => {
    expect(TagSchema.safeParse('Has Spaces').success).toBe(false);
    expect(TagSchema.safeParse('UPPER').success).toBe(false);
    expect(TagSchema.safeParse('architecture').success).toBe(true);
    expect(TagSchema.safeParse('phase-1').success).toBe(true);
  });
});

describe('MemoryCorrectionInputSchema', () => {
  it('requires at least one superseded memory', () => {
    const result = MemoryCorrectionInputSchema.safeParse({
      type: 'correction',
      content: 'Actually use Postgres',
      supersedes: [],
    });
    expect(result.success).toBe(false);
  });

  it('accepts a well-formed correction', () => {
    const result = MemoryCorrectionInputSchema.safeParse({
      type: 'correction',
      project_id: 'demo-game',
      content: 'Actually use Postgres',
      supersedes: ['3f1f8b7a-1111-4222-8333-444455556666'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-uuid supersede targets', () => {
    const result = MemoryCorrectionInputSchema.safeParse({
      type: 'correction',
      project_id: 'demo-game',
      content: 'Actually use Postgres',
      supersedes: ['not-a-uuid'],
    });
    expect(result.success).toBe(false);
  });
});

describe('MemorySchema', () => {
  const memory = {
    id: '3f1f8b7a-1111-4222-8333-444455556666',
    type: 'technical_decision',
    scope: 'project',
    project_id: 'demo-game',
    content: 'Use SQLite for persistent storage',
    source: { session_id: 'session-1', reference: 'architecture-decision' },
    confidence: 0.95,
    validation_status: 'verified',
    status: 'active',
    created_at: '2026-10-27T07:30:00.000Z',
    updated_at: '2026-10-27T07:30:00.000Z',
    expires_at: null,
    supersedes: [],
    superseded_by: null,
    tags: ['database', 'architecture'],
    // The brief's example predates the record contract (roadmap §6): every
    // stored record now also carries its edit counter and latest actor.
    revision: 1,
    actor: 'user',
  };

  it('accepts the canonical example from the brief', () => {
    expect(MemorySchema.parse(memory)).toMatchObject({ id: memory.id, status: 'active' });
  });

  it('rejects a non-ISO timestamp', () => {
    expect(MemorySchema.safeParse({ ...memory, created_at: 'yesterday' }).success).toBe(false);
  });

  it('rejects an invalid lifecycle status', () => {
    expect(MemorySchema.safeParse({ ...memory, status: 'maybe' }).success).toBe(false);
  });
});

describe('MemoryQuerySchema', () => {
  it('defaults to active memories with a bounded limit', () => {
    const parsed = MemoryQuerySchema.parse({});
    expect(parsed.status).toEqual(['active']);
    expect(parsed.limit).toBe(50);
    expect(parsed.include_global).toBe(true);
  });

  it('caps the page size so a caller cannot request everything', () => {
    expect(MemoryQuerySchema.safeParse({ limit: 5_000 }).success).toBe(false);
  });
});
