/**
 * FTS5 query construction.
 *
 * User input is never interpolated into a MATCH expression. Tokens are
 * extracted and each is double-quoted, so characters that FTS5 treats as
 * operators (`"`, `*`, `-`, `:`, `NEAR`, `OR`, …) become literal text. This is
 * both a correctness fix (arbitrary input would otherwise raise SQL errors)
 * and a defence: a search box cannot be used to reshape the query.
 */

/** Cap the token count so a pathological query cannot become expensive. */
const MAX_TOKENS = 12;

export function tokenizeSearchText(text: string): string[] {
  const matches = text.toLowerCase().match(/[\p{L}\p{N}_]+/gu);
  if (!matches) return [];
  return matches.slice(0, MAX_TOKENS);
}

/**
 * Build a safe FTS5 MATCH expression: every token required (`AND`), each
 * quoted. Returns `null` when the text contains no searchable tokens, which
 * callers must treat as "no text filter".
 */
export function toFtsQuery(text: string): string | null {
  const tokens = tokenizeSearchText(text);
  if (tokens.length === 0) return null;
  return tokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(' AND ');
}
