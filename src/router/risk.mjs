// Deterministic risk classifier (Codex §1 "route on risk, not category name").
// First-pass, auditable routing: the orchestrator takes this suggestion by
// default and logs an override reason when it deviates (ledger: suggested vs
// actual). Heuristic keyword/shape rules — intentionally simple and testable.

const RULES = [
  // Highest-signal first. Each rule: risk class + suggested route + matcher.
  { risk: "creative", route: "kimi", re: /\b(poem|haiku|story|fiction|slogan|tagline|brainstorm|creative|catchy|lyrics|joke|metaphor)\b/i },
  { risk: "subjective", route: "frontier-final", re: /\b(executive|recommendation|strategy|should we|assessment|verdict|prioriti[sz]e|trade-?offs?|pros and cons|insight)\b/i },
  { risk: "evidence-grounded", route: "kimi", re: /\b(according to (the )?doc|cite|citation|based on the (document|report|pdf|transcript)|quote|from the attached)\b/i },
  { risk: "deterministic", route: "deepseek", re: /\b(implement|refactor|fix|bug|unit test|function|regex|sql|compile|patch|diff|repo|script|code|api endpoint)\b/i },
  { risk: "deterministic", route: "deepseek", re: /\b(calculate|compute|solve|sum|average|median|percent|derivative|integral|probability|how many)\b/i },
  { risk: "deterministic", route: "deepseek", re: /\b(extract|parse|json|csv|table|schema|fields?|structured|normali[sz]e|dedupe)\b/i },
  { risk: "evidence-grounded", route: "deepseek", re: /\b(summari[sz]e|tl;?dr|key points|analy[sz]e (the|this) data|spreadsheet|metrics)\b/i },
];

const LONG_CONTEXT_CHARS = 12_000; // ≳3k tokens of pasted material ⇒ the input is the challenge

/**
 * @param {string} taskText
 * @returns {{ risk: string, route: "deepseek"|"kimi"|"frontier-final",
 *             signals: string[], confidence: "high"|"low" }}
 * route "frontier-final": workhorse evidence/draft pass, orchestrator writes the final.
 */
export function classifyRisk(taskText) {
  const text = String(taskText ?? "");
  const signals = [];
  let hit = null;
  for (const rule of RULES) {
    const m = text.match(rule.re);
    if (m) {
      signals.push(`${rule.risk}:${m[0].toLowerCase()}`);
      if (!hit) hit = rule;
    }
  }
  if (text.length >= LONG_CONTEXT_CHARS) {
    signals.push(`long-context:${text.length}chars`);
    // Long input dominates unless the task is plainly deterministic (code/math on a big paste).
    if (!hit || hit.risk !== "deterministic") {
      return { risk: "long-context", route: "kimi", signals, confidence: "high" };
    }
  }
  if (!hit) {
    // Default posture: cheapest reliable worker; orchestrator may override with reason.
    return { risk: "deterministic", route: "deepseek", signals: ["default:no-signal"], confidence: "low" };
  }
  return { risk: hit.risk, route: hit.route, signals, confidence: "high" };
}
