import { z } from 'zod';
import { ForgeRecoveryIssueSchema } from './forge.js';

export const ServiceStatusSchema = z.enum(['ok', 'degraded', 'error']);
export type ServiceStatus = z.infer<typeof ServiceStatusSchema>;

export const ComponentStatusSchema = z.enum(['ok', 'degraded', 'error', 'skipped']);
export type ComponentStatus = z.infer<typeof ComponentStatusSchema>;

/**
 * A single dependency check.
 *
 * `detail` is written for a human debugging a demo five minutes before
 * submission, so it states what was actually observed.
 */
export const ComponentCheckSchema = z.object({
  status: ComponentStatusSchema,
  detail: z.string(),
  latency_ms: z.number().int().min(0).nullable(),
});
export type ComponentCheck = z.infer<typeof ComponentCheckSchema>;

/**
 * Provider health, including whether a *real* round-trip succeeded.
 * This is what separates a liveness ping from an integration check.
 */
export const ProviderCheckSchema = ComponentCheckSchema.extend({
  provider_id: z.string(),
  provider_name: z.string(),
  model: z.string().nullable(),
  /** True only when a real model call returned in this process. */
  verified_with_live_call: z.boolean(),
  capabilities: z
    .object({
      streaming: z.boolean(),
      tool_calling: z.boolean(),
      structured_output: z.boolean(),
      max_context_tokens: z.number().int().positive(),
    })
    .nullable(),
});
export type ProviderCheck = z.infer<typeof ProviderCheckSchema>;

export const DatabaseCheckSchema = ComponentCheckSchema.extend({
  engine: z.string(),
  path: z.string(),
  /** Schema version currently applied, from the migration table. */
  schema_version: z.number().int().min(0),
  /** True when a real write/read/rollback round-trip succeeded. */
  write_verified: z.boolean(),
});
export type DatabaseCheck = z.infer<typeof DatabaseCheckSchema>;

/**
 * Store-wide Forge recovery summary for operators who have not opened a
 * project (NEXT_STEPS P1 #8). Read-only display data: acknowledgement and
 * repair stay in the Studio project view, which remains the full source.
 */
export const ForgeHealthSummarySchema = z.object({
  storage_ok: z.boolean(),
  unacknowledged_issues: z.number().int().min(0),
  acknowledged_issues: z.number().int().min(0),
  interrupted_jobs_current: z.number().int().min(0),
  interrupted_jobs_startup: z.number().int().min(0),
  loaded_jobs_startup: z.number().int().min(0),
  /** Display subset; bounded so health stays a small, fast payload. */
  issues: z.array(ForgeRecoveryIssueSchema).max(5),
});
export type ForgeHealthSummary = z.infer<typeof ForgeHealthSummarySchema>;

/**
 * Alert signals (roadmap §8 groundwork): states an EXTERNAL prober can watch.
 * This server never sends notifications itself — the block exists so a cron
 * or uptime monitor can alert on named states without parsing prose.
 */
export const BackupFreshnessSchema = z.object({
  state: z.enum(['ok', 'stale', 'missing', 'disabled']),
  latest_backup_at: z.string().nullable(),
  age_hours: z.number().min(0).nullable(),
  max_age_hours: z.number().min(0),
  backup_count: z.number().int().min(0),
});
export type BackupFreshness = z.infer<typeof BackupFreshnessSchema>;

export const AlertSignalsSchema = z.object({
  backup: BackupFreshnessSchema,
  storage: z.object({ ok: z.boolean(), unacknowledged_issues: z.number().int().min(0) }),
  provider: z.object({ state: z.enum(['ok', 'error', 'skipped']) }),
});
export type AlertSignals = z.infer<typeof AlertSignalsSchema>;

/**
 * Setup readiness — the "can this judge actually run each documented path?"
 * panel (server startup, `pnpm judge:check`, and the System screen).
 *
 * It deliberately reports *configuration and local prerequisites*, never model
 * availability: probing it performs no network request and spends no quota, so
 * it can run on every startup. A live provider call stays a deliberate POST to
 * `/api/health/muse`.
 *
 * Four states, chosen so "not needed for this path" never reads as a failure:
 *   ready          the prerequisite is present
 *   missing        needed and absent; `fix` says what to run
 *   not_available  cannot be satisfied in this environment (Codespaces CLI)
 *   not_probed     present, but the deeper condition is not checked here
 *                  (a CLI binary on PATH says nothing about its login state)
 */
export const SetupProbeStateSchema = z.enum(['ready', 'missing', 'not_available', 'not_probed']);
export type SetupProbeState = z.infer<typeof SetupProbeStateSchema>;

export const SetupProbeSchema = z.object({
  state: SetupProbeStateSchema,
  /** What was actually seen, bounded, secret-free. */
  detail: z.string().max(240),
  /** Exact command or setting that would change this row; null when nothing to do. */
  fix: z.string().max(300).nullable(),
});
export type SetupProbe = z.infer<typeof SetupProbeSchema>;

/**
 * How each state is worded to a reader. "ready" is not one thing across rows:
 * the media row means a key is configured, the browser row means an executable
 * exists, the demo row means the project and its artifact were inspected. Naming
 * the state per row keeps a presence check from reading like a live check, and
 * keeps the terminal panel and the System screen using the same words.
 */
export const SETUP_STATE_WORD: Record<SetupProbeState, string> = {
  ready: 'ready',
  missing: 'missing',
  not_available: 'not here',
  not_probed: 'unverified',
};

/** What "ready" means for each row, said in the row's own terms. */
export const SETUP_READY_WORD: Record<SetupRowKey, string> = {
  cli: 'found',
  media_api: 'configured',
  browser: 'installed',
  offline_seed: 'seeded',
};

export type SetupRowKey = 'cli' | 'media_api' | 'browser' | 'offline_seed';

export function setupStateWord(row: SetupRowKey, state: SetupProbeState): string {
  return state === 'ready' ? SETUP_READY_WORD[row] : SETUP_STATE_WORD[state];
}

export const SetupReadinessSchema = z.object({
  generated_at: z.iso.datetime(),
  /** `codespaces` changes what the generation path can promise. */
  environment: z.enum(['local', 'codespaces']),
  provider: z.string(),
  /** Path 2 — live application generation through the coding CLI. */
  cli: SetupProbeSchema,
  /** Path 3 — image / segmentation / transcription / screenshot review. */
  media_api: SetupProbeSchema,
  /** Whether a staged application can be verified in a real browser. */
  browser: SetupProbeSchema,
  /** Path 1 — the seeded offline demo workspace and its database. */
  offline_seed: SetupProbeSchema,
});
export type SetupReadiness = z.infer<typeof SetupReadinessSchema>;

export const HealthResponseSchema = z.object({
  status: ServiceStatusSchema,
  service: z.literal('muse-memory-lab'),
  version: z.string(),
  environment: z.string(),
  uptime_seconds: z.number().min(0),
  timestamp: z.iso.datetime(),
  database: DatabaseCheckSchema,
  provider: ProviderCheckSchema,
  forge: ForgeHealthSummarySchema.optional(),
  alerts: AlertSignalsSchema.optional(),
  /** Setup readiness for the three documented judge paths. */
  setup: SetupReadinessSchema.optional(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/** Response for the lightweight liveness probe, used by CI and the UI. */
export const LivenessResponseSchema = z.object({
  status: z.literal('ok'),
  timestamp: z.iso.datetime(),
});
export type LivenessResponse = z.infer<typeof LivenessResponseSchema>;
