import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractBoxed, extractAnswerPhrase, extractLastNumber, extractFinalLine, extractAnswer,
  gradeExact, extractCode, parseFileEdits, gradeUnitTest, gradeRepoChange,
  buildJudgePrompt, parseJudgeScores, gradeRubric, grade, validateFixture, hashManifest,
} from "./grader.mjs";

test("extractors pull the right fragment", () => {
  assert.equal(extractBoxed("work... \\boxed{42} done"), "42");
  assert.equal(extractBoxed("\\boxed{1} then \\boxed{7}"), "7"); // last wins
  assert.equal(extractAnswerPhrase("The answer is 3.14 units."), "3.14 units");
  assert.equal(extractLastNumber("steps 12, then 3, total 1,024"), "1,024");
  assert.equal(extractFinalLine("line1\n\n  final  \n"), "final");
});

test("extractAnswer honors strategy order and falls through", () => {
  assert.equal(extractAnswer("noise 5\n\\boxed{9}", { extract: ["boxed", "last-number"] }), "9");
  assert.equal(extractAnswer("just 5 and 8 here", { extract: ["boxed", "last-number"] }), "8");
  assert.equal(extractAnswer("no answer here at all!", { extract: ["boxed"] }), null);
});

test("gradeExact numeric with tolerance and comma grouping", () => {
  assert.equal(gradeExact("... \\boxed{1024}", { answer: "1,024", match: "numeric" }).pass, true);
  assert.equal(gradeExact("result 3.14159", { answer: 3.1416, match: "numeric", tolerance: 0.01 }).pass, true);
  assert.equal(gradeExact("result 99", { answer: 42, match: "numeric" }).pass, false);
});

test("gradeExact string and regex modes", () => {
  assert.equal(gradeExact("The answer is Paris.", { answers: ["paris"], match: "string", extract: ["answer-phrase"] }).pass, true);
  assert.equal(gradeExact("code: AB12", { answers: ["[A-Z]{2}\\d{2}"], match: "regex", extract: ["final-line"] }).pass, true);
});

test("extractCode prefers fenced block of the right language", () => {
  const out = "text\n```python\ndef f():\n    return 1\n```\nmore";
  assert.match(extractCode(out, { language: "python" }), /def f\(\)/);
  assert.equal(extractCode("no fence, raw code", {}), "no fence, raw code");
});

test("parseFileEdits parses delimited full-file blocks", () => {
  const out = "prose\n<<<FILE calc.py>>>\ndef mul(a,b):\n    return a*b\n<<<END>>>\ntrailer";
  const edits = parseFileEdits(out);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].path, "calc.py");
  assert.match(edits[0].content, /return a\*b/);
});

test("gradeUnitTest runs python asserts: pass and fail", () => {
  const grading = { type: "unit-test", language: "python", tests: "assert add(2,3)==5\nassert add(-1,1)==0" };
  const good = gradeUnitTest("```python\ndef add(a,b):\n    return a+b\n```", grading);
  assert.equal(good.pass, true);
  assert.equal(good.score, 100);
  const bad = gradeUnitTest("```python\ndef add(a,b):\n    return a-b\n```", grading);
  assert.equal(bad.pass, false);
  assert.equal(bad.score, 0);
});

test("gradeRepoChange applies edits to a throwaway git repo and runs tests", () => {
  const grading = {
    type: "repo-change",
    files: [{ path: "calc.py", content: "def mul(a, b):\n    return a + b  # bug\n" }],
    testFiles: [{ path: "test_calc.py", content: "from calc import mul\nassert mul(3, 4) == 12\nassert mul(0, 9) == 0\n" }],
    testCommand: ["python3", "test_calc.py"],
  };
  const fixed = "<<<FILE calc.py>>>\ndef mul(a, b):\n    return a * b\n<<<END>>>";
  const good = gradeRepoChange(fixed, grading);
  assert.equal(good.pass, true, good.stderr);
  assert.deepEqual(good.appliedFiles, ["calc.py"]);
  const stillBuggy = "<<<FILE calc.py>>>\ndef mul(a, b):\n    return a + b\n<<<END>>>";
  assert.equal(gradeRepoChange(stillBuggy, grading).pass, false);
  assert.equal(gradeRepoChange("no edits at all", grading).reason, "no-file-edits");
});

