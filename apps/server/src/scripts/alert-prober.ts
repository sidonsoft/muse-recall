import { evaluateHealth, findingsToExit, formatFindings } from '../alert-prober.js';
import { loadDotEnv } from '../config.js';

/**
 * `pnpm ops:alert-prober [base-url]` — a cron-ready consumer for the alert
 * signals inside GET /api/health (D050/D051). Exit 0 healthy, 1 findings
 * (cron MAILTO/forwarder delivers stdout), 2 unreachable or broken response.
 * Token mode: set ACCESS_TOKEN (or .env) and it sends the bearer header.
 */
async function main(): Promise<void> {
  loadDotEnv();
  const base = process.argv[2] ?? 'http://127.0.0.1:8787';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const headers: Record<string, string> = {};
    const token = process.env.ACCESS_TOKEN;
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await fetch(`${base.replace(/\/$/, '')}/api/health`, {
      signal: controller.signal,
      headers,
    });
    if (response.status !== 200) {
      console.log(`ALERT endpoint=http_status_${String(response.status)}: unexpected status`);
      process.exitCode = 2;
      return;
    }
    const body = (await response.json()) as { data?: unknown };
    const { findings } = evaluateHealth(body.data ?? body);
    console.log(formatFindings(findings));
    process.exitCode = findingsToExit(findings);
  } catch (error) {
    console.log(
      `ALERT endpoint=unreachable: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 2;
  } finally {
    clearTimeout(timer);
  }
}

void main();
