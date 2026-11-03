/**
 * The dependency disclosure in the approval interface (KI-74).
 *
 * The wording lives here, pinned, for two reasons. First, the decision a person
 * is making is a decision about words: "this artifact loads its engine from a
 * host that has to answer" has to be said the same way every time, or the next
 * reviewer reads a different warning. Second, a server `note` is a *fact* about
 * bytes ("version outside the pin"); the sentence a human acts on belongs to the
 * interface and is testable here.
 *
 * What is deliberately not here: any judgement. Whether a remote dependency is
 * acceptable is the reviewer's call — the product vendored what it could and
 * refuses to swap an engine silently, so the panel states the situation and the
 * options, not a verdict.
 */
import type { ForgeDependency, ForgeDependencyDisclosure } from '@mml/shared';

/** One line in the disclosure: what it is, and the sentence that explains it. */
export type DependencyRowView = {
  /** Which of the three cases this row is; drives the class and the tests. */
  kind: ForgeDependency['status'];
  /** Status label, from the pinned set below. */
  status: string;
  /** The library and version, or the URL when the reference does not name one. */
  subject: string;
  /** The approved sentence for this case. */
  explanation: string;
  /** Where it comes from: the origin it would contact, or the pin it carries. */
  source: string;
};

export type DependencyView = {
  /** One-line summary of what these bytes do, in the pinned wording. */
  summary: string;
  /** What the verification network policy allowed. */
  policy: string;
  rows: DependencyRowView[];
  /** Anything the rows cannot say on their own. */
  notes: string[];
};

/**
 * No disclosure was recorded. That is a real state, not an empty one: versions
 * approved before this field existed have no record, and reconstructing one from
 * the file would present bytes the approver never saw as what they approved.
 */
export const NOT_RECORDED_SUMMARY =
  'No dependency record was kept for these bytes — they were approved before dependency disclosure existed.';

export const NO_DEPENDENCIES_SUMMARY =
  'No remote reference was found in these bytes: nothing in them asks another host to load something.';

export const SELF_CONTAINED_SUMMARY =
  'These bytes carry their own libraries, and no remote reference was found in them.';

/**
 * Rendered when a stored record predates `scan_limits`. Silence here would be the
 * worst reading of all: the reader would take an empty list as proof that nothing
 * was fetched, when all it proves is that no reference was found by a scan.
 */
export const UNKNOWN_SCAN_LIMITS =
  'this record does not state what its reading cannot see, so treat an empty list as "no remote ' +
  'reference found", never as "nothing was fetched"';

/** Pinned status labels. */
export const STATUS_LABELS = {
  bundled: 'Carried inside these bytes',
  fetched: 'Loaded from a remote host',
  blocked: 'Refused by the verification policy',
} as const;

/**
 * The sentence KI-74 approved for the remote-dependency case. It names the host,
 * says what approving assumes, and says what the alternative is — so the reviewer
 * is not left guessing whether "Fetched at run time" is a warning or a fact of
 * life.
 */
export const REMOTE_ENGINE_WARNING = (origin: string | null): string =>
  `this artifact loads its engine from ${origin ?? 'a remote host'}; approve it knowing that ` +
  'host must answer when the artifact runs, or ask for a change to the pinned reference';

function subject(dependency: ForgeDependency): string {
  if (dependency.library && dependency.version)
    return `${dependency.library} ${dependency.version}`;
  if (dependency.library) return dependency.library;
  return dependency.url;
}

function source(dependency: ForgeDependency): string {
  if (dependency.status === 'bundled') {
    const digest = dependency.sha256
      ? `pinned sha256 ${dependency.sha256.slice(0, 12)}…`
      : 'pinned copy';
    return `${digest}, ${String(dependency.bytes)} bytes, in place of ${dependency.url}`;
  }
  return dependency.origin ?? dependency.url;
}

/** The approved sentence for one row, chosen by the machine-readable reason. */
function explanation(dependency: ForgeDependency): string {
  switch (dependency.reason) {
    case 'bundled_pinned_copy':
      return (
        `this product carries its own pinned copy of ${subject(dependency)} in place of the ` +
        'remote reference'
      );
    case 'version_outside_pin':
      return `${REMOTE_ENGINE_WARNING(dependency.origin)}. ${dependency.note}.`;
    case 'tag_form_not_replaced':
      return `${REMOTE_ENGINE_WARNING(dependency.origin)}. It was left remote because ${dependency.note}.`;
    case 'vendored_copy_and_remote_copy':
      return `these bytes carry a pinned copy and still reference the remote one; the copy is what loads, but the remote reference is still in the file`;
    case 'requested_by_application_code':
      /*
       * Found by reading code text, not by a reference the browser loads. The
       * same characters in a comment or a string literal produce this row and
       * produce no request at all (measured), so the sentence says where the URL
       * was found rather than claiming the application asks for it.
       */
      return (
        "this URL appears as a literal in the application's code text rather than in a tag; " +
        'whether that line ever runs is not something a reading of the file can settle'
      );
    case 'remote_asset':
    default:
      return `this application loads it from the remote host when it runs`;
  }
}

