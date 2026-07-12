// Grader for the live campaign (docs/live-test-plan.md §6).
//
// Two grading tracks:
//   DETERMINISTIC (no LLM judge) — ground truth exists:
//     - exact       : math/numeric/symbolic exact match with answer extraction
//     - unit-test   : self-contained code; extract code, run hidden assert tests
//     - repo-change : apply model's full-file edits to a throwaway git fixture,
//                     run hidden tests (pass = test process exits 0)
//   BLIND DUAL-JUDGE (Opus primary + DeepSeek co-judge) — open-ended:
//     - rubric      : per-dimension 1-10 scores, anchored by calibration
//                     examples, arm/model labels stripped; report inter-judge
//                     agreement and flag disagreements (|Δ| ≥ 2).
//
// Quality is normalized to 0-100 across ALL types so §2 gates compare cleanly
// (deterministic pass=100 / fail=0; rubric = mean dimension score x10).
//
// Deterministic helpers are pure and unit-tested. Judge orchestration takes an
// injectable dispatchJudge(request) so grading is re-runnable and testable.
// Zero external deps (node builtins; python3/git shelled out for code tasks).

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Answer extraction (deterministic exact grading)
// ---------------------------------------------------------------------------

/** Last \boxed{...} content, or null. Handles one level of simple braces. */
export function extractBoxed(text) {
  const re = /\\boxed\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;
  let m;
  let last = null;
  while ((m = re.exec(text)) !== null) last = m[1];
  return last;
}

/** Last "the answer is X" / "answer: X" / "final answer: X" capture, or null.
 *  Captures the rest of the line, then strips trailing sentence punctuation. */
