/**
 * Parse the bounded `[media-trace]` lines emitted by the media adapter when
 * FORGE_MEDIA_TRACE=1. Kept separate from the live-smoke script so the trace
 * reader and attempt counter can be tested without a provider or browser.
 *
 * Trace lines contain no credential values:
 *   [media-trace] attempt=1 path=/v1/responses model=muse-spark-1.3
 *   [media-trace] outcome=response attempt=1 status=200 bytes=123
 *   [media-trace] outcome=error attempt=1 error=...
 */
import { readFileSync } from 'node:fs';

export interface MediaTraceEntry {
  attempt: number;
  path?: string;
  model?: string;
  outcome?: string;
  status?: number;
}

/** Parse trace lines from a log body; non-trace lines are ignored. */
export function parseMediaTrace(text: string): MediaTraceEntry[] {
  const entries: MediaTraceEntry[] = [];
  for (const line of text.split('\n')) {
    if (!line.includes('[media-trace]')) continue;
    const attempt = /attempt=(\d+)/.exec(line)?.[1];
    if (attempt === undefined) continue;
    const entry: MediaTraceEntry = { attempt: Number(attempt) };
    const path = /path=(\S+)/.exec(line)?.[1];
    if (path !== undefined) entry.path = path;
    const model = /model=(\S+)/.exec(line)?.[1];
    if (model !== undefined) entry.model = model;
    const outcome = /outcome=(\S+)/.exec(line)?.[1];
    if (outcome !== undefined) entry.outcome = outcome;
    const status = /status=(\d+)/.exec(line)?.[1];
    if (status !== undefined) entry.status = Number(status);
    entries.push(entry);
  }
  return entries;
}

/** Read and parse a trace log. Missing/unreadable logs are an empty trace. */
export function readMediaTrace(logPath: string): MediaTraceEntry[] {
  try {
    return parseMediaTrace(readFileSync(logPath, 'utf8'));
  } catch {
    return [];
  }
}

/**
 * Count distinct provider dispatches for a model needle. Start lines carry the
 * model; each dispatch has one start line, so this counts attempts rather than
 * log lines. Outcome lines are deliberately not counted a second time.
 */
export function countModelAttempts(entries: MediaTraceEntry[], modelNeedle: string): number {
  const attempts = new Set(
    entries
      .filter((entry) => entry.model?.includes(modelNeedle) === true)
      .map((entry) => entry.attempt),
  );
  return attempts.size;
}

/**
 * Vision-only scope is a success only when exactly one vision submission has
 * occurred and SAM/coding are still untouched. Returns true when the caller
 * should stop after vision; throws (rather than silently continuing) when an
 * extra call has already happened.
 */
export function shouldStopAfterVisionOnly(
  visionOnly: boolean,
  calls: { sam: number; coding: number },
): boolean {
  if (!visionOnly) return false;
  if (calls.sam !== 0 || calls.coding !== 0) {
    throw new Error('vision-only scope made an extra SAM/coding call');
  }
  return true;
}

/**
 * Success path for a single-provider-attempt capability: both the response
 * metadata and the retained trace must prove exactly one dispatch. Throws
 * before acceptance can report success if either is missing or >1.
 */
export function assertSingleProviderAttempt(input: {
  capability: string;
  responseAttempts: number | undefined;
  traceAttempts: number;
}): void {
  if (input.responseAttempts !== 1) {
    throw new Error(
      `${input.capability} response provider_attempts=${String(input.responseAttempts)}; expected 1`,
    );
  }
  if (input.traceAttempts !== 1) {
    throw new Error(
      `${input.capability} trace provider attempts=${String(input.traceAttempts)}; expected 1`,
    );
  }
}

/** One provider dispatch: a start line paired with the outcome line it answers. */
export interface TracedDispatch {
  attempt: number;
  path: string;
  model?: string;
  outcome?: string;
  status?: number;
}

export interface DispatchAccount {
  /** Distinct dispatches, counted from start lines, never from log lines. */
  dispatches: TracedDispatch[];
  paths: string[];
  maxAttempt: number;
  /** Outcome lines with no start line to answer: the provider did something we cannot attribute. */
  unpairedOutcomes: MediaTraceEntry[];
  /** Start lines whose outcome never arrived: the transport died mid-call. */
  unanswered: TracedDispatch[];
}

/**
 * Pair trace lines into dispatches.
 *
 * A single call writes two lines: `attempt=1 path=… model=…` then
 * `outcome=response attempt=1 status=200 bytes=…`. Counting lines counted every
 * call twice and made the outcome line look like a dispatch on an unknown path,
 * so a live run that paid for exactly one permitted call reported a forbidden
 * path `(unattributed)`. Pairing by attempt number inside the slice fixes both,
 * and keeps the status visible as evidence.
 */
export function accountDispatches(entries: readonly MediaTraceEntry[]): DispatchAccount {
  const dispatches: TracedDispatch[] = [];
  const unpairedOutcomes: MediaTraceEntry[] = [];
  for (const entry of entries) {
    if (entry.path !== undefined) {
      dispatches.push({
        attempt: entry.attempt,
        path: entry.path,
        ...(entry.model === undefined ? {} : { model: entry.model }),
      });
      continue;
    }
    if (entry.outcome === undefined) continue;
    const open = dispatches.find(
      (dispatch) => dispatch.attempt === entry.attempt && dispatch.outcome === undefined,
    );
    if (open === undefined) {
      unpairedOutcomes.push(entry);
      continue;
    }
    open.outcome = entry.outcome;
    if (entry.status !== undefined) open.status = entry.status;
  }
  return {
    dispatches,
    paths: [...new Set(dispatches.map((dispatch) => dispatch.path))],
    maxAttempt: dispatches.reduce((max, dispatch) => Math.max(max, dispatch.attempt), 0),
    unpairedOutcomes,
    unanswered: dispatches.filter((dispatch) => dispatch.outcome === undefined),
  };
}
