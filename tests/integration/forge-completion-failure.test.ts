import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

interface WorkerResult {
  alive: boolean;
  status: string;
  error: string | null;
  errorLength: number;
  persistedStatus: string;
  invocations: number;
  shutdownMs: number;
  completed: boolean;
}

describe('Forge completion failure containment', () => {
  it('keeps the server alive when a quota fallback cannot reset corrupt staging', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'forge-completion-test-'));
    temporaryDirectories.push(directory);
    const resultPath = join(directory, 'result.json');
    const worker = join(process.cwd(), 'tests/fixtures/forge-completion-worker.ts');
    const tsxCli = join(process.cwd(), 'node_modules/tsx/dist/cli.mjs');

    const child = spawn(process.execPath, [tsxCli, worker], {
      cwd: process.cwd(),
      env: { ...process.env, FORGE_COMPLETION_RESULT: resultPath },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error(`completion worker timed out\nstdout:\n${stdout}\nstderr:\n${stderr}`));
        }, 20_000);
        child.once('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once('close', (code, signal) => {
          clearTimeout(timer);
          resolve({ code, signal });
        });
      },
    );

    expect(stderr).not.toMatch(/unhandledRejection|UnhandledPromiseRejection/i);
    expect(exit).toEqual({ code: 0, signal: null });
    const result = JSON.parse(await readFile(resultPath, 'utf8')) as WorkerResult;

    expect(result.completed).toBe(true);
    expect(result.alive).toBe(true);
    expect(result.status).toBe('failed');
    expect(result.persistedStatus).toBe('failed');
    expect(result.error).toContain('state');
    expect(result.errorLength).toBeGreaterThan(0);
    expect(result.errorLength).toBeLessThanOrEqual(300);
    expect(result.invocations).toBe(1);
    expect(result.shutdownMs).toBeLessThan(2_000);
  }, 25_000);
});
