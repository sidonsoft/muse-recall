import { spawnSync } from 'node:child_process';
import {
  accessSync,
  chmodSync,
  closeSync,
  constants,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

/**
 * Forge worker launch wrapper (roadmap G-2 / NEXT_STEPS P0 #4).
 *
 * The environment allow-list reduces accidental exposure, but the Forge CLI
 * still inherits the server user's OS permissions. This module adds the
 * code-side seam: `FORGE_WORKER_WRAPPER` names an absolute, executable
 * pass-through wrapper that launches the real CLI instead of it
 * (`wrapper <bin> <args...>`). Operators point it at a container launcher
 * (staging bind-mount uid-mapped to the server euid), a same-uid
 * `systemd-run` scope, or a sandbox-exec profile. UID-CHANGING wrappers
 * (setpriv-style) are NOT supported until worker-group ACL support lands
 * (KI-49 / action register C-13): the staging tree and prompt file are
 * server-owned 0700/0600.
 *
 * Fail-fast contract: a configured wrapper that cannot be verified at startup
 * refuses boot, because a silently ignored wrapper would be a false sense of
 * isolation. Two probes, both executed for real at startup:
 *  1. pass-through: `<wrapper> node -e 0` proves argv passthrough and PATH;
 *  2. staging access (beta fix for KI-49's trap): the wrapper runs node with
 *     cwd = a 0700 scratch staging dir, reading a 0600 prompt file inside it
 *     and writing a file into the dir — the EXACT accesses every generation
 *     performs. A wrapper that cannot pass refuses BOOT instead of killing
 *     the first paid generation with EACCES mid-job.
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

/**
 * Prove the wrapper can perform the accesses EVERY Forge generation needs:
 * cwd = the job staging dir (0700, server-owned), read of `prompt.txt`
 * (0600), and file writes inside the staging dir. This mirrors
 * ensurePrivateDirectory/writePrivateFile (fs-utils) and the runner's
 * `--prompt-file` + cwd contract, in a throwaway scratch copy.
 *
 * KI-49's trap in one sentence: this used to be UNtested — a wrapper that
 * changes uid booted happily and then died with EACCES inside the first
 * real generation. Now it refuses boot. Returns null on success or an
 * actionable failure description.
 */
export function probeWorkerStagingAccess(
  wrapper: ForgeWorkerWrapper,
  options: {
    timeoutMs?: number;
    execPath?: string;
    /** TEST SEAM: parent directory for the scratch tree (default os.tmpdir()). */
    scratchRoot?: string;
  } = {},
): string | null {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const execPath = options.execPath ?? process.execPath;
  const parent = options.scratchRoot ?? tmpdir();
  if (options.scratchRoot) {
    // Point the probe INSIDE the server's real workspace tree (what a
    // container launcher's staging bind-mount covers); create it the way the
    // server creates its own trees.
    mkdirSync(parent, { recursive: true, mode: 0o700 });
  }
  const scratch = mkdtempSync(join(parent, 'mml-wrapper-probe-'));
  try {
    const staging = join(scratch, 'staging');
    mkdirSync(staging, { recursive: true, mode: 0o700 });
    chmodSync(staging, 0o700);
    const prompt = join(staging, 'prompt.txt');
    closeSync(openSync(prompt, 'wx', 0o600));
    writeFileSync(prompt, 'worker wrapper staging probe\n', 'utf8');
    chmodSync(prompt, 0o600);

    // argv after `-e <script>`: argv[1] is the prompt path. The script reads
    // the 0600 file, writes into cwd (must be the 0700 dir), reads it back.
    const script =
      'const fs = require("node:fs");' +
      'const promptPath = process.argv[1];' +
      'const want = fs.readFileSync(promptPath, "utf8");' +
      'fs.writeFileSync("probe.ok", want);' +
      'if (fs.readFileSync("probe.ok", "utf8") !== want) process.exit(2);';
    const result = spawnSync(wrapper.path, [execPath, '-e', script, prompt], {
      cwd: staging,
      stdio: 'ignore',
      timeout: timeoutMs,
      windowsHide: true,
    });
    if (result.error) {
      return `worker wrapper "${wrapper.path}" could not start for the staging-access probe: ${result.error.message}`;
    }
    if (result.status !== 0) {
      const how = result.signal ? `on signal ${result.signal}` : `with exit code ${result.status}`;
      return (
        `worker wrapper "${wrapper.path}" failed the staging-access probe ${how}. ` +
        'The probe reproduces the exact accesses every Forge generation performs through the ' +
        'wrapper: cwd = a 0700 staging directory, a read of a 0600 prompt file inside it, and ' +
        'file writes inside the same directory - all server-owned. A wrapper that changes uid ' +
        '(setpriv-style) cannot pass this until worker-group ACL support lands (KI-49). ' +
        'Use a provisioning path that works (docs/ops/OPERATOR_RUNBOOKS.md, "Forge worker ' +
        'isolation": container launcher with a uid-mapped staging bind-mount, or a same-uid ' +
        'scope wrapper), fix the wrapper, or unset FORGE_WORKER_WRAPPER.'
      );
    }
    return null;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
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
