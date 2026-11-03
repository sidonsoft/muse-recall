/**
 * The Phase 17 comparison helper, held here so the research test can exercise
 * the math without importing a protocol-locked script.
 *
 * scripts/verify-phase17-strict.ts keeps its own copy: its bytes are hashed by
 * the locked protocol chain, so it cannot import anything. The drift guard in
 * phase17-evidence.test.ts compares the two copies text by text, so neither can
 * change the comparison without the other failing.
 */

/**
 * Relative-only comparison: no absolute floor, so a value of 0 never matches a
 * tiny expected probability, and 1e-24 is judged to the same precision as 0.5.
 */
export function closeRelative(actual: number, expected: number, rel = 1e-9): boolean {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
  if (expected === 0) return actual === 0;
  return Math.abs(actual - expected) <= Math.abs(expected) * rel;
}
