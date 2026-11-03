import { chmod, mkdir, open, writeFile } from 'node:fs/promises';

/** Create a directory that only the owning user can enter. */
export async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
}

/** Write a file that only the owning user can read or write. */
export async function writePrivateFile(file: string, data: string | Uint8Array): Promise<void> {
  if (typeof data === 'string') {
    await writeFile(file, data, { encoding: 'utf8', mode: 0o600 });
  } else {
    await writeFile(file, data, { mode: 0o600 });
  }
  await chmod(file, 0o600);
}

/**
 * Flush a file's data and metadata to the device.
 *
 * Called on a temporary file *before* it is renamed into place, so a power
 * loss after the rename can never publish an entry whose bytes are missing.
 * Genuine errors (EIO) propagate; the caller treats them like a write failure.
 */
export async function syncFile(file: string): Promise<void> {
  const handle = await open(file, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Make a directory entry (a create or rename result) durable.
 *
 * Best-effort by portability, not by preference: platforms that refuse to
 * open or fsync a directory simply lose this extra guarantee while the file
 * sync above still holds. Errors are swallowed and documented, never hidden.
 */
export async function syncDirectory(directory: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(directory, 'r');
    await handle.sync();
  } catch {
    // Directory fsync is not portable; the write remains atomic, just
    // potentially absent from the directory entry after a hard crash.
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/** True only for a genuinely absent filesystem entry (ENOENT). */
export function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  );
}
