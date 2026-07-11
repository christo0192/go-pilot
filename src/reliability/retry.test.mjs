import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBackoff, withRetry, createCircuitBreaker } from "./retry.mjs";

// ── Test doubles ────────────────────────────────────────────────────────────
// All hermetic: no real timers, no wall clock, no randomness.

// A fake sleep that records the delays it was asked to wait and resolves
// IMMEDIATELY — the retry loop's timing is exercised without any real waiting.
function makeFakeSleep() {
  const calls = [];
  const sleep = (ms) => {
    calls.push(ms);
    return Promise.resolve();
  };
  return { sleep, calls };
}

// A fake clock: a mutable counter the test advances by hand.
function makeFakeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
    set: (ms) => {
      t = ms;
    },
  };
}

// ── computeBackoff (pure) ────────────────────────────────────────────────────

test("computeBackoff: exponential, monotonic non-decreasing", () => {
  const opts = { baseMs: 100, maxMs: 100_000, factor: 2 };
  const seq = [0, 1, 2, 3, 4].map((a) => computeBackoff(a, opts));
  assert.deepEqual(seq, [100, 200, 400, 800, 1600]);
  for (let i = 1; i < seq.length; i++) {
    assert.ok(seq[i] >= seq[i - 1], "sequence is non-decreasing");
  }
});

test("computeBackoff: capped at maxMs (never exceeds the ceiling)", () => {
  const opts = { baseMs: 100, maxMs: 2000, factor: 2 };
  assert.equal(computeBackoff(4, opts), 1600); // 100*2^4 = 1600, under cap
  assert.equal(computeBackoff(5, opts), 2000); // 100*2^5 = 3200 → capped
  assert.equal(computeBackoff(50, opts), 2000); // huge → capped, still finite
  assert.ok(Number.isFinite(computeBackoff(2000, opts)), "no Infinity leak");
});

test("computeBackoff: jitter is applied AFTER the cap", () => {
  const seen = [];
  const jitter = (d) => {
    seen.push(d);
    return d / 2; // deterministic fake jitter
  };
  const out = computeBackoff(5, { baseMs: 100, maxMs: 2000, factor: 2, jitter });
  assert.deepEqual(seen, [2000], "jitter received the already-capped delay");
  assert.equal(out, 1000, "jitter's transformed value is returned");
});

test("computeBackoff: default jitter is identity (deterministic, no jitter)", () => {
  assert.equal(computeBackoff(0), 100); // defaults base=100
  assert.equal(computeBackoff(1), 200);
  assert.equal(computeBackoff(3), 800);
});

// ── withRetry ────────────────────────────────────────────────────────────────

test("withRetry: succeeds on first try — fn called once, NO sleep", async () => {
  const { sleep, calls } = makeFakeSleep();
  let count = 0;
  const out = await withRetry(
    async () => {
      count++;
      return "ok";
    },
    { sleep },
  );
  assert.equal(out, "ok");
  assert.equal(count, 1, "fn called exactly once");
  assert.deepEqual(calls, [], "no backoff sleep on first-try success");
});

test("withRetry: retries then succeeds — sleeps with expected backoffs", async () => {
  const { sleep, calls } = makeFakeSleep();
  let count = 0;
  const out = await withRetry(
    async () => {
      count++;
      if (count < 3) throw new Error(`boom ${count}`);
      return "recovered";
    },
    { sleep, baseMs: 100, maxMs: 2000, factor: 2 },
  );
  assert.equal(out, "recovered");
  assert.equal(count, 3, "failed twice, succeeded on the third");
  // Two failures → two backoff waits: computeBackoff(0)=100, computeBackoff(1)=200.
  assert.deepEqual(calls, [100, 200]);
});

test("withRetry: exhausts retries and rejects with the LAST error", async () => {
  const { sleep, calls } = makeFakeSleep();
  let count = 0;
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          count++;
          throw new Error(`fail ${count}`);
        },
        { sleep, retries: 2, baseMs: 100, factor: 2 },
      ),
    /fail 3/, // retries=2 → 3 attempts total; last error is "fail 3"
  );
  assert.equal(count, 3, "1 initial + 2 retries = 3 attempts");
  assert.deepEqual(calls, [100, 200], "slept between the 3 attempts, not after the last");
});

test("withRetry: stops immediately when shouldRetry returns false", async () => {
  const { sleep, calls } = makeFakeSleep();
  let count = 0;
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          count++;
          throw new Error("non-retryable");
        },
        { sleep, retries: 5, shouldRetry: () => false },
      ),
    /non-retryable/,
  );
  assert.equal(count, 1, "no retry attempted");
  assert.deepEqual(calls, [], "never slept");
});

test("withRetry: shouldRetry can inspect the error to decide", async () => {
  const { sleep, calls } = makeFakeSleep();
  let count = 0;
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          count++;
          const err = new Error("fatal");
          err.retryable = false;
          throw err;
        },
        { sleep, retries: 5, shouldRetry: (err) => err.retryable === true },
      ),
    /fatal/,
  );
  assert.equal(count, 1);
  assert.deepEqual(calls, []);
});

