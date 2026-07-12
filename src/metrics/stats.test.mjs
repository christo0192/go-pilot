import { test } from "node:test";
import assert from "node:assert/strict";

import {
  mean,
  median,
  percentile,
  p75,
  p90,
  p95,
  stdev,
  weightedMean,
  distribution,
  mulberry32,
  bootstrapCI,
} from "./stats.mjs";

test("mean of a known list", () => {
  assert.equal(mean([1, 2, 3, 4]), 2.5);
  assert.ok(Number.isNaN(mean([])));
});

test("median: odd and even length", () => {
  assert.equal(median([3, 1, 2]), 2); // sorted [1,2,3]
  assert.equal(median([1, 2, 3, 4]), 2.5); // avg of 2 and 3
  assert.equal(median([42]), 42);
});

test("percentile uses linear interpolation (R-7 / NumPy default)", () => {
  // rank = (5-1)*0.9 = 3.6 → between 40 and 50 → 40 + 0.6*10 = 46
  assert.equal(percentile([10, 20, 30, 40, 50], 0.9), 46);
  assert.equal(p90([10, 20, 30, 40, 50]), 46);
  // p0 = min, p100 = max
  assert.equal(percentile([10, 20, 30], 0), 10);
  assert.equal(percentile([10, 20, 30], 1), 30);
});

test("stdev is the population standard deviation", () => {
  // Classic example: mean 5, variance 4, stdev 2.
  assert.equal(stdev([2, 4, 4, 4, 5, 5, 7, 9]), 2);
  assert.equal(stdev([7]), 0);
  assert.ok(Number.isNaN(stdev([])));
});

test("weightedMean weights values by size; equal weights == plain mean", () => {
  // Values [10, 20] with weights [3, 1] → (30 + 20) / 4 = 12.5
  assert.equal(weightedMean([10, 20], [3, 1]), 12.5);
  // Equal weights collapse to the arithmetic mean.
  assert.equal(weightedMean([10, 20], [1, 1]), 15);
  // All-zero weights fall back to the unweighted mean (no divide-by-zero).
  assert.equal(weightedMean([10, 20], [0, 0]), 15);
});

test("distribution bundles median/p90/stdev/sampleCount", () => {
  const d = distribution([10, 20, 30, 40, 50]);
  assert.equal(d.median, 30);
  assert.equal(d.p90, 46);
  assert.equal(d.sampleCount, 5);
  assert.ok(Math.abs(d.stdev - Math.sqrt(200)) < 1e-9); // pop. stdev of that set
});

test("p75 and p95 use linear interpolation", () => {
  // rank = (5-1)*0.75 = 3 → exactly 40; (5-1)*0.95 = 3.8 → 40 + 0.8*10 = 48
  assert.equal(p75([10, 20, 30, 40, 50]), 40);
  assert.equal(p95([10, 20, 30, 40, 50]), 48);
});

test("mulberry32 is deterministic for a given seed", () => {
  const a = mulberry32(12345);
  const b = mulberry32(12345);
  const seqA = [a(), a(), a()];
  const seqB = [b(), b(), b()];
  assert.deepEqual(seqA, seqB);
  seqA.forEach((x) => assert.ok(x >= 0 && x < 1));
  // A different seed yields a different stream.
  const c = mulberry32(54321);
  assert.notEqual(c(), seqA[0]);
});

test("bootstrapCI is reproducible and brackets the point estimate", () => {
  const data = [10, 12, 9, 11, 13, 8, 10, 12, 11, 9];
  const r1 = bootstrapCI(data, { seed: 42, resamples: 1000 });
  const r2 = bootstrapCI(data, { seed: 42, resamples: 1000 });
  assert.equal(r1.lo, r2.lo); // deterministic
  assert.equal(r1.hi, r2.hi);
  assert.ok(Math.abs(r1.point - mean(data)) < 1e-9);
  assert.ok(r1.lo <= r1.point && r1.point <= r1.hi); // point inside CI
  assert.ok(r1.lo < r1.hi); // non-degenerate for spread data
});

test("bootstrapCI handles empty and singleton inputs", () => {
  const empty = bootstrapCI([], { seed: 1 });
  assert.ok(Number.isNaN(empty.point));
  const one = bootstrapCI([5], { seed: 1 });
  assert.equal(one.point, 5);
  assert.equal(one.lo, 5);
  assert.equal(one.hi, 5);
});

test("bootstrapCI accepts a custom statistic (median)", () => {
  const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100];
  const r = bootstrapCI(data, { seed: 7, resamples: 500, statistic: median });
  // Median is robust to the outlier — CI should sit well below the mean (~14.5).
  assert.ok(r.point < 10);
  assert.ok(r.lo <= r.point && r.point <= r.hi);
});
