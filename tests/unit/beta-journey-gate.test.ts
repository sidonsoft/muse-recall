/**
 * The beta-journey gate makes release claims in its own check names. This test pins the gate against
 * its own source, so a claim cannot survive in the documents while disappearing from the run.
 *
 * It is not a substitute for running the gate. It answers a narrower question: does the script still
 * contain the measurement each of its required claims rests on, does it still refuse when a provider
 * credential is present, and does it still refuse to score application quality by itself?
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFECTIVE_KNOBS } from '../../scripts/lib/artifact-probe-fixtures.ts';

const SCRIPT = join(__dirname, '..', '..', 'scripts', 'verify-beta-journey.ts');
const source = readFileSync(SCRIPT, 'utf8');

/** The literal strings passed to `check(...)`, which are the claims this run actually measures. */
function checkLabels(text: string): string[] {
  return [...text.matchAll(/check\(\s*\n?\s*'([^']+)'/g)].map((match) => match[1] as string);
}

function requiredNames(): string[] {
  const block = source.slice(
    source.indexOf('const REQUIRED_CHECK_NAMES = ['),
    source.indexOf('] as const;'),
  );
  return [...block.matchAll(/'([^']+)'/g)].map((match) => match[1] as string).slice(1);
}

describe('the beta journey gate keeps its own claims measurable', () => {
  it('every required claim name is a check the script really performs', () => {
    const labels = checkLabels(source);
    const missing = requiredNames().filter((name) => !labels.includes(name));
    expect(
      missing,
      `these release claims are pinned as required but no check() emits them: ${missing.join(' | ')}`,
    ).toEqual([]);
  });

  it('pins a check-count floor at least as large as the claims it requires', () => {
    const floor = Number(/min:\s*(\d+)/.exec(source)?.[1]);
    expect(Number.isFinite(floor)).toBe(true);
    expect(floor).toBeGreaterThanOrEqual(requiredNames().length);
  });

  it('refuses to run at all while a provider credential is exported', () => {
    // A run that could pay is not the run the release packet describes, so this is a prerequisite
    // refusal rather than a measurement that happens to spend nothing.
    for (const name of [
      'FORGE_MUSE_API_KEY',
      'FORGE_FALLBACK_API_KEY',
      'META_API_KEY',
      'BASETEN_API_KEY',
    ]) {
      expect(source, `the credential guard no longer names ${name}`).toContain(`'${name}'`);
    }
    expect(source).toContain(
      'refusing to run the beta journey while provider credentials are exported',
    );
    expect(source).toContain('class Refusal extends PrerequisiteRefusal');
    expect(source).toContain('process.exit(2)');
  });

  it('names the scripted coding CLI, so plumbing evidence cannot read as model evidence', () => {
    expect(source).toContain("coding_cli: 'fixture:tests/fixtures/fake-muse.mjs'");
    expect(source).toContain('HUMAN REVIEW REQUIRED: the coding CLI here is scripted');
    expect(source).toContain("human_review_status: 'required_not_performed'");
  });

  it('compares both handover controls with the bytes the endpoint serves', () => {
    // KI-88's class of defect: a control that hands over output the application no longer displays.
    // Reading the code was not enough, so the measurement is a byte comparison in the browser.
    expect(source).toContain('sha256(clipboard) !== servedSha');
    expect(source).toContain('sha256(downloaded) !== servedSha');
    // and the endpoint's own recorded hash is cross-checked rather than trusted
    expect(source).toContain('served.sha256 !== servedSha');
  });

  it('reads a refusal reason that names the field and the rule, not just a code', () => {
    expect(source).toContain('inner.details');
    // The literal carries template braces on purpose: it pins the shape of the interpolation in the
    // gate source, not a string the test itself builds.
    // biome-ignore lint/suspicious/noTemplateCurlyInString: pinning the gate's own template literal
    expect(source).toContain('`${path}: ${item.message ??');
    expect(source).toContain('never names the field at fault');
  });

  it('keeps page-side measurements free of named helpers', () => {
    // The toolchain wraps a named function in a `__name(...)` call that does not exist inside the page,
    // so a helper-driven measurement throws at runtime instead of measuring. Every evaluate body in
    // this gate is written with anonymous callbacks only.
    const spans = source.split('page.evaluate(').slice(1);
    for (const span of spans) {
      const body = span.slice(0, span.indexOf('});'));
      // A comment may say the word; only an actual declaration is the hazard.
      expect(body).not.toMatch(/\bfunction\s*[({]/);
      expect(body).not.toMatch(/\bfunction\s+[A-Za-z0-9_]+\s*\(/);
      expect(body).not.toMatch(/const\s+[A-Za-z0-9_]+\s*=\s*\([^)]*\)\s*=>/);
    }
  });

  it('measures the phone by role rather than by a label the product is free to reword', () => {
    // "Generate HTML" becomes "Stage new version" once a version exists; matching the old words would
    // have failed the measurement instead of reporting it.
    expect(source).toContain("'primary action'");
    expect(source).toContain('prompt field');
  });
});

describe('the probe battery names what it did not do', () => {
  it('defines exactly the four outcome words a sequence may report', () => {
    // "No findings" and "I could not run" are different sentences, and conflating them let a capture
    // print a clean bill of health over defects it never looked for (KI-87).
    const vocabulary = readFileSync(
      join(__dirname, '..', '..', 'scripts', 'lib', 'artifact-probes.ts'),
      'utf8',
    );
    expect(vocabulary).toContain(
      "export type ProbeStatus = 'finding' | 'clean' | 'not_tested' | 'incomplete';",
    );
    expect(vocabulary).toContain('NOT TESTED');
  });

  it('drives the seven sequences the beta promises to work', () => {
    const driver = readFileSync(
      join(__dirname, '..', '..', 'scripts', 'verify-artifact-probes.ts'),
      'utf8',
    );
    for (const id of [
      'export-then-regenerate-then-export',
      'copy-after-state-change',
      'distinct-accepted-inputs',
      'destructive-then-undo',
      'destructive-then-reload-recovery',
      'narrow-viewport-interaction',
      'invalid-input-then-retry',
    ]) {
      expect(driver, `the probe battery no longer names the sequence ${id}`).toContain(`'${id}'`);
    }
  });

  it('ships at least one single-defect fixture per sequence it claims to run', () => {
    // A battery whose fixtures are all multi-defect cannot show which probe measured what, so the
    // discrimination claim would be untestable.
    expect(DEFECTIVE_KNOBS.length).toBeGreaterThanOrEqual(7);
  });
});
