// Reliability primitives: exponential backoff, retry-with-abort, circuit breaker.
//
// Every source of non-determinism the caller might depend on — the clock, the
// jitter randomness, and the sleep between attempts — is INJECTABLE. Each
// defaults to the real implementation (Date.now / setTimeout / identity jitter)
// so production callers write nothing extra, but tests pass fakes and stay
// hermetic: no wall-clock reads, no real timers, no flakes.
//
// The three exports compose but are independent:
//
//   computeBackoff  — PURE. attempt → delay ms, capped at maxMs. No I/O.
//   withRetry       — run fn(), backing off between failed attempts, abortable.
//   createCircuitBreaker — trip after N consecutive failures, self-heal after a
//                          cooldown (closed → open → half-open → closed).
//
// No external deps — only node builtins. AbortSignal (used by withRetry) and
// Date.now (the circuit clock) are the only ambient dependencies, and both are
// overridable in tests.

/**
 * PURE exponential backoff for a 0-indexed attempt.
 *
 * Delay = min(maxMs, baseMs * factor**attempt), then `jitter(delay)`. The cap is
 * applied BEFORE jitter so the base curve is monotonic non-decreasing and never
 * exceeds `maxMs`; a jitter fn may still perturb the final value (a real one
 * typically returns something in [0, delay], so callers that want the cap to be
 * a hard ceiling should keep jitter within [0, delay]).
 *
 * `jitter` is injectable so the default is deterministic — identity, i.e. NO
 * jitter. Pass a randomized fn in production if you want to spread retries.
 *
 * @param {number} attempt  0-indexed attempt number (0 = first retry delay)
 * @param {{baseMs?: number, maxMs?: number, factor?: number, jitter?: (delay: number) => number}} [opts]
 * @returns {number} delay in ms
 */
export function computeBackoff(attempt, opts = {}) {
  const { baseMs = 100, maxMs = 2000, factor = 2, jitter = (d) => d } = opts;
  // factor**attempt can overflow to Infinity for large attempts; min() with the
  // finite maxMs collapses that straight to the cap, so the result stays finite.
  const raw = baseMs * factor ** attempt;
  const capped = Math.min(maxMs, raw);
  return jitter(capped);
}

// Real sleep — the only place a timer is created. Injectable so tests never wait.
const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Normalize whatever an AbortSignal carries into a throwable Error. Prefer the
// signal's own `reason` when it is already an Error (that is what the caller
// asked us to reject with); otherwise synthesize a named AbortError.
function abortError(signal) {
  const reason = signal && signal.reason;
  if (reason instanceof Error) return reason;
  const err = new Error("aborted");
  err.name = "AbortError";
  return err;
}

/**
 * Sleep for `ms` but reject promptly if `signal` aborts first. The abort
 * listener is attached BEFORE `sleep` is invoked, so a fake sleep that aborts
 * synchronously (as tests do) still loses the race to the rejection. Whichever
 * settles first wins; the loser is ignored and the listener is detached.
 */
