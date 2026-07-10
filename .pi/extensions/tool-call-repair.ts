/**
 * Tool-call schema validator + repair loop — Pi wrapper (Step 2.4).
 *
 * This is the reliability layer that makes weak open models usable as
 * tool-callers. It hooks Pi's `tool_call` lifecycle event (fired after
 * `tool_execution_start`, before the tool runs — and it CAN BLOCK), validates
 * the model's proposed arguments against a per-tool schema, and on an invalid
 * call BLOCKS execution with a precise correction message as the block
 * `reason`. Pi feeds that reason back to the model as the tool result, which
 * naturally re-prompts it — so Pi's own turn loop IS the re-prompt mechanism.
 * We bound the retries: after `maxRetries` consecutive invalid attempts for a
 * tool we stop blocking and let the call through (fail-open) so the agent is
 * never wedged.
 *
 * The real, unit-tested logic lives in `src/toolcall/repair.mjs`
 * (zero-dependency, `node --test`). This extension imports it directly rather
 * than re-implementing it — Pi loads extensions via jiti, which resolves a
 * relative `.mjs` import fine (verified headlessly). `runRepairLoop` in that
 * module is the standalone/testable form of this same bounded-repair loop with
 * an injected `reCall`; here the "reCall" is implicit — Pi re-prompts the model
 * for us when we block with a reason.
 *
 * NOTE ON MEASUREMENT: the before/after tool-call-success-rate measurement on a
 * real flaky open model is DEFERRED — it needs a provider key (LiteLLM has none
 * yet). It completes once OPENROUTER_API_KEY is set in `deploy/.env`. No numbers
 * are fabricated here.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Import the tested, zero-dep core. Path is relative to THIS file:
//   <root>/.pi/extensions/tool-call-repair.ts  →  <root>/src/toolcall/repair.mjs
import { validateToolCall, buildRepairPrompt } from "../../src/toolcall/repair.mjs";

// Minimal shape of a per-tool schema (mirrors src/toolcall/repair.mjs docs).
type ToolSchema = {
  required?: string[];
  properties?: Record<string, { type?: string }>;
  additionalProperties?: boolean;
};

const MAX_RETRIES = 2;

/**
 * Load the tool→schema registry from `config/toolcall-schemas.json` at the
 * project root, if present. Absent/invalid config → empty registry (the
 * extension then no-ops on every tool, which is safe).
 */
function loadSchemas(): Record<string, ToolSchema> {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const root = resolve(here, "..", "..");
    const path = resolve(root, "config", "toolcall-schemas.json");
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object") return {};
    // Drop documentation keys (leading "_") so they are never treated as tools.
    const out: Record<string, ToolSchema> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (key.startsWith("_")) continue;
      if (value && typeof value === "object") out[key] = value as ToolSchema;
    }
    return out;
  } catch {
    return {};
  }
}

export default function (pi: ExtensionAPI) {
  const schemas = loadSchemas();
  // Bounded-retry accounting, keyed by tool name. A tool that has already been
  // blocked `MAX_RETRIES` times is allowed through on the next attempt so the
  // agent is never permanently wedged. A valid call resets the counter.
  const attempts = new Map<string, number>();

  pi.on("tool_call", async (event, ctx) => {
    const schema = schemas[event.toolName];
    if (!schema) return undefined; // no schema registered for this tool → nothing to enforce

    const call = { name: event.toolName, arguments: event.input as Record<string, unknown> };
    const result = validateToolCall(call, schema);

    if (result.ok) {
      attempts.delete(event.toolName); // recovered / clean → reset the retry budget
      return undefined; // let the valid call execute
    }

    const priorBlocks = attempts.get(event.toolName) ?? 0;
    if (priorBlocks >= MAX_RETRIES) {
      // Budget exhausted — fail open so the agent can make progress. Surface a
      // warning so the operator knows repair did not converge.
      attempts.delete(event.toolName);
      if (ctx.hasUI) {
        ctx.ui.notify(
          `tool-call-repair: "${event.toolName}" still invalid after ${MAX_RETRIES} retries — allowing through`,
          "warning",
        );
      }
      return undefined;
    }

    attempts.set(event.toolName, priorBlocks + 1);
    const reason = buildRepairPrompt(call, result.errors);
    if (ctx.hasUI) {
      ctx.ui.setStatus(
        "tool-call-repair",
        `repairing "${event.toolName}" (attempt ${priorBlocks + 1}/${MAX_RETRIES})`,
      );
    }
    // Blocking with a reason: Pi returns `reason` to the model as the tool
    // result, which re-prompts it to emit a corrected call — the repair loop.
    return { block: true, reason };
  });

  // Optional manual command to inspect which tools have enforced schemas.
  pi.registerCommand("toolcall-schemas", {
    description: "List tools that have a repair schema registered",
    handler: async (_args, ctx) => {
      const names = Object.keys(schemas);
      const msg = names.length ? names.join(", ") : "(none — add config/toolcall-schemas.json)";
      ctx.ui.notify(`tool-call-repair schemas: ${msg}`, "info");
    },
  });
}
