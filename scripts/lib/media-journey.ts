/**
 * Policies for the media journey gate (`scripts/verify-media-journey.ts`).
 *
 * The journey itself is the product flow — approved image asset → placeholder in staged
 * HTML → embedded bytes in an approved version → restart byte-identity → modify → rollback
 * with the embedded bytes returning. What this module decides is only **how the journey is
 * paid for**, and what the ledger has to prove in each case:
 *
 * - `live`: the asset comes from the paid image provider, so the ledger must show exactly
 *   one generate and one edit dispatch and nothing else.
 * - `upload`: the asset comes from bytes the harness uploads itself, so the ledger must be
 *   **empty**, and the fake coding CLI is the only code generator. An offline journey that
 *   dispatched anything is not offline.
 *
 * Kept separate from the script so the rules can be tested against real-shaped trace lines.
 */
import { type DispatchAccount, ledgerIntegrityIssues, pathsOutside } from './media-trace.js';

export type JourneyAssetSource = 'live' | 'upload';

export const JOURNEY_ASSET_SOURCES: readonly JourneyAssetSource[] = ['live', 'upload'];

/** The only paid paths a media journey may take, whichever mode it runs in. */
export const JOURNEY_ALLOWED_PATHS: readonly string[] = [
  '/v1/images/generations',
  '/v1/images/edits',
];

export const JOURNEY_ENV_NAME = 'MEDIA_JOURNEY_ASSET_SOURCE';

/**
 * Read the requested asset source without guessing.
 *
 * A typo used to fall back to `live`, which then spent two paid image calls on a run the
 * operator meant to run for free. An unknown name is refused before any prerequisite,
 * credential read, port reservation, or dispatch happens.
 */
export function parseAssetSource(value: string | undefined | null): {
  source: JourneyAssetSource;
  requested: string;
  source_of_truth: 'env' | 'default';
  issues: string[];
} {
  const raw = value ?? '';
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return {
      source: 'live',
      requested: '',
      source_of_truth: 'default',
      issues: [],
    };
  }
  const matches = JOURNEY_ASSET_SOURCES.filter((name) => name === trimmed);
  if (matches.length === 1) {
    return {
      source: matches[0] as JourneyAssetSource,
      requested: trimmed,
      source_of_truth: 'env',
      issues: [],
    };
  }
  return {
    source: 'live',
    requested: trimmed,
    source_of_truth: 'env',
    issues: [
      `${JOURNEY_ENV_NAME}=${JSON.stringify(raw)} is not one of ${JOURNEY_ASSET_SOURCES.join(' | ')} — ` +
        'this gate will not guess which rail to pay for',
    ],
  };
}

/** What the ledger must look like for the mode the journey is claiming. */
export function journeyLedgerIssues(ledger: DispatchAccount, source: JourneyAssetSource): string[] {
  const issues: string[] = [];
  if (source === 'upload') {
    if (ledger.dispatches.length !== 0) {
      const seen = ledger.dispatches
        .map((dispatch) => `${dispatch.path} (attempt ${String(dispatch.attempt)})`)
        .join(', ');
      issues.push(
        `the offline (uploaded-asset) journey dispatched ${String(ledger.dispatches.length)} ` +
          `provider call(s): ${seen} — nothing in this mode should reach a provider`,
      );
    }
    return issues;
  }

  issues.push(...pathsOutside(ledger, JOURNEY_ALLOWED_PATHS));
  for (const path of JOURNEY_ALLOWED_PATHS) {
    const count = ledger.dispatches.filter((dispatch) => dispatch.path === path).length;
    if (count !== 1) {
      issues.push(
        `expected exactly 1 dispatch on ${path} for a live media journey, saw ${String(count)}`,
      );
    }
  }
  // Retries are part of ledger integrity: an attempt beyond 1 is a paid call
  // nobody budgeted for, and it must fail the run rather than be reported.
  issues.push(...ledgerIntegrityIssues(ledger, 'live media journey'));
  return issues;
}

/**
 * The uploaded stand-in for live image bytes, and the honest label it carries.
 *
 * The offline journey proves the *flow* on bytes the harness supplied. It does not prove
 * that provider-returned bytes flow through it; the retained live runs do. Both labels go
 * into the report so a reader cannot mistake one for the other.
 */
export function assetProvenance(source: JourneyAssetSource): {
  asset_source: JourneyAssetSource;
  asset_provenance: string;
} {
  return source === 'upload'
    ? {
        asset_source: 'upload',
        asset_provenance:
          'uploaded local PNG bytes: proves the asset→embed→restart→rollback flow, not that provider bytes flow through it',
      }
    : {
        asset_source: 'live',
        asset_provenance: 'bytes returned by the live image provider (paid generate + edit)',
      };
}
