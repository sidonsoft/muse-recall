import { MemoryEngine, openDatabase } from '@mml/memory-engine';
import type { MemoryCreateInput } from '@mml/shared';
import { describe, expect, it } from 'vitest';
import { buildRetrievalQuery } from '../../apps/server/src/forge/prompt.js';
import { FORGE_PINNED_TYPES } from '../../apps/server/src/forge/runner.js';

const PROJECT_ID = 'reading-nook';
const BUDGET = { max_memories: 6, max_characters: 3_000 };

const PROMPT =
  "Build Reading Nook, a reading log for children aged 7 to 10. A child can add books (title, author, total pages), log pages read each day, and see a weekly summary of pages read with a simple bar chart. Finished books move to a 'My Shelf' section with a small celebration message. Set a weekly page goal and show progress towards it. Everything works in one index.html. Follow the saved project decisions, including the colour palette and offline storage in localStorage so nothing is lost on reload.";

const PREFERENCE = 'Palette: warm — orange, gold and peach on a cream background.';
const TECHNICAL_DECISION =
  'Offline only: store data in localStorage; no network requests and no external scripts, fonts or images.';

// These are the six decisions saved in the 2026-10-29 live run
// (docs/hackathon-evidence/live-dsh-run-2026-10-29, finding F1).
const MEMORIES: MemoryCreateInput[] = [
  {
    type: 'constraint',
    scope: 'project',
    project_id: PROJECT_ID,
    content: 'No countdown timers or time pressure anywhere in the app.',
  },
  {
    type: 'constraint',
    scope: 'project',
    project_id: PROJECT_ID,
    content: 'No flashing or blinking animations.',
  },
  {
    type: 'constraint',
    scope: 'project',
    project_id: PROJECT_ID,
    content:
      'Never use colour-only cues: every status (goal met, in progress, finished) must also have a text label or icon, so it works without colour.',
  },
  {
    type: 'constraint',
    scope: 'project',
    project_id: PROJECT_ID,
    content:
      'Audience is children aged 7–10: tap targets at least 44px, plain words, an encouraging tone, and no scores or rankings that compare children.',
  },
  {
    type: 'preference',
    scope: 'project',
    project_id: PROJECT_ID,
    content: PREFERENCE,
  },
  {
    type: 'technical_decision',
    scope: 'project',
    project_id: PROJECT_ID,
    content: TECHNICAL_DECISION,
  },
];

describe('Forge retrieval decisions', () => {
  it('supplies all six live-case memories within the Forge budget', () => {
    const opened = openDatabase({ path: ':memory:' });
    try {
      const engine = new MemoryEngine(opened.db);
      const ids = MEMORIES.map((input) => engine.create(input).memory.id);
      const query = buildRetrievalQuery({
        projectId: PROJECT_ID,
        kind: 'generate',
        prompt: PROMPT,
      });

      // The project id is a scope filter, not a search term.
      expect(query).toBe(PROMPT);
      expect(query).not.toContain(PROJECT_ID);

      // Reproduce the live failure: default pinning leaves the palette and
      // offline decision out because the long prompt's tokens never reach them.
      const before = engine.retrieve({
        project_id: PROJECT_ID,
        query,
        budget: BUDGET,
      });
      expect(before.metadata.candidate_count).toBe(4);
      expect(before.metadata.memory_ids).not.toContain(ids[4]);
      expect(before.metadata.memory_ids).not.toContain(ids[5]);

      const retrieval = engine.retrieve(
        { project_id: PROJECT_ID, query, budget: BUDGET },
        { pinnedTypes: FORGE_PINNED_TYPES },
      );
      const contents = retrieval.results.map((entry) => entry.injected_content);

      expect(retrieval.metadata.candidate_count).toBe(6);
      expect(retrieval.results).toHaveLength(6);
      expect(new Set(retrieval.metadata.memory_ids)).toEqual(new Set(ids));
      expect(contents).toContain(PREFERENCE);
      expect(contents).toContain(TECHNICAL_DECISION);
      expect(retrieval.results.every((entry) => entry.pinned)).toBe(true);
      expect(retrieval.metadata.characters_used).toBeLessThanOrEqual(BUDGET.max_characters);
    } finally {
      opened.close();
    }
  });
});
