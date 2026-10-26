/**
 * Muse capability probe.
 *
 * Answers, with evidence rather than documentation guesswork: does this
 * machine have the Muse CLI, which models does it offer, does a real headless
 * call work, how long does it take, and how many tokens does it consume?
 *
 * Usage:
 *   pnpm muse:probe              # probe the default model
 *   pnpm muse:probe muse-spark-1.3
 *
 * Exits non-zero when the live call fails, so it doubles as a pre-demo check.
 */
// Relative import on purpose: this script runs from the repository root via
// tsx, where workspace package names are not resolvable from node_modules.
import { createModelProvider } from '../packages/muse-provider/src/index.js';

const model = process.argv[2] ?? process.env.MUSE_MODEL ?? 'muse-wonder-1.0';

console.log('Muse Memory Lab — provider probe');
console.log('--------------------------------');

const provider = createModelProvider({
  kind: 'muse-cli',
  museModel: model,
  museReasoningEffort: 'low',
  museTimeoutMs: 120_000,
});

const capabilities = provider.capabilities();
console.log(`provider:        ${provider.id} (${provider.name})`);
console.log(`configured model: ${model}`);
console.log(`models offered:   ${capabilities.models.join(', ')}`);
console.log(`context window:   ${capabilities.max_context_tokens.toLocaleString('en-US')} tokens`);
console.log(
  `capabilities:     streaming=${capabilities.streaming} tool_calling=${capabilities.tool_calling} structured_output=${capabilities.structured_output} provider_sessions=${capabilities.provider_sessions}`,
);
console.log('notes:');
for (const note of capabilities.notes) console.log(`  - ${note}`);
console.log('\nrunning a real headless call…');

try {
  const response = await provider.generate({
    messages: [{ role: 'user', content: 'Reply with exactly the single word: READY' }],
    max_output_tokens: 32,
  });

  console.log('\nresult:');
  console.log(`  reply:        ${JSON.stringify(response.text.trim())}`);
  console.log(`  model used:   ${response.model}`);
  console.log(`  stop reason:  ${response.stop_reason}`);
  console.log(`  latency:      ${response.latency_ms} ms`);
  console.log(`  input tokens: ${response.usage.input_tokens}`);
  console.log(`  output tokens:${response.usage.output_tokens}`);
  console.log(`  reasoning:    ${response.usage.reasoning_tokens}`);
  console.log('\nprobe passed: real Muse inference works from this machine.');
} catch (error) {
  console.error(`\nprobe failed: ${error instanceof Error ? error.message : String(error)}`);
  console.error(
    '\nCheck that `muse` is installed and logged in: run `muse exec "hello"` manually, or `muse login`.',
  );
  process.exit(1);
}
