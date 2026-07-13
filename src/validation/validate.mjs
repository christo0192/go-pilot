// Deterministic output validation (Codex §2, extracted from orchestrator prose
// to tested code). The orchestrator — and the benchmark grader — verify worker
// artifacts with these instead of ad-hoc checks. Zero deps (node:* only).
import { spawnSync } from "node:child_process";

/**
 * Minimal JSON-Schema-lite validator: type, properties, required, items, enum,
 * minLength, minimum/maximum. Deliberately small — our output contracts are flat.
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateSchema(value, schema, path = "$") {
  const errors = [];
  if (schema == null || typeof schema !== "object") return { ok: true, errors };
  const t = schema.type;
  const actual = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
  if (t && t !== actual && !(t === "integer" && actual === "number" && Number.isInteger(value))) {
    return { ok: false, errors: [`${path}: expected ${t}, got ${actual}`] };
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${path}: value not in enum [${schema.enum.join(", ")}]`);
  }
  if (t === "object") {
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${path}.${key}: required property missing`);
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (key in value) errors.push(...validateSchema(value[key], sub, `${path}.${key}`).errors);
    }
  }
  if (t === "array" && schema.items) {
    value.forEach((item, i) => errors.push(...validateSchema(item, schema.items, `${path}[${i}]`).errors));
  }
  if (t === "string" && schema.minLength != null && value.length < schema.minLength) {
    errors.push(`${path}: shorter than minLength ${schema.minLength}`);
  }
  if ((t === "number" || t === "integer") && schema.minimum != null && value < schema.minimum) {
    errors.push(`${path}: below minimum ${schema.minimum}`);
  }
  if ((t === "number" || t === "integer") && schema.maximum != null && value > schema.maximum) {
    errors.push(`${path}: above maximum ${schema.maximum}`);
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Parse text as JSON (tolerating a ```json fence) and optionally schema-check.
 * @returns {{ ok, value?, errors: string[] }}
 */
export function validateJson(text, { schema } = {}) {
  const raw = String(text ?? "").trim();
  const fenced = raw.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/);
  const body = fenced ? fenced[1] : raw;
  let value;
  try {
    value = JSON.parse(body);
  } catch (e) {
    return { ok: false, errors: [`invalid JSON: ${e.message}`] };
  }
  if (schema) {
    const res = validateSchema(value, schema);
    return { ok: res.ok, value, errors: res.errors };
  }
  return { ok: true, value, errors: [] };
}

/**
 * Run a deterministic check command (tests, linter, node script) against a
 * produced artifact. The COMMAND decides pass/fail via exit code.
 * @returns {{ ok, exitCode, stdout, stderr, timedOut }}
 */
export function validateCode({ runCmd, cwd = process.cwd(), timeoutMs = 60_000 }) {
  if (!runCmd) return { ok: false, exitCode: -1, stdout: "", stderr: "no runCmd given", timedOut: false };
  const res = spawnSync("bash", ["-c", runCmd], {
    cwd, timeout: timeoutMs, encoding: "utf8", maxBuffer: 4 * 1024 * 1024,
  });
  const timedOut = res.error?.code === "ETIMEDOUT";
  return {
    ok: res.status === 0 && !timedOut,
    exitCode: res.status ?? -1,
    stdout: res.stdout ?? "",
    stderr: timedOut ? "timed out" : (res.stderr ?? String(res.error?.message ?? "")),
    timedOut,
  };
}

/**
 * Check a numeric answer: extracts the LAST number in the text (workers often
 * narrate first) and compares within tolerance.
 * @returns {{ ok, found?, expected, errors: string[] }}
 */
export function validateNumeric(text, { expected, tolerance = 0 }) {
  const matches = String(text ?? "").replace(/,(?=\d{3}\b)/g, "").match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi);
  if (!matches?.length) return { ok: false, expected, errors: ["no number found in output"] };
  const found = Number(matches[matches.length - 1]);
  const ok = Math.abs(found - Number(expected)) <= tolerance;
  return { ok, found, expected, errors: ok ? [] : [`expected ${expected}±${tolerance}, got ${found}`] };
}

/**
 * Citation-support check for evidence-grounded answers. Answers must cite
 * [chunk-id] markers; every cited id must exist in the evidence pack, and at
 * least `minCitations` distinct ids must be cited.
 * @returns {{ ok, cited: string[], unknown: string[], errors: string[] }}
 */
export function validateCitations(text, { evidenceIds = [], minCitations = 1 } = {}) {
  const cited = [...new Set([...String(text ?? "").matchAll(/\[([A-Za-z0-9._:-]+)\]/g)].map((m) => m[1]))];
  const known = new Set(evidenceIds);
  const unknown = cited.filter((id) => !known.has(id));
  const validCount = cited.length - unknown.length;
  const errors = [];
  if (validCount < minCitations) errors.push(`needs ≥${minCitations} valid citation(s), found ${validCount}`);
  if (unknown.length) errors.push(`cites unknown evidence ids: ${unknown.join(", ")}`);
  return { ok: errors.length === 0, cited, unknown, errors };
}

/**
 * Classify a failed/suspect worker result into the failure taxonomy used by
 * the ledger and the escalation ladder.
 * @returns {"empty"|"truncated"|"timeout"|"malformed"|"wrong"|null} null = not classifiable here
 */
export function classifyFailure({ text = "", outcome = null, validation = null } = {}) {
  if (outcome === "timeout") return "timeout";
  if (outcome === "truncated") return "truncated";
  if (!String(text).trim() || outcome === "empty") return "empty";
  if (validation && validation.ok === false) {
    return validation.errors?.some((e) => /invalid JSON|expected .*, got/.test(e)) ? "malformed" : "wrong";
  }
  return null;
}
