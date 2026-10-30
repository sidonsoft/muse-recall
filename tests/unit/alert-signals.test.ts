import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectAlertSignals, scanBackupFreshness } from '../../apps/server/src/alert-signals.js';

/** Backup freshness must judge by the NAME stamp (written at backup time),
 * never by mtime, and never trust malformed names. */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'alert-signals-'));
  dirs.push(dir);
  return dir;
}

const NOW = new Date('2026-10-30T12:00:00.000Z');

describe('scanBackupFreshness', () => {
  it('reports missing when no snapshot names exist', () => {
    const dir = workspace();
    const result = scanBackupFreshness(join(dir, 'app.db'), 24, NOW);
    expect(result.state).toBe('missing');
    expect(result.backup_count).toBe(0);
  });

  it('ok for a fresh snapshot, stale for an old one, counting only valid names', () => {
    const dir = workspace();
    writeFileSync(join(dir, 'app.db.backup-20261030T110000Z'), 'x');
    const fresh = scanBackupFreshness(join(dir, 'app.db'), 24, NOW);
    expect(fresh.state).toBe('ok');
    expect(fresh.age_hours).toBe(1);
    expect(fresh.backup_count).toBe(1);

    writeFileSync(join(dir, 'app.db.backup-20261020T110000Z'), 'x');
    writeFileSync(join(dir, 'app.db.backup-not-a-stamp'), 'x');
    writeFileSync(join(dir, 'other.db.backup-20261030T113000Z'), 'x');
    const latest = scanBackupFreshness(join(dir, 'app.db'), 24, NOW);
    expect(latest.state).toBe('ok');
    expect(latest.backup_count).toBe(2); // malformed + other-db names ignored
    expect(latest.age_hours).toBe(1);

    // A boundary maxAge equal to the age is still OK; staleness needs a
    // genuinely older newest snapshot.
    const boundary = scanBackupFreshness(join(dir, 'app.db'), 1, NOW);
    expect(boundary.state).toBe('ok');
    const staleDir = workspace();
    writeFileSync(join(staleDir, 'app.db.backup-20261020T110000Z'), 'x');
    const stale = scanBackupFreshness(join(staleDir, 'app.db'), 1, NOW);
    expect(stale.state).toBe('stale');
  });

  it('disabled for :memory: databases and maxAge 0', () => {
    expect(scanBackupFreshness(':memory:', 24, NOW).state).toBe('disabled');
    const dir = workspace();
    expect(scanBackupFreshness(join(dir, 'app.db'), 0, NOW).state).toBe('disabled');
  });

  it('collectAlertSignals passes through storage and provider states verbatim', () => {
    const signals = collectAlertSignals({
      databasePath: ':memory:',
      maxAgeHours: 24,
      storageOk: false,
      unacknowledgedIssues: 3,
      providerStatus: 'skipped',
      now: NOW,
    });
    expect(signals.backup.state).toBe('disabled');
    expect(signals.storage).toEqual({ ok: false, unacknowledged_issues: 3 });
    expect(signals.provider.state).toBe('skipped');
  });
});
