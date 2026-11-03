import { describe, expect, it } from 'vitest';
import { checkCountIssues, duplicateCheckNames } from '../../scripts/lib/gate-check-count.js';

/*
 * The defect this guards against happened: a `check(...)` call was deleted while
 * `verify:studio-workflow` was being edited, the printed total did not move because a
 * new check had just been added elsewhere, and the run still reported PASS. The count
 * was the claim, and nothing was checking the count.
 */
describe('a gate whose headline is a count', () => {
  const required = ['the approval rail discloses what these bytes fetch'];

  it('fails when a named claim stops being measured, even at the same total', () => {
    const before = ['alpha', 'beta', required[0] as string, 'delta'];
    const after = ['alpha', 'beta', 'gamma', 'delta'];
    expect(checkCountIssues({ measured: before, min: 4, required })).toEqual([]);
    // Same length, one fewer real claim: the count alone cannot see this.
    const issues = checkCountIssues({ measured: after, min: 4, required });
    expect(issues.join(' ')).toContain('never reported the check named');
    expect(issues.join(' ')).toContain(required[0] as string);
  });

  it('reports a shortfall below the floor rather than accepting a smaller run', () => {
    const issues = checkCountIssues({ measured: ['alpha'], min: 3, required: [] });
    expect(issues.join(' ')).toContain('1 check(s) measured, below the 3');
  });

  it('does not treat a larger conditional run as damage', () => {
    const wide = Array.from({ length: 60 }, (_unused, index) => `check ${String(index)}`);
    expect(checkCountIssues({ measured: wide, min: 55, required: [] })).toEqual([]);
  });

  it('names a check counted twice, because a padded total is the same defect upside down', () => {
    const labels = ['alpha', 'beta', 'alpha', 'gamma', 'beta'];
    expect(duplicateCheckNames(labels)).toEqual(['alpha', 'beta']);
    const issues = checkCountIssues({
      measured: labels,
      min: 4,
      required: ['alpha'],
      duplicates: duplicateCheckNames(labels),
    });
    expect(issues.join(' ')).toContain('reported more than once');
  });
});
