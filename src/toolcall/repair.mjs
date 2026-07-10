// Tool-call schema validator + bounded repair loop.
//
// The reliability layer that makes weak open models usable as tool-callers:
// validate every tool call against a minimal schema, and on an invalid call
// feed the *exact* error back to the model and re-prompt — bounded retries.
//
// Pure and deterministic: no I/O, no clock, no randomness, zero dependencies.
// `runRepairLoop` takes an INJECTED `reCall` so the whole loop is testable
// with a fake (no model needed). The Pi extension in
// `.pi/extensions/tool-call-repair.ts` is the only thing that wires a real
// model in.

/** JSON-Schema-ish primitive type names this validator understands. */
const KNOWN_TYPES = new Set(["string", "number", "boolean", "object", "array"]);

/**
 * Classify a value into one of the KNOWN_TYPES names (or "null"/"undefined").
 * Distinguishes array vs object, and rejects NaN as a valid number.
 *
 * @param {unknown} value
 * @returns {string}
 */
function typeOf(value) {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isNaN(value) ? "NaN" : "number";
  return typeof value; // "string" | "boolean" | "object" | "function" | ...
}

/**
 * Validate a single tool call against a minimal per-tool schema.
 *
 * @param {{ name?: string, arguments?: Record<string, unknown> }} call
 *   The model's tool call. `call.arguments` holds the tool parameters.
 * @param {{
 *   required?: string[],
 *   properties?: Record<string, { type?: string }>,
 *   additionalProperties?: boolean,
 * }} schema
 *   Minimal spec: `required` field names, `properties` (field → { type }),
 *   and optional `additionalProperties: false` to flag unknown fields.
 * @returns {{ ok: boolean, errors: string[] }}
 *   `errors` are precise, human-readable strings — they get fed back to the
 *   model verbatim, so they must name the field and say what was wrong.
 */
export function validateToolCall(call, schema) {
  const errors = [];

  // --- Structural checks on the call envelope itself. ---
  if (call === null || typeof call !== "object") {
    return { ok: false, errors: ['Tool call must be an object with "name" and "arguments".'] };
  }
  if (typeof call.name !== "string" || call.name.length === 0) {
    errors.push('Tool call is missing a non-empty string "name".');
  }

  const args = call.arguments;
  const argsType = typeOf(args);
  if (argsType !== "object") {
    // Without a valid arguments object we cannot check fields — report and stop.
    errors.push(`Tool call "arguments" must be an object, got ${argsType}.`);
    return { ok: false, errors };
  }

  if (schema === null || typeof schema !== "object") {
    // No schema to check against: envelope-only validation.
    return { ok: errors.length === 0, errors };
  }

  const properties = schema.properties ?? {};
  const required = Array.isArray(schema.required) ? schema.required : [];

  // --- Required-field presence. ---
  for (const field of required) {
    if (!Object.prototype.hasOwnProperty.call(args, field) || args[field] === undefined) {
      errors.push(`Missing required field "${field}".`);
    }
  }

  // --- Type checks for present, specified fields. ---
  for (const [field, spec] of Object.entries(properties)) {
    if (!Object.prototype.hasOwnProperty.call(args, field)) continue;
    if (args[field] === undefined) continue; // absence already handled above
    const expected = spec && spec.type;
    if (!expected || !KNOWN_TYPES.has(expected)) continue; // no/unknown type constraint
    const actual = typeOf(args[field]);
    if (actual !== expected) {
      errors.push(`Field "${field}" must be of type ${expected}, got ${actual}.`);
    }
  }

  // --- Unknown-field flagging (only when explicitly forbidden). ---
  if (schema.additionalProperties === false) {
    for (const field of Object.keys(args)) {
      if (!Object.prototype.hasOwnProperty.call(properties, field)) {
        errors.push(`Unknown field "${field}" is not allowed.`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Build a concise correction message telling the model exactly what was wrong
 * and to re-emit the tool call correctly. Fed back to the model as the retry
 * prompt. Always contains the tool name and every specific error.
 *
 * @param {{ name?: string, arguments?: unknown }} call
 * @param {string[]} errors
 * @returns {string}
 */
export function buildRepairPrompt(call, errors) {
  const name = call && typeof call.name === "string" && call.name.length > 0 ? call.name : "(unknown)";
  const list = (Array.isArray(errors) ? errors : []).map((e) => `  - ${e}`).join("\n");
  return [
    `Your call to the "${name}" tool was invalid and was NOT executed.`,
    `The following problem(s) must be fixed:`,
    list,
    `Re-emit the "${name}" tool call with corrected arguments that satisfy the tool's schema. Do not add prose — return only the corrected tool call.`,
  ].join("\n");
}

/**
 * Validate a tool call and, if invalid, re-prompt the model up to `maxRetries`
 * times — re-validating each returned call. The `reCall` function is INJECTED
 * (given the repair prompt, returns the model's next `{ name, arguments }`),
 * which keeps this loop fully testable without any model.
 *
 * `reCall` is invoked ONLY when a call is invalid (never on a first-try pass).
 *
 * @param {{
 *   call: { name?: string, arguments?: Record<string, unknown> },
 *   schema: object,
 *   reCall: (repairPrompt: string, ctx: { attempt: number, errors: string[] }) => (Promise<object> | object),
 *   maxRetries?: number,
 * }} params
 * @returns {Promise<{ ok: boolean, call: object, attempts: number, errors: string[] }>}
 *   `attempts` counts total validations performed (1 initial + N retries).
 *   On success `call` is the valid call; on failure it is the last attempt,
 *   and `errors` holds why it was still invalid.
 */
export async function runRepairLoop({ call, schema, reCall, maxRetries = 2 }) {
  if (typeof reCall !== "function") {
    throw new Error("runRepairLoop: `reCall` must be a function");
  }

  let current = call;
  let attempts = 0;
  let last = validateToolCall(current, schema);
  attempts += 1;

  if (last.ok) {
    return { ok: true, call: current, attempts, errors: [] };
  }

  for (let retry = 0; retry < maxRetries; retry += 1) {
    const repairPrompt = buildRepairPrompt(current, last.errors);
    // Injected re-prompt — the only place a real model would be consulted.
    current = await reCall(repairPrompt, { attempt: attempts, errors: last.errors });
    last = validateToolCall(current, schema);
    attempts += 1;
    if (last.ok) {
      return { ok: true, call: current, attempts, errors: [] };
    }
  }

  return { ok: false, call: current, attempts, errors: last.errors };
}
