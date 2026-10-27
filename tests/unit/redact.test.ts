import { redactSecrets } from '@mml/shared';
import { describe, expect, it } from 'vitest';

describe('credential redaction', () => {
  it('removes a configured secret value', () => {
    const secret = 'leak-secret-value';
    expect(redactSecrets(`failure: ${secret}`, { secrets: [secret] })).not.toContain(secret);
  });

  it('removes common key and header formats', () => {
    const text = [
      'key LLM_0000000000000000_TESTKEYTESTKEY_TEST',
      'Authorization: Bearer abcdefghijklmnop1234567890',
      'api_key=supersecretvalue',
      'sk-abcdefghijklmnop1234',
    ].join('\n');
    const redacted = redactSecrets(text);
    expect(redacted).not.toContain('LLM_0000000000000000');
    expect(redacted).not.toContain('abcdefghijklmnop1234567890');
    expect(redacted).not.toContain('supersecretvalue');
    expect(redacted).not.toContain('sk-abcdefghijklmnop1234');
  });

  it('keeps useful diagnostics', () => {
    const redacted = redactSecrets(
      'API error 429: Subscription quota exhausted. reset 2026-10-27T02:31:28Z',
    );
    expect(redacted).toContain('429');
    expect(redacted).toContain('quota');
  });

  it('bounds the size of diagnostics', () => {
    const redacted = redactSecrets('x'.repeat(10_000), { maxLength: 200 });
    expect(redacted.length).toBeLessThan(250);
    expect(redacted).toContain('truncated');
  });
});
