import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

/**
 * A copy step that writes a complete, valid SQLite image synchronously.
 *
 * Tests that need "a real database image sitting at the destination" (most of the restore
 * suite) use this instead of node:sqlite's asynchronous backup API: that promise does not
 * settle inside a Vitest worker once the full suite is running (KI-56), which made those
 * tests fail for a reason that has nothing to do with restore behaviour. The online API
 * itself stays covered end-to-end by `tests/helpers/online-backup-child.ts`, which runs it in
 * a plain process the way the server does.
 */
export async function vacuumIntoCopy(source: DatabaseSync, destination: string): Promise<number> {
  source.exec(`VACUUM INTO '${destination.replaceAll("'", "''")}'`);
  return pageCount(readFileSync(destination));
}

/** Page count from the SQLite header (offset 16 page size, offset 28 page count). */
export function pageCount(image: Buffer): number {
  const rawPageSize = image.readUInt16BE(16);
  const pageSize = rawPageSize === 1 ? 65536 : rawPageSize;
  const declared = image.readUInt32BE(28);
  if (declared > 0) return declared;
  return Math.ceil(image.length / (pageSize || 1024));
}
