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

/** 75th percentile (linear interpolation). */
export function p75(nums) {
  return percentile(nums, 0.75);
}

/** 90th percentile (linear interpolation). */
export function p90(nums) {
  return percentile(nums, 0.9);
}

/** 95th percentile (linear interpolation). */
export function p95(nums) {
  return percentile(nums, 0.95);
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

/**
 * Deterministic 32-bit PRNG (mulberry32). Seeded so bootstrap confidence
 * intervals are exactly reproducible from (data, seed) — the campaign records
 * the seed in the results header, per docs/live-test-plan.md §9.
 *
 * @param {number} seed - unsigned 32-bit integer.
 * @returns {() => number} generator yielding floats in [0, 1).
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Nonparametric bootstrap confidence interval. Resamples `nums` with
 * replacement `resamples` times, computes `statistic` on each resample, and
 * returns the percentile CI of that distribution. Deterministic given `seed`.
 *
 * @param {number[]} nums
 * @param {{statistic?:(xs:number[])=>number, resamples?:number, ci?:number, seed?:number}} [opts]
 * @returns {{point:number, lo:number, hi:number, resamples:number, ci:number}}
 */
export function bootstrapCI(nums, opts = {}) {
  const statistic = opts.statistic || mean;
  const resamples = opts.resamples ?? 2000;
  const ci = opts.ci ?? 0.95;
  const seed = opts.seed ?? 0x9e3779b9;
  const n = nums.length;
  if (n === 0) return { point: NaN, lo: NaN, hi: NaN, resamples: 0, ci };
  const point = statistic(nums);
  if (n === 1) return { point, lo: point, hi: point, resamples: 0, ci };

  const rand = mulberry32(seed);
  const stats = new Array(resamples);
  const sample = new Array(n);
  for (let r = 0; r < resamples; r += 1) {
    for (let i = 0; i < n; i += 1) sample[i] = nums[(rand() * n) | 0];
    stats[r] = statistic(sample);
  }
  const alpha = (1 - ci) / 2;
  return {
    point,
    lo: percentile(stats, alpha),
    hi: percentile(stats, 1 - alpha),
    resamples,
    ci,
  };
}
