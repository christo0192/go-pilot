// Blind grading pass — Phase 5 (docs/live-test-plan.md §6).
//
// Reads the campaign ledger and produces graded-runs.jsonl:
//   - Deterministic runs (exact/unit-test/repo-change): the inline score from
//     the run pass is authoritative (re-graded here if missing).
//   - Rubric runs (doc-qa/analysis/extraction): blind dual-judge — Opus (primary)
//     + DeepSeek (co-judge) each score every dimension 1-10, anchored by the
//     fixture's calibration examples; arm/model labels are never shown to judges
//     (buildJudgePrompt only includes the candidate answer). Inter-judge |Δ| and
//     a disagreement flag are recorded.
//
// Checkpointed (append-only, resume by key) and DeepSeek-budget-guarded. Judge
// token usage is tracked for the overhead ledger. Zero external deps.

import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createBenchmarkDispatcher, readKey } from "./ikey-dispatch.mjs";
import { grade, gradeRubric } from "./grader.mjs";
import { loadFixtures } from "./manifest.mjs";
import { estimateCallCost } from "../../src/metrics/cost-model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.env.CAMPAIGN_OUT || join(HERE, "out");
const CALIBRATION = JSON.parse(readFileSync(join(HERE, "calibration.json"), "utf8"));
const DEEPSEEK = "test/deepseek-v4-pro";
const DEEPSEEK_CAP = 2;

