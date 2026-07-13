// Multi-turn session-state compression (Codex §7) — instead of resending a
// growing raw transcript every turn, maintain a small, structured STATE
// object (decisions / constraints / open questions / refs / done steps) and
// render THAT as the context payload. State grows with signal, not with
// turn count, so token cost stays roughly flat across a long session instead
// of growing linearly with history.
//
// Extraction is heuristic (regex over sentences) rather than model-driven —
// zero deps, deterministic, and cheap enough to run on every turn. It will
// miss nuance a model-based summarizer would catch; `consistencyCheck` exists
// specifically to catch the OTHER failure mode (a state item that has drifted
// away from anything actually said) since the heuristic has no semantic
// understanding of what it extracted.
//
// Pure functions only — no I/O, no clock, no randomness. Every "state" value
// is a plain object of arrays; `updateState` always returns a NEW state and
// never mutates the one it was given.

/** Case/length-insensitive stopwords stripped from "significant token" sets
 * used by both open-question resolution and `consistencyCheck`. Small and
 * deliberately conservative — under-stripping just weakens the overlap
 * signal a little, over-stripping could hide real support. */
const STOPWORDS = new Set([
  "this", "that", "with", "from", "have", "will", "would", "should", "could",
  "about", "into", "your", "what", "when", "where", "which", "there", "their",
  "then", "than", "these", "those", "been", "being", "does", "did", "doing",
  "over", "also", "just", "only", "more", "some", "such", "each", "both",
  "most", "other", "them", "they", "were", "very", "some", "much", "many",
  "like", "still", "even", "make", "made", "want", "need", "sure", "okay",
]);

/** Sentence-level heuristics. Each is a plain `/\b(...)\b/i` alternation
 * tested against ONE sentence at a time — the exact regexes come straight
 * from the spec, so the extraction is auditable line-by-line against it. */
