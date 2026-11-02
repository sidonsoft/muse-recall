import { describe, expect, it } from 'vitest';
import { BrowserUnavailableError, launchVerificationBrowser } from '../../scripts/lib/browser.js';
import {
  classifyGateFailure,
  describeGateOutcome,
  GATE_PASS,
  PrerequisiteRefusal,
} from '../../scripts/lib/gate-outcome.js';

/**
 * A verification gate has three endings, and they must not share an exit code or
 * an evidence shape: it measured a failure, it was refused before measuring, or it
 * passed. Before this helper the two browser gates reported all three the same
 * way, and one gate's evidence file carried no status at all.
 */
describe('gate outcome classification', () => {
  it('treats a missing browser as a blocked prerequisite, not a defect', () => {
    const outcome = classifyGateFailure(
      new BrowserUnavailableError('managed Chromium could not be launched: missing binary.'),
    );
    expect(outcome).toEqual({
      kind: 'blocked',
      reason: 'managed Chromium could not be launched: missing binary.',
      exitCode: 2,
    });
    expect(describeGateOutcome(outcome)).toContain('BLOCKED before measuring anything');
  });

  it('treats a named prerequisite refusal as blocked', () => {
    const outcome = classifyGateFailure(
      new PrerequisiteRefusal('paid provider keys are set in the environment'),
    );
    expect(outcome.kind).toBe('blocked');
    expect(outcome.exitCode).toBe(2);
  });

  it('treats anything else as a measured failure, with its reason on the terminal line', () => {
    const outcome = classifyGateFailure(new Error('the staged preview never rendered the asset'));
    expect(outcome.kind).toBe('failed');
    expect(outcome.exitCode).toBe(1);
    expect(describeGateOutcome(outcome)).toBe(
      'FAILED before completion: the staged preview never rendered the asset',
    );
  });

  it('renders the pass case as a pass, so the same helper describes every ending', () => {
    expect(describeGateOutcome(GATE_PASS)).toBe('PASS');
    expect(GATE_PASS.exitCode).toBe(0);
  });

  it('still names the reason when the thrown value is not an Error', () => {
    const outcome = classifyGateFailure('playwright crashed');
    expect(outcome).toEqual({ kind: 'failed', reason: 'playwright crashed', exitCode: 1 });
  });

  it('reports an unusable browser policy as a configuration error the operator can fix', async () => {
    const previous = process.env.FORGE_RUNTIME_BROWSER;
    process.env.FORGE_RUNTIME_BROWSER = 'safari';
    try {
      await expect(launchVerificationBrowser()).rejects.toThrow(/Invalid FORGE_RUNTIME_BROWSER/);
    } finally {
      if (previous === undefined) delete process.env.FORGE_RUNTIME_BROWSER;
      else process.env.FORGE_RUNTIME_BROWSER = previous;
    }
  });

  it('raises the named refusal type when the launcher itself cannot start a browser', async () => {
    const previous = process.env.FORGE_RUNTIME_BROWSER;
    delete process.env.FORGE_RUNTIME_BROWSER;
    try {
      await expect(
        launchVerificationBrowser({
          launch: async () => {
            throw new Error('browser type chromium is not installed at the expected path');
          },
        }),
      ).rejects.toBeInstanceOf(BrowserUnavailableError);
      const failure = await launchVerificationBrowser({
        launch: async () => {
          throw new Error('browser type chromium is not installed at the expected path');
        },
      }).then(
        () => {
          throw new Error('the launcher reported success with a browser that cannot start');
        },
        (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
      );
      // The message has to carry the fix, not just the failure: an operator
      // reading a blocked gate should not have to guess what to install.
      expect(failure.message).toContain('playwright-core install chromium');
    } finally {
      if (previous === undefined) delete process.env.FORGE_RUNTIME_BROWSER;
      else process.env.FORGE_RUNTIME_BROWSER = previous;
    }
  });
});
