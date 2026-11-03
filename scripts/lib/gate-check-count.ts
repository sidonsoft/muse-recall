/**
 * A guard for gates whose headline result is a count.
 *
 * `verify:studio-workflow` prints "N checks passed", and that number was the only
 * thing standing between a named claim in the release documents and that claim going
 * unmeasured: while the file was being edited, one `check(...)` call was deleted, the
 * total stayed identical because another had just been added, and every assertion still
 * passed. A count nobody pins is a count that can shrink to mean less.
 *
 * So the gate pins two things: a floor the run must clear, and the names of the checks
 * the documents repeat. The floor is a minimum rather than an equality because some
 * checks are conditional on the artifact and legitimately vary; a shortfall below it is
 * reported as a missing check rather than accepted as a smaller run.
 */
export interface CheckCountInput {
  /** Labels of every check this run actually reached, in order. */
  readonly measured: readonly string[];
  /** The fewest checks a real run of this gate is expected to reach. */
  readonly min: number;
  /** Claims the release documents make in prose, which must stay measured. */
  readonly required: readonly string[];
  /** Duplicate labels: two checks reporting one name, or one name counted twice. */
  readonly duplicates?: readonly string[];
}

export function checkCountIssues(input: CheckCountInput): string[] {
  const issues: string[] = [];
  const seen = new Set(input.measured);
  if (input.measured.length < input.min) {
    issues.push(
      `${String(input.measured.length)} check(s) measured, below the ${String(input.min)} this gate is expected to reach — a check went missing, and a count nobody pins is a count that can quietly shrink`,
    );
  }
  for (const name of input.required) {
    if (!seen.has(name)) {
      issues.push(
        `the run never reported the check named "${name}", so its claim is no longer measured`,
      );
    }
  }
  for (const name of input.duplicates ?? []) {
    issues.push(
      `the check name "${name}" was reported more than once, so the total double-counts it`,
    );
  }
  return issues;
}

/** The names reported more than once, in first-duplicate order. */
export function duplicateCheckNames(labels: readonly string[]): string[] {
  const seen = new Set<string>();
  const twice: string[] = [];
  for (const label of labels) {
    if (seen.has(label) && !twice.includes(label)) twice.push(label);
    seen.add(label);
  }
  return twice;
}
