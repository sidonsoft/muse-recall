/**
 * Study 02 — qualification cost cap with pre-dispatch reservation (Director requirement #1).
 *
 * Director decision: Baseten qualification is authorized up to **$6 USD**, conditional on
 * verified billing/credentials. The harness must enforce the cap using **actual usage plus a
 * conservative reservation for outstanding requests**, not post-hoc estimation.
 *
 * Money is tracked in integer micro-USD (1e-6 USD) so the ledger is exact and auditable.
 * Public Baseten rates are USD per 1M tokens; $X per 1M tokens = X micro-USD per token, so
 * `microUsd(tokens, rateUsdPerMillion) = tokens * rateUsdPerMillion` (ceil).
 *
 * Admission rule (before dispatch):
 *     spent + reserved + newReservation  <=  cap
 * where the reservation for one request is calculated from the *worst case*:
 *     inputUpper = ceil(promptChars / 3)        (conservative token upper bound; see note)
 *     outputMax  = max_tokens requested (or the provider's applicable cap)
 *     reservation = ceil(inputUpper * inRate) + ceil(outputMax * outRate)
 * The reservation is conservative (chars/3 over-estimates tokens for English/HTML; cached
 * input is not assumed). If actual usage later exceeds its reservation, the ledger records an
 * overrun and hard-stops — that indicates the reservation model was wrong and the run must not
 * continue silently.
 *
 * The ledger is persisted atomically and can be re-read after an interruption. No network.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const COST_CAP_VERSION = 's02-cost-cap-1.0';

/** Convert a USD-per-1M-tokens rate to integer micro-USD for a token count. */
export function microUsd(tokens, usdPerMillion) {
  if (!Number.isFinite(tokens) || tokens < 0) throw new Error(`invalid token count ${tokens}`);
  if (!Number.isFinite(usdPerMillion) || usdPerMillion < 0) throw new Error(`invalid rate ${usdPerMillion}`);
  return Math.ceil(tokens * usdPerMillion);
}

/** Conservative prompt-token upper bound used for reservation (documented assumption). */
export function promptTokenUpperBound(promptChars) {
  if (!Number.isInteger(promptChars) || promptChars < 0) throw new Error(`invalid promptChars ${promptChars}`);
  return Math.ceil(promptChars / 3);
}

export function reservationMicro({ promptChars, maxTokens, rates }) {
  const inputUpper = promptTokenUpperBound(promptChars);
  const inputMicro = microUsd(inputUpper, rates.inputUsdPerMillion);
  const outputMicro = microUsd(maxTokens, rates.outputUsdPerMillion);
  return {
    inputUpper,
    outputMax: maxTokens,
    inputMicro,
    outputMicro,
    amountMicro: inputMicro + outputMicro,
  };
}

export function actualUsageMicro({ usage, rates }) {
  const promptTokens = Number(usage?.prompt_tokens ?? 0);
  const completionTokens = Number(usage?.completion_tokens ?? 0);
  const cachedTokens = Number(usage?.prompt_tokens_details?.cached_tokens ?? 0);
  const uncachedInput = Math.max(0, promptTokens - cachedTokens);
  return {
    promptTokens,
    completionTokens,
    cachedTokens,
    inputMicro: microUsd(uncachedInput, rates.inputUsdPerMillion),
    cachedMicro: microUsd(cachedTokens, rates.cachedUsdPerMillion ?? 0),
    outputMicro: microUsd(completionTokens, rates.outputUsdPerMillion),
    totalMicro: microUsd(uncachedInput, rates.inputUsdPerMillion)
      + microUsd(cachedTokens, rates.cachedUsdPerMillion ?? 0)
      + microUsd(completionTokens, rates.outputUsdPerMillion),
  };
}

export class CostCap {
  /**
   * @param {object} options
   * @param {number} options.capUsd hard cap in USD (e.g. 6.00)
   * @param {{inputUsdPerMillion:number,outputUsdPerMillion:number,cachedUsdPerMillion?:number}} options.rates
   * @param {string|null} options.ledgerFile optional path for atomic persistence
   */
  constructor({ capUsd, rates, ledgerFile = null }) {
    if (!Number.isFinite(capUsd) || capUsd <= 0) throw new Error('capUsd must be a positive number');
    this.capMicro = Math.round(capUsd * 1e6);
    this.capUsd = this.capMicro / 1e6;
    this.rates = { ...rates };
    if (!Number.isFinite(this.rates.inputUsdPerMillion) || !Number.isFinite(this.rates.outputUsdPerMillion)) {
      throw new Error('rates.inputUsdPerMillion and rates.outputUsdPerMillion are required');
    }
    this.ledgerFile = ledgerFile;
    this.spentMicro = 0;
    this.reserved = new Map();
    this.hardStop = false;
    this.stopReason = null;
    this.records = [];
    this.createdAt = new Date().toISOString();
    if (ledgerFile) this.load();
  }

  get reservedMicro() {
    let total = 0;
    for (const value of this.reserved.values()) total += value.amountMicro;
    return total;
  }

  get availableMicro() {
    return this.capMicro - this.spentMicro - this.reservedMicro;
  }

  snapshot() {
    return {
      version: COST_CAP_VERSION,
      capUsd: this.capUsd,
      capMicro: this.capMicro,
      rates: this.rates,
      spentMicro: this.spentMicro,
      spentUsd: this.spentMicro / 1e6,
      reservedMicro: this.reservedMicro,
      reservedUsd: this.reservedMicro / 1e6,
      availableMicro: this.availableMicro,
      availableUsd: this.availableMicro / 1e6,
      hardStop: this.hardStop,
      stopReason: this.stopReason,
      outstanding: [...this.reserved.entries()].map(([id, value]) => ({ id, ...value })),
      records: this.records,
      createdAt: this.createdAt,
      updatedAt: new Date().toISOString(),
    };
  }

