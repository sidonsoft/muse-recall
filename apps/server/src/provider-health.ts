import { ProviderError } from '@mml/muse-provider';
import { type ModelProvider, redactSecrets } from '@mml/shared';

export interface ProviderHealthState {
  checked_at: string | null;
  ok: boolean;
  latency_ms: number | null;
  model: string | null;
  message: string;
  /** True only when a real model call succeeded in this process. */
  verified_with_live_call: boolean;
}

interface ProviderHealthLogger {
  error(context: Record<string, unknown>, message: string): void;
}

const GENERIC_PROVIDER_FAILURE = 'The provider is currently unavailable.';

const UNCHECKED: ProviderHealthState = {
  checked_at: null,
  ok: false,
  latency_ms: null,
  model: null,
  message: 'no live check has been run in this process',
  verified_with_live_call: false,
};

const PROBE_PROMPT = 'Health check. Reply with the single word: ready';

/**
 * Tracks whether the configured provider actually works.
 *
 * Provider health is *observed*, never assumed: the state only flips to
 * verified after a real model call returns. Results are cached briefly so a
 * page refresh cannot burn the demo's token allowance, and concurrent checks
 * share a single in-flight call.
 */
export class ProviderHealthTracker {
  private state: ProviderHealthState = { ...UNCHECKED };
  private inFlight: Promise<ProviderHealthState> | null = null;

  constructor(
    private readonly provider: ModelProvider,
    private readonly ttlMs = 60_000,
    private readonly logger?: ProviderHealthLogger,
  ) {}

  current(): ProviderHealthState {
    return { ...this.state };
  }

  private isFresh(): boolean {
    if (!this.state.checked_at) return false;
    const age = Date.now() - Date.parse(this.state.checked_at);
    return age >= 0 && age < this.ttlMs;
  }

  /**
   * Run a live probe (or return the cached result while it is fresh).
   * Pass `force` to bypass the cache.
   */
  async check(options: { force?: boolean } = {}): Promise<ProviderHealthState> {
    if (!options.force && this.isFresh()) return this.current();
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.runProbe().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async runProbe(): Promise<ProviderHealthState> {
    try {
      const response = await this.provider.generate({
        messages: [{ role: 'user', content: PROBE_PROMPT }],
        max_output_tokens: 32,
      });
      this.state = {
        checked_at: new Date().toISOString(),
        ok: response.text.trim().length > 0,
        latency_ms: response.latency_ms,
        model: response.model,
        message:
          response.text.trim().length > 0
            ? `live reply received (${response.usage.output_tokens} output tokens)`
            : 'live call returned empty text',
        verified_with_live_call: true,
      };
    } catch (error) {
      const code = ProviderError.isProviderError(error) ? error.code : 'provider_crashed';
      const detail = error instanceof Error ? error.message : String(error);
      // The exact upstream error can carry credentials or provider internals;
      // keep it in the server log and expose only a generic state to clients.
      this.logger?.error({ code, detail: redactSecrets(detail) }, 'provider health probe failed');
      this.state = {
        checked_at: new Date().toISOString(),
        ok: false,
        latency_ms: null,
        model: null,
        message: GENERIC_PROVIDER_FAILURE,
        verified_with_live_call: true,
      };
    }
    return this.current();
  }
}
