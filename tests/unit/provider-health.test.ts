import { ProviderError } from '@mml/muse-provider';
import type { ModelProvider } from '@mml/shared';
import { describe, expect, it } from 'vitest';
import { ProviderHealthTracker } from '../../apps/server/src/provider-health.js';

/**
 * The tracker's docstring makes three cost/behavior promises ("state only
 * flips after a real call", "results are cached briefly so a page refresh
 * cannot burn the demo's token allowance", "concurrent checks share a single
 * in-flight call") and the failure path promises credential hygiene ("keep
 * it in the server log, expose only a generic state"). None of the caching
 * or in-flight mechanics had a witness — a broken cache turns every System
 * view refresh into a real model call, which is exactly the demo-budget bug
 * the comment was written to prevent.
 */

function okProvider(counter: { calls: number; delayMs?: number }): ModelProvider {
  return {
    id: 'fake',
    name: 'fake',
    capabilities: () => ({}),
    generate: async () => {
      counter.calls += 1;
      if (counter.delayMs) await new Promise((r) => setTimeout(r, counter.delayMs));
      return {
        text: 'ready',
        model: 'fake-model',
        latency_ms: 5,
        usage: { input_tokens: 3, output_tokens: 1 },
      };
    },
  } as unknown as ModelProvider;
}

describe('ProviderHealthTracker cache + in-flight + hygiene', () => {
  it('never-probed is honest: not ok, not verified, says so', () => {
    const t = new ProviderHealthTracker(okProvider({ calls: 0 }), 60_000);
    const s = t.current();
    expect(s.ok).toBe(false);
    expect(s.verified_with_live_call).toBe(false);
    expect(s.message).toContain('no live check has been run');
  });

  it('fresh results are cached; force bypasses; concurrent checks share one call', async () => {
    const counter = { calls: 0, delayMs: 40 };
    const t = new ProviderHealthTracker(okProvider(counter), 60_000);
    const first = await t.check();
    expect(first.verified_with_live_call).toBe(true);
    const second = await t.check(); // cache hit, no provider call
    expect(counter.calls).toBe(1);
    expect(second.checked_at).toBe(first.checked_at);

    const shared = await Promise.all([t.check({ force: true }), t.check({ force: true })]);
    expect(counter.calls).toBe(2); // two forced checks while first is in-flight -> ONE probe
    expect(shared[0].checked_at).toBe(shared[1].checked_at);
  });

  it('probe failure: generic state to clients, secrets stay out, but the probe WAS live', async () => {
    const provider = {
      id: 'fake',
      name: 'fake',
      capabilities: () => ({}),
      generate: async () => {
        throw new ProviderError('overloaded', 'token sk-SUPERSECRET rejected');
      },
    } as unknown as ModelProvider;
    const t = new ProviderHealthTracker(provider, 0);
    const s = await t.check();
    expect(s.ok).toBe(false);
    expect(s.message).toBe('The provider is currently unavailable.');
    expect(s.message).not.toContain('sk-SUPERSECRET');
    // A live call RAN and reported failure — that is "verified" in the
    // never-checked sense, distinct from the offline UNCHECKED state.
    expect(s.verified_with_live_call).toBe(true);
  });
});
