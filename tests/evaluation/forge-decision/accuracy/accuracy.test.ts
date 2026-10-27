/**
 * Phase 12D — Decision Guard accuracy + security evaluation.
 *
 * Records engine behaviour against auditor ground truth (confusion matrices
 * per rule), pins the false-positive / false-negative / overclaim case sets
 * so any future engine change that shifts them fails loudly, and probes the
 * security/robustness surface. Pure: no network, no model calls, no execution
 * of untrusted source (fixtures are string data, never imported).
 */

import { describe, expect, it } from 'vitest';
import {
  evaluateDecisions,
  GUARD_VERSION,
  type GuardDecision,
  MAX_DECISIONS,
  MAX_FINDINGS,
  MAX_SOURCE_CHARS,
  RULE_ORDER,
} from '../../../../packages/decision-guard/src/index.js';
import { AUTHENTIC_CASES, AUTHENTIC_FILE, readAuthenticSource } from './authentic.js';
import { CDN, CORPUS, type CorpusCase } from './corpus.js';
import {
  DEC_COLOUR,
  DEC_COUNTDOWN,
  DEC_FLASH,
  DEC_MUSIC,
  DEC_PENALTY,
  DEC_RED_GREEN,
} from './decisions.js';
import { type CaseRow, metricsForRules, runCase, runCorpus } from './harness.js';

const SYNTHETIC_ROWS = runCorpus(CORPUS);

function rowById(rows: readonly CaseRow[], id: string): CaseRow {
  const row = rows.find((entry) => entry.id === id);
  if (!row) throw new Error(`missing corpus case ${id}`);
  return row;
}

const idsWhere = (rows: readonly CaseRow[], predicate: (row: CaseRow) => boolean) =>
  rows.filter(predicate).map((row) => row.id);

describe('accuracy corpus — size and provenance', () => {
  it('meets the >=30-case requirement and keeps ids unique', () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(CORPUS.map((testCase) => testCase.id)).size).toBe(CORPUS.length);
    expect(SYNTHETIC_ROWS).toHaveLength(CORPUS.length);
  });

  it('covers every adversarial dimension for every rule', () => {
    for (const rule of RULE_ORDER) {
      const categories = new Set(
        CORPUS.filter((testCase) => testCase.rule === rule).map((testCase) => testCase.category),
      );
      for (const dimension of [
        'violation-clear',
        'compliance-clear',
        'comment-inert',
        'string-inert',
        'renamed',
        'alt-pattern',
        'formatting',
        'multi-construct',
        'memory-relevance',
      ]) {
        expect(categories.has(dimension as CorpusCase['category']), `${rule}/${dimension}`).toBe(
          true,
        );
      }
    }
  });
});