export function extractAnswerPhrase(text) {
  const re = /(?:the\s+answer\s+is|final\s+answer\s*:?|answer\s*:)\s*\$?\\?\(?\s*([^\n]+)/gi;
  let m;
  let last = null;
  while ((m = re.exec(text)) !== null) last = m[1];
  return last ? last.trim().replace(/[.\s]+$/, "") : null;
}

/** Last standalone number (int/float/sci, comma grouping allowed), or null. */
export function extractLastNumber(text) {
  const re = /-?\d[\d,]*\.?\d*(?:[eE][-+]?\d+)?/g;
  let m;
  let last = null;
  while ((m = re.exec(text)) !== null) last = m[0];
  return last;
}

/** Last non-empty line, trimmed, or null. */
export function extractFinalLine(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : null;
}

const EXTRACTORS = {
  boxed: extractBoxed,
  "answer-phrase": extractAnswerPhrase,
  "last-number": extractLastNumber,
  "final-line": extractFinalLine,
};

/**
 * Extract a candidate answer from free-form model output using an ordered list
 * of strategies (first hit wins). Defaults suit math: boxed → answer-phrase →
 * last-number.
 */
export function extractAnswer(text, { extract } = {}) {
  const strategies = Array.isArray(extract) && extract.length ? extract : ["boxed", "answer-phrase", "last-number"];
  for (const name of strategies) {
    const fn = EXTRACTORS[name];
    if (!fn) throw new Error(`unknown extractor "${name}"`);
    const v = fn(text);
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return null;
}

function normalizeNumber(s) {
  if (s == null) return NaN;
  // Pull the first number out of the candidate so "3.14 units" / "$42.0" work.
  const m = String(s).replace(/,/g, "").match(/-?\d+\.?\d*(?:[eE][-+]?\d+)?/);
  return m ? Number(m[0]) : NaN;
}

function normalizeString(s) {
  return String(s == null ? "" : s).trim().toLowerCase().replace(/\s+/g, " ").replace(/[.$]+$/, "");
}

/** Grade an `exact` fixture. Returns {type,pass,score,candidate}. */
export function gradeExact(output, grading) {
  const candidate = extractAnswer(output, grading);
  const answers = grading.answers || (grading.answer != null ? [grading.answer] : []);
  const match = grading.match || "numeric";
  let pass = false;
  if (candidate != null) {
    if (match === "numeric") {
      const c = normalizeNumber(candidate);
      const tol = Number.isFinite(grading.tolerance) ? grading.tolerance : 1e-6;
      pass = answers.some((a) => Number.isFinite(c) && Math.abs(c - normalizeNumber(a)) <= tol);
    } else if (match === "string") {
      const c = normalizeString(candidate);
      pass = answers.some((a) => normalizeString(a) === c);
    } else if (match === "regex") {
      pass = answers.some((a) => new RegExp(a).test(candidate));
    } else {
      throw new Error(`unknown match mode "${match}"`);
    }
  }
  return { type: "exact", pass, score: pass ? 100 : 0, candidate };
}

// ---------------------------------------------------------------------------
// Code extraction + execution (unit-test, repo-change)
// ---------------------------------------------------------------------------

/** Extract a code block. Prefers the last fenced ``` block; else raw text. */
export function extractCode(text, { language } = {}) {
  const fence = /```(\w+)?\s*\n([\s\S]*?)```/g;
  let m;
  let last = null;
  let langMatch = null;
  while ((m = fence.exec(text)) !== null) {
    last = m[2];
    if (language && m[1] && m[1].toLowerCase() === language.toLowerCase()) langMatch = m[2];
  }
  if (langMatch != null) return langMatch.trim();
  if (last != null) return last.trim();
  return text.trim();
}

/**
 * Parse full-file edit blocks in the required format:
 *   <<<FILE path/to/file>>>
 *   ...content...
 *   <<<END>>>
 * Returns [{path, content}]. Also tolerates fenced code inside the block.
 */
export function parseFileEdits(text) {
  const re = /<<<FILE\s+(.+?)>>>\s*\n([\s\S]*?)\n?<<<END>>>/g;
  const edits = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    let content = m[2];
    // If the whole block is a single fenced snippet, unwrap it.
    const fenced = content.match(/^```\w*\s*\n([\s\S]*?)\n```\s*$/);
    if (fenced) content = fenced[1];
    edits.push({ path: m[1].trim(), content });
  }
  return edits;
}

function runProcess(cmd, args, { cwd, input, timeoutMs }) {
  const r = spawnSync(cmd, args, {
    cwd,
    input,
    encoding: "utf8",
    timeout: timeoutMs || 15000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    ok: r.status === 0,
    status: r.status,
    timedOut: r.error?.code === "ETIMEDOUT" || r.signal === "SIGTERM",
    stdout: r.stdout || "",
    stderr: (r.stderr || "") + (r.error ? `\n${r.error.message}` : ""),
  };
}

const RUNNERS = {
  python: (file) => ["python3", [file]],
  node: (file) => ["node", [file]],
};

/**
 * Grade a `unit-test` fixture: extract code, append hidden assert tests, run.
 * Pass = the test process exits 0.
 */
export function gradeUnitTest(output, grading) {
  const lang = grading.language || "python";
  const runner = RUNNERS[lang];
  if (!runner) throw new Error(`unsupported unit-test language "${lang}"`);
  const code = extractCode(output, grading);
  if (!code || !code.trim()) return { type: "unit-test", pass: false, score: 0, reason: "empty-code" };
  const ext = lang === "python" ? "py" : "js";
  const dir = mkdtempSync(join(tmpdir(), "gopilot-grade-"));
  try {
    const file = join(dir, `solution.${ext}`);
    writeFileSync(file, `${code}\n\n${grading.tests || ""}\n`, "utf8");
    const [cmd, args] = runner(file);
    const res = runProcess(cmd, args, { cwd: dir, timeoutMs: grading.timeoutMs });
    return {
      type: "unit-test",
      pass: res.ok,
      score: res.ok ? 100 : 0,
      timedOut: res.timedOut,
      stderr: res.stderr.slice(-800),
      extractedCodeChars: code.length,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Grade a `repo-change` fixture: build a throwaway repo from grading.files, apply
 * the model's full-file edits, write hidden test file(s), run testCommand.
 * Pass = the test process exits 0. Captures the applied diff as evidence.
 */
export function gradeRepoChange(output, grading) {
  const dir = mkdtempSync(join(tmpdir(), "gopilot-repo-"));
  try {
    for (const f of grading.files || []) {
      const p = join(dir, f.path);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, f.content, "utf8");
    }
    // Snapshot as a git repo so we can show the applied diff as evidence.
    runProcess("git", ["init", "-q"], { cwd: dir, timeoutMs: 15000 });
    runProcess("git", ["add", "-A"], { cwd: dir, timeoutMs: 15000 });
    runProcess("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "fixture"], { cwd: dir, timeoutMs: 15000 });

    const edits = parseFileEdits(output);
    if (edits.length === 0) return { type: "repo-change", pass: false, score: 0, reason: "no-file-edits" };
    for (const e of edits) {
      const p = resolve(dir, e.path);
      if (!p.startsWith(resolve(dir))) return { type: "repo-change", pass: false, score: 0, reason: `path-escape:${e.path}` };
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, e.content, "utf8");
    }
    // Hidden tests written AFTER edits so a model can't overwrite them.
    for (const t of grading.testFiles || []) {
      const p = join(dir, t.path);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, t.content, "utf8");
    }
    const [cmd, ...args] = grading.testCommand || ["python3", "test_main.py"];
    const res = runProcess(cmd, args, { cwd: dir, timeoutMs: grading.timeoutMs || 20000 });
    const diff = runProcess("git", ["--no-pager", "diff", "HEAD", "--stat"], { cwd: dir, timeoutMs: 15000 });
    return {
      type: "repo-change",
      pass: res.ok,
      score: res.ok ? 100 : 0,
      timedOut: res.timedOut,
      appliedFiles: edits.map((e) => e.path),
      diffStat: diff.stdout.slice(-600),
      stderr: res.stderr.slice(-800),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Blind dual-judge (rubric)
// ---------------------------------------------------------------------------

/** Build a blind judge prompt: task + rubric + calibration anchors + output. */
export function buildJudgePrompt(fixture, output, grading) {
  const dims = grading.dimensions || ["correctness", "completeness", "reasoning", "faithfulness"];
  const anchors = (grading.calibrationAnchors || [])
    .map((a, i) => `Anchor ${i + 1} (scores ${JSON.stringify(a.scores)}):\n${a.answer}`)
    .join("\n\n");
  return [
    "You are a strict, impartial grader. Score the CANDIDATE ANSWER against the task on each dimension using an integer 1-10 scale (10 = flawless, 1 = unacceptable). Judge only quality; you do not know which system produced it.",
    "",
    `## Task\n${fixture.prompt}`,
    fixture.inputs?.length ? `\n## Provided inputs\n${fixture.inputs.map((x) => `[${x.name}]\n${x.content}`).join("\n\n")}` : "",
    grading.guidance ? `\n## Rubric guidance\n${grading.guidance}` : "",
    anchors ? `\n## Calibration anchors (pre-scored)\n${anchors}` : "",
    `\n## Dimensions\n${dims.join(", ")}`,
    `\n## CANDIDATE ANSWER\n${output}`,
    `\n## Output format\nReturn ONLY strict JSON, no prose:\n{"scores":{${dims.map((d) => `"${d}":<1-10>`).join(",")}},"rationale":"<one sentence>"}`,
  ].filter(Boolean).join("\n");
}

/** Parse a judge's JSON reply into {scores, rationale, overall(0-100)}. */
export function parseJudgeScores(text, dimensions) {
  const dims = dimensions || ["correctness", "completeness", "reasoning", "faithfulness"];
  let obj = null;
  const fenced = text.match(/```json\s*\n([\s\S]*?)```/i) || text.match(/```\s*\n([\s\S]*?)```/);
  const candidates = [];
  if (fenced) candidates.push(fenced[1]);
  const brace = text.match(/\{[\s\S]*\}/);
  if (brace) candidates.push(brace[0]);
  for (const c of candidates) {
    try { obj = JSON.parse(c); break; } catch { /* try next */ }
  }
  if (!obj || !obj.scores) return { ok: false, scores: null, rationale: null, overall: 0, raw: text.slice(0, 200) };
  const scores = {};
  let sum = 0;
  let count = 0;
  for (const d of dims) {
    let v = Number(obj.scores[d]);
    if (!Number.isFinite(v)) v = 1;
    v = Math.min(10, Math.max(1, v));
    scores[d] = v;
    sum += v;
    count += 1;
  }
  return { ok: true, scores, rationale: obj.rationale || "", overall: count ? (sum / count) * 10 : 0 };
}

/**
 * Grade a `rubric` fixture with two blind judges. dispatchJudge(request) →
 * {result:{text}, usage}. Opus is the primary judge, DeepSeek the co-judge.
 * Reports mean quality, per-dimension inter-judge |Δ|, and a disagreement flag.
 */
export async function gradeRubric(fixture, output, grading, { dispatchJudge, judgeModels } = {}) {
  if (typeof dispatchJudge !== "function") throw new Error("gradeRubric requires opts.dispatchJudge");
  const dims = grading.dimensions || ["correctness", "completeness", "reasoning", "faithfulness"];
  const prompt = buildJudgePrompt(fixture, output, grading);
  const models = judgeModels || { primary: { plane: "frontier", model: "opus" }, co: { plane: "workhorse", model: "deepseek-ikey" } };

  const [primaryRes, coRes] = await Promise.all([
    dispatchJudge({ ...models.primary, prompt, role: "judge" }),
    dispatchJudge({ ...models.co, prompt, role: "judge" }),
  ]);
  const primary = parseJudgeScores(primaryRes.result?.text || "", dims);
  const co = parseJudgeScores(coRes.result?.text || "", dims);

  const perDimensionDelta = {};
  let maxDelta = 0;
  for (const d of dims) {
    const delta = Math.abs((primary.scores?.[d] ?? 0) - (co.scores?.[d] ?? 0));
    perDimensionDelta[d] = delta;
    if (delta > maxDelta) maxDelta = delta;
  }
  const overalls = [primary.overall, co.overall].filter((x) => Number.isFinite(x) && x > 0);
  const quality = overalls.length ? overalls.reduce((a, b) => a + b, 0) / overalls.length : 0;
  return {
    type: "rubric",
    score: quality,
    judges: {
      opus: { ...primary, usage: primaryRes.usage },
      deepseek: { ...co, usage: coRes.usage },
    },
    perDimensionDelta,
    maxDelta,
    flaggedDisagreement: maxDelta >= 2,
    bothParsed: primary.ok && co.ok,
  };
}

// ---------------------------------------------------------------------------
// Dispatch + manifest
// ---------------------------------------------------------------------------

/**
 * Grade one output against a fixture. Empty output is a hard fail (score 0,
 * failure="empty") regardless of type. Deterministic types return synchronously
 * wrapped in a resolved promise; rubric awaits the judges.
 */
export async function grade(fixture, output, ctx = {}) {
  const text = typeof output === "string" ? output : output?.text ?? "";
  if (!text.trim()) return { type: fixture.grading.type, pass: false, score: 0, failure: "empty" };
  switch (fixture.grading.type) {
    case "exact": return gradeExact(text, fixture.grading);
    case "unit-test": return gradeUnitTest(text, fixture.grading);
    case "repo-change": return gradeRepoChange(text, fixture.grading);
    case "rubric": return gradeRubric(fixture, text, fixture.grading, ctx);
    default: throw new Error(`unknown grading type "${fixture.grading.type}"`);
  }
}

const REQUIRED = ["id", "area", "category", "armAModel", "prompt", "settings", "grading"];

/** Validate a fixture's shape. Returns {valid, errors[]}. */
export function validateFixture(fx) {
  const errors = [];
  for (const k of REQUIRED) if (fx[k] == null) errors.push(`missing ${k}`);
  if (fx.grading) {
    const t = fx.grading.type;
    if (!["exact", "unit-test", "repo-change", "rubric"].includes(t)) errors.push(`bad grading.type "${t}"`);
    if (t === "exact" && fx.grading.answer == null && !(fx.grading.answers?.length)) errors.push("exact needs answer/answers");
    if (t === "unit-test" && !fx.grading.tests) errors.push("unit-test needs tests");
    if (t === "repo-change" && (!fx.grading.files?.length || !fx.grading.testCommand)) errors.push("repo-change needs files + testCommand");
    if (t === "rubric" && !fx.grading.dimensions?.length) errors.push("rubric needs dimensions");
  }
  if (fx.settings && !Number.isFinite(fx.settings.max_tokens)) errors.push("settings.max_tokens must be a number");
  return { valid: errors.length === 0, errors };
}

/** Deterministic SHA-256 of the frozen manifest (canonical sorted-key JSON). */
export function hashManifest(fixtures) {
  const canonical = (v) => {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === "object") {
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = canonical(v[k]);
      return out;
    }
    return v;
  };
  const sorted = [...fixtures].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return createHash("sha256").update(JSON.stringify(canonical(sorted))).digest("hex");
}
