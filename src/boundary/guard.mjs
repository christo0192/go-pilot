// Reference > Compressed > Full boundary guard.
//
// Enforces the token-efficiency invariant: content crossing a pane boundary
// must be a reference/pointer or a compressed summary by default — NEVER raw
// full content unless explicitly justified.
//
// Budgets are counted in ESTIMATED TOKENS (not characters), because that is
// what the model actually pays for. When oversized full content must be
// downgraded and no external ref exists, the guard does STRUCTURED head-and-
// tail truncation that preserves the actionable failure signal (the command,
// exit code, failing test, file:line, and the first + final error lines), and
// hands back the full text as an addressable artifact plus a reference so the
// caller can persist it and nothing is silently lost.
//
// Pure and deterministic: no I/O, no clock, no randomness. The artifact id is a
// content hash (deterministic), so equal inputs yield equal ids.

import { createHash } from "node:crypto";

// Default per-boundary budget, in estimated tokens.
export const DEFAULT_THRESHOLD = 800;

const VALID_TIERS = new Set(["reference", "compressed", "full"]);

/**
 * Rough, dependency-free token estimate: ~4 characters per token. Deterministic
 * and monotonic in length — good enough to keep a boundary within a model's
 * budget without pulling in a tokenizer. Empty/blank → 0.
 * @param {string} str
 * @returns {number}
 */
export function estimateTokens(str) {
  if (typeof str !== "string" || str.length === 0) return 0;
  return Math.ceil(str.length / 4);
}

