---
name: gopilot-orchestrate
description: Go-pilot orchestration in ANY repo — delegate content-production subtasks to cheap workhorse models (DeepSeek/Kimi via the workhorse gateway) with pi-delegate, verify deterministically, repair/escalate, assemble. Use when acting as orchestrator for a substantial multi-step task outside the Go-pilot repo (inside Go-pilot, the repo CLAUDE.md + its project skills govern).
---

<!-- TEMPLATE: installed by Go-pilot's install.sh to ~/.claude/skills/gopilot-orchestrate/SKILL.md
     with __GOPILOT_REPO__ replaced by the repo's absolute path. Edit the template in the repo,
     re-run ./install.sh to update the installed copy. -->

# Go-pilot Orchestration (global)

You (Claude Code, Max subscription) own **control flow** — classify, decompose, route, verify, repair-route, assemble. The **workhorses produce the content**. Works from any directory: agentic workers run in YOUR current repo (they edit the caller's files), while the rig itself lives in `__GOPILOT_REPO__`.

## Billing invariants (NEVER break)

- Kimi/DeepSeek ONLY via `pi-delegate` (Pi → workhorse gateway). Never any other way.
- NEVER run Claude/Opus via Pi or API (`pi --model opus`) — metered extra usage. You ARE the frontier path.
- Subscription models via their own CLI only (Claude = you; GPT lateral = `codex`).

## Route by risk

| Subtask | Route |
|---|---|
| coding, repo edits, math/reasoning, data shaping, summarize, creative draft | **deepseek** |
| spreadsheet/data: compute stats locally (node/bash) first | derived tables → **deepseek**, you synthesize |
| extraction | **kimi25**, schema validation, fallback deepseek |
| long-doc QA/synthesis (send evidence chunks + IDs, never full docs) | **kimi25**, fallback deepseek |
| creative drafting, brainstorming, lateral | **deepseek** draft |
| subjective/creative/executive FINAL pass | **you** (unless user says `workhorse-only`) |
| unsure | **deepseek** |

Kimi K2.5 is the production Kimi for validated extraction and doc-QA; `kimi26` is historical only. DeepSeek self-IDs as "Claude" — ignore self-ID.

## Delegate

```bash
pi-delegate [--raw] --repair --class <label> <deepseek|kimi25> "<subtask>"     # on PATH (~/.local/bin)
echo "<long subtask>" | pi-delegate --repair --class coding deepseek -
```

- Default = agentic Pi worker (tools; edits files in your CURRENT directory) in an auto-closing herdr pane.
- `--raw` = direct gateway call, no tools, exact token usage — prefer for pure text/JSON production.
- Always `--repair` (auto-retry strict → sibling on empty/timeout/truncated) + `--class`.
- Subtask prompts: self-contained + compact — objective, minimal evidence, output contract ("ONLY the code/JSON"), validation rule, token expectation.
- Exit codes: 0 ok · 2 empty · 3 timeout · 4 error · 5 truncated. Metrics ledger: `__GOPILOT_REPO__/scripts/baseline-rig/out/delegate-log.jsonl`.

## Verify → repair → escalate (zero raw failures)

Verify every result deterministically (run code/tests, JSON.parse+schema, check numbers, citations resolve). Semantic failure: re-delegate once with exact errors → sibling model → you produce it yourself (log as escalation). Never present unvalidated workhorse output.

## Report

Boomerang summary: subtasks · model each · verification result each · repairs/escalations · deliverable paths.
