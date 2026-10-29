import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, isAbsolute, join, resolve } from 'node:path';

/**
 * Whether the Studio generation CLI can be started at all.
 *
 * A best-effort check that mirrors how `spawn` finds the binary: a path is
 * checked directly, a bare name is searched on `PATH`. It lets the UI say
 * "generation needs the Muse CLI" up front (for example in Codespaces, where
 * it is not installed) instead of failing a job with `spawn muse ENOENT`.
 */
export function isCliAvailable(bin: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (isAbsolute(bin) || bin.includes('/') || bin.includes('\\')) return isExecutable(resolve(bin));
  const extensions =
    process.platform === 'win32' ? ['', ...(env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';')] : [''];
  for (const directory of (env.PATH ?? '').split(delimiter)) {
    if (directory.length === 0) continue;
    for (const extension of extensions) {
      if (isExecutable(join(directory, bin + extension))) return true;
    }
  }
  return false;
}

function isExecutable(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
