import { readdirSync } from 'node:fs';
import { basename, dirname } from 'node:path';

/**
 * Machine-readable alert signals surfaced inside GET /api/health (roadmap §8
 * / G4 groundwork). Health stays informational for alerting purposes: the
 * block exists so an EXTERNAL prober can watch named states — this server
 * does not itself send notifications, and saying so is part of the posture.
 */

export interface BackupFreshness {
  state: 'ok' | 'stale' | 'missing' | 'disabled';
  latest_backup_at: string | null;
  age_hours: number | null;
  max_age_hours: number;
  backup_count: number;
}

const BACKUP_SUFFIX = /^\d{8}T\d{6}Z$/;

function parseBackupStamp(stamp: string): Date | null {
  const at = new Date(
    `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`,
  );
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * Freshness of `pnpm db:backup` snapshots taken NEXT TO the database file
 * (the default destination; operator-chosen directories are their own cron
 * concern and deliberately not guessed here). Names come from
 * `defaultBackupPath`, so a malformed suffix is skipped, not trusted.
 */
export function scanBackupFreshness(
  databasePath: string,
  maxAgeHours: number,
  now: Date = new Date(),
): BackupFreshness {
  const base = {
    latest_backup_at: null as string | null,
    age_hours: null as number | null,
    max_age_hours: maxAgeHours,
    backup_count: 0,
  };
  if (databasePath === ':memory:') {
    return { ...base, state: 'disabled' };
  }
  if (maxAgeHours <= 0) return { ...base, state: 'disabled' };

  const dir = dirname(databasePath);
  const prefix = `${basename(databasePath)}.backup-`;
  let latest: Date | null = null;
  let count = 0;
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return { ...base, state: 'missing' };
  }
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    const stamp = name.slice(prefix.length);
    if (!BACKUP_SUFFIX.test(stamp)) continue;
    const at = parseBackupStamp(stamp);
    if (!at) continue;
    count += 1;
    if (!latest || at > latest) latest = at;
  }
  if (!latest) return { ...base, state: 'missing' };
  const ageHours = (now.getTime() - latest.getTime()) / 3_600_000;
  const rounded = Math.round(ageHours * 10) / 10;
  return {
    ...base,
    state: ageHours <= maxAgeHours ? 'ok' : 'stale',
    latest_backup_at: latest.toISOString(),
    age_hours: rounded,
    backup_count: count,
  };
}

export interface AlertSignals {
  backup: BackupFreshness;
  storage: { ok: boolean; unacknowledged_issues: number };
  provider: { state: 'ok' | 'error' | 'skipped' };
}

export function collectAlertSignals(input: {
  databasePath: string;
  maxAgeHours: number;
  storageOk: boolean;
  unacknowledgedIssues: number;
  providerStatus: 'ok' | 'error' | 'skipped';
  now?: Date;
}): AlertSignals {
  return {
    backup: scanBackupFreshness(input.databasePath, input.maxAgeHours, input.now ?? new Date()),
    storage: { ok: input.storageOk, unacknowledged_issues: input.unacknowledgedIssues },
    provider: { state: input.providerStatus },
  };
}
