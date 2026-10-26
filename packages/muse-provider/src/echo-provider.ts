import type {
  ModelCapabilities,
  ModelEvent,
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from '@mml/shared';
import { ModelResponseSchema } from '@mml/shared';

export interface EchoProviderOptions {
  /** Override the reply. Tests use this to script exact output. */
  respond?: (request: ModelRequest) => string | Promise<string>;
  /** Simulated per-call latency, for exercising timeouts and the UI. */
  latencyMs?: number;
}

/**
 * Deterministic offline provider.
 *
 * This exists so the test suite and CI can exercise the harness, the API, and
 * the UI without network access or credentials. It is **not** a model and must
 * never stand in for Muse in a demonstration: the name, id, and capability
 * notes all say so, and the UI labels it. Rule 9 of the build brief — no fake
 * success — is enforced here by refusing to impersonate Muse.
 */
export class EchoProvider implements ModelProvider {
  readonly id = 'echo';
  readonly name = 'Deterministic offline provider (not a model)';

  private readonly respond: (request: ModelRequest) => string | Promise<string>;
  private readonly latencyMs: number;

  constructor(options: EchoProviderOptions = {}) {
    this.respond =
      options.respond ??
      ((request) => {
        const last = [...request.messages].reverse().find((m) => m.role === 'user');
        return `echo: ${last?.content.trim() ?? '(no user message)'}`;
      });
    this.latencyMs = options.latencyMs ?? 0;
  }

  capabilities(): ModelCapabilities {
    return {
      streaming: true,
      tool_calling: false,
      structured_output: false,
      provider_sessions: false,
      max_context_tokens: 8_192,
      models: ['echo-1'],
      notes: [
        'Deterministic offline provider for tests and CI.',
        'Not a language model: it must never be presented as Meta Muse.',
      ],
    };
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const startedAt = performance.now();
    const text = await this.respond(request);
    if (this.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    }
    return ModelResponseSchema.parse({
      text,
      model: 'echo-1',
      provider: this.id,
      stop_reason: 'completed',
      usage: {
        input_tokens: estimateTokens(request),
        output_tokens: Math.ceil(text.length / 4),
        cached_input_tokens: 0,
        reasoning_tokens: 0,
      },
      latency_ms: Math.round(performance.now() - startedAt),
    });
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    const text = await this.respond(request);
    const startedAt = performance.now();
    for (const chunk of chunkText(text)) {
      yield { type: 'text_delta', text: chunk };
    }
    // Report usage, like a real provider does: a streaming turn that omits it
    // would make every accounting display read zero.
    yield {
      type: 'usage',
      usage: {
        input_tokens: estimateTokens(request),
        output_tokens: Math.ceil(text.length / 4),
        cached_input_tokens: 0,
        reasoning_tokens: 0,
      },
    };
    yield {
      type: 'completed',
      text,
      model: 'echo-1',
      stop_reason: 'completed',
      latency_ms: Math.round(performance.now() - startedAt),
    };
  }
}

/** Rough token estimate (~4 chars/token). Clearly an estimate, never billed. */
export function estimateTokens(request: ModelRequest): number {
  return Math.ceil(request.messages.reduce((sum, m) => sum + m.content.length, 0) / 4);
}

function* chunkText(text: string, size = 24): Generator<string> {
  for (let i = 0; i < text.length; i += size) {
    yield text.slice(i, i + size);
  }
}
