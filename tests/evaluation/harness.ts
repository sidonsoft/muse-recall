import { formatMemoryContext, MemoryEngine, openDatabase } from '@mml/memory-engine';
import type { ModelProvider } from '@mml/muse-provider';
import {
  DEFAULT_EVALUATION_CONFIGURATIONS,
  type EvaluationComparison,
  type EvaluationConfiguration,
  type EvaluationRun,
  type EvaluationTask,
  EvaluationTaskSchema,
  type RetrievalBudget,
} from '@mml/shared';

/**
 * Evaluation harness.
 *
 * Runs the same task under two configurations — **baseline** (Muse with no
 * memory layer) and **memory-enabled** (Muse with retrieved memory injected) —
 * and records what actually happened: the prompt it sent, the answer, the
 * provider-reported token usage, and whether the answer satisfied the task's
 * expected and forbidden facts.
 *
 * This is the interface for the Phase 6 comparison. Phase 2 ships it working
 * and tested against the deterministic provider; it does **not** publish a
 * Muse comparison, because none has been run yet.
 *
 * Isolation rules that make the comparison fair:
 *   - each run gets a fresh in-memory database, so no state leaks between cells
 *   - both configurations receive the identical task prompt
 *   - the only difference is whether the memory block is prepended
 *   - usage is taken from the provider; when the provider reports none, the run
 *     is marked `usage_available: false` rather than estimated into the record
 */

export interface EvaluationHarnessOptions {
  provider: ModelProvider;
  tasks: EvaluationTask[];
  configurations?: EvaluationConfiguration[];
  /** Retrieval budget for the memory-enabled configuration. */
  retrievalBudget?: Partial<RetrievalBudget>;
  maxOutputTokens?: number;
  now?: () => Date;
}

export interface EvaluationOutcome {
  runs: EvaluationRun[];
  comparisons: EvaluationComparison[];
  /** Prompts actually sent, for auditability. */
  prompts: { task_id: string; configuration_id: string; prompt: string }[];
}

function buildTask(input: unknown): EvaluationTask {
  return EvaluationTaskSchema.parse(input);
}

export async function runEvaluation(options: EvaluationHarnessOptions): Promise<EvaluationOutcome> {
  const tasks = options.tasks.map(buildTask);
  const configurations = options.configurations ?? DEFAULT_EVALUATION_CONFIGURATIONS;
  const clock = options.now ?? (() => new Date());

  const runs: EvaluationRun[] = [];
  const prompts: EvaluationOutcome['prompts'] = [];

  for (const task of tasks) {
    for (const configuration of configurations) {
      const opened = openDatabase({ path: ':memory:' });
      try {
        const engine = new MemoryEngine(opened.db, { now: clock });

        for (const memory of task.seed_memories) {
          engine.create(memory);
        }

        let prompt = task.prompt;
        let retrievalIds: string[] = [];
        let retrievalCharacters = 0;

        if (configuration.memory_enabled) {
          const retrieval = engine.retrieve(
            {
              project_id: task.project_id,
              query: task.prompt,
              ...(options.retrievalBudget ? { budget: options.retrievalBudget } : {}),
            },
            { now: clock() },
          );
          const context = formatMemoryContext(retrieval);
          prompt = context.text.length > 0 ? `${context.text}\n\n${task.prompt}` : task.prompt;
          retrievalIds = context.memory_ids;
          retrievalCharacters = context.characters;
        }

        prompts.push({
          task_id: task.id,
          configuration_id: configuration.id,
          prompt,
        });

        const startedAt = performance.now();
        const response = await options.provider.generate({
          messages: [{ role: 'user', content: prompt }],
          ...(options.maxOutputTokens ? { max_output_tokens: options.maxOutputTokens } : {}),
        });
        const duration = performance.now() - startedAt;

        const usageAvailable = response.usage.input_tokens > 0 || response.usage.output_tokens > 0;

        runs.push({
          task_id: task.id,
          configuration_id: configuration.id,
          provider_id: response.provider,
          model: response.model,
          started_at: new Date(clock().getTime() - duration).toISOString(),
          duration_ms: Number(duration.toFixed(2)),
          output_text: response.text,
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
          usage_available: usageAvailable,
          retrieved_memory_ids: retrievalIds,
          retrieved_characters: retrievalCharacters,
          success: scoreAnswer(task, response.text),
          notes: null,
        });
      } finally {
        opened.close();
      }
    }
  }

  const comparisons: EvaluationComparison[] = [];
  for (const task of tasks) {
    const baseline = runs.find(
      (run) => run.task_id === task.id && run.configuration_id === 'baseline',
    );
    const memoryEnabled = runs.find(
      (run) => run.task_id === task.id && run.configuration_id === 'memory-enabled',
    );
    if (!baseline || !memoryEnabled) continue;

    comparisons.push({
      task_id: task.id,
      baseline,
      memory_enabled: memoryEnabled,
      input_token_delta: memoryEnabled.input_tokens - baseline.input_tokens,
      output_token_delta: memoryEnabled.output_tokens - baseline.output_tokens,
      duration_delta_ms: Number((memoryEnabled.duration_ms - baseline.duration_ms).toFixed(2)),
      token_comparison_valid: baseline.usage_available && memoryEnabled.usage_available,
    });
  }

  return { runs, comparisons, prompts };
}

/**
 * Score an answer against a task's expectations.
 *
 * Deliberately mechanical: expected facts must appear, forbidden facts must
 * not. It measures whether the answer used the right knowledge, not whether it
 * was well written.
 */
export function scoreAnswer(task: EvaluationTask, answer: string): boolean {
  const haystack = answer.toLowerCase();
  const hasExpected = task.expected_facts.every((fact) => haystack.includes(fact.toLowerCase()));
  const lacksForbidden = task.forbidden_facts.every(
    (fact) => !haystack.includes(fact.toLowerCase()),
  );
  return hasExpected && lacksForbidden;
}

/**
 * Human-readable summary of one comparison, used by the Phase 6 report.
 * Returns null until both runs reported provider usage — deltas computed from
 * missing usage would be fiction.
 */
export function summariseComparison(comparison: EvaluationComparison): string | null {
  if (!comparison.token_comparison_valid) return null;
  const direction = comparison.input_token_delta <= 0 ? 'saved' : 'spent';
  return `task ${comparison.task_id}: ${direction} ${Math.abs(
    comparison.input_token_delta,
  )} input tokens with memory (${comparison.baseline.input_tokens} → ${
    comparison.memory_enabled.input_tokens
  })`;
}
