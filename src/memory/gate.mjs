// Validation gate BEFORE compression.
//
// Correctness-of-memory invariant (#6): a result must pass deterministic checks
// (tests / lint / scope-match) BEFORE it is allowed to be summarized or
// compressed. When any check fails, the FULL, untouched result propagates —
// failures are NEVER smoothed into a clean summary, and the compressor is never
// even invoked. Pass first, compress second.
//
// Pure and deterministic: no I/O, no clock, no randomness. Checks are supplied
// by the caller as `{ name, run }` predicate objects.

/**
 * Normalize a single check's return value into `{ ok, detail }`.
 *
 * A `run(result)` may return either a boolean (ok, no detail) or an object
 * `{ ok, detail }`. Anything else is coerced: truthiness decides `ok`.
 *
 * @param {*} value - the raw return of a check's `run`.
 * @returns {{ok: boolean, detail: (string|undefined)}}
 */
function normalizeCheckResult(value) {
  if (typeof value === "boolean") {
    return { ok: value, detail: undefined };
  }
  if (value && typeof value === "object") {
    return { ok: Boolean(value.ok), detail: value.detail };
  }
  return { ok: Boolean(value), detail: undefined };
}

/**
 * Run every check against `result`. A check that throws is itself a failure
 * (its error message becomes the detail) — `mustPass` never throws.
 *
 * @param {*} result - the work product being validated.
 * @param {Array<{name: string, run: function(*): (boolean|{ok: boolean, detail?: string})}>} checks
 * @returns {{passed: boolean, failures: Array<{name: string, detail: (string|undefined)}>}}
 *   `passed` is true only if every check is ok; `failures` lists each failing
 *   check by name with its detail.
 */
export function mustPass(result, checks = []) {
  const failures = [];

  for (const check of checks) {
    const name = check && check.name ? check.name : "(anonymous check)";
    let outcome;
    try {
      outcome = normalizeCheckResult(check.run(result));
    } catch (err) {
      // A throwing check is a failure — capture its message as the detail.
      const detail = err && err.message ? err.message : String(err);
      failures.push({ name, detail });
      continue;
    }

    if (!outcome.ok) {
      failures.push({ name, detail: outcome.detail });
    }
  }

  return { passed: failures.length === 0, failures };
}

/**
 * Gate, THEN compress. Runs `mustPass` first.
 *
 *   - passed  -> `{ summarized: true,  passed: true,  output: compressFn(result), failures: [] }`
 *   - failed  -> `{ summarized: false, passed: false, output: result, failures }`
 *
 * On failure the FULL, untouched `result` is returned as `output` and
 * `compressFn` is NOT called at all. This is the load-bearing guarantee: a
 * result that has not passed validation is never summarized.
 *
 * @param {*} result
 * @param {Array<{name: string, run: function}>} checks
 * @param {function(*): *} compressFn - only invoked when all checks pass.
 * @returns {{summarized: boolean, passed: boolean, output: *, failures: Array<{name: string, detail: (string|undefined)}>}}
 */
export function gateThenCompress(result, checks, compressFn) {
  const { passed, failures } = mustPass(result, checks);

  if (!passed) {
    return { summarized: false, passed: false, output: result, failures };
  }

  return { summarized: true, passed: true, output: compressFn(result), failures: [] };
}

// ---------------------------------------------------------------------------
// Ready-made check factories. Small, pure, and concrete — they make the intent
// of the gate legible. Each returns a `{ name, run }` predicate object.
// ---------------------------------------------------------------------------

/**
 * Wrap an arbitrary test function as a check. `fn(result)` should return a
 * boolean or `{ ok, detail }`. Use for "the tests pass" style gates.
 *
 * @param {function(*): (boolean|{ok: boolean, detail?: string})} fn
 * @param {string} [name]
 * @returns {{name: string, run: function}}
 */
export function testsPass(fn, name = "testsPass") {
  return {
    name,
    run(result) {
      return normalizeCheckResult(fn(result));
    },
  };
}

/**
 * Fail if the result touches any file outside `allowedPaths`. The result is
 * expected to expose a `files` array (the paths it touched); a missing/empty
 * list is trivially in-scope.
 *
 * @param {string[]} allowedPaths - the permitted file set.
 * @returns {{name: string, run: function}}
 */
export function scopeMatch(allowedPaths = []) {
  const allowed = new Set(allowedPaths);
  return {
    name: "scopeMatch",
    run(result) {
      const files = Array.isArray(result && result.files) ? result.files : [];
      const outOfScope = files.filter((f) => !allowed.has(f));
      if (outOfScope.length === 0) return { ok: true };
      return {
        ok: false,
        detail: `touched files outside scope: ${outOfScope.join(", ")}`,
      };
    },
  };
}

/**
 * Fail if the result text contains placeholder markers (TODO, FIXME, XXX, or a
 * bare `...` ellipsis). Reads `result.text` if present, else stringifies the
 * result. Guards against half-finished work being summarized as complete.
 *
 * @returns {{name: string, run: function}}
 */
export function noPlaceholders() {
  const patterns = [/\bTODO\b/, /\bFIXME\b/, /\bXXX\b/, /\.\.\./];
  return {
    name: "noPlaceholders",
    run(result) {
      const text =
        result && typeof result.text === "string"
          ? result.text
          : typeof result === "string"
            ? result
            : JSON.stringify(result);
      const hit = patterns.find((p) => p.test(text));
      if (!hit) return { ok: true };
      return { ok: false, detail: `placeholder marker found: ${hit}` };
    },
  };
}
