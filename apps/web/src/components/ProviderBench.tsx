import type { ModelResponse } from '@mml/shared';
import { type FormEvent, useState } from 'react';
import { ApiError, api } from '../lib/api.ts';
import { formatLatency, formatTokens } from '../lib/format.ts';
import { StatusPill } from './ui.tsx';

/**
 * Raw model bench.
 *
 * This is not the chat. It sends one bounded prompt straight to the configured
 * provider and prints exactly what came back, so a reviewer can confirm real
 * inference on their machine in seconds. No memory, no tools, no agent loop —
 * and the panel says so.
 */
export function ProviderBench({ onResult }: { onResult: (response: ModelResponse) => void }) {
  const [prompt, setPrompt] = useState(
    'In one sentence, explain why a persistent memory layer matters for an AI companion.',
  );
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ModelResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || prompt.trim().length === 0) return;

    setBusy(true);
    setError(null);
    try {
      const response = await api.generate({
        prompt: prompt.trim(),
        system:
          'You are Meta Muse. Answer directly and concisely. Never claim to have remembered anything from a previous session.',
        max_output_tokens: 384,
      });
      setResult(response);
      onResult(response);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? `${cause.code}: ${cause.message}`
          : cause instanceof Error
            ? cause.message
            : String(cause),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <form onSubmit={submit} className="space-y-3">
        <label htmlFor="bench-prompt" className="block text-xs font-medium text-ink-dim">
          Prompt
        </label>
        <textarea
          id="bench-prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={3}
          maxLength={4_000}
          className="w-full resize-none rounded-lg border border-line bg-base/70 px-3 py-2.5 font-mono text-[12px] leading-relaxed text-ink placeholder:text-muted focus:border-line-bright focus:outline-none"
          placeholder="Ask Muse something short…"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={busy || prompt.trim().length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Calling Muse…' : 'Send to provider'}
          </button>
          <span className="text-[11px] text-muted">
            One model call · no memory · no tools · max 384 output tokens
          </span>
        </div>
      </form>

      {error ? (
        <div className="mt-3 rounded-lg border border-err/30 bg-err/5 px-3 py-2.5">
          <p className="font-mono text-[11px] leading-relaxed text-err">{error}</p>
        </div>
      ) : null}

      {result ? (
        <div className="mt-3 rounded-lg border border-line bg-base/60">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
            <StatusPill tone="ok">reply received</StatusPill>
            <span className="font-mono text-[10px] text-muted">{result.model}</span>
            <span className="text-[10px] text-muted">·</span>
            <span className="font-mono text-[10px] text-muted">
              {formatLatency(result.latency_ms)}
            </span>
            <span className="text-[10px] text-muted">·</span>
            <span className="font-mono text-[10px] text-muted">
              {formatTokens(result.usage.input_tokens)} in /{' '}
              {formatTokens(result.usage.output_tokens)} out
            </span>
          </div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap px-3 py-2.5 font-mono text-[12px] leading-relaxed text-ink-dim">
            {result.text}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