const DECISION_RE = /\b(decided|we will|let's go with|chosen|agreed|use|picked)\b/i;
const CONSTRAINT_RE = /\b(must|never|always|only|cannot|don't|budget|limit|deadline)\b/i;
const OPEN_KEYWORD_RE = /\b(TODO|open question|unresolved|pending)\b/i;
const DONE_RE = /\b(done|completed|fixed|implemented|shipped|created|verified|passed)\b/i;

/** Ref-extraction regexes, run over the FULL turn text (refs are tokens, not
 * sentences). Order matters: URLs and backtick spans are claimed first so the
 * generic path regex doesn't re-report a fragment of either as a second,
 * near-duplicate ref (e.g. the `//host/path` tail of a URL). */
const URL_RE = /https?:\/\/[^\s)]+/g;
const BACKTICK_RE = /`([^`]+)`/g;
const PATH_RE = /[\w./-]+\.\w{1,5}/g;

/** Extensions that count as a "known ext" ref even with no "/" in the token
 * (e.g. a bare `package.json`). Deliberately a plain-text file/config/code
 * allowlist, not exhaustive. */
const KNOWN_EXTS = new Set([
  "mjs", "js", "jsx", "ts", "tsx", "json", "md", "yml", "yaml", "py", "txt",
  "css", "scss", "html", "sh", "bash", "toml", "xml", "csv", "sql", "env",
  "lock", "log", "cfg", "ini", "rb", "go", "rs", "java", "c", "h", "cpp",
  "php", "pdf", "png", "jpg", "jpeg", "gif", "svg",
]);

/** Minimum fraction of an item's significant tokens that must reappear
 * elsewhere (a resolving decision/doneStep, or the source turns) for it to
 * count as supported/resolved. Shared by `updateState`'s open-question
 * resolution and by `consistencyCheck`. */
const OVERLAP_THRESHOLD = 0.6;

/** Cap applied to any extracted sentence before it is stored. */
const MAX_ITEM_CHARS = 200;

/**
 * Lowercase-alnum tokenizer with a length>3 floor and stopword removal, used
 * to compare "does this state item still connect to the real text" without
 * requiring exact substring matches (tense/phrasing naturally drifts between
 * a question and its eventual answer).
 * @param {string} text
 * @returns {string[]}
 */
function significantTokens(text) {
  const words = String(text ?? "").toLowerCase().match(/[a-z0-9]+/g) || [];
  return words.filter((w) => w.length > 3 && !STOPWORDS.has(w));
}

/**
 * Split free text into trimmed, non-empty sentence-ish chunks: split on
 * sentence-terminal punctuation followed by whitespace, and on newlines
 * (chat turns are frequently line-oriented rather than prose-oriented).
 * @param {string} text
 * @returns {string[]}
 */
function splitSentences(text) {
  return String(text ?? "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Cap a stored item to MAX_ITEM_CHARS, per the API contract ("≤200 chars").
 * @param {string} s
 * @returns {string}
 */
function truncate(s) {
  return s.length > MAX_ITEM_CHARS ? s.slice(0, MAX_ITEM_CHARS) : s;
}

/**
 * Append `additions` to `existing`, case-insensitively deduped, WITHOUT
 * mutating `existing` — always returns a new array (this is what makes
 * `updateState` immutable with respect to its input state).
 * @param {string[]} existing
 * @param {string[]} additions
 * @returns {string[]}
 */
function dedupeAppend(existing, additions) {
  const seen = new Set(existing.map((s) => s.toLowerCase()));
  const result = [...existing];
  for (const item of additions) {
    const key = item.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

/**
 * Is `ext` (no leading dot) one of the KNOWN_EXTS? Case-insensitive.
 * @param {string} ext
 * @returns {boolean}
 */
function isKnownExt(ext) {
  return KNOWN_EXTS.has(String(ext).toLowerCase());
}

/**
 * Extract ref tokens (file paths, URLs, backtick-quoted tokens) from a whole
 * turn's raw text. URLs and backtick spans are claimed first (by character
 * range) so the generic path regex is skipped wherever it would just
 * re-report a fragment already captured by one of those two.
 * @param {string} text
 * @returns {string[]}
 */
function extractRefs(text) {
  const s = String(text ?? "");
  const refs = [];
  const consumed = [];

  const claim = (start, end) => consumed.push([start, end]);
  const isClaimed = (start, end) => consumed.some(([cs, ce]) => start < ce && end > cs);

  for (const m of s.matchAll(URL_RE)) {
    refs.push(m[0].replace(/[.,;:)]+$/, ""));
    claim(m.index, m.index + m[0].length);
  }
  for (const m of s.matchAll(BACKTICK_RE)) {
    refs.push(m[1]);
    claim(m.index, m.index + m[0].length);
  }
  for (const m of s.matchAll(PATH_RE)) {
    const start = m.index;
    const end = start + m[0].length;
    if (isClaimed(start, end)) continue;
    const token = m[0];
    const dot = token.lastIndexOf(".");
    const ext = token.slice(dot + 1);
    if (token.includes("/") || isKnownExt(ext)) {
      refs.push(token.replace(/[.,;:)]+$/, ""));
    }
  }
  return refs;
}

/**
 * Run every sentence-level heuristic over one turn, returning the NEW items
 * it contributes to each bucket (not yet merged/deduped into a state).
 * @param {{role: string, text: string}} turn
 * @returns {{decisions: string[], constraints: string[], openQuestions: string[], refs: string[], doneSteps: string[]}}
 */
function extractTurnItems(turn) {
  const role = turn?.role;
  const text = turn?.text ?? "";
  const out = { decisions: [], constraints: [], openQuestions: [], refs: [], doneSteps: [] };

  for (const s of splitSentences(text)) {
    if (DECISION_RE.test(s)) out.decisions.push(truncate(s));
    if (CONSTRAINT_RE.test(s)) out.constraints.push(truncate(s));
    if (role === "user" && s.endsWith("?")) out.openQuestions.push(truncate(s));
    if (OPEN_KEYWORD_RE.test(s)) out.openQuestions.push(truncate(s));
    if (role === "assistant" && DONE_RE.test(s)) out.doneSteps.push(truncate(s));
  }

  out.refs = extractRefs(text);
  return out;
}

/**
 * Does `item` count as supported/resolved by ANY of `sources`? True iff at
 * least OVERLAP_THRESHOLD of item's significant tokens appear in the
 * significant-token set of at least one single source string.
 * @param {string} item
 * @param {string[]} sources
 * @returns {boolean}
 */
function overlapsAny(item, sources) {
  const itemTokens = significantTokens(item);
  if (itemTokens.length === 0) return false;
  return sources.some((src) => {
    const srcTokens = new Set(significantTokens(src));
    const hits = itemTokens.filter((t) => srcTokens.has(t)).length;
    return hits / itemTokens.length >= OVERLAP_THRESHOLD;
  });
}

/**
 * Create a fresh, empty session-compression state.
 * @returns {{decisions: string[], constraints: string[], openQuestions: string[], refs: string[], doneSteps: string[], turnCount: number}}
 */
export function createState() {
  return {
    decisions: [],
    constraints: [],
    openQuestions: [],
    refs: [],
    doneSteps: [],
    turnCount: 0,
  };
}

/**
 * Fold one more turn into a state, returning a NEW state — `state` is never
 * mutated. Heuristically extracts decisions/constraints/openQuestions/refs/
 * doneSteps from `turn.text` (role-gated where the contract specifies a
 * role), dedupes each list case-insensitively, then resolves any open
 * question whose significant tokens now sufficiently overlap a decision or
 * doneStep (own or prior) by dropping it from `openQuestions`.
 * @param {{decisions: string[], constraints: string[], openQuestions: string[], refs: string[], doneSteps: string[], turnCount: number}} state
 * @param {{role: "user"|"assistant"|string, text: string}} turn
 * @returns {{decisions: string[], constraints: string[], openQuestions: string[], refs: string[], doneSteps: string[], turnCount: number}}
 */
export function updateState(state, turn) {
  const items = extractTurnItems(turn);

  const decisions = dedupeAppend(state.decisions, items.decisions);
  const constraints = dedupeAppend(state.constraints, items.constraints);
  const refs = dedupeAppend(state.refs, items.refs);
  const doneSteps = dedupeAppend(state.doneSteps, items.doneSteps);
  const mergedOpenQuestions = dedupeAppend(state.openQuestions, items.openQuestions);

  // Resolve: drop any open question now sufficiently echoed by a decision or
  // doneStep — re-checked against the FULL current lists every call, so a
  // question resolves whenever its answer lands, regardless of which turn
  // that was.
  const openQuestions = mergedOpenQuestions.filter(
    (q) => !overlapsAny(q, [...decisions, ...doneSteps]),
  );

  return {
    decisions,
    constraints,
    openQuestions,
    refs,
    doneSteps,
    turnCount: state.turnCount + 1,
  };
}

/**
 * Render a state into a compact, human-readable context block: a header
 * naming the turn count, then one "- item" section per non-empty list (most
 * recent item first within each section), hard-capped to `maxChars` — kept
 * to whole lines, with a trailing "…" marker if anything was cut.
 * @param {{decisions: string[], constraints: string[], openQuestions: string[], refs: string[], doneSteps: string[], turnCount: number}} state
 * @param {{maxChars?: number}} [options]
 * @returns {string}
 */
export function renderState(state, { maxChars = 1500 } = {}) {
  const lines = [`## Session state (turn ${state.turnCount})`];
  const sections = [
    ["Decisions:", state.decisions],
    ["Constraints:", state.constraints],
    ["Open:", state.openQuestions],
    ["Refs:", state.refs],
    ["Done:", state.doneSteps],
  ];

  for (const [heading, items] of sections) {
    if (!items.length) continue;
    lines.push(heading);
    for (let i = items.length - 1; i >= 0; i--) lines.push(`- ${items[i]}`);
  }

  const full = lines.join("\n");
  if (full.length <= maxChars) return full;

  const MARKER = "\n…";
  const budget = Math.max(0, maxChars - MARKER.length);
  let out = "";
  for (const line of lines) {
    const next = out ? `${out}\n${line}` : line;
    if (next.length > budget) break;
    out = next;
  }
  return out + MARKER;
}

