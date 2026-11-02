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
export const BATCHC_VISION_MODEL = 'muse-spark';
export const BATCHC_SAM_MODEL = 'sam-';

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

function modelStarts(ledger: DispatchAccount, modelNeedle: string): number {
  return ledger.dispatches.filter((d) => d.model?.includes(modelNeedle) === true).length;
}

/** Reasons this Batch C ledger cannot support its paid-call claim. */
export function batchcLedgerIssues(
  ledger: DispatchAccount,
  expected: { vision: number; sam: number },
): string[] {
  const issues = ledgerIntegrityIssues(ledger, 'Batch C run');
  const outside = pathsOutside(ledger, BATCHC_ALLOWED_PATHS);
  if (outside.length > 0) {
    issues.push(
      `Batch C run dispatched paths it was never allowed to touch: ${outside.join(', ')} — coding never appears in this ledger, so any extra media path is an extra paid media call`,
    );
  }
  const vision = modelStarts(ledger, BATCHC_VISION_MODEL);
  const sam = modelStarts(ledger, BATCHC_SAM_MODEL);
  if (vision !== expected.vision) {
    issues.push(
      `expected ${String(expected.vision)} vision dispatch(es) on model ${BATCHC_VISION_MODEL}, saw ${String(vision)}`,
    );
  }
  if (sam !== expected.sam) {
    issues.push(
      `expected ${String(expected.sam)} SAM dispatch(es) on model ${BATCHC_SAM_MODEL}, saw ${String(sam)}`,
    );
  }
  return issues;
}