test("buildJudgePrompt includes dimensions, guidance, and candidate", () => {
  const fx = { prompt: "Summarize X", inputs: [{ name: "doc", content: "body" }] };
  const grading = { dimensions: ["correctness", "faithfulness"], guidance: "be strict", calibrationAnchors: [{ answer: "weak", scores: { correctness: 2 } }] };
  const p = buildJudgePrompt(fx, "candidate text", grading);
  assert.match(p, /correctness, faithfulness/);
  assert.match(p, /be strict/);
  assert.match(p, /candidate text/);
  assert.match(p, /Calibration anchors/);
});

test("parseJudgeScores handles fenced json, bare json, clamping, and garbage", () => {
  const dims = ["correctness", "completeness"];
  const a = parseJudgeScores('```json\n{"scores":{"correctness":8,"completeness":6},"rationale":"ok"}\n```', dims);
  assert.equal(a.ok, true);
  assert.equal(a.overall, 70); // mean(8,6)=7 -> x10
  const b = parseJudgeScores('prefix {"scores":{"correctness":15,"completeness":0}} suffix', dims);
  assert.equal(b.scores.correctness, 10); // clamped high
  assert.equal(b.scores.completeness, 1); // clamped low
  const c = parseJudgeScores("no json here", dims);
  assert.equal(c.ok, false);
  assert.equal(c.overall, 0);
  const incomplete = parseJudgeScores('{"scores":{"correctness":9}}', dims);
  assert.equal(incomplete.ok, false, "a missing dimension is a judge error, not an implicit score of 1");
});

test("gradeRubric: Opus-only headline, co-judge diagnostic, disagreement flagged", async () => {
  const fx = { prompt: "task", grading: { dimensions: ["correctness", "completeness"] } };
  const replies = {
    frontier: '{"scores":{"correctness":9,"completeness":9},"rationale":"strong"}',   // overall 90
    workhorse: '{"scores":{"correctness":5,"completeness":6},"rationale":"weak"}',    // overall 55
  };
  const dispatchJudge = async (req) => ({ result: { text: replies[req.plane] }, usage: { tokens: { total: 10 } } });
  const r = await gradeRubric(fx, "candidate", fx.grading, { dispatchJudge });
  assert.equal(r.score, 90); // v3 headline = neutral Opus judge alone (Codex §10)
  assert.equal(r.coScore, 55); // DeepSeek co-judge is diagnostic only
  assert.equal(r.perDimensionDelta.correctness, 4);
  assert.equal(r.flaggedDisagreement, true); // maxDelta 4 >= 2
  assert.equal(r.bothParsed, true);
});

test("gradeRubric: coJudge:false skips the co-judge entirely", async () => {
  const fx = { prompt: "task", grading: { dimensions: ["correctness"] } };
  let workhorseCalls = 0;
  const dispatchJudge = async (req) => {
    if (req.plane === "workhorse") workhorseCalls += 1;
    return { result: { text: '{"scores":{"correctness":8},"rationale":"ok"}' }, usage: { tokens: { total: 10 } } };
  };
  const r = await gradeRubric(fx, "candidate", fx.grading, { dispatchJudge, coJudge: false });
  assert.equal(r.score, 80);
  assert.equal(r.coScore, null);
  assert.equal(r.judges.deepseek, null);
  assert.equal(r.maxDelta, null);
  assert.equal(r.flaggedDisagreement, false);
  assert.equal(workhorseCalls, 0);
});

test("grade() treats empty output as a hard fail", async () => {
  const fx = { grading: { type: "exact", answer: 1 } };
  const r = await grade(fx, "   ", {});
  assert.equal(r.pass, false);
  assert.equal(r.failure, "empty");
});

test("validateFixture catches missing and malformed fields", () => {
  const base = { id: "x", area: 1, category: "math", armAModel: "deepseek-ikey", prompt: "p", settings: { max_tokens: 8000 } };
  assert.equal(validateFixture({ ...base, grading: { type: "exact", answer: 5 } }).valid, true);
  assert.equal(validateFixture({ ...base, grading: { type: "unit-test" } }).valid, false); // no tests
  assert.match(validateFixture({ ...base }).errors.join(), /missing grading/);
});

test("hashManifest is deterministic and order-independent", () => {
  const a = { id: "a", n: 1, nested: { z: 1, y: 2 } };
  const b = { id: "b", n: 2 };
  const h1 = hashManifest([a, b]);
  const h2 = hashManifest([b, a]); // different order
  assert.equal(h1, h2);
  const h3 = hashManifest([{ ...a, n: 99 }, b]); // content change
  assert.notEqual(h1, h3);
  assert.match(h1, /^[0-9a-f]{64}$/);
});
