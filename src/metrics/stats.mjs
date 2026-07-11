// Pure, zero-dependency summary statistics for the metrics pipeline.
//
// These helpers back the portfolio-weighted acceptance accounting (Step 8.4):
// alongside the aggregate headline number we report a DISTRIBUTION (median,
// p90, stdev) so a single large task can't quietly hide the spread across a
// batch of runs. Every function is deterministic and side-effect free.

/** Arithmetic mean. NaN for an empty list. */
export function mean(nums) {
  if (nums.length === 0) return NaN;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * Linear-interpolated percentile (the "R-7" / NumPy-default method).
 *
 * @param {number[]} nums
 * @param {number} p - fraction in [0, 1] (e.g. 0.9 for p90).
 * @returns {number} NaN for an empty list.
 */
export function percentile(nums, p) {
  const n = nums.length;
  if (n === 0) return NaN;
  const a = [...nums].sort((x, y) => x - y);
  if (n === 1) return a[0];
  const rank = (n - 1) * p;
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return a[lo];
  const frac = rank - lo;
  return a[lo] + (a[hi] - a[lo]) * frac;
}

/** Median = 50th percentile. */
export function median(nums) {
  return percentile(nums, 0.5);
}

/** 90th percentile (linear interpolation). */
export function p90(nums) {
  return percentile(nums, 0.9);
}

/**
 * Population standard deviation (divides by N, not N-1). NaN for an empty
 * list; 0 for a single element.
 */
export function stdev(nums) {
  const n = nums.length;
  if (n === 0) return NaN;
  const m = mean(nums);
  const variance = nums.reduce((s, x) => s + (x - m) * (x - m), 0) / n;
  return Math.sqrt(variance);
}

/**
 * Weighted arithmetic mean: Σ(wᵢ·xᵢ) / Σ(wᵢ). Falls back to the unweighted
 * mean when every weight is 0 (avoids a divide-by-zero). NaN for empty input.
 *
 * @param {number[]} values
 * @param {number[]} weights - same length as values.
 */
export function weightedMean(values, weights) {
  if (values.length === 0) return NaN;
  let wSum = 0;
  let acc = 0;
  for (let i = 0; i < values.length; i += 1) {
    const w = weights[i];
    wSum += w;
    acc += w * values[i];
  }
  if (wSum === 0) return mean(values);
  return acc / wSum;
}

/**
 * Standard distribution summary for a list of per-record percentages.
 *
 * @param {number[]} nums
 * @returns {{median: number, p90: number, stdev: number, sampleCount: number}}
 */
export function distribution(nums) {
  return {
    median: median(nums),
    p90: p90(nums),
    stdev: stdev(nums),
    sampleCount: nums.length,
  };
}