// High-signal lines worth preserving through a truncation: shell commands, exit
// codes, failing-test markers, file:line locations, and error/exception lines.
const SIGNAL_PATTERNS = [
  /^\s*[$>#]\s+\S/, // a shell command line ("$ npm test")
  /\bexit(?:ed)?\b.*\b(?:code|status)\b|\bexit code\b|\bcode\s+\d+\b/i, // exit code/status N
  /\b(?:FAIL(?:ED|ING|URE)?|not ok)\b|[✕✗✖✘×]/i, // failing-test markers (incl. glyphs)
  /\b(?:error|exception|traceback|panic|assert(?:ion)?error?)\b/i, // error lines
  /[\w./-]+\.[A-Za-z]\w*:\d+(?::\d+)?/, // path/file.ext:line[:col] (slashes/parens ok)
];

function isSignalLine(line) {
  if (!line || !line.trim()) return false;
  return SIGNAL_PATTERNS.some((re) => re.test(line));
}

function artifactId(content) {
  const h = createHash("sha256").update(content).digest("hex").slice(0, 12);
  return `artifact://sha256:${h}`;
}

/**
 * Structured head-and-tail truncation that keeps the actionable failure signal.
 *
 * Strategy: greedily preserve signal lines from the OUTSIDE in (so the first and
 * final errors survive), then fill remaining budget with a head and a tail
 * slice. Elided runs collapse into one `…[N lines · ~M tokens elided]…` marker,
 * and a trailing pointer to the full artifact is always appended.
 *
 * @param {string} content
 * @param {number} maxTokens  token budget for the surviving content
 * @param {string} ref        artifact reference to point at the full output
 * @returns {string}
 */
function structuredTruncate(content, maxTokens, ref) {
  // Hard postcondition: a "compressed" boundary must never cost MORE than the
  // raw content — otherwise the guard defeats its own purpose. Marker/ref
  // overhead is not budgeted line-by-line, so for tiny inputs or many scattered
  // short signal lines the assembled form can exceed the original; when it
  // does, the raw content is the cheapest faithful option, so emit that.
  const capToInput = (s) => (s.length < content.length ? s : content);

  const lines = content.split("\n");
  const n = lines.length;
  const lineCost = (s) => estimateTokens(s) + 1; // +1 for the line's newline
  const keep = new Set();

  const refNote = `full output → ${ref}`;
  // Budget is for content; the trailing ref line is unavoidable overhead.
  const budget = Math.max(1, maxTokens);

  // (1) Signal lines first, alternating earliest/latest inward so the opening
  //     command and the closing error both survive when the budget is tight.
  const signalIdx = [];
  for (let i = 0; i < n; i++) if (isSignalLine(lines[i])) signalIdx.push(i);

  let used = 0;
  const tryKeep = (i) => {
    if (i == null || keep.has(i)) return;
    const c = lineCost(lines[i]);
    if (used + c > budget) return;
    keep.add(i);
    used += c;
  };
  for (let lo = 0, hi = signalIdx.length - 1; lo <= hi; ) {
    tryKeep(signalIdx[lo++]);
    if (lo <= hi) tryKeep(signalIdx[hi--]);
  }

  // (2) Fill the remainder with a head slice, then a tail slice.
  let headB = Math.ceil((budget - used) / 2);
  for (let i = 0; i < n && headB > 0; i++) {
    if (keep.has(i)) continue;
    const c = lineCost(lines[i]);
    if (c > headB) break;
    keep.add(i);
    headB -= c;
    used += c;
  }
  let tailB = budget - used;
  for (let i = n - 1; i >= 0 && tailB > 0; i--) {
    if (keep.has(i)) continue;
    const c = lineCost(lines[i]);
    if (c > tailB) break;
    keep.add(i);
    tailB -= c;
  }

  // Fallback: a single line too large to fit anywhere would otherwise vanish.
  // Hard-slice the raw content head+tail so we never drop everything.
  if (keep.size === 0) {
    const chars = Math.max(2, maxTokens * 4);
    const headChars = Math.ceil(chars / 2);
    const tailChars = Math.floor(chars / 2);
    const head = content.slice(0, headChars);
    const tail = tailChars > 0 ? content.slice(-tailChars) : "";
    const elided = content.length - head.length - tail.length;
    return capToInput(
      `${head}\n…[~${estimateTokens(content)} tokens elided, ${elided} chars]…\n${tail}\n[${refNote}]`,
    );
  }

  // (3) Emit kept lines in order; collapse each gap into one marker.
  const idxs = [...keep].sort((a, b) => a - b);
  const out = [];
  const gapMarker = (from, to) => {
    const count = to - from;
    let toks = 0;
    for (let k = from; k < to; k++) toks += estimateTokens(lines[k]);
    out.push(`…[${count} line${count === 1 ? "" : "s"} · ~${toks} tokens elided]…`);
  };
  let prev = -1;
  for (const i of idxs) {
    if (i > prev + 1) gapMarker(prev + 1, i);
    out.push(lines[i]);
    prev = i;
  }
  if (prev < n - 1) gapMarker(prev + 1, n);
  out.push(`[${refNote}]`);
  return capToInput(out.join("\n"));
}

/**
 * Guard a payload crossing a pane boundary.
 *
 * @param {{ tier: "reference"|"compressed"|"full", content?: string, ref?: unknown, justification?: string }} payload
 * @param {{ threshold?: number }} [opts]  `threshold` is a TOKEN budget
 * @returns {{ tier: string, content?: string, ref?: unknown, artifact?: {id: string, content: string, tokens: number}, flagged: boolean, reason: string }}
 */
export function guardBoundary(payload, opts = {}) {
  if (payload === null || typeof payload !== "object") {
    throw new Error("guardBoundary: payload must be an object");
  }

  const { tier, content, ref, justification } = payload;

  if (tier === undefined || tier === null) {
    throw new Error("guardBoundary: missing tier");
  }
  if (!VALID_TIERS.has(tier)) {
    throw new Error(
      `guardBoundary: unknown tier "${tier}" (expected reference | compressed | full)`,
    );
  }

  if (tier === "reference") {
    return { tier: "reference", ref, flagged: false, reason: "reference passes" };
  }

  if (tier === "compressed") {
    return { tier: "compressed", content, flagged: false, reason: "compressed passes" };
  }

  // tier === "full"
  if (typeof content !== "string") {
    throw new Error("guardBoundary: full tier requires a string `content`");
  }

  // Explicit justification always allows raw full content through.
  if (typeof justification === "string" && justification.length > 0) {
    return { tier: "full", content, flagged: false, reason: "justified" };
  }

  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const tokens = estimateTokens(content);

  // Small enough (in tokens) to pass without justification.
  if (tokens <= threshold) {
    return { tier: "full", content, flagged: false, reason: "under threshold" };
  }

  // Unjustified full content over budget → downgrade.
  if (ref !== undefined && ref !== null) {
    return {
      tier: "reference",
      ref,
      flagged: true,
      reason: "downgraded: unjustified full content over threshold, ref available",
    };
  }

  // No ref → structured head+tail truncation that keeps the failure signal, and
  // preserve the full output as an addressable artifact + reference.
  const id = artifactId(content);
  const truncated = structuredTruncate(content, threshold, id);
  return {
    tier: "compressed",
    content: truncated,
    ref: id,
    artifact: { id, content, tokens },
    flagged: true,
    reason:
      "downgraded: unjustified full content over token budget — head+tail truncated, full output preserved as artifact",
  };
}
