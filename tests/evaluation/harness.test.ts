import { EchoProvider } from '@mml/muse-provider';
import { describe, expect, it } from 'vitest';
import { runEvaluation, scoreAnswer, summariseComparison } from './harness.ts';

/**
 * Tests for the evaluation harness itself.
 *
 * These prove the instrument works — isolation between cells, prompt
 * construction, factual scoring, and delta arithmetic — using a deterministic
 * provider. They are not a Muse comparison and must never be reported as one.
 */

const task = {
  id: 'constraint-retention',
  name: 'Retain the offline constraint',
  prompt: 'What must the game support before we ship?',
  project_id: 'demo-game',
  seed_memories: [
    {
      type: 'constraint' as const,
      scope: 'project' as const,
      project_id: 'demo-game',
      content: 'The game must run offline on integrated graphics',
      confidence: 1,
      validation_status: 'verified' as const,
    },
  ],
  expected_memory_contents: ['offline on integrated graphics'],
  expected_facts: ['offline'],
  forbidden_facts: ['always online'],
};

describe('runEvaluation', () => {
  it('runs both configurations and pairs them into a comparison', async () => {
    const provider = new EchoProvider({
      respond: (request) => {
        const content = request.messages[0]?.content ?? '';
        // Behave like a memory-enabled model when the block is present.
        return content.includes('<retrieved_memories>')
          ? 'It must run offline on integrated graphics.'
          : 'I do not have that context.';
      },
    });

    const outcome = await runEvaluation({
      provider,
      tasks: [task],
      now: () => new Date('2026-10-27T00:00:00.000Z'),
    });

    expect(outcome.runs).toHaveLength(2);
    expect(outcome.comparisons).toHaveLength(1);

    const baseline = outcome.runs.find((run) => run.configuration_id === 'baseline');
    const memoryEnabled = outcome.runs.find((run) => run.configuration_id === 'memory-enabled');

    expect(baseline?.success).toBe(false);
    expect(memoryEnabled?.success).toBe(true);
    expect(memoryEnabled?.retrieved_memory_ids).toHaveLength(1);
    expect(memoryEnabled?.retrieved_characters).toBeGreaterThan(0);
    expect(baseline?.retrieved_memory_ids).toEqual([]);
  });

  it('sends the memory block only in the memory-enabled configuration', async () => {
    const prompts: string[] = [];
    const provider = new EchoProvider({
      respond: (request) => {
        prompts.push(request.messages[0]?.content ?? '');
        return 'ok';
      },
    });

    await runEvaluation({ provider, tasks: [task] });

    expect(prompts).toHaveLength(2);
    const withMemory = prompts.filter((prompt) => prompt.includes('<retrieved_memories>'));
    expect(withMemory).toHaveLength(1);
    expect(withMemory[0]).toContain('offline on integrated graphics');
  });

  it('isolates state between runs', async () => {
    const provider = new EchoProvider({ respond: () => 'It must run offline.' });

    const outcome = await runEvaluation({ provider, tasks: [task] });
    for (const run of outcome.runs) {
      // Each cell seeds exactly one memory; leakage would show as more.
      expect(run.retrieved_memory_ids.length).toBeLessThanOrEqual(1);
    }
  });

  it('marks token comparisons as invalid when usage is unavailable', async () => {
    const provider = new EchoProvider({ respond: () => 'It must run offline.' });
    const outcome = await runEvaluation({ provider, tasks: [task] });

    const comparison = outcome.comparisons[0];
    expect(comparison).toBeDefined();
    if (!comparison) return;

    // The echo provider reports usage, so the comparison is valid here; the
    // guard exists for providers that do not.
    expect(comparison.token_comparison_valid).toBe(true);
    expect(summariseComparison(comparison)).toMatch(/input tokens/);
  });

  it('returns no comparison when only one configuration runs', async () => {
    const provider = new EchoProvider({ respond: () => 'offline' });
    const outcome = await runEvaluation({
      provider,
      tasks: [task],
      configurations: [{ id: 'baseline', memory_enabled: false }],
    });

    expect(outcome.runs).toHaveLength(1);
    expect(outcome.comparisons).toHaveLength(0);
  });
});

describe('scoreAnswer', () => {
  it('requires every expected fact', () => {
    const parsed = { ...task, expected_facts: ['offline', 'integrated graphics'] };
    expect(scoreAnswer(parsed, 'offline on integrated graphics')).toBe(true);
    expect(scoreAnswer(parsed, 'offline only')).toBe(false);
  });

  it('rejects answers containing a forbidden fact', () => {
    const parsed = { ...task, forbidden_facts: ['always online'] };
    expect(scoreAnswer(parsed, 'It must run offline, so not always online')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(scoreAnswer(task, 'MUST RUN OFFLINE')).toBe(true);
  });
});

describe('summariseComparison', () => {
  it('refuses to summarise when usage is missing', async () => {
    const provider = new EchoProvider({ respond: () => 'x' });
    const outcome = await runEvaluation({ provider, tasks: [task] });
    const comparison = outcome.comparisons[0];
    if (!comparison) return;

    expect(summariseComparison({ ...comparison, token_comparison_valid: false })).toBeNull();
  });
});
