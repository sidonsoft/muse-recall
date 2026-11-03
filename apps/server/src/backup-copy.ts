import { spawn } from 'node:child_process';

/**
 * The online copy runs in a **child process**, not in this one.
 *
 * `node:sqlite`'s backup API has no abort path: once `step()` is running in this
 * process, a deadline can only stop the *await*. The review that found this named
 * the consequence precisely — the abandoned copy keeps its file handle open, so a
 * parked partial can be extended after the caller has already given up and written
 * its "parked, never served" message. A promise timeout cannot prevent that.
 * Removing the process can.
 */
export class BackupDeadlineError extends Error {
  constructor(timeoutMs: number) {
    super(`the online copy was still running after ${String(timeoutMs)}ms and was given up on`);
    this.name = 'BackupDeadlineError';
  }
}

/**
 * The copy, run by `node -e` so it needs no build step and no loader flag. It opens
 * the source read-only, performs the online backup, and prints the destination's
 * page count. Any failure exits non-zero with the reason on stderr.
 */
const CHILD_SCRIPT = `
const { DatabaseSync, backup } = require('node:sqlite');
const { statSync } = require('node:fs');
const [source, destination] = process.argv.slice(1);
const db = new DatabaseSync(source, { readOnly: true });
backup(db, destination).then(
  () => {
    db.close();
    let pages = 0;
    try {
      const check = new DatabaseSync(destination, { readOnly: true });
      pages = Number(check.prepare('PRAGMA page_count').get().page_count);
      check.close();
    } catch {}
    process.stdout.write(JSON.stringify({ pages, bytes: statSync(destination).size }));
  },
  (error) => {
    db.close();
    process.stderr.write(String((error && error.message) || error) + String.fromCharCode(10));
    process.exit(1);
  },
);
`;

const liveChildren = new Set<number>();

/** PIDs of copy children still running. Exported so the lifetime can be *asserted*, not assumed. */
export function activeBackupCopies(): number[] {
  return [...liveChildren];
}

function firstLine(text: string): string {
  const line = text.split('\n').find((entry) => entry.trim().length > 0) ?? '';
  return line.trim().slice(0, 200);
}

export interface ChildCopyOptions {
  source: string;
  destination: string;
  timeoutMs: number;
}

/**
 * Copy `source` to `destination` in a child that is killed if it outlives
 * `timeoutMs`. Resolves with the destination's page count; rejects with
 * `BackupDeadlineError` when the child had to be taken down, and with a named
 * failure when the child itself failed.
 */
export function copyOnlineBackupInChild(options: ChildCopyOptions): Promise<number> {
  const { source, destination, timeoutMs } = options;
  return new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', CHILD_SCRIPT, source, destination], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const pid = child.pid ?? -1;
    liveChildren.add(pid);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });
    // `timeoutMs <= 0` means "no deadline": the copy may run as long as it needs.
    // A zero-delay timer would kill every copy on the spot.
    const timer =
      Number.isFinite(timeoutMs) && timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
          }, timeoutMs)
        : undefined;
    child.on('error', (error) => {
      if (timer !== undefined) clearTimeout(timer);
      liveChildren.delete(pid);
      reject(new Error(`the online backup copy process could not start: ${error.message}`));
    });
    child.on('close', (code, signal) => {
      if (timer !== undefined) clearTimeout(timer);
      liveChildren.delete(pid);
      if (timedOut) {
        reject(new BackupDeadlineError(timeoutMs));
        return;
      }
      if (code !== 0) {
        reject(
          new Error(
            `the online backup copy process ${signal ? `was ended by ${signal}` : `failed with exit code ${String(code)}`}: ${firstLine(stderr) || '(the copy process wrote nothing to stderr)'}`,
          ),
        );
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as { pages?: unknown };
        resolve(typeof parsed.pages === 'number' ? parsed.pages : 0);
      } catch {
        reject(
          new Error(
            `the online backup copy process exited cleanly but reported no usable page count (stdout: ${firstLine(stdout) || '(empty)'})`,
          ),
        );
      }
    });
  });
}
