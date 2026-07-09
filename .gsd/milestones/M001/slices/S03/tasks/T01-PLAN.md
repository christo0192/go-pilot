# T01 — Deterministic rule-based router (PLAN Step 3.1)

## Goal
The central control logic: given a task, deterministically decide **which plane + model** runs it.
LLM judgment is the costed exception, logged separately (D8). Profile-keyed config so hybrid/open-first
swap models with no code change (D5). Zero external deps; Node.js ESM; tests via `node --test`.

## Context (already decided — do not re-litigate)
- Profile = `pure-anthropic`. Frontier plane only (claude/codex binaries). No LiteLLM/Pi.
- Dispatch is already solved (D18): router does NOT run panes; it only returns the routing decision
  `{plane, model}` that the (future) dispatcher feeds to `scripts/lean-worker.sh <model>` /
  `scripts/lean-codex-worker.sh`. Keep router pure + side-effect-free except the judgment-cost log.
- Task-class table (`docs/task-class-decisions.md`) is intentionally PENDING (D17) → key on **work-type**,
  not business domain. Multi-pane fan-out stays opt-in per validated class; router just picks the tier.

## Deliverables
1. `config/router.json` — profile-keyed mapping. Shape:
   ```json
   {
     "pure-anthropic": {
       "categories": {
         "orchestrate": {"plane":"frontier","model":"opus"},
         "plan":        {"plane":"frontier","model":"opus"},
         "code":        {"plane":"frontier","model":"sonnet"},
         "analyze":     {"plane":"frontier","model":"sonnet"},
         "draft":       {"plane":"frontier","model":"sonnet"},
         "extract":     {"plane":"frontier","model":"haiku"},
         "classify":    {"plane":"frontier","model":"haiku"},
         "summarize":   {"plane":"frontier","model":"haiku"},
         "code-review": {"plane":"frontier","model":"codex"},
         "lateral":     {"plane":"frontier","model":"codex"}
       },
       "default": "__judgment__"
     }
   }
   ```
   (Add `hybrid`/`open-first` keys as empty stubs `{ "categories": {}, "default": "__judgment__" }`
   so the profile switch is proven to exist — do not fill their models.)

2. `src/router/router.mjs` — exports:
   - `loadConfig(profile, {configPath?})` → the profile's mapping (throws on unknown profile).
   - `route(task, {profile, config?, onJudgment?})` → for a known category returns
     `{category, plane, model, deterministic:true}`. For unknown/ambiguous category (or explicit
     `category:"ambiguous"`) returns `{category, deterministic:false, needsJudgment:true, judgmentCost}` and
     invokes `onJudgment(task)` if provided. `task` shape: `{ id?, category, prompt? }`.
   - Deterministic means: same input → same output, no I/O, no clock/random in the decision path.

3. `src/router/judgment-log.mjs` — appends each judgment-path invocation as its own line item
   (`{ts, taskId, category, tokens|estimate}`) to a JSONL under `metrics/runs/router-judgment.jsonl`.
   This is the seam T04 (Step 3.9) will build the overhead report on — keep the record summable and
   NEVER merge it into any "savings" figure. (`ts` may come from `new Date().toISOString()` here — this is
   runtime logging, not the pure decision path.)

4. `src/router/router.test.mjs` — `node --test`:
   - Fixture of ≥8 tasks across categories → assert exact `{plane, model}`.
   - Unknown category → `needsJudgment:true` and `onJudgment` called once.
   - Unknown profile → throws.
   - `route` is pure: calling twice yields deep-equal results for a deterministic category.

5. `package.json` (minimal, `"type":"module"`, `"private":true`, no deps) with
   `"scripts": { "test": "node --test" }`. If one already exists, extend it.

6. `src/router/README.md` — 10-line usage + the category→tier table + how to add a category.

## Acceptance (Done when)
- `npm test` (or `node --test`) passes green with the fixtures above.
- A fixture set of tasks each route to the correct plane+model deterministically; ambiguous ones
  trigger the judgment path AND a line item lands in `metrics/runs/router-judgment.jsonl`.
- No external npm dependencies added; `node --test` is the only runner.

## Out of scope (later tasks — do NOT build)
- Actual pane dispatch / herdr calls (already D18). TOON (T02). Boundary guard (T03).
- The overhead *report* (T04) — only the raw judgment log seam here.
- Filling hybrid/open-first model tables.
