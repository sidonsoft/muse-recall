import { describe, expect, it } from 'vitest';
import {
  evaluateHealth,
  findingsToExit,
  formatFindings,
} from '../../apps/server/src/alert-prober.js';

const HEALTHY = {
  status: 'ok',
  service: 'muse-memory-lab',
  version: 'test',
  environment: 'test',
  uptime_seconds: 1,
  timestamp: new Date().toISOString(),
  database: { status: 'ok' },
  provider: { status: 'skipped' },
  forge: { storage_ok: true, unacknowledged_issues: 0 },
  alerts: {
    backup: {
      state: 'ok',
      latest_backup_at: null,
      age_hours: 0,
      max_age_hours: 24,
      backup_count: 1,
    },
    storage: { ok: true, unacknowledged_issues: 0 },
    provider: { state: 'skipped' },
  },
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('alert prober evaluation (D051)', () => {
  it('a clean payload yields no findings and exit 0', () => {
    const { findings } = evaluateHealth(HEALTHY);
    expect(findings).toEqual([]);
    expect(findingsToExit(findings)).toBe(0);
    expect(formatFindings(findings)).toContain('ALERT none');
  });

  it('stale backup with a live server is a finding (exit 1), not an outage', () => {
    const payload = clone(HEALTHY);
    payload.alerts.backup = {
      state: 'stale',
      latest_backup_at: '2026-10-28T00:00:00.000Z',
      age_hours: 57,
      max_age_hours: 24,
      backup_count: 3,
    };
    const { findings } = evaluateHealth(payload);
    expect(findings.map((f) => `${f.component}=${f.state}`)).toEqual(['backup=stale']);
    expect(findingsToExit(findings)).toBe(1);
  });

  it('storage issues open, provider error, and missing backups are separate findings', () => {
    const payload = clone(HEALTHY);
    payload.alerts.storage = { ok: true, unacknowledged_issues: 2 };
    payload.alerts.provider.state = 'error';
    payload.alerts.backup.state = 'missing';
    const keys = evaluateHealth(payload).findings.map((f) => `${f.component}=${f.state}`);
    expect(keys).toEqual(['backup=missing', 'storage=issues_open', 'provider=error']);
  });

  it('server status error exits 2 (outage), degraded exits 1', () => {
    const outage = clone(HEALTHY);
    outage.status = 'error';
    expect(findingsToExit(evaluateHealth(outage).findings)).toBe(2);
    const degraded = clone(HEALTHY);
    degraded.status = 'degraded';
    expect(findingsToExit(evaluateHealth(degraded).findings)).toBe(1);
  });

  it('unreachable endpoint exits 2; a non-health payload is unrecognized', () => {
    expect(findingsToExit([], true)).toBe(2);
    const { findings } = evaluateHealth({ greeting: 'hello' });
    expect(findings[0]?.state).toBe('unrecognized');
    expect(findingsToExit(findings)).toBe(1);
  });

  it('older servers without an alerts block still evaluate honestly', () => {
    const payload = clone(HEALTHY) as Record<string, unknown>;
    delete payload.alerts;
    const { findings } = evaluateHealth(payload);
    expect(findings.map((f) => `${f.component}=${f.state}`)).toEqual(['alerts=absent']);
  });
});
