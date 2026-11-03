// Shared narrowing helper for test fixtures (B-7).
// biome's noNonNullAssertion bans `!`-free-of-argument style in this repo's
// lint config, and an explicit check names the missing fixture in the error -
// strictly better than "Cannot read properties of undefined" mid-assertion.
export function defined<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`fixture missing: ${what}`);
  return value;
}
