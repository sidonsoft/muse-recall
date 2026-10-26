import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EchoProvider,
  formatPrompt,
  MuseCliProvider,
  type MuseCliProviderOptions,
  ProviderError,
} from '@mml/muse-provider';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Provider adapter tests.
 *
 * The Muse CLI is replaced by a scripted local executable that emits the same
 * JSONL frames the real binary emits. That lets us test frame parsing, usage
 * aggregation, terminal handling, timeouts, and spawn failures deterministically,
 * without network access or quota.
 */

const FAKE_BIN = `#!/usr/bin/env node
const mode = process.env.MML_FAKE_MODE || 'ok';
const emit = (payload_type, payload) =>
  process.stdout.write(JSON.stringify({ payload_type, payload }) + '\\n');

if (mode === 'hang') {
  setInterval(() => {}, 1000);
} else if (mode === 'fail') {
  emit('run.terminal.failed', { terminal: 'failed', text: '', reason: 'model refused' });
} else if (mode === 'noterminal') {
  emit('run.output.delta', { text: 'partial' });
} else if (mode === 'args') {
  emit('run.terminal.completed', {
    terminal: 'completed',
    text: JSON.stringify(process.argv.slice(2)),
    reason: null,
  });
} else if (mode === 'multimodel') {
  emit('run.model.configured', { model_id: 'muse-spark-1.3' });
  emit('run.output.delta', { text: 'Hello ' });
  emit('run.output.delta', { text: 'world' });
  emit('run.usage', {
    models: [
      { model: 'muse-spark-1.3', input_tokens: 100, output_tokens: 20, cached_tokens: 5, reasoning_tokens: 8 },
      { model: 'muse-wonder-1.0', input_tokens: 50, output_tokens: 10, cached_tokens: 0, reasoning_tokens: 2 },
    ],
  });
  emit('run.terminal.completed', { terminal: 'completed', text: 'Hello world', reason: null });
} else {
  emit('run.output.delta', { text: 'ready' });
  emit('run.usage', {
    models: [{ model: 'muse-wonder-1.0', input_tokens: 42, output_tokens: 3, cached_tokens: 0, reasoning_tokens: 1 }],
  });
  emit('run.terminal.completed', { terminal: 'completed', text: 'ready', reason: null });
}
`;

let fakeDirectory = '';
let fakeBin = '';

beforeAll(async () => {
  fakeDirectory = await mkdtemp(join(tmpdir(), 'mml-fake-muse-'));
  fakeBin = join(fakeDirectory, 'fake-muse.mjs');
  await writeFile(fakeBin, FAKE_BIN, 'utf8');
  await chmod(fakeBin, 0o755);
});

afterAll(async () => {
  await rm(fakeDirectory, { recursive: true, force: true });
});

function provider(options: Partial<MuseCliProviderOptions> = {}) {
  return new MuseCliProvider({ bin: fakeBin, timeoutMs: 10_000, ...options });
}

describe('formatPrompt', () => {
  it('folds a system message into an instructions block', () => {
    const prompt = formatPrompt([
      { role: 'system', content: 'Be terse.' },
      { role: 'user', content: 'Hello' },
    ]);
    expect(prompt).toContain('<instructions>\nBe terse.\n</instructions>');
    expect(prompt).toContain('USER: Hello');
  });

  it('renders multi-turn conversations with explicit roles', () => {
    const prompt = formatPrompt([
      { role: 'user', content: 'First' },
      { role: 'assistant', content: 'Second' },
      { role: 'user', content: 'Third' },
    ]);
    expect(prompt).toContain('USER: First');
    expect(prompt).toContain('ASSISTANT: Second');
    expect(prompt).toContain('USER: Third');
    expect(prompt).not.toContain('<instructions>');
  });
});

