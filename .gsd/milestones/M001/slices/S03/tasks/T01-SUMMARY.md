---
task: T01
title: Deterministic rule-based router (PLAN Step 3.1)
status: complete
duration: ~12min
files_changed:
  - config/router.json
  - src/router/router.mjs
  - src/router/judgment-log.mjs
  - src/router/router.test.mjs
  - src/router/README.md
  - package.json
verification: node_test_10_pass, zero_deps, code_review_pass
---

Built the central control logic: a pure, profile-keyed router. `route(task, {profile})`
returns `{plane, model, deterministic:true}` for a known work-type category, or escalates
unknown/`ambiguous`/`__judgment__` categories to a costed judgment path
(`{needsJudgment:true, judgmentCost:{estimatedTokens:1500}}`) and fires an optional
`onJudgment` hook. Mapping lives in `config/router.json`, profile-keyed (`pure-anthropic`
populated; `hybrid`/`open-first` intentionally empty stubs proving the switch exists, D5).

Router stays side-effect-free except the caller hook; the disk seam is a separate module
`judgment-log.mjs` (`logJudgment` → JSONL under `metrics/runs/`) that T04 (Step 3.9) will
report on. Records are self-contained/summable and never folded into "savings" (D8).

Verification: `node --test` → 10/10 pass. Independent re-run confirmed green + zero
dependencies (`type:module`, no deps/devDeps). Code review: pure decision path, prototype-
pollution guard on category lookup, fresh-object return (no leaked config refs).

Decisions made: `judgmentCost.estimatedTokens = 1500` (single constant `JUDGMENT_ESTIMATED_TOKENS`);
missing category returns `category:null`; repo-root config resolution via `import.meta.url`
so cwd-independent. Recorded language/config choice as D20.
