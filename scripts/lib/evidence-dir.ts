import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Pick a free evidence directory name.
 *
 * The review harness stamped its output to the minute, so two runs inside the same minute wrote the
 * same directory and the second overwrote the first — measured, because a re-measurement 40 seconds
 * after another one destroyed the packet that run had just written (KI-86). Retained evidence is
 * never rewritten, so the harness has to fail that way rather than by construction.
 */
export interface UniqueDir {
  /** The directory to write into. Never an existing one. */
  path: string;
  /** Suffix applied, empty when the natural name was free. */
  suffix: string;
  /** Names already present that forced the choice, newest consideration first. */
  taken: string[];
}

export function uniqueEvidenceDir(parent: string, base: string): UniqueDir {
  const taken: string[] = [];
  if (!existsSync(join(parent, base))) {
    return { path: join(parent, base), suffix: '', taken };
  }
  taken.push(base);
  // Suffixes are ordered, so a rerun is predictable, and the collision is visible in the printed
  // path instead of hidden behind an overwrite.
  const siblings = readdirSync(parent);
  let attempt = 2;
  for (;;) {
    const candidate = `${base}-${String(attempt)}`;
    if (!siblings.includes(candidate)) {
      return { path: join(parent, candidate), suffix: `-${String(attempt)}`, taken };
    }
    taken.push(candidate);
    attempt += 1;
    if (attempt > 1000) {
      throw new Error(
        `no free evidence directory name under ${parent} after 1000 attempts at ${base}`,
      );
    }
  }
}

/**
 * A stamp with seconds. Minute stamps collided on purpose in review sessions, where several
 * re-measurements of the same artifact run back to back while a harness defect is being chased.
 */
export function evidenceStamp(now: Date = new Date()): string {
  return now.toISOString().replace(/[:.]/g, '').replace('T', '-').slice(0, 17);
}
