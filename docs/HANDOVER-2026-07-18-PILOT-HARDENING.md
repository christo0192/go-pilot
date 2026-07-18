# Go-pilot 9.x hardening handover

Date: 2026-07-18  
Status: implementation complete, uncommitted by request

## Executive verdict

The engineering rig is now **9.2/10** by the review rubric below. Every engineering segment is at least 9.0, the default runtime path is `ikey-prod`, Kimi K2.5 is pinned for extraction/document-QA, and DeepSeek is the validation/mechanical fallback. Routing, provider versions, usage, estimated cost, fallback behavior, validation, and benchmark completeness are enforced in code and covered by tests.

Do not conflate the engineering score with model quality. Existing replicated evidence gives document-QA **97.1/100**, extraction **89.4/100**, and the two selected areas **93.3/100 combined**. Extraction remains below 9/10 and K2.5 uses **91.4% more tokens/success** than DeepSeek on the same selected-area fixtures. No fresh paid model campaign was run as part of this code-hardening pass, so the new validator/fallback's quality lift is not claimed.

## Engineering score

| Segment | Score | Evidence |
|---|---:|---|
| Production routing/config | 9.5 | Single runtime default, pinned aliases, generated route table, CI consistency check |
| Reliability/fallback | 9.3 | Transient-only retry, process-group termination, breakers, journal, K2.5 -> DeepSeek validation/dispatch fallback |
| Task validation | 9.2 | Conditional structured output, JSON-Schema-lite nesting/null/date/pattern/minItems checks, evidence citations, required fields fail closed |
| Dispatch/accounting | 9.2 | Pinned provider IDs, Pi usage recovery, reasoning tokens, calibrated estimated cost, aggregate fallback accounting |
| Benchmark integrity | 9.3 | Resume-safe current-pass spend reconciliation, grade-error retry, incomplete judge reply rejection, completeness gate |
| Security/sandboxing | 9.2 | Sandbox fails closed, child process groups terminated, errors redacted, partial gateway key fingerprint removed |
| CLI/operability | 9.1 | Profile precedence, category inference, governed judgment, context/schema inputs, live result output, unknown flags fail closed |
| Test/CI posture | 9.5 | 415 unit + 28 integration + 3 live green; routing and metrics freshness checked in CI |
| Documentation | 9.1 | Generated route/metrics sources of truth, README/runbook/skills aligned, this handover |
| **Overall engineering** | **9.2** | Conservative unweighted review score |

## Model-facing evidence

| Area | Quality | Reliability | Tokens/success | Cost/success | Max latency | vs DeepSeek quality |
|---|---:|---:|---:|---:|---:|---:|
| document-QA / K2.5 | 97.1 | 100% (18/18) | 4,404 | $0.0125 | 143s | +2.5 |
| extraction / K2.5 | 89.4 | 100% (18/18) | 2,485 | $0.0070 | 166s | +2.2 |
| selected-area composite | 93.3 | 100% (36/36) | 3,444 | $0.0098 | 166s | +2.4 |

K2.5 remains below the $0.02/success gate but is not token-efficient: the selected-area composite uses 91.4% more tokens/success than DeepSeek. The exact reproducible calculation is in `docs/production-metrics.md` and `scripts/baseline-rig/production-metrics.mjs`.

## Main changes

- Added `config/runtime.json` and deterministic profile precedence: CLI > process env > `deploy/.env` > runtime default.
- Made `ikey-prod` the source of truth and generated `docs/production-routing.md`; K2.6 remains only as an explicit historical alias.
- Fixed CLI category inference/judgment, context/schema inputs, result rendering, profile selection, and unknown-option handling.
- Pinned workhorse dispatch to registry versions, recovered exact Pi token/reasoning usage, estimated cost from calibration, and terminated process groups on timeout/overflow.
- Added K2.5 -> DeepSeek fallback for schema/citation failures and exhausted primary dispatch errors, with all attempts included in token/cost/latency accounting.
- Strengthened extraction and document-QA contracts; source-less live doc-QA now refuses before dispatch because citations cannot be verified.
- Made retry transient-only and sandbox execution fail closed when a worktree cannot be created.
- Hardened campaign resume accounting, judge parsing, re-grading, latest-record aggregation, and trial completeness gates.
- Removed the partial gateway-key fingerprint from tracked metadata and documentation.

## Verification completed

```text
npm run test:unit         415/415 pass
npm run test:integration   28/28 pass
npm run test:live            3/3 pass
npm run check:routing      pass (ikey-prod)
npm run check:metrics      pass
node bin/gopilot.mjs config doctor  pass, 0 warnings
git diff --check           pass
```

The live suite here is the repository's dependency-backed test bucket; it is not a new 21-fixture paid model campaign.

## Claude review/commit checklist

1. Review `git diff` and confirm no unrelated user changes are included.
2. Re-run the verification block above, especially `check:routing`, `check:metrics`, and config doctor.
3. Inspect `docs/production-routing.md` and `docs/production-metrics.md` as generated artifacts; do not hand-edit them.
4. Confirm `git status --short` contains only the intended hardening files and this handover.
5. Do not promote extraction as a proven >=90 quality route. It is a user-selected tradeoff with DeepSeek fallback.
6. Commit only after review. No commit was created by Codex.

## Next empirical gate

Run a fresh controlled `ikey-prod` campaign using schemas for structured extraction and evidence-pack citations for document-QA. Pre-register: extraction quality >=90, 100% reliability, no hard fixture regression, fallback rate, total tokens including rejected K2.5 calls, cost/success < $0.02, and latency <=240s. That run is the only honest way to determine whether the new validator/fallback moves extraction above 9/10 without making token efficiency worse.
