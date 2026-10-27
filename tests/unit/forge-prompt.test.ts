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