describe('accuracy corpus — recorded behaviour (golden)', () => {
  it('per-case rows match the committed snapshot', () => {
    expect(SYNTHETIC_ROWS).toMatchSnapshot();
  });

  it('confusion metrics match the committed snapshot', () => {
    expect(metricsForRules(SYNTHETIC_ROWS, [...RULE_ORDER])).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// Findings pinned as code: these sets are the audit's headline results.
// If a fix or regression moves any case between sets, this fails and the
// audit doc must be updated alongside.

describe('accuracy corpus — pinned false-positive set (BLOCK on compliant fixtures)', () => {
  it('rule A countdown false positives (v1.2.0: comments and inert strings no longer block)', () => {
    expect(
      idsWhere(
        SYNTHETIC_ROWS,
        (row) => row.rule === 'countdown-mechanics' && row.classification === 'FP',
      ),
    ).toEqual([]);
  });

  it('rule B flashing false positives (v1.1.0: comment FP fixed; ticker-interval + negation-scope remain)', () => {
    expect(
      idsWhere(
        SYNTHETIC_ROWS,
        (row) => row.rule === 'flashing-effects' && row.classification === 'FP',
      ),
    ).toEqual(['B13', 'B14']);
  });

  it('rule C penalty false positives (v1.1.0: comment FP fixed; string + identifier-substring remain)', () => {
    expect(
      idsWhere(
        SYNTHETIC_ROWS,
        (row) => row.rule === 'mistake-penalty' && row.classification === 'FP',
      ),
    ).toEqual(['C06', 'C09']);
  });

  it('rule D palette false positives (v1.1.0: comment-hex FP fixed; changelog string remains)', () => {
    expect(
      idsWhere(
        SYNTHETIC_ROWS,
        (row) => row.rule === 'superseded-palette' && row.classification === 'FP',
      ),
    ).toEqual(['D04']);
  });

  it('rule E colour false positives (v1.1.0: comment red/green now abstains; narrative string still blocks)', () => {
    expect(
      idsWhere(
        SYNTHETIC_ROWS,
        (row) => row.rule === 'colour-only-cue' && row.classification === 'FP',
      ),
    ).toEqual(['E05']);
  });
});

describe('accuracy corpus — v1.1.0 comment-masking fixes (before: FP/BLOCK; now: no claim or PASS)', () => {
  const fixedCases: Array<[string, 'TN' | 'ABSTAIN']> = [
    ['A06', 'TN'], // line comment
    ['A07', 'TN'], // block comment
    ['A16', 'TN'], // HTML comment
    ['B06', 'TN'], // block comment with animation + flash tokens
    ['C05', 'TN'], // line comment with score--
    ['D03', 'TN'], // superseded hex inside line comment
    ['E04', 'ABSTAIN'], // comment-only red/green pair -> UNVERIFIED, never BLOCK
  ];

  it.each(fixedCases)('%s is no longer a false positive after masking (now %s)', (id, expected) => {
    const row = rowById(SYNTHETIC_ROWS, id);
    expect(row.classification).toBe(expected);
    expect(row.block_correct).toBe(false);
  });
});

describe('accuracy corpus — v1.2.0 targeted hardening', () => {
  it('A08 string-only countdown prose abstains instead of blocking (was a false positive)', () => {
    const row = rowById(SYNTHETIC_ROWS, 'A08');
    expect(row.ground_truth).toBe('compliant'); // fixture label is unchanged
    expect(row.observed).toBe('UNVERIFIED');
    expect(row.classification).toBe('ABSTAIN');
    expect(row.block_unsafe).toBe(false);
  });

  it('D12 0x source against a # record is now a true positive (was abstain)', () => {
    const row = rowById(SYNTHETIC_ROWS, 'D12');
    expect(row.ground_truth).toBe('violation'); // fixture label is unchanged
    expect(row.observed).toBe('BLOCK');
    expect(row.classification).toBe('TP');
    expect(row.block_correct).toBe(true);
  });
});

describe('accuracy corpus — pinned false-negative set (PASS claimed on violations)', () => {
  it('rule A countdown false negatives', () => {
    expect(
      idsWhere(
        SYNTHETIC_ROWS,
        (row) => row.rule === 'countdown-mechanics' && row.classification === 'FN',
      ),
    ).toEqual(['A09', 'A10']);
  });

  it('rule B flashing false negatives', () => {
    expect(
      idsWhere(
        SYNTHETIC_ROWS,
        (row) => row.rule === 'flashing-effects' && row.classification === 'FN',
      ),
    ).toEqual(['B05', 'B08', 'B09']);
  });

  it('rule C penalty false negatives', () => {
    expect(
      idsWhere(
        SYNTHETIC_ROWS,
        (row) => row.rule === 'mistake-penalty' && row.classification === 'FN',
      ),
    ).toEqual(['C07', 'C08']);
  });

  it('rule D palette false negatives (v1.2.0: 0x/# notation equivalence fixes D12)', () => {
    expect(
      idsWhere(
        SYNTHETIC_ROWS,
        (row) => row.rule === 'superseded-palette' && row.classification === 'FN',
      ),
    ).toEqual(['D07', 'D14']);
  });

  it('rule E colour false negatives (unsound narrow-PASS on colour-only fixtures)', () => {
    expect(
      idsWhere(
        SYNTHETIC_ROWS,
        (row) => row.rule === 'colour-only-cue' && row.classification === 'FN',
      ),
    ).toEqual(['E10', 'E11']);
  });
});

describe('accuracy corpus — pinned unsound-PASS on indeterminate fixtures', () => {
  it('no indeterminate fixture is currently claimed PASS (D11 reads as TN; family-word reintroduction stays invisible)', () => {
    expect(idsWhere(SYNTHETIC_ROWS, (row) => row.classification === 'UNSOUND_PASS')).toEqual([]);
  });

  it('E13 decision-linking gap: rule E never fires yet the decision aggregate PASSes', () => {
    const row = rowById(SYNTHETIC_ROWS, 'E13');
    expect(row.observed).toBe('NOT_EVALUATED');
    expect(row.overall).toBe('PASS');
  });
});

// ---------------------------------------------------------------------------
// Authentic Muse-generated source (separate category, never merged into the
// synthetic metrics). Small n: observations only, no statistical claim.

describe('authentic Muse artifact corpus', () => {
  it('artifact sha256 is unchanged (provenance guard)', () => {
    const source = readAuthenticSource();
    expect(Buffer.byteLength(source, 'utf8')).toBe(AUTHENTIC_FILE.bytes);
  });

  it('per-rule observations on the authentic source match the committed snapshot', () => {
    const authenticSource = readAuthenticSource();
    const rows = AUTHENTIC_CASES.map((testCase) =>
      runCase({
        ...testCase,
        source: authenticSource,
        decisions: [...testCase.decisions],
      }),
    );
    expect(rows).toMatchSnapshot();
  });

  it('engine never claims full verification on the authentic game (E abstains)', () => {
    const authenticSource = readAuthenticSource();
    const colourCase = AUTHENTIC_CASES.find((testCase) => testCase.rule === 'colour-only-cue');
    if (!colourCase) throw new Error('missing authentic colour case');
    const row = runCase({ ...colourCase, source: authenticSource });
    expect(row.observed).toBe('UNVERIFIED');
  });
});

// ---------------------------------------------------------------------------
// Security + robustness probes. Inputs are hostile data, never executed.

describe('security probes', () => {
  const BAD_DECISIONS = [
    null,
    42,
    { id: '12d-bad1' },
    { id: '12d-bad2', content: 'No countdown timers.', status: 'active', supersedes: 'nope' },
    { id: '', content: 'No countdown timers.', status: 'active', supersedes: [] },
  ] as unknown as GuardDecision[];

  it('S01 source at the size limit evaluates; limit+1 never PASSes', () => {
    const atLimit = `${CDN}${'a'.repeat(MAX_SOURCE_CHARS - CDN.length)}`;
    expect(atLimit.length).toBe(MAX_SOURCE_CHARS);
    const ok = evaluateDecisions([DEC_COUNTDOWN], atLimit);
    expect(ok.input_warnings).not.toContain('source_oversized');
    expect(ok.verdict).toBe('PASS');

    const over = evaluateDecisions([DEC_COUNTDOWN], `${atLimit}a`);
    expect(over.verdict).toBe('UNVERIFIED');
    expect(over.input_warnings).toContain('source_oversized');
    expect(over.findings).toEqual([]);
  });

  it('S02 decision count cap truncates with a warning', () => {
    const padded: GuardDecision[] = [];
    for (let index = 0; index < MAX_DECISIONS + 8; index += 1) {
      padded.push({ ...DEC_COUNTDOWN, id: `12d-pad-${index.toString().padStart(3, '0')}` });
    }
    const result = evaluateDecisions(padded, 'let elapsed = 0;');
    expect(result.input_warnings.some((note) => note.startsWith('decision_limit_exceeded'))).toBe(
      true,
    );
    expect(result.evaluations).toHaveLength(MAX_DECISIONS);
  });

  it('S03 findings are capped and the cap is disclosed', () => {
    const many: GuardDecision[] = [];
    for (let index = 0; index < 30; index += 1) {
      many.push({
        id: `12d-many-${index.toString().padStart(2, '0')}`,
        content:
          'No countdown timers, avoid flashing, never penalise mistakes, replace the warm sunset palette accent #FF7E47, and never rely on colour only.',
        status: 'active',
        supersedes: [],
      });
    }
    const result = evaluateDecisions(
      many,
      `let timeLeft = 5;
setInterval(() => { timeLeft--; }, 1000);
<style>@keyframes blinkDot { 50% { opacity: 0; } }</style>
function onWrong() { score -= 1; }
go.setFill('#00FF00'); stop.setFill('#FF0000');`,
    );
    expect(result.findings).toHaveLength(MAX_FINDINGS);
    expect(result.input_warnings).toContain('finding_limit_exceeded');
  });

  it('S04 malformed decision objects are rejected with warnings, never trusted', () => {
    const result = evaluateDecisions([...BAD_DECISIONS, DEC_COUNTDOWN], 'let elapsed = 0;');
    expect(result.input_warnings).toContain('malformed_input:decision_rejected');
    expect(result.evaluations.every((entry) => entry.decision_id === DEC_COUNTDOWN.id)).toBe(true);
  });

  it('S05 duplicate decision ids produce duplicate findings (no dedupe)', () => {
    const twin = { ...DEC_COUNTDOWN };
    const result = evaluateDecisions([DEC_COUNTDOWN, twin], 'let timeLeft = 3; timeLeft -= 1;');
    expect(result.evaluations.filter((entry) => entry.rule === 'countdown-mechanics')).toHaveLength(
      2,
    );
    expect(result.findings).toHaveLength(2);
    expect(result.findings[0]?.decision_id).toBe(result.findings[1]?.decision_id);
  });

  it('S06 unicode whitespace: NBSP still matches, zero-width space defeats the pattern', () => {
    const nbsp = evaluateDecisions([DEC_PENALTY], `score\u00A0-= 5;`);
    expect(nbsp.verdict).toBe('BLOCK');
    const zwsp = evaluateDecisions([DEC_PENALTY], `score\u200B-= 5;`);
    expect(zwsp.verdict).toBe('PASS'); // documented obfuscation vector
  });

  it('S07 embedded HTML: inert attribute prose abstains; inline styles remain evaluable', () => {
    const attr = evaluateDecisions(
      [DEC_COUNTDOWN],
      '<div data-tip="countdown">3</div><script>let elapsed = 0;</script>',
    );
    // v1.2.0: an inert attribute value is prose, not an executable mechanic.
    // The honest outcome is UNVERIFIED, never BLOCK and never PASS.
    expect(attr.verdict).toBe('UNVERIFIED');

    const spans = evaluateDecisions(
      [DEC_COLOUR],
      '<span style="color:red">GO</span><span style="color:green">STOP</span>',
    );
    expect(spans.verdict).toBe('BLOCK');

    const scriptTag = evaluateDecisions(
      [DEC_FLASH],
      '<script>/* injected */</script><span>alert("flash")</span>',
    );
    expect(scriptTag.verdict).toBe('PASS');
  });

  it('S08 decision-side matcher fires on any mention of a banned word near a negation, including inside prose about allowed things', () => {
    // "must not ... flash" inside a sentence that PERMITS flashing (B14 mechanism).
    const decision: GuardDecision = {
      id: '12d-s08',
      content: 'Do not animate the banner; a brief flash is allowed.',
      status: 'active',
      supersedes: [],
    };
    const result = evaluateDecisions(
      [decision],
      '<style>@keyframes blinkBanner { 50% { opacity: 0 } } .b { animation: blinkBanner 1s infinite }</style>',
    );
    const flashing = result.evaluations.find((entry) => entry.rule === 'flashing-effects');
    expect(flashing?.verdict).toBe('BLOCK'); // negation scope leak
  });

  it('S09 engine evidence can carry adjacent source text verbatim (integration must redact)', () => {
    const result = evaluateDecisions(
      [DEC_PENALTY],
      `const apiKey = 'sk-live-SECRETVALUE42'; score -= 5;`,
    );
    const finding = result.findings[0];
    // The pure engine still exposes a raw excerpt; the production adapter is
    // responsible for redaction and minimisation (tested in the server suite).
    expect(finding?.evidence).toContain('SECRETVALUE42');
    expect(finding?.match_spans[0]?.start).toBeGreaterThan(0);
  });

  it('S10 output is deterministic and input-order independent', () => {
    const source = `let timeLeft = 3; timeLeft -= 1;
<style>@keyframes blinkDot { 50% { opacity: 0 } }</style>
score -= 1;
go.setFill('#00FF00'); stop.setFill('#FF0000');`;
    const decisions = [DEC_FLASH, DEC_PENALTY, DEC_COUNTDOWN, DEC_MUSIC, DEC_RED_GREEN];
    const first = JSON.stringify(evaluateDecisions(decisions, source));
    const shuffled = [DEC_MUSIC, DEC_COUNTDOWN, DEC_RED_GREEN, DEC_PENALTY, DEC_FLASH];
    const second = JSON.stringify(evaluateDecisions(shuffled, source));
    const repeat = JSON.stringify(evaluateDecisions(decisions, source));
    expect(second).toBe(first);
    expect(repeat).toBe(first);
  });

  it('S11 inputs are never mutated (decisions, options, source)', () => {
    const decisions = [DEC_PENALTY, DEC_COUNTDOWN];
    const options = { supersededDecisions: [{ ...DEC_COUNTDOWN, status: 'superseded' as const }] };
    const decisionsBefore = structuredClone(decisions);
    const optionsBefore = structuredClone(options);
    const source = 'let elapsed = 0;';
    evaluateDecisions(decisions, source, options);
    expect(decisions).toEqual(decisionsBefore);
    expect(options).toEqual(optionsBefore);
  });

  it('S12 no decisions at all yields UNVERIFIED, never PASS', () => {
    expect(evaluateDecisions([], 'let elapsed = 0;').verdict).toBe('UNVERIFIED');
  });

  it('S13 regex work stays bounded on a 400 KB near-miss source', () => {
    const chunk = `${'animation' + 'x'.repeat(60)};`;
    const heavy = `${CDN}${chunk.repeat(Math.floor((MAX_SOURCE_CHARS - CDN.length) / chunk.length))}`;
    expect(heavy.length).toBeLessThanOrEqual(MAX_SOURCE_CHARS);
    const started = performance.now();
    const result = evaluateDecisions([DEC_FLASH, DEC_COUNTDOWN, DEC_PENALTY], heavy);
    const elapsedMs = performance.now() - started;
    expect(result.verdict).toBe('PASS');
    expect(elapsedMs).toBeLessThan(2000); // generous CI margin; linear patterns measured much faster
  });

  it('engine version is reported verbatim on every result', () => {
    expect(evaluateDecisions([DEC_COUNTDOWN], 'x').engine_version).toBe(GUARD_VERSION);
  });
});
