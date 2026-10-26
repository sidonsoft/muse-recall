import { toFtsQuery, tokenizeSearchText } from '@mml/memory-engine';
import { describe, expect, it } from 'vitest';

/**
 * Regression coverage for the FTS5 query builder contract in fts.ts.
 *
 * The existing retrieval suite only proves that hostile queries do not throw.
 * These tests pin the string-level guarantees that make that true:
 * stopwords are removed BEFORE the 12-token cap is applied, the cap bounds
 * non-stopword tokens, FTS operator words are neutralised into quoted
 * literals, and stopword-only text yields no text filter at all.
 */
describe('fts query builder', () => {
  it('filters stopwords before the token cap so a trailing noun survives', () => {
    // 15 leading stopwords + one signal word: slicing to 12 first would drop
    // the only searchable term and silently return nothing.
    const query =
      'what are the we have been down that with this for from need know want unobtainium';
    const tokens = tokenizeSearchText(query);

    expect(tokens).toEqual(['unobtainium']);
    expect(toFtsQuery(query)).toBe('"unobtainium"');
  });

  it('caps non-stopword tokens at 12, keeping the leading ones', () => {
    const words = Array.from({ length: 20 }, (_, index) => `alpha${index}`);
    const tokens = tokenizeSearchText(words.join(' '));

    expect(tokens).toHaveLength(12);
    expect(tokens).toEqual(words.slice(0, 12));
  });

  it('neutralises FTS operator words into quoted literal terms', () => {
    // `OR` is a stopword and disappears; every surviving token is double-
    // quoted, so NEAR/OR/* can never reshape the MATCH expression.
    expect(toFtsQuery('sqlite OR postgres')).toBe('"sqlite" AND "postgres"');
    expect(toFtsQuery('NEAR("sqlite")', 'or')).toBe('"near" OR "sqlite"');
    expect(toFtsQuery('SQLite')).toBe('"sqlite"');
  });

  it('returns no text filter for stopword-only or empty search text', () => {
    expect(tokenizeSearchText('tell me what you want to know')).toEqual([]);
    expect(toFtsQuery('tell me what you want to know')).toBeNull();
    expect(toFtsQuery('')).toBeNull();
  });
});
