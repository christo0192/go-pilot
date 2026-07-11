// Per-task-class acceptance sign-off — PLAN Step 7.3.
//
// The go-live gate, evaluated PER task class. For each class we aggregate its
// run metrics (via computeRun) and apply the same numeric targets as the #10
// acceptance gate: a class is signed off for multi-pane IFF it hits the token
// reduction AND quality targets. Otherwise the class reverts to single-agent.
//
// SAFE DEFAULT (decision D17): real LIVE per-class data is intentionally
// PENDING, so a class with NO records defaults to "revert-to-single". Reverting
// to the proven single-agent baseline can never make things worse — there is no
// negative return from defaulting to safe.
//
// Reuses the metrics contract from ./metrics.mjs — computeRun(record) yields
// { tokenReductionPct, qualityDropPct, retries, routerOverheadTokens }.

import { computeRun } from "./metrics.mjs";
import { weightedMean } from "./stats.mjs";

/** Same numeric targets as acceptance #10. Overridable via the `targets` arg. */
export const DEFAULT_TARGETS = { tokenReductionPct: 20, qualityDropPct: 5 };

const REASON_NO_DATA = "no data (pending live runs — D17)";

/**
 * Sign off (or revert) ONE task class from its metrics records.
 *
 * Aggregation (PORTFOLIO-WEIGHTED, Step 8.4 — matches acceptance.mjs, so a
 * tiny run can't swing a class's verdict):
 *   - tokenReductionPct = (Σ single − Σ multi) / Σ single × 100  (aggregate
 *     totals, NOT the equal-weight mean of per-run percentages).
 *   - qualityDropPct    = per-run drops weighted by each run's single-agent
 *     token size.
 *   - retries.count/attempts and routerOverheadTokens are SUMMED as class
 *     totals (informational; overhead is never netted).
 *
 * GO rule: verdict is "sign-off" IFF
 *   portfolio tokenReductionPct >= targets.tokenReductionPct  AND
 *   weighted  qualityDropPct    <= targets.qualityDropPct
 * else "revert-to-single". An empty record set => revert (D17 safe default).
 *
 * @param {object[]} records - metrics records for a SINGLE class.
 * @param {{tokenReductionPct?: number, qualityDropPct?: number}} [targets]
 * @param {string} [className] - explicit class name; falls back to records[0].taskClass.
 * @returns {{class: (string|undefined), verdict: string, metrics: object, reason: string}}
 */
export function signoffClass(records, targets = {}, className) {
  const t = { ...DEFAULT_TARGETS, ...targets };
  const list = Array.isArray(records) ? records : [];
  const cls = className ?? (list[0] && list[0].taskClass) ?? undefined;

  if (list.length === 0) {
    return {
      class: cls,
      verdict: "revert-to-single",
      metrics: {
        tokenReductionPct: null,
        qualityDropPct: null,
        retries: null,
        routerOverheadTokens: null,
      },
      reason: REASON_NO_DATA,
    };
  }

  const computed = list.map(computeRun);
  // Portfolio-weighted token reduction from aggregate totals (each record's
  // tokens.* is validated positive by computeRun).
  const tokensSingle = list.reduce((a, r) => a + r.tokens.single, 0);
  const tokensMulti = list.reduce((a, r) => a + r.tokens.multi, 0);
  const tokenReductionPct = ((tokensSingle - tokensMulti) / tokensSingle) * 100;
  // Quality drop weighted by each run's single-agent token size.
  const qualityDropPct = weightedMean(
    computed.map((c) => c.qualityDropPct),
    list.map((r) => r.tokens.single),
  );
  const retries = {
    count: computed.reduce((a, c) => a + c.retries.count, 0),
    attempts: computed.reduce((a, c) => a + c.retries.attempts, 0),
  };
  const routerOverheadTokens = computed.reduce(
    (a, c) => a + c.routerOverheadTokens,
    0,
  );

  const passToken = tokenReductionPct >= t.tokenReductionPct;
  const passQuality = qualityDropPct <= t.qualityDropPct;
  const signedOff = passToken && passQuality;

  let reason;
  if (signedOff) {
    reason =
      `meets targets: token reduction ${tokenReductionPct.toFixed(1)}% >= ` +
      `${t.tokenReductionPct}% and quality drop ${qualityDropPct.toFixed(1)}% <= ` +
      `${t.qualityDropPct}%`;
  } else {
    const fails = [];
    if (!passToken) {
      fails.push(
        `token reduction ${tokenReductionPct.toFixed(1)}% below target ` +
          `${t.tokenReductionPct}%`,
      );
    }
    if (!passQuality) {
      fails.push(
        `quality drop ${qualityDropPct.toFixed(1)}% above target ` +
          `${t.qualityDropPct}%`,
      );
    }
    reason = `revert: ${fails.join("; ")}`;
  }

  return {
    class: cls,
    verdict: signedOff ? "sign-off" : "revert-to-single",
    metrics: { tokenReductionPct, qualityDropPct, retries, routerOverheadTokens },
    reason,
  };
}

