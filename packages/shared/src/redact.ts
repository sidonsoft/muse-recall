/**
 * Credential redaction for diagnostics.
 *
 * Applied before text is logged, persisted, returned by the API, or rendered.
 * This reduces accidental exposure; it cannot prove that every possible secret
 * format has been removed.
 */

const MAX = 4_000;

const PATTERNS: { pattern: RegExp; replacement: string }[] = [
  { pattern: /\bLLM_[A-Za-z0-9_]{16,}\b/g, replacement: '[REDACTED:api-key]' },
  { pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g, replacement: '[REDACTED:api-key]' },
  { pattern: /\bghp_[A-Za-z0-9]{20,}\b/g, replacement: '[REDACTED:token]' },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, replacement: '[REDACTED:token]' },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: '[REDACTED:key]' },
  { pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi, replacement: 'Bearer [REDACTED]' },
  {
    pattern:
      /\b(api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*['"]?[A-Za-z0-9._~+/-]{8,}/gi,
    replacement: '$1=[REDACTED]',
  },
];

export interface RedactOptions {
  /** Exact credential values known to this process. */
  secrets?: (string | null | undefined)[];
  maxLength?: number;
}

export function redactSecrets(text: string, options: RedactOptions = {}): string {
  let output = text;
  for (const secret of options.secrets ?? []) {
    if (secret && secret.length >= 8) output = output.split(secret).join('[REDACTED:credential]');
  }
  for (const { pattern, replacement } of PATTERNS) {
    output = output.replace(pattern, replacement);
  }
  const limit = options.maxLength ?? MAX;
  return output.length > limit ? `${output.slice(0, limit)}… [truncated]` : output;
}