function readLedger(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

function completedKeys(path) {
  const done = new Set();
  for (const r of readLedger(path)) {
    const retryable = (r.failures || []).some((f) => ["grade-error", "budget-skip-judge"].includes(f));
    if (r.key && Number.isFinite(r.finalScore) && !retryable) done.add(r.key);
  }
  return done;
}

async function main() {
  // v3 methodology (Codex §10): Opus is the sole HEADLINE judge; the DeepSeek
  // co-judge is an optional secondary diagnostic, enabled with --co-judge.
  const coJudge = process.argv.includes("--co-judge");
  mkdirSync(OUT_DIR, { recursive: true });
  const runsPath = join(OUT_DIR, "campaign-runs.jsonl");
  const gradedPath = join(OUT_DIR, "graded-runs.jsonl");
  const summaryPath = join(OUT_DIR, "grade-summary.json");
  if (!existsSync(runsPath)) { console.error(`no ledger at ${runsPath}`); process.exit(1); }

  const byId = Object.fromEntries(loadFixtures().map((f) => [f.id, f]));
  const runs = readLedger(runsPath);
  const done = completedKeys(gradedPath);
  const pending = runs.filter((r) => !done.has(r.key));
  console.error(`Grading: ${runs.length} runs · ${done.size} graded · ${pending.length} to grade`);

  // Seed the DeepSeek budget guard from the run pass's estimate (cumulative caps).
  let priorDeepseek = 0;
  const rsPath = join(OUT_DIR, "run-summary.json");
  if (existsSync(rsPath)) {
    const rs = JSON.parse(readFileSync(rsPath, "utf8"));
    priorDeepseek = rs.workhorsePerModel?.[DEEPSEEK]?.estUsd || 0;
  }

  const rates = CALIBRATION.rates;
  const dispatch = createBenchmarkDispatcher({ key: readKey(), rates });
  const dispatchJudge = (req) => dispatch(req);

  let judgeDeepseekEst = 0;
  const judgeTokens = { opus: 0, deepseek: 0 };
  let graded = 0;
  let disagreements = 0;
  const deltas = [];

  for (const r of pending) {
    const fx = byId[r.fixtureId];
    const rec = { key: r.key, fixtureId: r.fixtureId, area: r.area, areaName: r.areaName, arm: r.arm, trial: r.trial, gradingType: r.gradingType };

    // Failed/empty runs pass through with a 0/null final score.
    if (!r.output || !String(r.output).trim() || (r.failures && r.failures.length && r.score == null && r.gradingType !== "rubric")) {
      rec.finalScore = r.output && String(r.output).trim() ? rec.finalScore : 0;
      if (r.failures?.length) rec.failures = r.failures;
      if (!r.output || !String(r.output).trim()) { rec.finalScore = 0; rec.failures = [...new Set([...(r.failures || []), "empty"])]; }
      appendFileSync(gradedPath, JSON.stringify(rec) + "\n");
      continue;
    }

    try {
      if (r.gradingType !== "rubric") {
        // Deterministic: trust inline score; re-grade if absent.
        const g = r.grade || (await grade(fx, r.output, {}));
        rec.finalScore = g.score;
        rec.deterministic = true;
        rec.gradeDetail = { pass: g.pass, candidate: g.candidate ?? undefined, reason: g.reason ?? undefined };
      } else {
        // Budget-guard the DeepSeek co-judge when enabled (Opus is Max-plan flat fee).
        if (coJudge) {
          const projected = estimateCallCost(DEEPSEEK, { total: 1200 }, rates);
          if (priorDeepseek + judgeDeepseekEst + projected > DEEPSEEK_CAP) {
            rec.finalScore = null; rec.failures = ["budget-skip-judge"];
            appendFileSync(gradedPath, JSON.stringify(rec) + "\n");
            console.error(`  SKIP-JUDGE ${r.key}: DeepSeek cap`);
            continue;
          }
        }
        const res = await gradeRubric(fx, r.output, fx.grading, { dispatchJudge, coJudge });
        // An unparseable judge reply is a JUDGE failure, not a zero-quality
        // output — record it as a retryable grade-error, never as score 0.
        if (!res.judges.opus.ok) {
          rec.finalScore = null; rec.failures = ["grade-error"];
          rec.error = `judge reply unparseable: ${String(res.judges.opus.raw || "").slice(0, 200)}`;
          appendFileSync(gradedPath, JSON.stringify(rec) + "\n");
          console.error(`  GRADE-ERROR ${r.key}: judge reply unparseable`);
          continue;
        }
        rec.finalScore = res.score;       // Opus-only headline
        rec.coScore = res.coScore;        // diagnostic (null when co-judge off)
        rec.deterministic = false;
        rec.judges = {
          opus: { overall: res.judges.opus.overall, scores: res.judges.opus.scores, ok: res.judges.opus.ok, usage: res.judges.opus.usage },
          deepseek: res.judges.deepseek
            ? { overall: res.judges.deepseek.overall, scores: res.judges.deepseek.scores, ok: res.judges.deepseek.ok, usage: res.judges.deepseek.usage }
            : null,
        };
        rec.perDimensionDelta = res.perDimensionDelta;
        rec.maxDelta = res.maxDelta;
        rec.flaggedDisagreement = res.flaggedDisagreement;
        rec.bothParsed = res.bothParsed;
        const oTok = res.judges.opus.usage?.tokens?.total || 0;
        const dTok = res.judges.deepseek?.usage?.tokens?.total || 0;
        judgeTokens.opus += oTok; judgeTokens.deepseek += dTok;
        if (res.judges.deepseek) {
          judgeDeepseekEst += res.judges.deepseek.usage?.estCostUsd || estimateCallCost(DEEPSEEK, { total: dTok }, rates);
        }
        if (res.flaggedDisagreement) disagreements += 1;
        if (res.maxDelta != null) deltas.push(res.maxDelta);
      }
      graded += 1;
      console.error(`  ${r.key} [${r.gradingType}] score=${rec.finalScore == null ? "n/a" : Number(rec.finalScore).toFixed(1)}${rec.flaggedDisagreement ? " (disagree Δ" + rec.maxDelta + ")" : ""}`);
    } catch (e) {
      rec.finalScore = null; rec.failures = ["grade-error"]; rec.error = String(e.message || e).slice(0, 300);
      console.error(`  GRADE-ERROR ${r.key}: ${rec.error}`);
    }
    appendFileSync(gradedPath, JSON.stringify(rec) + "\n");
  }

  // Adjudication queue (Codex §10): rubric runs where the judges disagreed by
  // ≥2 on any dimension get queued for manual review.
  const latest = new Map(readLedger(gradedPath).filter((g) => g.key).map((g) => [g.key, g]));
  const finalGrades = [...latest.values()];
  const adjudication = finalGrades.filter((g) => g.flaggedDisagreement).map((g) => ({
    key: g.key, fixtureId: g.fixtureId, arm: g.arm, opus: g.judges?.opus?.overall, deepseek: g.judges?.deepseek?.overall, maxDelta: g.maxDelta,
  }));
  writeFileSync(join(OUT_DIR, "adjudication-queue.json"), JSON.stringify(adjudication, null, 2));

  const allJudgeTokens = finalGrades.reduce((sum, g) => {
    sum.opus += g.judges?.opus?.usage?.tokens?.total || 0;
    sum.deepseek += g.judges?.deepseek?.usage?.tokens?.total || 0;
    return sum;
  }, { opus: 0, deepseek: 0 });
  const allDeltas = finalGrades.map((g) => g.maxDelta).filter(Number.isFinite);
  const summary = {
    gradedThisPass: graded, totalGraded: completedKeys(gradedPath).size,
    gradeErrors: finalGrades.filter((g) => (g.failures || []).includes("grade-error")).length,
    coJudge,
    rubricDisagreements: finalGrades.filter((g) => g.flaggedDisagreement).length,
    meanMaxDelta: allDeltas.length ? allDeltas.reduce((a, b) => a + b, 0) / allDeltas.length : null,
    adjudicationQueue: adjudication.length,
    judgeTokens: allJudgeTokens, judgeDeepseekEstUsd: judgeDeepseekEst, generatedAt: new Date().toISOString(),
  };
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.error(`\nGrading complete: ${graded} runs. Disagreements: ${disagreements}. Judge tokens opus=${judgeTokens.opus} deepseek=${judgeTokens.deepseek}. -> ${summaryPath}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error("grading failed:", e.stack || e.message); process.exit(1); });
}
