import { createHash } from "node:crypto";
import { estimateTokens } from "../boundary/guard.mjs";

function section(name, content, stable) {
  return { name, content: String(content || ""), stable };
}

export function buildPrompt(input = {}) {
  const sections = [
    section("policy", input.policy, true),
    section("rules", input.rules, true),
    section("tools", input.toolSummary, true),
    section("retrieved-context", input.context, false),
    section("task", input.task, false),
  ].filter((item) => item.content.length > 0);
  const text = sections.map((item) => `## ${item.name}\n${item.content}`).join("\n\n");
  const stablePrefix = sections.filter((item) => item.stable).map((item) => `${item.name}\n${item.content}`).join("\n\n");
  return {
    text,
    sections,
    tokens: estimateTokens(text),
    cache: {
      key: createHash("sha256").update(stablePrefix).digest("hex"),
      stableTokens: estimateTokens(stablePrefix),
      cacheable: stablePrefix.length > 0,
    },
  };
}
