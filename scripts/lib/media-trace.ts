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
import { readFileSync, statSync } from 'node:fs';

export interface MediaTraceEntry {
  attempt: number;
  path?: string;
  model?: string;
  outcome?: string;
  status?: number;
  /**
   * A line carried the `[media-trace]` tag but could not be parsed: no usable
   * attempt number, or neither a path nor an outcome (a truncated write). Such a
   * line used to be dropped silently, which made a damaged ledger look clean — an
   * image ledger with a truncated line appended still reported "no issues".
   * A gate may not read a corrupted ledger as evidence of anything, so these
   * lines are kept and reported. Ordinary log output without the tag is still
   * ignored: that is not a trace line, damaged or otherwise.
   */
  malformed?: string;
}

/** Parse trace lines from a log body; non-trace lines are ignored. */
export function parseMediaTrace(text: string): MediaTraceEntry[] {
  const entries: MediaTraceEntry[] = [];
  for (const line of text.split('\n')) {
    if (!line.includes(TRACE_TAG)) continue;
    entries.push(parseTraceLine(line));
  }
  return entries;
}

/** The tag that makes a line part of the ledger. */
const TRACE_TAG = '[media-trace]';

/**
 * Fields the adapter writes, and nothing else. A ledger reader that invents no
 * limits reads a damaged line as a clean one: `attempt=1broken` used to parse as
 * attempt 1, and `outcome=nonsense status=200garbage` completed an expected paid
 * dispatch. So every token is validated whole, an unknown key is damage rather
 * than something to skip past, and the shapes below are what the writer emits.
 */
const TRACE_KEYS = ['attempt', 'path', 'model', 'outcome', 'status', 'bytes', 'events'] as const;
const TRACE_OUTCOMES = ['response', 'error'] as const;
const TRACE_KEY_TOKEN = /^([a-z][a-z0-9]*)=(\S+)$/;

function damaged(line: string): MediaTraceEntry {
  return { attempt: 0, malformed: line.trim().slice(0, 200) };
}

function parseTraceLine(line: string): MediaTraceEntry {
  // A pino JSON wrapper puts the message inside a string; read the message, not
  // the JSON punctuation, so a wrapped log does not look damaged.
  const wrapped = /"msg":"((?:[^"\\]|\\.)*)"/.exec(line);
  const unwrapped = line.slice(line.indexOf(TRACE_TAG) + TRACE_TAG.length);
  // A JSON-wrapped message carries the tag inside the string, so strip it from
  // whichever body was chosen: the fields follow it in both shapes.
  const raw = wrapped?.[1] ?? unwrapped;
  const body = raw.startsWith(TRACE_TAG) ? raw.slice(TRACE_TAG.length) : raw;

  /*
   * `error=` carries human text, which may contain spaces. Splitting it off first
   * is what lets every remaining token be validated whole instead of hoping.
   */
  const errorAt = body.search(/(?:^|\s)error=/);
  const head = errorAt === -1 ? body : body.slice(0, errorAt);
  const hasErrorText = errorAt !== -1;

  const fields = new Map<string, string>();
  for (const token of head.trim().split(/\s+/).filter(Boolean)) {
    const match = TRACE_KEY_TOKEN.exec(token);
    if (match === null) return damaged(line); // free text where a field belongs
    const key = match[1] ?? '';
    if (!(TRACE_KEYS as readonly string[]).includes(key)) return damaged(line);
    if (fields.has(key)) return damaged(line); // same field twice: which one is the ledger?
    fields.set(key, match[2] ?? '');
  }

  const attemptText = fields.get('attempt');
  if (attemptText === undefined || !/^\d+$/.test(attemptText)) return damaged(line);
  const attempt = Number(attemptText);
  if (attempt < 1) return damaged(line);

  const outcome = fields.get('outcome');
  if (outcome !== undefined && !(TRACE_OUTCOMES as readonly string[]).includes(outcome)) {
    return damaged(line);
  }
  const path = fields.get('path');
  if (path !== undefined && !path.startsWith('/')) return damaged(line);
  const statusText = fields.get('status');
  if (statusText !== undefined && !/^[1-5]\d{2}$/.test(statusText)) return damaged(line);
  for (const key of ['bytes', 'events'] as const) {
    const value = fields.get(key);
    if (value !== undefined && !/^\d+$/.test(value)) return damaged(line);
  }
  if (fields.get('model') !== undefined && fields.get('attempt') === undefined) {
    return damaged(line);
  }
  if (path === undefined && outcome === undefined) return damaged(line);
  // An outcome line that does not carry the fields that make it an outcome is a
  // truncated write, not a clean record: an answer cannot be inferred from it.
  if (outcome === 'response' && (statusText === undefined || fields.get('bytes') === undefined)) {
    return damaged(line);
  }
  if (outcome === 'error' && !hasErrorText) return damaged(line);

  const entry: MediaTraceEntry = { attempt };
  if (path !== undefined) entry.path = path;
  const model = fields.get('model');
  if (model !== undefined) entry.model = model;
  if (outcome !== undefined) entry.outcome = outcome;
  if (statusText !== undefined) entry.status = Number(statusText);
  return entry;
}