describe('MuseCliProvider', () => {
  it('reports honest capabilities', () => {
    const capabilities = provider().capabilities();
    expect(capabilities.streaming).toBe(true);
    expect(capabilities.tool_calling).toBe(false);
    expect(capabilities.structured_output).toBe(true);
    expect(capabilities.max_context_tokens).toBe(1_007_997);
    expect(capabilities.models).toContain('muse-wonder-1.0');
  });

  it('parses a successful run, including usage', async () => {
    process.env.MML_FAKE_MODE = 'ok';
    const response = await provider().generate({ messages: [{ role: 'user', content: 'hi' }] });
    expect(response.text).toBe('ready');
    expect(response.provider).toBe('muse-cli');
    expect(response.stop_reason).toBe('completed');
    expect(response.usage.input_tokens).toBe(42);
    expect(response.usage.output_tokens).toBe(3);
    expect(response.usage.reasoning_tokens).toBe(1);
  });

  it('aggregates usage across every model in the run', async () => {
    process.env.MML_FAKE_MODE = 'multimodel';
    const response = await provider().generate({ messages: [{ role: 'user', content: 'hi' }] });
    expect(response.usage.input_tokens).toBe(150);
    expect(response.usage.output_tokens).toBe(30);
    expect(response.usage.cached_input_tokens).toBe(5);
    expect(response.usage.reasoning_tokens).toBe(10);
    expect(response.model).toBe('muse-spark-1.3');
  });

  it('streams text deltas incrementally', async () => {
    process.env.MML_FAKE_MODE = 'multimodel';
    const deltas: string[] = [];
    let sawCompleted = false;
    for await (const event of provider().stream({
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      if (event.type === 'text_delta') deltas.push(event.text);
      if (event.type === 'completed') sawCompleted = true;
    }
    expect(deltas).toEqual(['Hello ', 'world']);
    expect(sawCompleted).toBe(true);
  });

  it('surfaces a failed terminal as a ProviderError', async () => {
    process.env.MML_FAKE_MODE = 'fail';
    await expect(
      provider().generate({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({ code: 'provider_crashed' });
  });

  it('treats a run with no terminal event as a protocol failure', async () => {
    process.env.MML_FAKE_MODE = 'noterminal';
    await expect(
      provider().generate({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({ code: 'provider_crashed' });
  });

  it('kills a hung run and reports a timeout', async () => {
    process.env.MML_FAKE_MODE = 'hang';
    const startedAt = Date.now();
    await expect(
      provider({ timeoutMs: 400 }).generate({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({ code: 'provider_timeout' });
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });

  it('reports a missing binary as provider_unavailable', async () => {
    const error = await provider({ bin: join(fakeDirectory, 'does-not-exist') })
      .generate({ messages: [{ role: 'user', content: 'hi' }] })
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).code).toBe('provider_unavailable');
  });

  it('passes hermetic flags and the output schema to the CLI', async () => {
    process.env.MML_FAKE_MODE = 'args';
    const response = await provider().generate({
      messages: [{ role: 'user', content: 'hi' }],
      response_schema: { type: 'object', properties: {}, additionalProperties: false },
    });
    const args = JSON.parse(response.text) as string[];
    expect(args).toContain('--preset');
    expect(args).toContain('empty');
    expect(args).toContain('--no-session-log');
    expect(args).toContain('--no-foreign-personal-context');
    expect(args).toContain('--disable-web-tools');
    expect(args).toContain('--output-schema');
    expect(args[args.indexOf('--output-schema') + 1]).toMatch(/schema\.json$/);
  });

  it('rejects an invalid request without spawning anything', async () => {
    const events = [];
    for await (const event of provider().stream({ messages: [] })) events.push(event);
    expect(events[0]).toMatchObject({ type: 'error', code: 'invalid_request' });
  });
});

describe('EchoProvider', () => {
  it('is clearly labelled as not being a model', () => {
    const echo = new EchoProvider();
    expect(echo.id).toBe('echo');
    expect(echo.name).toMatch(/not a model/i);
    expect(echo.capabilities().notes.join(' ')).toMatch(/never be presented as Meta Muse/i);
  });

  it('is deterministic for the same input', async () => {
    const echo = new EchoProvider();
    const request = { messages: [{ role: 'user' as const, content: 'ping' }] };
    const first = await echo.generate(request);
    const second = await echo.generate(request);
    expect(first.text).toBe(second.text);
    expect(first.text).toBe('echo: ping');
  });

  it('supports a scripted responder for tests', async () => {
    const echo = new EchoProvider({ respond: (request) => `saw ${request.messages.length}` });
    const response = await echo.generate({ messages: [{ role: 'user', content: 'x' }] });
    expect(response.text).toBe('saw 1');
  });
});
