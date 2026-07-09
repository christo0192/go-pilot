// Session-start recall seam — PLAN Step 4.5.
//
// At session start the orchestrator queries Tier-2 memory (Mem0) for the top-k
// relevant memories and injects a SMALL, bounded context block — replacing the
// manual handover doc. This module builds that recall + formatting logic
// against the { add, search } adapter contract (see mem0-adapter.mjs).
//
// Token accounting uses the repo-wide proxy: tokens = Math.ceil(str.length / 4).
// The injection is capped by a token budget; memories are included in rank
// order until the next bullet would blow the budget, then we STOP (no partial
// bullets). If even the first bullet overflows, its text is truncated with an
// ellipsis so we never exceed the budget.
//
// Pure and deterministic aside from the single adapter.search read.

/** Injection header. */
const HEADER = "## Recalled context";

/** Single-character ellipsis appended to a truncated bullet. */
const ELLIPSIS = "…";

/** Repo-wide token proxy: ~4 chars per token. */
function tokensOf(str) {
  return Math.ceil(str.length / 4);
}

/**
 * Derive a search query string from the caller-supplied context.
 *
 * Accepts:
 *   - a string                     -> used verbatim
 *   - an array of strings          -> joined with spaces (non-strings dropped)
 *   - an object with a `query`     -> its `query` string
 * Anything else (null/undefined/other) -> "" (which recalls nothing).
 *
 * @param {string | string[] | { query?: string }} context
 * @returns {string}
 */
function deriveQuery(context) {
  if (typeof context === "string") return context;
  if (Array.isArray(context)) {
    return context.filter((x) => typeof x === "string").join(" ");
  }
  if (context && typeof context === "object" && typeof context.query === "string") {
    return context.query;
  }
  return "";
}

/** Format one memory as a bullet: `- [kind] text`. */
function bulletFor(memory) {
  const kind = memory.kind ?? "memory";
  return `- [${kind}] ${memory.text}`;
}

/**
 * Build a header + single, truncated first bullet that fits inside the budget.
 * Only used when even the first bullet on its own overflows maxTokens.
 */
function truncatedFirst(memory, maxTokens) {
  const maxLen = maxTokens * 4; // ceil(len/4) <= maxTokens  <=>  len <= maxTokens*4
  const kind = memory.kind ?? "memory";
  const head = `${HEADER}\n- [${kind}] `;
  const avail = maxLen - head.length - ELLIPSIS.length;
  let text = avail > 0 ? head + memory.text.slice(0, avail) + ELLIPSIS : head + ELLIPSIS;
  // Hard clamp for pathologically tiny budgets — never exceed maxTokens.
  if (text.length > maxLen) text = text.slice(0, maxLen);
  return text;
}

/**
 * Query the adapter and format a bounded, rank-ordered injection block.
 *
 * @param {{ search: (query: string, topK?: number) => Array<{ memory: object, score: number }> }} adapter
 * @param {string | string[] | { query?: string }} context  Current session focus.
 * @param {{ topK?: number, maxTokens?: number }} [opts]
 * @returns {{ text: string, used: object[], tokens: number }}
 *   `text` is the injection string (or "" when nothing recalled), `used` are the
 *   memories actually included (rank order), `tokens` = tokensOf(text) <= maxTokens.
 */
export function recall(adapter, context, opts = {}) {
  const topK = opts.topK ?? 5;
  const maxTokens = opts.maxTokens ?? 300;
  const maxLen = maxTokens * 4;

  const query = deriveQuery(context);
  const hits = query.trim() === "" ? [] : adapter.search(query, topK);
  if (!hits || hits.length === 0) {
    return { text: "", used: [], tokens: 0 };
  }

  const used = [];
  let text = HEADER;

  for (let i = 0; i < hits.length; i++) {
    const memory = hits[i].memory;
    const candidate = `${text}\n${bulletFor(memory)}`;
    if (candidate.length <= maxLen) {
      // Fits within budget — include it and keep going.
      text = candidate;
      used.push(memory);
      continue;
    }
    // Does not fit. Drop this and all lower-ranked bullets (no partial cuts)...
    if (i === 0) {
      // ...unless even the top hit overflows, in which case truncate it to fit.
      text = truncatedFirst(memory, maxTokens);
      used.push(memory);
    }
    break;
  }

  let tokens = tokensOf(text);
  if (tokens > maxTokens) {
    // Final safety net — guarantees the budget is never exceeded.
    text = text.slice(0, maxLen);
    tokens = tokensOf(text);
  }
  return { text, used, tokens };
}
