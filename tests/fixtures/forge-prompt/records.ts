import type { RetrievedMemory } from '@mml/shared';

/**
 * Fixed retrieval records for the prompt byte fixtures.
 *
 * The ids, source references, and timestamps are deliberately stable: the
 * fixture asserts the exact bytes sent to the model, including record identity
 * and provenance. Scores are irrelevant to the prompt but required by the
 * retrieval contract.
 */
export const FORGE_PROMPT_MEMORIES: RetrievedMemory[] = [
  {
    memory: {
      id: '11111111-1111-4111-8111-111111111111',
      type: 'constraint',
      scope: 'project',
      project_id: 'montys-memory-meadow',
      content:
        'Primary colour: #FF7E5F. Text colour: #2D1E2F. Avoid neon colours and keep the cards large.',
      source: { session_id: null, reference: 'forge:decision:palette' },
      confidence: 0.95,
      validation_status: 'verified',
      status: 'active',
      created_at: '2026-10-01T00:00:00.000Z',
      updated_at: '2026-10-01T00:00:00.000Z',
      expires_at: null,
      supersedes: [],
      superseded_by: null,
      tags: ['forge', 'palette'],
    },
    injected_content:
      'Primary colour: #FF7E5F. Text colour: #2D1E2F. Avoid neon colours and keep the cards large.',
    truncated: false,
    pinned: true,
    score: 1,
    rank_components: {
      relevance: 1,
      scope: 1,
      confidence: 0.95,
      validation: 1,
      recency: 1,
      type_priority: 1,
    },
    evidence: 'pinned constraint · project scope · verified',
  },
  {
    memory: {
      id: '22222222-2222-4222-8222-222222222222',
      type: 'contextual_fact',
      scope: 'project',
      project_id: 'montys-memory-meadow',
      content: 'The card grid is 4 by 3 with six pairs.',
      source: { session_id: 'session-abc', reference: null },
      confidence: 0.8,
      validation_status: 'unverified',
      status: 'active',
      created_at: '2026-10-02T00:00:00.000Z',
      updated_at: '2026-10-02T00:00:00.000Z',
      expires_at: null,
      supersedes: [],
      superseded_by: null,
      tags: [],
    },
    injected_content: 'The card grid is 4 by 3 with six pairs.',
    truncated: false,
    pinned: false,
    score: 0.7,
    rank_components: {
      relevance: 1,
      scope: 1,
      confidence: 0.8,
      validation: 0,
      recency: 1,
      type_priority: 0.2,
    },
    evidence: 'keyword match · project scope',
  },
];
