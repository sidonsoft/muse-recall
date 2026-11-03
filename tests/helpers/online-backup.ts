/**
 * Copy an existing database through the product's **online** backup API in a plain Node
 * process (KI-56).
 *
 * Calling `backupDatabase` from inside a suite test measures the harness, not the product:
 * node:sqlite's `backup()` promise settles in 1-19 ms in a plain process (even 8-way
 * concurrent) and never settles inside a full-suite Vitest worker. The product now bounds that
 * wait and names the stall, so the child propagates a deadline failure as a non-zero exit
 * rather than hanging.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export interface OnlineCopyResult {
  ok: true;
  source: string;
  destination: string;
  pages: number;
}

const CHILD = fileURLToPath(new URL('./online-copy-child.ts', import.meta.url));

export function onlineCopy(source: string, destination: string): OnlineCopyResult {
  const child = spawnSync(process.execPath, ['--import', 'tsx', CHILD, source, destination], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    timeout: 120_000,
  });
  if (child.status !== 0) {
    throw new Error(
      `the online copy child failed (exit ${child.status}): ${String(child.stderr).slice(-400)}`,
    );
  }
  const last = child.stdout.trim().split('\n').at(-1) ?? '';
  try {
    return JSON.parse(last) as OnlineCopyResult;
  } catch {
    throw new Error(`the online copy child printed no result: ${last.slice(0, 200)}`);
  }
}
