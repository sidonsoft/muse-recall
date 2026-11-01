/**
 * Build identity baked into the production bundle at build time.
 *
 * The production build passes `--define:__BUILD_IDENTITY__='<json>'` with
 * the source commit and content hash; esbuild replaces the identifier
 * with the literal. Bundles built without the define (tsx/dev) report
 * null, and acceptance harnesses must fail closed on a null identity.
 */
export interface BuildIdentity {
  commit: string;
  source_hash: string;
  built_at: string;
}

declare const __BUILD_IDENTITY__: string | undefined;

function isBuildIdentity(value: unknown): value is BuildIdentity {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.commit === 'string' &&
    typeof record.source_hash === 'string' &&
    typeof record.built_at === 'string'
  );
}

/** Identity baked into this bundle, or null when built without one. */
export function buildIdentity(): BuildIdentity | null {
  try {
    if (typeof __BUILD_IDENTITY__ === 'undefined') return null;
    const parsed: unknown = JSON.parse(__BUILD_IDENTITY__);
    return isBuildIdentity(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
