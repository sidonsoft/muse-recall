import { chmod, mkdir, writeFile } from 'node:fs/promises';

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

/** True only for a genuinely absent filesystem entry (ENOENT). */
export function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  );
}
