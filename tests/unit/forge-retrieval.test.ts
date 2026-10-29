import { MemoryEngine, openDatabase } from '@mml/memory-engine';
import { FORGE_RETRIEVAL_BUDGET } from '@mml/shared';
import { describe, expect, it } from 'vitest';
import { buildRetrievalQuery } from '../../apps/server/src/forge/prompt.js';
import {
  READING_NOOK_MEMORIES,
  READING_NOOK_PREFERENCE,
  READING_NOOK_PROJECT_ID,
  READING_NOOK_PROMPT,
  READING_NOOK_TECHNICAL_DECISION,
} from '../fixtures/reading-nook.js';

describe('Forge retrieval decisions', () => {
  it('supplies all six live-case memories within the Forge budget', () => {
    const opened = openDatabase({ path: ':memory:' });
    try {
      const engine = new MemoryEngine(opened.db);
      const ids = READING_NOOK_MEMORIES.map((input) => engine.create(input).memory.id);
      const query = buildRetrievalQuery({
        projectId: READING_NOOK_PROJECT_ID,
        kind: 'generate',
        prompt: READING_NOOK_PROMPT,
      });

      // The project id is a scope filter, not a search term.
      expect(query).toBe(READING_NOOK_PROMPT);
      expect(query).not.toContain(READING_NOOK_PROJECT_ID);

      // Preserve the live failure: default pinning leaves the palette and
      // offline decision out because the long prompt's tokens never reach them.
      const before = engine.retrieve({
        project_id: READING_NOOK_PROJECT_ID,
        query,
      });
      expect(before.metadata.mode).toBe('default');
      expect(before.metadata.candidate_count).toBe(4);
      expect(before.metadata.memory_ids).not.toContain(ids[4]);
      expect(before.metadata.memory_ids).not.toContain(ids[5]);

      // One named mode drives both pinned types and budgets; the preview API
      // and the Forge runner request exactly this.
      const retrieval = engine.retrieve({
        project_id: READING_NOOK_PROJECT_ID,
        query,
        mode: 'forge',
      });
      const contents = retrieval.results.map((entry) => entry.injected_content);

      expect(retrieval.metadata.mode).toBe('forge');
      expect(retrieval.metadata.memory_budget).toBe(FORGE_RETRIEVAL_BUDGET.max_memories);
      expect(retrieval.metadata.character_budget).toBe(FORGE_RETRIEVAL_BUDGET.max_characters);
      expect(retrieval.metadata.candidate_count).toBe(6);
      expect(retrieval.results).toHaveLength(6);
      expect(new Set(retrieval.metadata.memory_ids)).toEqual(new Set(ids));
      expect(contents).toContain(READING_NOOK_PREFERENCE);
      expect(contents).toContain(READING_NOOK_TECHNICAL_DECISION);
      expect(retrieval.results.every((entry) => entry.pinned)).toBe(true);
      expect(retrieval.metadata.characters_used).toBeLessThanOrEqual(
        FORGE_RETRIEVAL_BUDGET.max_characters,
      );
    } finally {
      opened.close();
    }
  });
});