test("withRetry: already-aborted signal rejects WITHOUT calling fn", async () => {
  const { sleep, calls } = makeFakeSleep();
  const ac = new AbortController();
  ac.abort();
  let count = 0;
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          count++;
          return "should-not-run";
        },
        { sleep, signal: ac.signal },
      ),
    (err) => err.name === "AbortError",
  );
  assert.equal(count, 0, "fn never invoked when pre-aborted");
  assert.deepEqual(calls, []);
});

test("withRetry: abort DURING backoff rejects promptly, no further attempts", async () => {
  const ac = new AbortController();
  const calls = [];
  // Fake sleep that aborts mid-wait (simulating a cancel while backing off).
  const sleep = (ms) => {
    calls.push(ms);
    ac.abort();
    return Promise.resolve();
  };
  let count = 0;
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          count++;
          throw new Error("boom");
        },
        { sleep, retries: 5, signal: ac.signal },
      ),
    (err) => err.name === "AbortError",
  );
  assert.equal(count, 1, "only the first attempt ran; abort stopped the rest");
  assert.deepEqual(calls, [100], "entered exactly one backoff before aborting");
});

// ── createCircuitBreaker ─────────────────────────────────────────────────────

const boom = () => {
  throw new Error("downstream failure");
};

test("circuit breaker: opens after `threshold` consecutive failures", async () => {
  const clock = makeFakeClock(1000);
  const cb = createCircuitBreaker({ threshold: 3, cooldownMs: 5000, now: clock.now });
  assert.equal(cb.state(), "closed");

  for (let i = 0; i < 2; i++) {
    await assert.rejects(() => cb.run(boom), /downstream failure/);
    assert.equal(cb.state(), "closed", "still closed below threshold");
  }
  // Third consecutive failure trips it.
  await assert.rejects(() => cb.run(boom), /downstream failure/);
  assert.equal(cb.state(), "open");
});

test("circuit breaker: open breaker rejects with /circuit open/ WITHOUT calling fn", async () => {
  const clock = makeFakeClock(0);
  const cb = createCircuitBreaker({ threshold: 1, cooldownMs: 5000, now: clock.now });
  await assert.rejects(() => cb.run(boom)); // trips (threshold 1)
  assert.equal(cb.state(), "open");

  let called = false;
  await assert.rejects(
    () =>
      cb.run(() => {
        called = true;
        return "nope";
      }),
    /circuit open/,
  );
  assert.equal(called, false, "fn must NOT run while the circuit is open");
});

test("circuit breaker: transitions to half-open after cooldown elapses", async () => {
  const clock = makeFakeClock(1000);
  const cb = createCircuitBreaker({ threshold: 1, cooldownMs: 5000, now: clock.now });
  await assert.rejects(() => cb.run(boom)); // opens at t=1000
  assert.equal(cb.state(), "open");

  clock.advance(4999);
  assert.equal(cb.state(), "open", "still open just before cooldown");
  clock.advance(1); // now exactly 5000ms elapsed
  assert.equal(cb.state(), "half-open", "cooldown elapsed → half-open");
});

test("circuit breaker: half-open success closes the circuit and resets count", async () => {
  const clock = makeFakeClock(0);
  const cb = createCircuitBreaker({ threshold: 2, cooldownMs: 1000, now: clock.now });
  await assert.rejects(() => cb.run(boom));
  await assert.rejects(() => cb.run(boom)); // opens at t=0
  assert.equal(cb.state(), "open");

  clock.advance(1000); // → half-open
  assert.equal(cb.state(), "half-open");
  const out = await cb.run(async () => "healed");
  assert.equal(out, "healed");
  assert.equal(cb.state(), "closed", "successful probe healed the circuit");

  // Count was reset: a single fresh failure must not re-trip (threshold is 2).
  await assert.rejects(() => cb.run(boom));
  assert.equal(cb.state(), "closed");
});

test("circuit breaker: half-open failure re-opens and resets the cooldown clock", async () => {
  const clock = makeFakeClock(0);
  const cb = createCircuitBreaker({ threshold: 1, cooldownMs: 1000, now: clock.now });
  await assert.rejects(() => cb.run(boom)); // opens at t=0
  clock.advance(1000); // → half-open at t=1000
  assert.equal(cb.state(), "half-open");

  await assert.rejects(() => cb.run(boom), /downstream failure/); // probe fails at t=1000
  assert.equal(cb.state(), "open", "failed probe re-opens the circuit");

  clock.advance(999);
  assert.equal(cb.state(), "open", "cooldown restarted from the re-open, still cooling");
  clock.advance(1);
  assert.equal(cb.state(), "half-open", "half-open again after the fresh cooldown");
});

test("circuit breaker: a success in closed state resets the consecutive-failure count", async () => {
  const clock = makeFakeClock(0);
  const cb = createCircuitBreaker({ threshold: 3, cooldownMs: 5000, now: clock.now });

  // Two failures (below threshold), then a success clears the streak.
  await assert.rejects(() => cb.run(boom));
  await assert.rejects(() => cb.run(boom));
  assert.equal(cb.state(), "closed");
  await cb.run(async () => "ok");
  assert.equal(cb.state(), "closed");

  // Two MORE failures must still not trip it — the earlier streak was reset.
  await assert.rejects(() => cb.run(boom));
  await assert.rejects(() => cb.run(boom));
  assert.equal(cb.state(), "closed", "count reset by the intervening success");
});
