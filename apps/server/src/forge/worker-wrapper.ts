import { spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { isAbsolute } from 'node:path';

/**
 * Forge worker launch wrapper (roadmap G-2 / NEXT_STEPS P0 #4).
 *
 * The environment allow-list reduces accidental exposure, but the Forge CLI
 * still inherits the server user's OS permissions. This module adds the
 * code-side seam: `FORGE_WORKER_WRAPPER` names an absolute, executable
 * pass-through wrapper that launches the real CLI instead of it
 * (`wrapper <bin> <args...>`). Operators point it at `setpriv`/`systemd-run`
 * scoping, a container launcher, or a sandbox-exec profile so the worker can
 * run under a different uid/mount view while the repository stays portable.
 *
 * Fail-fast contract: a configured wrapper that cannot be verified at startup
 * refuses boot, because a silently ignored wrapper would be a false sense of
 * isolation. The probe actually executes the wrapper (`<wrapper> node -e 0`)
 * so pass-through, permissions and PATH independence are proven, not assumed.
 */

export const FORGE_WORKER_WRAPPER_ENV = 'FORGE_WORKER_WRAPPER';

export interface ForgeWorkerWrapper {
  path: string;
}

export interface WorkerWrapperResolution {
  wrapper: ForgeWorkerWrapper | null;
  error: string | null;
}

export function resolveWorkerWrapper(
  source: NodeJS.ProcessEnv = process.env,
): WorkerWrapperResolution {
  const value = source[FORGE_WORKER_WRAPPER_ENV]?.trim();
  if (!value) return { wrapper: null, error: null };
  if (!isAbsolute(value)) {
    return {
      wrapper: null,
      error: `${FORGE_WORKER_WRAPPER_ENV} must be an absolute path to an executable wrapper; got "${value}".`,
    };
  }
  try {
    accessSync(value, constants.X_OK);
  } catch {
    return {
      wrapper: null,
      error: `${FORGE_WORKER_WRAPPER_ENV} points at "${value}", which is not an executable file.`,
    };
  }
  return { wrapper: { path: value }, error: null };
}

/**
 * Prove the wrapper passes argv through and runs to success. Returns null on
 * success or an actionable failure description.
 */
export function probeWorkerWrapper(
  wrapper: ForgeWorkerWrapper,
  timeoutMs = 5_000,
  execPath: string = process.execPath,
): string | null {
  const result = spawnSync(wrapper.path, [execPath, '-e', '0'], {
    stdio: 'ignore',
    timeout: timeoutMs,
    windowsHide: true,
  });
  if (result.error) {
    return `worker wrapper "${wrapper.path}" could not start: ${result.error.message}`;
  }
  if (result.status !== 0) {
    const how = result.signal ? `on signal ${result.signal}` : `with exit code ${result.status}`;
    return (
      `worker wrapper "${wrapper.path}" failed the pass-through probe ${how} ` +
      `(expected 0 while running "${execPath} -e 0"). ` +
      'Fix the wrapper or unset FORGE_WORKER_WRAPPER.'
    );
  }
  return null;
}

/** Compose the effective spawn target: wrapper first, real CLI as argv[0]. */
export function applyWorkerWrapper(
  wrapper: ForgeWorkerWrapper | null,
  bin: string,
  args: string[],
): { command: string; argv: string[] } {
  if (!wrapper) return { command: bin, argv: args };
  return { command: wrapper.path, argv: [bin, ...args] };
}
