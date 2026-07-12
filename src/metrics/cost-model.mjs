// Cost model for the live campaign (docs/live-test-plan.md §7, §8).
//
// The Ikey gateway's /key/info.spend is ACCURATE but ASYNC/batched — it settles
// 2-7s after a call (verified by scripts/baseline-rig/calibrate.mjs). So an
// immediate before/after read attributes $0. This module therefore uses a
// two-track approach:
//
//   1. Per-call ESTIMATE: calibrated $/token rate x reported tokens. Fast,
//      deterministic, available immediately for budget-cap scheduling.
//   2. Grand-total TRUTH: read the SETTLED cumulative spend (poll until stable)
//      at checkpoints/end. Reconcile: rescale the per-model estimate split so it
//      sums EXACTLY to the settled delta — total is exact, split is calibrated.
//
// Zero external deps (node builtins + injected fetch).

/**
 * Estimate the USD cost of one workhorse call from calibrated rates.
 * @param {string} gatewayModel  e.g. "test/kimi-k2.6"
 * @param {{total?:number}} tokens
 * @param {Record<string,{perTotalToken:number}>} rates
 * @returns {number} estimated USD (0 if model/rate unknown)
 */
export function estimateCallCost(gatewayModel, tokens = {}, rates = {}) {
  const rate = rates[gatewayModel]?.perTotalToken;
  const total = Number.isFinite(tokens.total) ? tokens.total : 0;
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return rate * total;
}

/**
 * Poll the gateway's cumulative spend until it stops changing (settled) or a
 * timeout elapses. Injectable `readSpend` (async () => number|null) keeps this
 * unit-testable without a network.
 *
 * @param {() => Promise<number|null>} readSpend
 * @param {{baseline?:number|null, intervalMs?:number, maxMs?:number, stableReads?:number, requireMove?:boolean, sleep?:(ms:number)=>Promise<void>, now?:()=>number}} [opts]
 * @returns {Promise<{settled:number|null, curve:{tMs:number,spend:number|null}[], stable:boolean}>}
 */
export async function readSettledSpend(readSpend, opts = {}) {
  const intervalMs = opts.intervalMs ?? 1500;
  const maxMs = opts.maxMs ?? 30000;
  const stableReads = opts.stableReads ?? 3;
  const requireMove = opts.requireMove ?? false;
  const baseline = opts.baseline ?? null;
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = opts.now || (() => Date.now());

  const curve = [];
  const t0 = now();
  const window = [];
  while (now() - t0 < maxMs) {
    const spend = await readSpend();
    curve.push({ tMs: now() - t0, spend });
    window.push(spend);
    if (window.length > stableReads) window.shift();
    const settled =
      window.length === stableReads &&
      window.every((v) => v === window[0]) &&
      window[0] != null &&
      (!requireMove || window[0] !== baseline);
    if (settled) return { settled: window[0], curve, stable: true };
    await sleep(intervalMs);
  }
  const last = curve.length ? curve[curve.length - 1].spend : baseline;
  return { settled: last, curve, stable: false };
}

/**
 * Budget ledger: accumulates per-model estimated cost, enforces caps, and can
 * reconcile the running estimate against a settled cumulative total.
 *
 * @param {{caps?:Record<string,number>, totalCap?:number, rates?:object}} [opts]
 *   caps keyed by gateway model id (e.g. {"test/kimi-k2.6":5,"test/deepseek-v4-pro":2}).
 */
export function createBudgetLedger(opts = {}) {
  const caps = opts.caps || {};
  const totalCap = Number.isFinite(opts.totalCap) ? opts.totalCap : Infinity;
  const rates = opts.rates || {};
  /** @type {Map<string,{calls:number, tokens:number, estUsd:number, reportedUsd:number}>} */
  const perModel = new Map();

  function bucket(model) {
    if (!perModel.has(model)) perModel.set(model, { calls: 0, tokens: 0, estUsd: 0, reportedUsd: 0 });
    return perModel.get(model);
  }

  return {
    /**
     * Record a completed workhorse call. Uses calibrated estimate for cap
     * accounting (available immediately); also stores any provider-reported
     * costUsd (which lags/settles) for later reconciliation.
     */
    record({ model, tokens = {}, costUsd = null }) {
      const b = bucket(model);
      b.calls += 1;
      b.tokens += Number.isFinite(tokens.total) ? tokens.total : 0;
      b.estUsd += estimateCallCost(model, tokens, rates);
      if (Number.isFinite(costUsd) && costUsd > 0) b.reportedUsd += costUsd;
      return b;
    },

    /** Estimated USD already spent on a model. */
    modelEstUsd(model) {
      return perModel.get(model)?.estUsd || 0;
    },

    /** Total estimated USD across all workhorse models. */
    totalEstUsd() {
      let s = 0;
      for (const b of perModel.values()) s += b.estUsd;
      return s;
    },

    /**
     * Would scheduling a call to `model` costing ~`projectedUsd` breach a cap?
     * Checks both the per-model cap and the global backstop. `projectedUsd`
     * defaults to a single median call so the check is meaningful before the
     * call is made.
     */
    wouldExceed(model, projectedUsd = 0) {
      const modelCap = caps[model];
      const modelAfter = (perModel.get(model)?.estUsd || 0) + projectedUsd;
      if (Number.isFinite(modelCap) && modelAfter > modelCap) return { blocked: true, reason: `per-model cap $${modelCap} for ${model}` };
      const totalAfter = this.totalEstUsd() + projectedUsd;
      if (totalAfter > totalCap) return { blocked: true, reason: `total workhorse cap $${totalCap}` };
      return { blocked: false };
    },

    /** Snapshot of per-model accounting. */
    snapshot() {
      const out = {};
      for (const [model, b] of perModel.entries()) out[model] = { ...b };
      return out;
    },

    /**
     * Reconcile the estimated per-model split against a SETTLED cumulative
     * total delta (from the gateway). Rescales each model's estimate so the
     * per-model figures sum EXACTLY to `settledTotalDelta`, preserving the
     * calibrated ratio between models. Returns the reconciled split.
     */
    reconcile(settledTotalDelta) {
      const est = this.totalEstUsd();
      const out = {};
      if (!Number.isFinite(settledTotalDelta) || settledTotalDelta <= 0 || est <= 0) {
        // Nothing to rescale against; fall back to raw estimates.
        for (const [model, b] of perModel.entries()) out[model] = { ...b, reconciledUsd: b.estUsd };
        return { settledTotalDelta, scale: 1, split: out };
      }
      const scale = settledTotalDelta / est;
      for (const [model, b] of perModel.entries()) out[model] = { ...b, reconciledUsd: b.estUsd * scale };
      return { settledTotalDelta, scale, split: out };
    },
  };
}
