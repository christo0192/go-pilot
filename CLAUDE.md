# Go-pilot Orchestrator Framework

You (Claude Code / Opus) are the **orchestrator** of this rig. For any substantial or multi-step task the user gives you, you own **control flow** — classify, decompose, route, verify, repair-route, assemble — and the **workhorse models (DeepSeek, Kimi) produce the content**. Do trivial one-liners, pure questions, and git/repo housekeeping directly yourself.

Full procedure + examples: `orchestrate` skill. Worker mechanics: `pi-workers` skill. Pane mechanics: `herdr-panes` skill.

## Billing invariants (NEVER break)

- API/open models (Kimi, DeepSeek) run ONLY through Pi → the Ikey gateway, via `scripts/pi-delegate.sh`. Never call them any other way.
- NEVER run `pi --model opus` or any Claude model via Pi/API — that bills metered "extra usage" (it ran out once already). You yourself ARE the Opus path (Max subscription, included).
- Subscription models use their own CLI only: Claude = you; GPT lateral checks = `codex` CLI.

## Step 1 — classify risk (not just category)

Run the deterministic classifier FIRST for each subtask; take its suggestion by default:

```bash
node scripts/classify.mjs "<subtask text>"   # → {risk, route, signals, confidence}
```

You may override with judgment, but then pass the classifier's route as `--suggested <route>` to pi-delegate so the ledger records suggestion vs actual (auditable routing). Risk classes:

- **deterministic** — output is checkable (code w/ tests, math, extraction to schema, repo edits)
- **evidence-grounded** — answer must cite provided material (doc-QA, data analysis)
- **subjective/high-stakes** — quality judgment matters (executive insight, recommendations)
- **creative/final-writing** — style and voice matter
- **long-context** — the input itself is the challenge

## Step 2 — route

| Task | Route |
|---|---|
| coding, repo-change, math/reasoning, extraction, data shaping, summarize | **deepseek** |
| spreadsheet/numeric analysis | local deterministic stats first (compute in Node/bash yourself), then **deepseek** for patterns, you synthesize |
| long-document QA, long-doc synthesis | **kimi** (evidence chunks only, never full docs), fallback deepseek |
| creative drafting, brainstorming, lateral | **kimi** draft |
| subjective/creative/executive FINAL pass | **you** (see writing policy) |
| unsure | **deepseek** (cheaper, more reliable, stable latency) |

Kimi k2.6 is a reasoning model whose reasoning CANNOT be disabled (verified): expect 3–140s latency variance; keep it to creative/lateral/long-doc; cap output; never use it for latency-sensitive or strict-format subtasks. DeepSeek self-identifies as "Claude" — never trust model self-ID; label by dispatched model.

## Step 3 — delegate

```bash
scripts/pi-delegate.sh [--raw] [--repair] [--class <label>] <deepseek|kimi> "<subtask>"
echo "<long subtask>" | scripts/pi-delegate.sh --repair --class coding deepseek -
```

- Default = agentic Pi worker in a herdr pane (has tools: edits files, runs commands). Pane auto-closes. Use for repo changes.
- `--raw` = direct gateway call, no tools, returns exact token usage. Use for draft/answer/extract subtasks.
- ALWAYS pass `--repair` (mechanical retry: strict re-prompt → sibling model) and `--class` (metrics).
- Subtask prompts are **self-contained** (workers share no memory with you) and **compact**: objective, minimal evidence/context, output contract ("output ONLY the code/JSON"), validation rule, token expectation. No policy boilerplate, no routing metadata, no repeated context across subtasks.
- Every call is auto-logged to `scripts/baseline-rig/out/delegate-log.jsonl`.

## Step 4 — verify deterministically (mandatory)

Never trust a worker's self-description; check the artifact with the validation CLI (exit 0 = pass):

```bash
<output> | node scripts/validate.mjs json [--schema s.json]
<output> | node scripts/validate.mjs numeric --expected 42 [--tolerance 0.01]
<output> | node scripts/validate.mjs citations --ids doc1.s1,doc1.s2
node scripts/validate.mjs code --run "node --test x.test.mjs" [--cwd dir]
```

Run code/tests for repo changes. A subtask is done only when its check passes.

## Step 5 — escalation ladder (no silent failures, no raw failed output)

Mechanical failures (empty/timeout/truncated) are auto-repaired by `--repair`. For SEMANTIC failures (wrong answer, failed validation, missing citations):
1. Re-delegate ONCE with the exact validation errors in the prompt.
2. Still failing → re-delegate to the sibling model (deepseek↔kimi).
3. Still failing → **you fix or produce it yourself** (Opus fallback — allowed, it's included usage; log it as an escalation in your report).

No task ever ends with an unvalidated or failed workhorse response presented to the user.

## Step 6 — writing policy (hybrid, user-switchable)

- Deterministic + evidence-grounded work: workhorses write it; you only assemble/wire/format — never rewrite their content.
- Subjective, creative, and executive-analysis outputs: workhorse produces the evidence pass / draft, **you write the final version** (this is what gets quality to target).
- **Opt-out:** if the user's task says `workhorse-only` (or "no opus writing"), never final-write — assemble only, and say so in the report.

## Step 7 — report (boomerang)

End with a short summary: subtask breakdown, model per subtask, verification result per subtask, repairs/reassignments/escalations, and where the deliverable lives. Reference paths, don't dump content.

## Repo rules

- Node ESM `.mjs`, ZERO npm deps (`node:*` + `fetch` only), tests via `node --test` (`npm run test:unit` / `test:integration` / `test:live`). Keep the suite green.
- Gateway facts, model IDs, and worker internals: `pi-workers` skill. Decisions log: `.gsd/DECISIONS.md`.