function sleepWithAbort(ms, sleep, signal) {
  if (!signal) return sleep(ms);
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      reject(abortError(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(sleep(ms)).then(
      (value) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

/**
 * Call `fn()`, retrying on throw with exponential backoff between attempts.
 *
 * `retries` is the number of RETRIES, so `fn` is invoked at most `retries + 1`
 * times (one initial try plus up to `retries` more). Between a failed attempt
 * and the next, it waits `computeBackoff(attempt, ...)` via the injectable
 * `sleep`. A retry happens only when ALL hold: attempts remain, `shouldRetry(err)`
 * is truthy, and the `signal` (if any) is not aborted. Otherwise the last error
 * propagates. On success `fn`'s resolved value is returned; the first attempt
 * that succeeds never sleeps.
 *
 * Abort semantics: if `signal` is already aborted, reject immediately WITHOUT
 * calling `fn`; if it aborts while backing off (or between attempts), reject
 * promptly with the abort error and make no further attempts.
 *
 * @param {() => Promise<any>|any} fn
 * @param {{
 *   retries?: number, baseMs?: number, maxMs?: number, factor?: number,
 *   jitter?: (delay: number) => number,
 *   sleep?: (ms: number) => Promise<void>,
 *   shouldRetry?: (err: unknown) => boolean,
 *   signal?: AbortSignal,
 * }} [opts]
 * @returns {Promise<any>} `fn`'s resolved value
 */
export async function withRetry(fn, opts = {}) {
  const {
    retries = 3,
    baseMs,
    maxMs,
    factor,
    jitter,
    sleep = realSleep,
    shouldRetry = () => true,
    signal,
  } = opts;

  const backoffOpts = { baseMs, maxMs, factor, jitter };
  const isAborted = () => Boolean(signal && signal.aborted);

  // Refuse to even start if the caller handed us an already-aborted signal.
  if (isAborted()) throw abortError(signal);

  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      // Decide whether another attempt is warranted. `attempt < retries` because
      // `attempt` is 0-indexed: with retries=3, attempts 0..2 may retry, attempt
      // 3 is the final try and must propagate.
      const attemptsRemain = attempt < retries;
      if (isAborted()) throw abortError(signal);
      if (!attemptsRemain || !shouldRetry(err)) throw err;

      const delay = computeBackoff(attempt, backoffOpts);
      // May reject with the abort error if `signal` fires during the wait.
      await sleepWithAbort(delay, sleep, signal);
      attempt++;
    }
  }
}

/**
 * A consecutive-failure circuit breaker.
 *
 * States and transitions (all time comparisons via the injectable `now`):
 *
 *   closed  ──`threshold` consecutive failures──▶  open
 *   open    ──run() called before cooldown──▶      rejects `/circuit open/`, fn NOT called
 *   open    ──`cooldownMs` elapsed──▶              half-open (next run attempts fn)
 *   half-open ──run() succeeds──▶                  closed (failure count reset)
 *   half-open ──run() fails──▶                     open (cooldown clock reset)
 *   closed  ──run() succeeds──▶                    stays closed, failure count reset to 0
 *
 * The half-open state is virtual: internally the breaker stays "open" but
 * `state()` and `run()` treat it as half-open once `cooldownMs` has elapsed
 * since it opened. A single half-open probe decides the outcome — success heals
 * the circuit, failure re-opens it and restarts the cooldown.
 *
 * @param {{threshold?: number, cooldownMs?: number, now?: () => number}} [opts]
 *   `now` — injectable clock (ms epoch); defaults to Date.now.
 * @returns {{ run: (fn: () => Promise<any>|any) => Promise<any>, state: () => "closed"|"open"|"half-open" }}
 */
export function createCircuitBreaker(opts = {}) {
  const { threshold = 5, cooldownMs = 30_000, now } = opts;
  const clock = typeof now === "function" ? now : () => Date.now();

  let state = "closed"; // internal: only ever "closed" or "open"
  let failures = 0; // consecutive failures while closed
  let openedAt = 0; // clock() reading when we last opened

  // Resolve the OBSERVABLE state at time `at`: an open breaker whose cooldown
  // has elapsed presents as "half-open" (ready for one probe).
  function observedState(at) {
    if (state === "open" && at - openedAt >= cooldownMs) return "half-open";
    return state;
  }

  async function run(fn) {
    const at = clock();
    const observed = observedState(at);

    // Open and still cooling down: fail fast WITHOUT touching fn.
    if (observed === "open") {
      throw new Error("circuit open");
    }

    // observed is "closed" or "half-open" — attempt the call.
    try {
      const result = await fn();
      // Any success (closed or half-open probe) heals the circuit fully.
      state = "closed";
      failures = 0;
      return result;
    } catch (err) {
      if (observed === "half-open") {
        // Probe failed — re-open and restart the cooldown from now.
        state = "open";
        openedAt = clock();
        failures = threshold; // remain tripped
      } else {
        // Closed-state failure — count it, trip if we hit the threshold.
        failures++;
        if (failures >= threshold) {
          state = "open";
          openedAt = clock();
        }
      }
      throw err;
    }
  }

  return {
    run,
    state: () => observedState(clock()),
  };
}
