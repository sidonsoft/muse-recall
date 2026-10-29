/**
 * Shared process, port and output helpers for the README capture scripts.
 *
 * Captures are written to a disposable staging directory first and copied
 * over the committed assets only after every check passes, so a failed run
 * never leaves a mix of old and new images. `SHA256SUMS` is rewritten from the
 * published bytes on every successful run.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import { copyFile, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

/** Ports used by developers' own dev servers and other verification scripts. */
export const RESERVED_PORTS: ReadonlySet<number> = new Set([
  4173, 5173, 5201, 5218, 8787, 8798, 8901, 8908,
]);

/** Allocate a free loopback port that is neither reserved nor already taken. */
export async function freePort(taken: Iterable<number> = []): Promise<number> {
  const avoid = new Set([...RESERVED_PORTS, ...taken]);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const port = await new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.unref();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address !== 'object') {
          server.close();
          reject(new Error('could not read an ephemeral port'));
          return;
        }
        const chosen = address.port;
        server.close(() => resolve(chosen));
      });
    });
    if (!avoid.has(port)) return port;
  }
  throw new Error('could not allocate a non-reserved free port');
}

export interface ChildHandle {
  label: string;
  child: ChildProcess;
  lines: string[];
}

/** Every child started by this process, so an interrupt can reach them all. */
const live = new Set<ChildHandle>();
/** Disposable directories to remove synchronously on interrupt. */
const disposable = new Set<string>();

/** Remove `path` even if the capture is interrupted before its own cleanup runs. */
export function disposeOnInterrupt(path: string): void {
  disposable.add(path);
}

function signalGroup(child: ChildProcess, name: NodeJS.Signals): void {
  const pid = child.pid;
  if (pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-pid, name);
  } catch {
    try {
      child.kill(name);
    } catch {
      // Already gone.
    }
  }
}

/**
 * The environment a capture child may see: enough to find executables and the
 * managed browser, nothing from the developer's Muse Recall configuration.
 */
export function captureEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'HOME', 'USER', 'TMPDIR', 'LANG', 'PLAYWRIGHT_BROWSERS_PATH']) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...extra };
}

/** Start a child in its own process group so it can be stopped with its descendants. */
export function startChild(
  label: string,
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): ChildHandle {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  const handle: ChildHandle = { label, child, lines: [] };
  live.add(handle);
  child.once('exit', () => live.delete(handle));
  const remember = (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n')) {
      if (line.trim().length === 0) continue;
      handle.lines.push(line.slice(0, 500));
      if (handle.lines.length > 120) handle.lines.shift();
    }
  };
  child.stdout?.on('data', remember);
  child.stderr?.on('data', remember);
  return handle;
}

export function childTail(handle: ChildHandle, lines = 20): string {
  return `${handle.label}:\n${handle.lines.slice(-lines).join('\n')}`;
}

export async function waitForHttp(
  url: string,
  options: { timeoutMs?: number; children?: ChildHandle[] } = {},
): Promise<void> {
  const { timeoutMs = 60_000, children = [] } = options;
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no response yet';
  while (Date.now() < deadline) {
    for (const handle of children) {
      if (handle.child.exitCode !== null) {
        throw new Error(
          `${handle.label} exited ${handle.child.exitCode} before ${url} answered.\n${childTail(handle)}`,
        );
      }
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(150);
  }
  const details = children.map((handle) => childTail(handle)).join('\n');
  throw new Error(`Timed out waiting for ${url}: ${lastError}${details ? `\n${details}` : ''}`);
}

/** SIGTERM the child's process group, then SIGKILL if it has not exited. */
export async function stopChild(handle: ChildHandle): Promise<void> {
  const { child } = handle;
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;

  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  signalGroup(child, 'SIGTERM');
  const timedOut = await Promise.race([exited.then(() => false), sleep(4_000).then(() => true)]);
  if (!timedOut) return;
  signalGroup(child, 'SIGKILL');
  await Promise.race([exited, sleep(2_000)]);
}

/** Wrap `cleanup` so every caller awaits the same single run. */
export function once(cleanup: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | null = null;
  return () => {
    running ??= cleanup();
    return running;
  };
}

/**
 * Stop every child, run `cleanup`, then exit on Ctrl-C or SIGTERM. Detached
 * children are in their own process group and do not receive the terminal's
 * SIGINT, so without this an interrupted capture would leave its servers
 * running. The children are signalled synchronously first: tsx escalates to
 * SIGKILL within milliseconds when a script does not exit, which would cut an
 * asynchronous cleanup short. A second signal waits for the same cleanup.
 * Returns a function that removes the handlers.
 */
export function onInterrupt(cleanup: () => Promise<void>): () => void {
  let exiting: Promise<never> | null = null;
  const handler = (signal: NodeJS.Signals) => {
    if (exiting) return;
    for (const handle of live) signalGroup(handle.child, 'SIGTERM');
    for (const path of disposable) {
      try {
        rmSync(path, { recursive: true, force: true });
      } catch {
        // The asynchronous cleanup below retries.
      }
    }
    console.error(`\n${signal} received; stopping capture servers…`);
    exiting = cleanup()
      .catch((error: unknown) => console.error(`Cleanup failed: ${String(error)}`))
      .then(() => process.exit(signal === 'SIGINT' ? 130 : 143));
  };
  process.on('SIGINT', handler);
  process.on('SIGTERM', handler);
  return () => {
    process.off('SIGINT', handler);
    process.off('SIGTERM', handler);
  };
}

export function pngInfo(buffer: Buffer): { width: number; height: number } {
  const signature = buffer.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') throw new Error('output is not a PNG');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/**
 * Check staged captures, copy them over the committed assets, and rewrite
 * `SHA256SUMS` for every PNG in the output directory.
 */
export async function publishCaptures(options: {
  stagingDir: string;
  outputDir: string;
  names: string[];
  viewport: { width: number; height: number };
  minBytes: number;
}): Promise<Map<string, string>> {
  const { stagingDir, outputDir, names, viewport, minBytes } = options;
  const hashes = new Map<string, string>();
  for (const name of names) {
    const buffer = await readFile(join(stagingDir, name));
    const info = pngInfo(buffer);
    if (info.width !== viewport.width || info.height !== viewport.height) {
      throw new Error(
        `${name} is ${info.width}x${info.height}, expected ${viewport.width}x${viewport.height}`,
      );
    }
    if (buffer.length < minBytes) {
      throw new Error(`${name} is suspiciously small (${buffer.length} bytes)`);
    }
    const hash = createHash('sha256').update(buffer).digest('hex');
    const duplicate = [...hashes].find(([, existing]) => existing === hash)?.[0];
    if (duplicate) throw new Error(`${name} is identical to ${duplicate}`);
    hashes.set(name, hash);
  }

  for (const name of names) {
    await copyFile(join(stagingDir, name), join(outputDir, name));
  }

  const published = (await readdir(outputDir)).filter((name) => name.endsWith('.png')).sort();
  const lines: string[] = [];
  for (const name of published) {
    const path = join(outputDir, name);
    if (!(await stat(path)).isFile()) continue;
    const hash = createHash('sha256')
      .update(await readFile(path))
      .digest('hex');
    lines.push(`${hash}  ${name}`);
  }
  await writeFile(join(outputDir, 'SHA256SUMS'), `${lines.join('\n')}\n`);
  return hashes;
}
