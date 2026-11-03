import { BrowserUnavailableError } from './browser.js';

/**
 * What a verification gate decided about its own run.
 *
 * The distinction is not cosmetic. A gate that exits 1 for "this machine has no
 * Chromium" and exits 1 for "the product refused to stage the artifact" looks
 * identical in CI, in the exit code, and — for the three browser gates until
 * now — in the evidence file. An operator then re-runs a run that cannot pass on
 * that machine, and a reader of the evidence cannot tell a blocked prerequisite
 * from a measured defect without reading the log.
 *
 * Exit codes follow the discipline the paid gates already use: 0 passed, 1
 * measured failure, 2 refused before measuring anything.
 */
export type GateOutcome =
  | { kind: 'pass'; exitCode: 0 }
  | { kind: 'blocked'; reason: string; exitCode: 2 }
  | { kind: 'failed'; reason: string; exitCode: 1 };

/** Refusals a gate raises on purpose: named prerequisite, not a measurement. */
export class PrerequisiteRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrerequisiteRefusal';
  }
}

function reasonOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** A gate that reached its last line. Gates name it so the pass case has a value. */
export const GATE_PASS = { kind: 'pass', exitCode: 0 } as const;

/**
 * Classify what ended a gate run, given that it ended badly.
 *
 * A missing browser is a prerequisite: the gate measured nothing, and no re-run
 * on the same machine will measure anything either. A refusal raised through
 * `PrerequisiteRefusal` is the same case. Everything else is a finding about the
 * code under test — and the type says so, so a gate cannot read `reason` off a
 * run it has not concluded failed or blocked.
 */
export type GateFailure =
  | { kind: 'blocked'; reason: string; exitCode: 2 }
  | { kind: 'failed'; reason: string; exitCode: 1 };

export function classifyGateFailure(error: unknown): GateFailure {
  if (error instanceof BrowserUnavailableError) {
    return { kind: 'blocked', reason: reasonOf(error), exitCode: 2 };
  }
  if (error instanceof PrerequisiteRefusal) {
    return { kind: 'blocked', reason: reasonOf(error), exitCode: 2 };
  }
  return { kind: 'failed', reason: reasonOf(error), exitCode: 1 };
}

/** One line an operator can act on, printed before any stack. */
export function describeGateOutcome(outcome: GateOutcome): string {
  if (outcome.kind === 'pass') return 'PASS';
  if (outcome.kind === 'blocked') return `BLOCKED before measuring anything: ${outcome.reason}`;
  return `FAILED before completion: ${outcome.reason}`;
}
