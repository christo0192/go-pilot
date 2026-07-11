import { test } from "node:test";
import assert from "node:assert/strict";

import {
  mean,
  median,
  percentile,
  p90,
  stdev,
  weightedMean,
  distribution,
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
