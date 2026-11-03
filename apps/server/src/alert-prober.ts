import type { HealthResponse } from '@mml/shared';

/**
 * The alert CONSUMER half of D050: evaluate a GET /api/health payload into
 * named findings and a cron-friendly exit code. This process never pages
 * anyone itself — cron mail, a forwarder, or the monitor of your choice does.
 *
 * Exit-code contract (D051):
 *   0  healthy: server alive AND every alert state acceptable
 *   1  findings to act on (degraded server, stale/missing backup, storage
 *      issues, provider error) — cron mail/forwarder should deliver them
 *   2  cannot evaluate: endpoint unreachable or response not the expected
 *      health payload (the prober itself is broken, or the server is down)
 */

export interface Finding {
  component: string;
  state: string;
  detail: string;
}

export function evaluateHealth(payload: unknown): { findings: Finding[] } {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    typeof (payload as HealthResponse).status !== 'string'
  ) {
    return {
      findings: [{ component: 'response', state: 'unrecognized', detail: 'not a health payload' }],
    };
  }
  const health = payload as HealthResponse;
  const findings: Finding[] = [];

  if (health.status === 'error') {
    findings.push({ component: 'status', state: 'error', detail: 'server reports error status' });
  } else if (health.status === 'degraded') {
    findings.push({
      component: 'status',
      state: 'degraded',
      detail: 'server reports degraded status',
    });
  }

  const alerts = health.alerts;
  if (!alerts) {
    findings.push({
      component: 'alerts',
      state: 'absent',
      detail: 'server predates alert signals or omitted them',
    });
    return { findings };
  }

  if (alerts.backup.state === 'stale') {
    findings.push({
      component: 'backup',
      state: 'stale',
      detail: `newest snapshot ${String(alerts.backup.age_hours)}h old (max ${String(alerts.backup.max_age_hours)}h)`,
    });
  } else if (alerts.backup.state === 'missing') {
    findings.push({
      component: 'backup',
      state: 'missing',
      detail: 'no db:backup snapshots found',
    });
  }

  if (!alerts.storage.ok) {
    findings.push({
      component: 'storage',
      state: 'not_ok',
      detail: `unacknowledged issues: ${String(alerts.storage.unacknowledged_issues)}`,
    });
  } else if (alerts.storage.unacknowledged_issues > 0) {
    findings.push({
      component: 'storage',
      state: 'issues_open',
      detail: `${String(alerts.storage.unacknowledged_issues)} unacknowledged issues`,
    });
  }

  if (alerts.provider.state === 'error') {
    findings.push({
      component: 'provider',
      state: 'error',
      detail: 'provider health check failed',
    });
  }

  return { findings };
}

export function findingsToExit(findings: Finding[], unreachable = false): number {
  if (unreachable) return 2;
  if (findings.some((f) => f.component === 'status' && f.state === 'error')) return 2;
  return findings.length > 0 ? 1 : 0;
}

export function formatFindings(findings: Finding[]): string {
  if (findings.length === 0) return 'ALERT none: all states acceptable';
  return findings.map((f) => `ALERT ${f.component}=${f.state}: ${f.detail}`).join('\n');
}
