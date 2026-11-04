/**
 * `pnpm exec tsx scripts/codespaces-seed-check.ts` — the seed decision for
 * `.devcontainer/setup.sh`, in machine-readable form.
 *
 * Prints `SEED_DECISION=seed|skip` on stdout (the line setup.sh consumes) and
 * the human reason on stderr. Exit 0 whenever a decision was reached; exit 2
 * when even the check failed — setup treats that as `skip`, because an
 * unchecked seed is the destructive direction.
 *
 * Reads `SEED_DEMO` and `WORKSPACE_ROOT` from the environment, exactly as the
 * seed and the server resolve them.
 */
import { checkSeedGuard, type SeedGuardResult } from './lib/codespaces-seed-guard.js';

let result: SeedGuardResult;
try {
  result = checkSeedGuard();
} catch (error) {
  console.error(
    `seed guard crashed (${error instanceof Error ? error.message : String(error)}); refusing to seed.`,
  );
  console.log('SEED_DECISION=skip');
  process.exit(2);
}
console.error(result.reason);
if (result.envFile) console.error(`config: ${result.envFile}`);
console.log(`SEED_DECISION=${result.decision}`);
