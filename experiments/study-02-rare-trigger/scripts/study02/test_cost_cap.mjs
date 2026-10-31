/**
 * Offline tests for the qualification cost-cap / reservation ledger. No model calls, no network.
 * Run: pnpm exec tsx experiments/study-02-rare-trigger/scripts/study02/test_cost_cap.mjs
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  CostCap, actualUsageMicro, microUsd, promptTokenUpperBound, reservationMicro,
} from './cost_cap.mjs';

let failures = 0;
function assert(condition, message) {
  if (condition) console.log(`  ok   ${message}`);
  else { failures += 1; console.error(`  FAIL ${message}`); }
}
function throws(fn, matcher, message) {
  try { fn(); failures += 1; console.error(`  FAIL ${message} (did not throw)`); }
  catch (error) { assert(matcher.test(String(error.message)), `${message}: ${String(error.message).slice(0, 120)}`); }
}

const rates = { inputUsdPerMillion: 1.25, outputUsdPerMillion: 4.25, cachedUsdPerMillion: 0.15 };
const root = mkdtempSync(path.join(os.tmpdir(), 's02-costcap-test-'));
try {
  console.log('arithmetic');
  assert(microUsd(1_000_000, 1.25) === 1_250_000, '1M tokens at $1.25 = $1.25 (1.25M micro)');
  assert(promptTokenUpperBound(24_000) === 8_000, 'chars/3 token upper bound');
  const proj = reservationMicro({ promptChars: 24_000, maxTokens: 32_000, rates });
  assert(proj.inputUpper === 8_000, 'reservation input upper');
  assert(proj.amountMicro === 146_000, `reservation worst case = $0.146 (got ${proj.amountMicro} micro)`);
  const usage = actualUsageMicro({ usage: { prompt_tokens: 6_000, completion_tokens: 8_000 }, rates });
  assert(usage.totalMicro === 41_500, `actual usage micro (got ${usage.totalMicro})`);

  console.log('admission');
  const cap = new CostCap({ capUsd: 6, rates });
  for (let i = 0; i < 41; i += 1) cap.reserve(`r${i}`, { promptChars: 24_000, maxTokens: 32_000 });
  assert(cap.reservedMicro === 41 * 146_000, '41 worst-case reservations fit under $6 ($5.986)');
  throws(() => cap.reserve('r41', { promptChars: 24_000, maxTokens: 32_000 }), /admission refused/, 'cap refuses the 42nd worst-case request');
  cap.release('r0', 'test release');
  const afterRelease = cap.reserve('r41', { promptChars: 24_000, maxTokens: 32_000 });
  assert(afterRelease.amountMicro === 146_000, 'released reservation allows one more');
  assert(cap.reservedMicro === 41 * 146_000, 'reserved total after release+reserve');

  console.log('settlement');
  const settle = cap.settle('r1', { usage: { prompt_tokens: 6_000, completion_tokens: 8_000 }, httpStatus: 200 });
  assert(settle.chargeMicro === 41_500, 'settles at actual usage');
  assert(cap.spentMicro === 41_500, 'spent updated');
  assert(cap.reservedMicro === 41 * 146_000 - 146_000, 'reservation released on settle');

  console.log('usage-missing conservatism');
  cap.settle('r2', { usage: null });
  assert(cap.spentMicro === 41_500 + 146_000, 'missing usage charges the reservation');

  console.log('overrun hard stop');
  const small = new CostCap({ capUsd: 1, rates });
  small.reserve('x', { promptChars: 3_000, maxTokens: 1_000 });
  const over = small.settle('x', { usage: { prompt_tokens: 2_000, completion_tokens: 5_000 } });
  assert(over.overrun, 'overrun flagged');
  assert(small.hardStop, 'hard stop set');
  throws(() => small.reserve('y', { promptChars: 10, maxTokens: 10 }), /hard stop/, 'hard stop refuses new reservations');

  console.log('persistence and conservative recovery');
  const ledger = path.join(root, 'ledger.json');
  const p1 = new CostCap({ capUsd: 6, rates, ledgerFile: ledger });
  p1.reserve('a', { promptChars: 24_000, maxTokens: 32_000 });
  p1.reserve('b', { promptChars: 24_000, maxTokens: 32_000 });
  p1.settle('a', { usage: { prompt_tokens: 6_000, completion_tokens: 8_000 } });
  const saved = JSON.parse(readFileSync(ledger, 'utf8'));
  assert(saved.spentMicro === 41_500 && saved.reservedMicro === 146_000, 'ledger persisted spent+reserved');
  const p2 = new CostCap({ capUsd: 6, rates, ledgerFile: ledger });
  assert(p2.spentMicro === 41_500 + 146_000, 'outstanding reservation charged conservatively on reload');
  assert(p2.records.some((r) => r.recoveredOutstanding), 'recovery recorded for reconciliation');

  console.log('plan-fit assertion');
  const planned = new CostCap({ capUsd: 6, rates });
  const fit = planned.assertPlanFits({ requests: 32, promptCharsPerRequest: 24_000, maxTokensPerRequest: 32_000 });
  assert(fit.totalUsd < 6, `32 worst-case requests fit under $6 ($${fit.totalUsd.toFixed(2)})`);
  throws(() => new CostCap({ capUsd: 3, rates }).assertPlanFits({ requests: 32, promptCharsPerRequest: 24_000, maxTokensPerRequest: 32_000 }), /exceeds cap/, 'plan fit refuses a too-small cap');
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} cost-cap test(s) failed`);
  process.exit(1);
}
console.log('\nall cost-cap tests passed');