/** Read and parse a trace log. Missing/unreadable logs are an empty trace. */
export function readMediaTrace(logPath: string): MediaTraceEntry[] {
  try {
    return parseMediaTrace(readFileSync(logPath, 'utf8'));
  } catch {
    return [];
  }
}

export interface LedgerEvidence {
  readonly logPresent: boolean;
  readonly logBytes: number;
  readonly note: string;
}

/**
 * Whether a ledger claim is backed by a log at all.
 *
 * `readMediaTrace` returns an empty trace when the file is missing, which is the right
 * tolerance for an optional log and the wrong one for a gate. A fixtures-only run that
 * never started a server reported `ledger_issues: []` and `dispatch_ledger: []` beside
 * evidence that contained no server log: "the ledger is clean and empty" was true of an
 * empty string, not of a run. Every ledger claim now records what it actually read, so a
 * reader can tell "no dispatches were logged" from "nothing was logged".
 */
export function ledgerEvidence(logPath: string): LedgerEvidence {
  try {
    const bytes = statSync(logPath).size;
    return { logPresent: true, logBytes: bytes, note: `trace log read: ${String(bytes)} bytes` };
  } catch {
    return {
      logPresent: false,
      logBytes: 0,
      note: 'no trace log at this path: an empty ledger here means nothing was read, not that no call was made',
    };
  }
}

/**
 * Count provider dispatches for a model needle by counting **start lines**
 * (a start line is the one that carries both `path` and `model`).
 *
 * Counting distinct attempt *numbers* was wrong: attempt numbering restarts per
 * operation, so two independent calls that each made their first attempt —
 * exactly what a zero-retry run looks like — collapsed into one. That let a run
 * that paid twice claim it paid once.
 */
export function countModelAttempts(entries: MediaTraceEntry[], modelNeedle: string): number {
  // A start line is the one that names the model and carries no outcome; outcome
  // lines answer a start and must not be counted a second time.
  return entries.filter(
    (entry) => entry.outcome === undefined && entry.model?.includes(modelNeedle) === true,
  ).length;
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
  /** Tagged lines that could not be parsed: the ledger itself is damaged. */
  malformedLines: string[];
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
  const malformedLines: string[] = [];
  for (const entry of entries) {
    if (entry.malformed !== undefined) {
      malformedLines.push(entry.malformed);
      continue;
    }
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
    malformedLines,
  };
}

/**
 * Paths the ledger shows that this run was never allowed to touch.
 *
 * A gate that lists only the paths it *expected* to forbid lets a new paid path
 * through: an image-only run that also dispatched `/v1/files` looked clean because
 * `/v1/files` was not on the forbidden list. The honest rule is the inverse —
 * every path in the ledger must be on the allowlist for this scope.
 */
export function pathsOutside(ledger: DispatchAccount, allowed: readonly string[]): string[] {
  return [
    ...new Set(ledger.dispatches.filter((d) => !allowed.includes(d.path)).map((d) => d.path)),
  ];
}

/**
 * Reasons this ledger cannot support an exact paid-call claim.
 *
 * "Exactly one dispatch" is only meaningful when every start line was answered and
 * every outcome line belongs to a start line. A start with no outcome means the
 * transport died mid-call and the number of paid calls is unknown; an outcome with
 * no start means something answered a call this run cannot attribute. Both must
 * fail the run rather than be reported as an observation.
 */
export function ledgerIntegrityIssues(ledger: DispatchAccount, capability: string): string[] {
  const issues: string[] = [];
  if (ledger.unanswered.length > 0) {
    issues.push(
      `${capability}: ${String(ledger.unanswered.length)} dispatch(es) started and were never answered (${ledger.unanswered
        .map((d) => `${d.path} attempt=${String(d.attempt)}`)
        .join(', ')}) — how many calls were paid is unknown`,
    );
  }
  if (ledger.unpairedOutcomes.length > 0) {
    issues.push(
      `${capability}: ${String(ledger.unpairedOutcomes.length)} outcome line(s) answer no dispatch this run started (${ledger.unpairedOutcomes
        .map((o) => `outcome=${o.outcome ?? '?'} attempt=${String(o.attempt)}`)
        .join(', ')}) — the ledger is not attributable`,
    );
  }
  if (ledger.malformedLines.length > 0) {
    issues.push(
      `${capability}: ${String(ledger.malformedLines.length)} tagged [media-trace] line(s) could not be parsed (${ledger.malformedLines
        .slice(0, 3)
        .map((line) => JSON.stringify(line.slice(0, 60)))
        .join(', ')}) — the ledger is damaged, so no call count read from it can be trusted`,
    );
  }
  const retried = ledger.dispatches.filter((d) => d.attempt > 1);
  if (retried.length > 0) {
    issues.push(
      `${capability}: ${String(retried.length)} dispatch(es) at attempt beyond 1 — a transport retry happened`,
    );
  }
  return issues;
}