/**
 * Normalize the two accepted input shapes into a stable, sorted list of
 * { class, records } entries.
 *
 * @param {Object<string, object[]>|Array<{class: string, records: object[]}>} recordsByClass
 * @returns {Array<{class: string, records: object[]}>}
 */
function normalizeByClass(recordsByClass) {
  let entries;
  if (Array.isArray(recordsByClass)) {
    entries = recordsByClass.map((e) => ({
      class: e.class,
      records: Array.isArray(e.records) ? e.records : [],
    }));
  } else if (recordsByClass && typeof recordsByClass === "object") {
    entries = Object.entries(recordsByClass).map(([cls, records]) => ({
      class: cls,
      records: Array.isArray(records) ? records : [],
    }));
  } else {
    entries = [];
  }
  // Deterministic, stable order.
  entries.sort((a, b) => String(a.class).localeCompare(String(b.class)));
  return entries;
}

/**
 * Sign off every task class. Deterministic: classes are sorted by name.
 *
 * @param {Object<string, object[]>|Array<{class: string, records: object[]}>} recordsByClass
 * @param {{tokenReductionPct?: number, qualityDropPct?: number}} [targets]
 * @returns {{results: object[], signedOff: string[], reverted: string[]}}
 */
export function signoff(recordsByClass, targets = {}) {
  const entries = normalizeByClass(recordsByClass);
  const results = entries.map((e) => signoffClass(e.records, targets, e.class));

  const signedOff = results
    .filter((r) => r.verdict === "sign-off")
    .map((r) => r.class);
  const reverted = results
    .filter((r) => r.verdict === "revert-to-single")
    .map((r) => r.class);

  return { results, signedOff, reverted };
}

/**
 * Render a short markdown table of sign-off results.
 * Accepts either the object returned by signoff() or a bare results array.
 *
 * @param {{results: object[]}|object[]} results
 * @returns {string} markdown
 */
export function formatSignoff(results) {
  const rows = Array.isArray(results) ? results : (results && results.results) || [];
  const fmt = (v) => (v == null ? "—" : Number(v).toFixed(1));

  const lines = [
    "| class | reduction% | drop% | verdict |",
    "| --- | --- | --- | --- |",
  ];
  for (const r of rows) {
    lines.push(
      `| ${r.class ?? "?"} | ${fmt(r.metrics && r.metrics.tokenReductionPct)} | ` +
        `${fmt(r.metrics && r.metrics.qualityDropPct)} | ${r.verdict} |`,
    );
  }
  lines.push("");
  lines.push(
    "_Classes lacking live data default to **revert-to-single** (D17 — safe " +
      "default; reverting to the proven single-agent baseline has no negative return)._",
  );
  return lines.join("\n");
}
