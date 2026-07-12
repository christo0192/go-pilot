import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateCallCost, readSettledSpend, createBudgetLedger } from "./cost-model.mjs";

const RATES = {
  "test/kimi-k2.6": { perTotalToken: 0.000004 },
  "test/deepseek-v4-pro": { perTotalToken: 0.0000008 },
};

test("estimateCallCost multiplies calibrated rate by total tokens", () => {
  assert.ok(Math.abs(estimateCallCost("test/kimi-k2.6", { total: 1000 }, RATES) - 0.004) < 1e-12);
  assert.ok(Math.abs(estimateCallCost("test/deepseek-v4-pro", { total: 500 }, RATES) - 0.0004) < 1e-12);
});

test("estimateCallCost returns 0 for unknown model or missing tokens", () => {
  assert.equal(estimateCallCost("unknown", { total: 1000 }, RATES), 0);
  assert.equal(estimateCallCost("test/kimi-k2.6", {}, RATES), 0);
});

test("readSettledSpend returns settled value after N stable reads", async () => {
  // Spend jumps to 0.5 on the 2nd read, then holds — settles after stableReads.
  const seq = [0.1, 0.5, 0.5, 0.5, 0.5];
  let i = 0;
  const readSpend = async () => seq[Math.min(i++, seq.length - 1)];
  let clock = 0;
  const res = await readSettledSpend(readSpend, {
    stableReads: 3,
    intervalMs: 10,
    maxMs: 10000,
    sleep: async () => { clock += 10; },
    now: () => clock,
  });
  assert.equal(res.stable, true);
  assert.equal(res.settled, 0.5);
});

test("readSettledSpend with requireMove ignores a stable baseline", async () => {
  // Holds at baseline 0.1 for a while (async lag), then moves to 0.42 and holds.
  const seq = [0.1, 0.1, 0.1, 0.42, 0.42, 0.42, 0.42];
  let i = 0;
  const readSpend = async () => seq[Math.min(i++, seq.length - 1)];
  let clock = 0;
  const res = await readSettledSpend(readSpend, {
    baseline: 0.1,
    requireMove: true,
    stableReads: 3,
    intervalMs: 10,
    maxMs: 10000,
    sleep: async () => { clock += 10; },
    now: () => clock,
  });
  assert.equal(res.stable, true);
  assert.equal(res.settled, 0.42);
});

test("readSettledSpend times out unstable and returns last value", async () => {
  let i = 0;
  const readSpend = async () => 0.1 + i++ * 0.01; // never stable
  let clock = 0;
  const res = await readSettledSpend(readSpend, {
    stableReads: 3,
    intervalMs: 100,
    maxMs: 500,
    sleep: async () => { clock += 100; },
    now: () => clock,
  });
  assert.equal(res.stable, false);
  assert.ok(res.settled != null);
});

test("budget ledger accumulates per-model estimate and total", () => {
  const ledger = createBudgetLedger({ rates: RATES });
  ledger.record({ model: "test/kimi-k2.6", tokens: { total: 1000 } }); // 0.004
  ledger.record({ model: "test/kimi-k2.6", tokens: { total: 500 } }); //  0.002
  ledger.record({ model: "test/deepseek-v4-pro", tokens: { total: 1000 } }); // 0.0008
  assert.equal(ledger.modelEstUsd("test/kimi-k2.6"), 0.006);
  assert.ok(Math.abs(ledger.totalEstUsd() - 0.0068) < 1e-12);
  assert.equal(ledger.snapshot()["test/kimi-k2.6"].calls, 2);
});

test("budget ledger enforces per-model and total caps", () => {
  const ledger = createBudgetLedger({
    rates: RATES,
    caps: { "test/kimi-k2.6": 5, "test/deepseek-v4-pro": 2 },
    totalCap: 7,
  });
  // Push kimi estimate to ~$4.8, then a $0.4 call would breach the $5 cap.
  ledger.record({ model: "test/kimi-k2.6", tokens: { total: 1_200_000 } }); // 1.2M * 4e-6 = 4.8
  assert.equal(ledger.wouldExceed("test/kimi-k2.6", 0.4).blocked, true);
  assert.equal(ledger.wouldExceed("test/kimi-k2.6", 0.1).blocked, false);
});

test("budget ledger total backstop trips even under per-model caps", () => {
  const ledger = createBudgetLedger({ rates: RATES, caps: {}, totalCap: 1 });
  ledger.record({ model: "test/deepseek-v4-pro", tokens: { total: 1_000_000 } }); // 0.8
  const check = ledger.wouldExceed("test/deepseek-v4-pro", 0.3); // 0.8+0.3 > 1
  assert.equal(check.blocked, true);
  assert.match(check.reason, /total workhorse cap/);
});

test("reconcile rescales per-model split to sum exactly to settled total", () => {
  const ledger = createBudgetLedger({ rates: RATES });
  ledger.record({ model: "test/kimi-k2.6", tokens: { total: 1000 } }); // est 0.004
  ledger.record({ model: "test/deepseek-v4-pro", tokens: { total: 1000 } }); // est 0.0008
  // est total = 0.0048; settled says actual was 0.0096 (2x).
  const { scale, split } = ledger.reconcile(0.0096);
  assert.ok(Math.abs(scale - 2) < 1e-9);
  const sum = split["test/kimi-k2.6"].reconciledUsd + split["test/deepseek-v4-pro"].reconciledUsd;
  assert.ok(Math.abs(sum - 0.0096) < 1e-9);
  // ratio preserved: kimi stays 5x deepseek
  assert.ok(Math.abs(split["test/kimi-k2.6"].reconciledUsd / split["test/deepseek-v4-pro"].reconciledUsd - 5) < 1e-9);
});

test("reconcile falls back to raw estimates when no settled delta", () => {
  const ledger = createBudgetLedger({ rates: RATES });
  ledger.record({ model: "test/kimi-k2.6", tokens: { total: 1000 } });
  const { scale, split } = ledger.reconcile(null);
  assert.equal(scale, 1);
  assert.equal(split["test/kimi-k2.6"].reconciledUsd, 0.004);
});