/**
 * Whether anything was *seen*, as opposed to what the rules predict. A static
 * reading can say a policy would refuse an origin; only the browser check can say
 * a request was attempted and refused. Conflating them is how "blocked during
 * verification" came to be reported for text the browser never asked for.
 */
function observationClause(dependency: ForgeDependency): string | null {
  if (dependency.status === 'bundled') return null;
  if (dependency.observed === true) {
    return 'the verification browser recorded a request for this origin being refused';
  }
  if (dependency.observed === false) {
    return 'no request for this origin was recorded during verification; this is what the policy in force does with it';
  }
  return 'no browser run was recorded against these bytes when this was written, so nothing here was observed either way';
}

/** One row per dependency, grouped bundled-then-remote by the server's order. */
export function dependencyView(
  disclosure: ForgeDependencyDisclosure | null | undefined,
): DependencyView {
  if (disclosure === null || disclosure === undefined) {
    return { summary: NOT_RECORDED_SUMMARY, policy: '', rows: [], notes: [] };
  }
  const notes: string[] = [];
  if (disclosure.pending_media_references > 0) {
    // Embedding an approved image changes the bytes but adds no network request,
    // so say that rather than let the count look like a dependency.
    notes.push(
      `${String(disclosure.pending_media_references)} approved image reference(s) in these bytes are ` +
        'embedded when the version is promoted; embedding adds bytes, not network requests.',
    );
  }
  if (
    disclosure.network_policy === 'vendored' &&
    disclosure.dependencies.some((row) => row.status !== 'bundled')
  ) {
    notes.push(
      'these bytes were verified with no remote origin at all, so any remote reference they still ' +
        'contain was refused during verification and would have to be reached when the artifact runs',
    );
  }
  if (disclosure.dependencies.some((row) => row.basis === 'code_text')) {
    notes.push(
      'one or more rows above were found by reading the application\u2019s code text, not by a ' +
        'reference the browser loads: a URL written in a comment or a string reads the same here',
    );
  }
  /*
   * The server states what this reading cannot see. It is rendered always rather
   * than only when a row looks doubtful, because the dangerous misreading is the
   * empty list: "no dependencies" is a finding about a scan, not a record of what
   * the application did.
   */
  const limits = disclosure.scan_limits ?? [UNKNOWN_SCAN_LIMITS];
  if (limits.length > 0) {
    notes.push(`what this record cannot see: ${limits.join('; ')}.`);
  }
  return {
    summary:
      disclosure.dependencies.length === 0
        ? NO_DEPENDENCIES_SUMMARY
        : disclosure.self_contained
          ? SELF_CONTAINED_SUMMARY
          : 'These bytes fetch something outside themselves; the rows below name what and from where.',
    policy:
      disclosure.granted_origins.length === 0
        ? 'verification granted no remote origin'
        : disclosure.self_contained
          ? // The grant is what the policy allows, not what the document does. A
            // document that asks for nothing still ran under a policy that would
            // have allowed the approved CDN, and saying only "permitted: …" would
            // read as if something were fetched.
            `verification would have permitted ${disclosure.granted_origins.join(', ')}; these bytes reference nothing remote`
          : `verification permitted: ${disclosure.granted_origins.join(', ')}`,
    rows: disclosure.dependencies.map((dependency) => {
      const clause = observationClause(dependency);
      return {
        kind: dependency.status,
        status: STATUS_LABELS[dependency.status],
        subject: subject(dependency),
        explanation:
          clause === null ? explanation(dependency) : `${explanation(dependency)}. ${clause}.`,
        source: source(dependency),
      };
    }),
    notes,
  };
}

/** The disclosure for the version currently approved, or null when unrecorded. */
export function disclosureForVersion(
  versions: { version: number; dependencies?: ForgeDependencyDisclosure }[],
  version: number | null,
): ForgeDependencyDisclosure | null {
  if (version === null) return null;
  return versions.find((entry) => entry.version === version)?.dependencies ?? null;
}
