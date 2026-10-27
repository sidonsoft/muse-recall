import { createModelProvider } from '../../packages/muse-provider/src/index.js';
const models = process.argv.slice(2);
for (const m of models) {
  const p = createModelProvider({ kind: 'muse-cli', museModel: m, museReasoningEffort: 'low', museTimeoutMs: 120000 });
  try {
    const r = await p.generate({ messages: [{ role: 'user', content: 'Reply with exactly: READY' }], max_output_tokens: 16 });
    console.log(JSON.stringify({ requested: m, reported_model: r.model, latency_ms: r.latency_ms,
      in: r.usage.input_tokens, out: r.usage.output_tokens, stop: r.stop_reason }));
  } catch (e) { console.log(JSON.stringify({ requested: m, error: String(e.message).slice(0, 160) })); }
}
