import { type DispatchAccount, ledgerIntegrityIssues, pathsOutside } from './media-trace';

/**
 * What one live Batch C run is allowed to cost, read from its own trace.
 *
 * The other live gates (Batch D clip/transcription, Batch B image, Batch E review) got
 * whole-run path budgets when KI-55 items 9-12 were closed, and this gate was left out —
 * the exact mistake the finding was about, since a budget copied gate by gate is only as
 * wide as the gate someone remembered. Batch C is the most expensive paid gate in the
 * repository, so the omission matters most here.
 *
 * Two facts shape the rule:
 * - Vision and SAM share `/v1/responses`, so paths alone cannot tell them apart. The
 *   per-capability counts have to match the model each start line named.
 * - Coding runs through the Muse CLI, which never writes a media-trace line. A media
 *   path in this ledger is therefore always an *extra* media call, never the coding job.
 */
export const BATCHC_ALLOWED_PATHS: readonly string[] = ['/v1/responses'];

/**
 * The model ids the running server reported configuring.
 *
 * Classification used to be a substring test (`muse-spark`, `sam-`), which left a hole a
 * probe walked straight through: a complete, answered third dispatch on
 * `unbudgeted-paid-model` sat inside the one allowed path, matched neither category, and
 * reported **no issues** — the run passed while paying for a model nothing authorised.
 * Substrings cannot say "every dispatch belongs to exactly one authorised category",
 * because a model outside both substrings simply goes uncounted. So the ids come from
 * `/api/meta` and matching is exact: an unmatched model is a violation, not a gap.
 */
export interface BatchCModelIds {
  vision: string | null;
  sam: string | null;
}

/** Dispatches each scope authorises. Resume modes spend less, never more. */
export function batchcExpectedCalls(scope: string): { vision: number; sam: number } {
  switch (scope) {
    case 'vision-only':
      return { vision: 1, sam: 0 };
    case 'resume':
      // Vision evidence is retained: only SAM is paid for.
      return { vision: 0, sam: 1 };
    case 'resume-cutout':
      // Vision and the cutout are both retained: only coding runs, outside this ledger.
      return { vision: 0, sam: 0 };
    default:
      return { vision: 1, sam: 1 };
  }
}

function startsWithModel(ledger: DispatchAccount, model: string): number {
  return ledger.dispatches.filter((dispatch) => dispatch.model === model).length;
}

function describeModel(model: string | undefined): string {
  // `(none)` is the adapter's marker for "nothing in this request named the
  // dispatch", not a model name. Treating it as one would let an unattributable
  // paid call satisfy a per-model budget.
  if (model === undefined || model.length === 0 || model === '(none)') return '(no model named)';
  return model;
}

/** Reasons this Batch C ledger cannot support its paid-call claim. */
export function batchcLedgerIssues(
  ledger: DispatchAccount,
  expected: { vision: number; sam: number },
  models: BatchCModelIds,
): string[] {
  const issues = ledgerIntegrityIssues(ledger, 'Batch C run');
  const outside = pathsOutside(ledger, BATCHC_ALLOWED_PATHS);
  if (outside.length > 0) {
    issues.push(
      `Batch C run dispatched paths it was never allowed to touch: ${outside.join(', ')} — coding never appears in this ledger, so any extra media path is an extra paid media call`,
    );
  }
  if (models.vision === null || models.sam === null) {
    issues.push(
      `the configured vision/SAM model ids were never read from /api/meta (vision=${String(models.vision)}, sam=${String(models.sam)}), so dispatches on ${BATCHC_ALLOWED_PATHS.join(', ')} cannot be attributed to a category and no exact-call claim is possible`,
    );
    return issues;
  }
  if (models.vision === models.sam) {
    issues.push(
      `the configured vision and SAM model ids are identical (${models.vision}), so no dispatch on ${BATCHC_ALLOWED_PATHS.join(', ')} can be attributed to exactly one category`,
    );
    return issues;
  }
  const vision = startsWithModel(ledger, models.vision);
  const sam = startsWithModel(ledger, models.sam);
  // Every dispatch must belong to exactly one authorised category. This is the
  // rule the substring version could not express: it counted what it recognised
  // and stayed silent about the rest.
  const unclassified = ledger.dispatches.filter(
    (dispatch) => dispatch.model !== models.vision && dispatch.model !== models.sam,
  );
  if (unclassified.length > 0) {
    issues.push(
      `${String(unclassified.length)} dispatch(es) named a model this run authorises neither: ${unclassified
        .map((dispatch) => `${describeModel(dispatch.model)} on ${dispatch.path}`)
        .join(', ')} — the authorised ids are ${models.vision} (vision) and ${models.sam} (SAM)`,
    );
  }
  if (vision !== expected.vision) {
    issues.push(
      `expected ${String(expected.vision)} vision dispatch(es) on model ${models.vision}, saw ${String(vision)}`,
    );
  }
  if (sam !== expected.sam) {
    issues.push(
      `expected ${String(expected.sam)} SAM dispatch(es) on model ${models.sam}, saw ${String(sam)}`,
    );
  }
  const total = expected.vision + expected.sam;
  if (ledger.dispatches.length !== total) {
    issues.push(
      `the scope authorises ${String(total)} dispatch(es) in total, and the ledger shows ${String(ledger.dispatches.length)}`,
    );
  }
  return issues;
}