/**
 * Traceability audit: every item across all five state lists must be
 * supported by at least one of `turns` — ≥OVERLAP_THRESHOLD of the item's
 * significant tokens must appear in that turn's text. Items that aren't are
 * reported as `unsupported`; this is the safety net for a heuristic
 * extractor that has no real understanding of what it pulled out.
 * @param {{decisions: string[], constraints: string[], openQuestions: string[], refs: string[], doneSteps: string[], turnCount: number}} state
 * @param {Array<{role: string, text: string}>} turns
 * @returns {{ok: boolean, unsupported: string[]}}
 */
export function consistencyCheck(state, turns) {
  const turnTexts = (turns ?? []).map((t) => t.text ?? "");
  const unsupported = [];

  const allItems = [
    ...state.decisions,
    ...state.constraints,
    ...state.openQuestions,
    ...state.refs,
    ...state.doneSteps,
  ];

  for (const item of allItems) {
    const traceable =
      overlapsAny(item, turnTexts) ||
      // Refs/short tokens may have no "significant" words at all (e.g. a bare
      // 3-4 letter extension-less path) — fall back to a literal substring
      // check so those aren't unfairly flagged.
      turnTexts.some((t) => t.toLowerCase().includes(String(item).toLowerCase()));
    if (!traceable) unsupported.push(item);
  }

  return { ok: unsupported.length === 0, unsupported };
}

/**
 * Measure the compression achieved by rendering a state instead of resending
 * the raw turns: total raw character count vs. rendered character count.
 * @param {Array<{role: string, text: string}>} turns
 * @param {string} rendered
 * @returns {{fullChars: number, compressedChars: number, reductionPct: number}}
 */
export function compressionReport(turns, rendered) {
  const fullChars = (turns ?? []).reduce((sum, t) => sum + String(t?.text ?? "").length, 0);
  const compressedChars = String(rendered ?? "").length;
  const reductionPct = fullChars === 0
    ? 0
    : Math.round(((fullChars - compressedChars) / fullChars) * 10000) / 100;
  return { fullChars, compressedChars, reductionPct };
}
