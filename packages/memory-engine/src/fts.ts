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

/**
 * Words that carry no retrieval signal.
 *
 * Filtering these *before* the token cap matters: a long question used to spend
 * its whole twelve-token budget on "what / are / we / the" and silently drop
 * the nouns that would have found the memory.
 */
const STOPWORDS = new Set([
  'a',
  'about',
  'after',
  'all',
  'also',
  'am',
  'an',
  'and',
  'any',
  'are',
  'as',
  'at',
  'be',
  'been',
  'before',
  'being',
  'both',
  'but',
  'by',
  'can',
  'could',
  'did',
  'do',
  'does',
  'doing',
  'done',
  'down',
  'during',
  'each',
  'few',
  'for',
  'from',
  'further',
  'had',
  'has',
  'have',
  'having',
  'he',
  'her',
  'here',
  'hers',
  'him',
  'his',
  'how',
  'i',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'itself',
  'just',
  'me',
  'more',
  'most',
  'my',
  'no',
  'nor',
  'not',
  'now',
  'of',
  'off',
  'on',
  'once',
  'only',
  'or',
  'other',
  'our',
  'ours',
  'out',
  'over',
  'own',
  'same',
  'she',
  'should',
  'so',
  'some',
  'such',
  'than',
  'that',
  'the',
  'their',
  'theirs',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'through',
  'to',
  'too',
  'under',
  'until',
  'up',
  'very',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'which',
  'while',
  'who',
  'whom',
  'why',
  'will',
  'with',
  'would',
  'you',
  'your',
  'yours',
  'tell',
  'please',
  'think',
  'know',
  'want',
  'need',
]);

export function tokenizeSearchText(text: string): string[] {
  const matches = text.toLowerCase().match(/[\p{L}\p{N}_]+/gu);
  if (!matches) return [];
  return matches.filter((token) => !STOPWORDS.has(token)).slice(0, MAX_TOKENS);
}

/**
 * Build a safe FTS5 MATCH expression. Returns `null` when the text contains no
 * searchable tokens, which callers must treat as "no text filter".
 *
 * `mode`:
 *   - `and` — every token required. Precise, but a multi-part question ("what
 *     game, which engine, what platform") matches nothing because no single
 *     memory contains every word.
 *   - `or`  — any token. Recall-oriented fallback; relevance still comes from
 *     bm25, so a weak match cannot outrank a strong one.
 */
export function toFtsQuery(text: string, mode: 'and' | 'or' = 'and'): string | null {
  const tokens = tokenizeSearchText(text);
  if (tokens.length === 0) return null;
  const joiner = mode === 'and' ? ' AND ' : ' OR ';
  return tokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(joiner);
}
