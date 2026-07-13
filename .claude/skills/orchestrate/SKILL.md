---
name: orchestrate
description: Full orchestration procedure for delegating a multi-step task to Kimi/DeepSeek workhorses via pi-delegate.sh — decompose, route by risk, delegate, verify, repair, escalate, assemble, report. Use when executing any substantial task in this repo as the orchestrator (see CLAUDE.md for the always-on policy summary).
---

# Orchestrate

You own control flow; workhorses own content. CLAUDE.md has the policy (routing table, billing invariants, writing policy) — this skill is the working procedure.

## Procedure

1. **Plan silently.** Decompose into the smallest set of concrete, independently-runnable subtasks. For each: exact subtask prompt · risk class · assigned model · `Depends on:` · a **Done-when** check (command/test/observable). Don't start writing content.

2. **Classify each subtask by risk** (deterministic / evidence-grounded / subjective / creative / long-context) and route per the CLAUDE.md table. Route by risk, not category name: "write a summary of test results" is deterministic-ish (deepseek); "write the executive summary for the client" is subjective (deepseek evidence pass → you final).

3. **Pre-shrink context before delegating:**
   - Spreadsheets/data: parse and compute stats LOCALLY (node/bash) — totals, deltas, outliers, top/bottom segments — and send only the compact derived table.
   - Long documents: chunk by headings, pick only relevant chunks, send quoted evidence snippets with IDs; require the answer to cite chunk IDs.
   - Never resend context a worker already produced; feed forward only verified results that a dependent subtask needs.

4. **Delegate.** `scripts/pi-delegate.sh --repair --class <class> [--raw] <model> "<subtask>"` (stdin `-` for long prompts). Agentic default for repo edits; `--raw` for pure text/JSON production. Independent subtasks: run several delegate calls in parallel (`&` + `wait`, or parallel Bash tool calls); dependent ones sequentially.

5. **Verify each result deterministically** (Done-when check). Run code/tests, validate JSON against the expected shape, check numbers, confirm citations resolve to the evidence you sent.

6. **Repair semantically if verification fails:** re-delegate once with the exact errors ("Your output failed: <errors>. Fix and return the corrected <artifact> only.") → then sibling model → then Opus fallback (you produce it; log the escalation). Never present unvalidated workhorse output.

7. **Assemble.** Structural work only for deterministic outputs (ordering, wiring, applying edits, formatting). For subjective/creative finals, write the final version yourself from the workhorse draft/evidence — unless the user said `workhorse-only`.

8. **Report boomerang-style:** subtasks · model each · Done-when result each · repairs/escalations · deliverable paths.

## Compact subtask prompt template

```
Objective: <one sentence>
Context: <minimal evidence only — derived tables, evidence chunks with IDs, prior verified results it needs>
Output: <exact contract, e.g. "ONLY a JSON object matching {…}" / "ONLY the Python file content">
Validation: <what will be checked, e.g. "must pass: node --test x.test.mjs" / "every claim cites a chunk ID">
Keep output under <n> tokens.
```

## Boundaries

- Control, not content (except the hybrid writing policy finals).
- Verify before trust — a result is done only when its deterministic check passes.
- No silent failures — blocked subtasks are reported as blocked with the exact failure.
- Never bill Claude via Pi/API; workhorses only via pi-delegate.sh.
