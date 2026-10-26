import { MuseCliProvider } from '@mml/muse-provider';
import { describe, expect, it } from 'vitest';

/**
 * Live integration tests against the real Meta Muse CLI.
 *
 * Opt-in by design: these cost real quota and require a logged-in Muse
 * installation, so they never run in CI by default.
 *
 *   MML_LIVE_MUSE=1 pnpm test
 */
const enabled = process.env.MML_LIVE_MUSE === '1';

describe.skipIf(!enabled)('live Muse integration', () => {
  const provider = new MuseCliProvider({
    model: process.env.MUSE_MODEL ?? 'muse-wonder-1.0',
    reasoningEffort: 'low',
    timeoutMs: 120_000,
  });

  it('completes a real inference round-trip', async () => {
    const response = await provider.generate({
      messages: [{ role: 'user', content: 'Reply with exactly the single word: READY' }],
      max_output_tokens: 32,
    });

    expect(response.provider).toBe('muse-cli');
    expect(response.stop_reason).toBe('completed');
    expect(response.text.toUpperCase()).toContain('READY');
    expect(response.model).toMatch(/^muse-/);
    expect(response.latency_ms).toBeGreaterThan(0);
    // Usage may be absent when the allowance endpoint refuses a refresh, so we
    // only assert it is a non-negative number rather than a specific count.
    expect(response.usage.input_tokens).toBeGreaterThanOrEqual(0);
  });

  it('honours a structured output schema', async () => {
    const response = await provider.generate({
      messages: [
        {
          role: 'user',
          content: 'Return a JSON object with a single field "status" set to "ok".',
        },
      ],
      response_schema: {
        type: 'object',
        properties: { status: { type: 'string' } },
        required: ['status'],
        additionalProperties: false,
      },
      max_output_tokens: 64,
    });

    const parsed = JSON.parse(response.text) as { status?: string };
    expect(parsed.status).toBe('ok');
  });

  it('streams incremental deltas from a real run', async () => {
    const deltas: string[] = [];
    let completed = false;

    for await (const event of provider.stream({
      messages: [{ role: 'user', content: 'Count from 1 to 5.' }],
      max_output_tokens: 64,
    })) {
      if (event.type === 'text_delta') deltas.push(event.text);
      if (event.type === 'completed') completed = true;
    }

    expect(completed).toBe(true);
    expect(deltas.length).toBeGreaterThan(0);
  });
});

if (!enabled) {
  describe('live Muse integration (skipped)', () => {
    it('is opt-in via MML_LIVE_MUSE=1', () => {
      expect(enabled).toBe(false);
    });
  });
}
