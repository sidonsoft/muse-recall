import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildForgePrompt } from '../../apps/server/src/forge/prompt.js';

const REQUEST = 'Add a Next Level button beneath the Restart button.';
const MEMORY = '- Primary colour: #FF7E5F\n- Text colour: #2D1E2F\n- Avoid neon colours.';

function fixture(name: string): string {
  return readFileSync(join(process.cwd(), 'tests/fixtures/forge-prompt', name), 'utf8');
}

describe('production prompt parity', () => {
  it('modify with memory is byte-identical to the recorded output', () => {
    expect(
      buildForgePrompt({ kind: 'modify', prompt: REQUEST, request: REQUEST, memoryBlock: MEMORY }),
    ).toBe(fixture('modify-memory.txt'));
  });

  it('modify without memory is byte-identical and contains no project decisions', () => {
    const prompt = buildForgePrompt({
      kind: 'modify',
      prompt: REQUEST,
      request: REQUEST,
      memoryBlock: '',
    });
    expect(prompt).toBe(fixture('modify-no-memory.txt'));
    expect(prompt).not.toContain('Project design decisions');
    expect(prompt).not.toContain('#FF7E5F');
  });

  it('generate is byte-identical', () => {
    expect(buildForgePrompt({ kind: 'generate', prompt: 'A small farmyard memory game.' })).toBe(
      fixture('generate.txt'),
    );
  });

  it('modify with a screenshot is byte-identical and names the attachment', () => {
    const prompt = buildForgePrompt({
      kind: 'modify',
      prompt: REQUEST,
      request: REQUEST,
      memoryBlock: MEMORY,
      hasScreenshot: true,
    });
    expect(prompt).toBe(fixture('modify-with-screenshot.txt'));
    expect(prompt).toContain('The attached screenshot is the current rendered preview.');
  });

  it('modify without a screenshot does not claim one is attached', () => {
    const prompt = buildForgePrompt({
      kind: 'modify',
      prompt: REQUEST,
      request: REQUEST,
      memoryBlock: '',
    });
    expect(prompt).not.toContain('attached screenshot');
    expect(prompt).toContain('No screenshot is attached');
  });

  it('memory block appears once and before the request', () => {
    const prompt = buildForgePrompt({
      kind: 'modify',
      prompt: REQUEST,
      request: REQUEST,
      memoryBlock: MEMORY,
    });
    expect(prompt.split(MEMORY).length - 1).toBe(1);
    expect(prompt.indexOf('Project design decisions')).toBeLessThan(
      prompt.indexOf('Requested change:'),
    );
    expect(prompt.endsWith(REQUEST)).toBe(true);
  });
});

/**
 * The preview sandbox is `sandbox="allow-scripts"` with CSP `form-action 'none'`.
 * The generator must be told that contract explicitly, or it will produce apps
 * whose primary action is a blocked native form submission (the live FocusFlow
 * attempt 1 failure).
 */
describe('generation interaction contract', () => {
  const generate = buildForgePrompt({ kind: 'generate', prompt: 'A task planner.' });
  const modify = buildForgePrompt({ kind: 'modify', prompt: REQUEST, request: REQUEST });

  it.each([
    ['generate', generate],
    ['modify', modify],
  ])('%s describes JavaScript-driven interactions', (_kind, prompt) => {
    expect(prompt).toContain('client-side JavaScript');
    expect(prompt).toContain('click or keydown listeners');
    expect(prompt).toContain('native form submission');
    expect(prompt).toContain('page navigation');
  });

  it.each([
    ['generate', generate],
    ['modify', modify],
  ])('%s forbids submit controls because preventDefault cannot rescue them', (_kind, prompt) => {
    expect(prompt).toContain('<button type="submit">');
    // The empirical Chrome behaviour: the sandbox blocks before the submit
    // event, so the prompt must not present preventDefault as a workaround.
    expect(prompt).toContain('event.preventDefault()');
    expect(prompt).toMatch(/cannot rescue|instead of relying/);
  });

  it.each([
    ['generate', generate],
    ['modify', modify],
  ])('%s still allows semantic form markup', (_kind, prompt) => {
    expect(prompt.toLowerCase()).toContain('semantic <form>');
    expect(prompt).not.toMatch(/do not use (a |any )?<form/i);
  });

  it.each([
    ['generate', generate],
    ['modify', modify],
  ])('%s preserves accessibility and keyboard operation', (_kind, prompt) => {
    expect(prompt).toContain('accessible label');
    expect(prompt.toLowerCase()).toContain('keyboard');
    expect(prompt).toContain('Enter');
  });

  it.each([
    ['generate', generate],
    ['modify', modify],
  ])('%s rules out unsupported browser capabilities', (_kind, prompt) => {
    expect(prompt).toContain('browser storage');
    expect(prompt).toContain('external services');
    expect(prompt).toContain('unrestricted browser capabilities');
  });

  it('generation names the unsupported storage APIs explicitly', () => {
    expect(generate).toContain('localStorage');
    expect(generate).toContain('sessionStorage');
    expect(generate).toContain('IndexedDB');
  });

  it('keeps the contract before the user request so it cannot be truncated', () => {
    expect(generate.indexOf('Interaction contract')).toBeLessThan(
      generate.indexOf('Application request:'),
    );
    expect(modify.indexOf('sandbox interaction contract')).toBeLessThan(
      modify.indexOf('Requested change:'),
    );
  });
});