  persist() {
    if (!this.ledgerFile) return;
    mkdirSync(path.dirname(this.ledgerFile), { recursive: true });
    const tmp = `${this.ledgerFile}.tmp-${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify(this.snapshot(), null, 2)}\n`);
    renameSync(tmp, this.ledgerFile);
  }

  load() {
    if (!existsSync(this.ledgerFile)) return;
    const saved = JSON.parse(readFileSync(this.ledgerFile, 'utf8'));
    if (saved.version !== COST_CAP_VERSION) throw new Error(`ledger version mismatch: ${saved.version}`);
    if (saved.capMicro !== this.capMicro) throw new Error('ledger cap differs from configured cap');
    this.spentMicro = saved.spentMicro ?? 0;
    this.hardStop = Boolean(saved.hardStop);
    this.stopReason = saved.stopReason ?? null;
    this.records = saved.records ?? [];
    this.reserved = new Map();
    // A restart cannot know the fate of requests that were outstanding when the ledger was
    // written. Charge each recovered reservation to spent (conservative: no refund, unknown
    // usage counted at the worst-case reservation) and record it for reconciliation.
    for (const item of saved.outstanding ?? []) {
      this.spentMicro += item.amountMicro;
      this.records.push({
        id: item.id,
        recoveredOutstanding: true,
        reservationMicro: item.amountMicro,
        chargeMicro: item.amountMicro,
        recoveredAt: new Date().toISOString(),
        note: 'outstanding at ledger load; charged conservatively at reservation',
      });
    }
    if (saved.outstanding?.length) this.persist();
    if (this.spentMicro > this.capMicro) {
      this.hardStop = true;
      this.stopReason = `recovered spend $${(this.spentMicro / 1e6).toFixed(6)} exceeded cap $${this.capUsd.toFixed(2)}`;
    }
  }

  /** Admit/reserve a request; throws if the cap would be exceeded. */
  reserve(id, { promptChars, maxTokens }) {
    if (this.hardStop) throw new Error(`cost cap hard stop: ${this.stopReason}`);
    if (this.reserved.has(id)) throw new Error(`reservation ${id} already exists`);
    const projection = reservationMicro({ promptChars, maxTokens, rates: this.rates });
    if (this.spentMicro + this.reservedMicro + projection.amountMicro > this.capMicro) {
      const error = new Error(
        `cost cap admission refused for ${id}: ` +
        `spent $${(this.spentMicro / 1e6).toFixed(6)} + reserved $${(this.reservedMicro / 1e6).toFixed(6)} ` +
        `+ request $${(projection.amountMicro / 1e6).toFixed(6)} > cap $${this.capUsd.toFixed(2)}`,
      );
      error.code = 'COST_CAP_EXCEEDED';
      throw error;
    }
    const value = { ...projection, reservedAt: new Date().toISOString() };
    this.reserved.set(id, value);
    this.persist();
    return value;
  }

  /** Settle a completed request with actual usage (or conservatively charge the reservation). */
  settle(id, { usage = null, httpStatus = null, note = null } = {}) {
    const reservation = this.reserved.get(id);
    if (!reservation) throw new Error(`settle for unknown reservation ${id}`);
    this.reserved.delete(id);
    const hasUsage = usage && Number.isFinite(Number(usage.prompt_tokens)) && Number.isFinite(Number(usage.completion_tokens));
    const actual = hasUsage ? actualUsageMicro({ usage, rates: this.rates }) : null;
    const charge = actual ? actual.totalMicro : reservation.amountMicro;
    if (charge > reservation.amountMicro) {
      this.hardStop = true;
      this.stopReason = `actual cost $${(charge / 1e6).toFixed(6)} exceeded reservation $${(reservation.amountMicro / 1e6).toFixed(6)} for ${id}`;
    }
    this.spentMicro += charge;
    if (this.spentMicro > this.capMicro) {
      this.hardStop = true;
      this.stopReason = `spent $${(this.spentMicro / 1e6).toFixed(6)} exceeded cap $${this.capUsd.toFixed(2)}`;
    }
    this.records.push({
      id,
      httpStatus,
      note,
      reservationMicro: reservation.amountMicro,
      inputUpper: reservation.inputUpper,
      outputMax: reservation.outputMax,
      usage: actual,
      chargeMicro: charge,
      usageMissing: !hasUsage,
      overrun: charge > reservation.amountMicro,
      settledAt: new Date().toISOString(),
    });
    this.persist();
    return { chargeMicro: charge, actual, overrun: charge > reservation.amountMicro };
  }

  /** Release a reservation that was never dispatched (e.g. local crash before send). */
  release(id, note = null) {
    const reservation = this.reserved.get(id);
    if (!reservation) throw new Error(`release for unknown reservation ${id}`);
    this.reserved.delete(id);
    this.records.push({
      id,
      released: true,
      note,
      reservationMicro: reservation.amountMicro,
      releasedAt: new Date().toISOString(),
    });
    this.persist();
  }

  /** Assert the remaining budget can fund a planned worst-case request count/size. */
  assertPlanFits({ requests, promptCharsPerRequest, maxTokensPerRequest }) {
    const per = reservationMicro({ promptChars: promptCharsPerRequest, maxTokens: maxTokensPerRequest, rates: this.rates });
    const total = per.amountMicro * requests;
    if (total > this.capMicro) {
      throw new Error(`planned qualification worst case $${(total / 1e6).toFixed(2)} exceeds cap $${this.capUsd.toFixed(2)}`);
    }
    return { requests, perRequestMicro: per.amountMicro, totalMicro: total, totalUsd: total / 1e6 };
  }
}
