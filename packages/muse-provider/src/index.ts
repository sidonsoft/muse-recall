import type { ModelProvider } from '@mml/shared';
import { EchoProvider } from './echo-provider.js';
import {
  MuseCliProvider as MuseCliProviderImpl,
  type MuseReasoningEffort,
} from './muse-cli-provider.js';

export const PROVIDER_KINDS = ['muse-cli', 'echo'] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export interface ProviderConfig {
  kind: ProviderKind;
  museBin?: string;
  museModel?: string;
  museReasoningEffort?: MuseReasoningEffort;
  museTimeoutMs?: number;
  cwd?: string;
  env?: Record<string, string>;
  museFallbackApiKey?: string;
  museFallbackModel?: string;
}

/**
 * Build the configured provider.
 *
 * Muse is the primary integration; `echo` is the deterministic offline
 * provider used by tests and CI. Nothing here silently downgrades a requested
 * Muse provider to echo — a misconfigured provider must fail loudly.
 */
export function createModelProvider(config: ProviderConfig): ModelProvider {
  switch (config.kind) {
    case 'muse-cli':
      return new MuseCliProviderImpl({
        bin: config.museBin,
        model: config.museModel,
        reasoningEffort: config.museReasoningEffort,
        timeoutMs: config.museTimeoutMs,
        cwd: config.cwd,
        env: config.env,
        ...(config.museFallbackApiKey ? { fallbackApiKey: config.museFallbackApiKey } : {}),
        ...(config.museFallbackModel ? { fallbackModel: config.museFallbackModel } : {}),
      });
    case 'echo':
      return new EchoProvider();
    default: {
      const unreachable: never = config.kind;
      throw new Error(`unknown provider kind: ${String(unreachable)}`);
    }
  }
}

export type { EchoProviderOptions } from './echo-provider.js';
export { EchoProvider } from './echo-provider.js';
export { ProviderError } from './errors.js';
export type { MuseCliProviderOptions, MuseReasoningEffort } from './muse-cli-provider.js';
export {
  formatPrompt,
  MUSE_DEFAULT_MODEL,
  MUSE_DEFAULT_REASONING_EFFORT,
  MUSE_MODELS,
  MUSE_REASONING_EFFORTS,
  MuseCliProvider,
} from './muse-cli-provider.js';
