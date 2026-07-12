# Go-pilot Live Test — Results

_Generated 2026-07-12T20:39:05.269Z. Directional efficiency proof on a frozen sample (see docs/live-test-plan.md §0 for scope)._

## Reproducibility header

- **Manifest hash:** `e318bbc52d44ff4fd7c43d4f2f4c1093b3d16d8f34ac9569763b65c4ab7ed69c`
- **Seed:** 12648430 · **Trials:** 1
- **Workhorse rates (calibrated):** kimi-k2.6 $3.847/M · deepseek-v4-pro $0.828/M total tokens
- **Workhorse spend:** est $0.38908 · settled $0.48995 (reconcile scale 1.259)
- **Opus (Arm B) cost @ API rates:** $13.4333 — includes the ~49k Claude-Code system-prompt tax per call (D32), low reasoning effort.
- **Judge tokens:** Opus 9682 · DeepSeek 91488

## Headline — WITH (Arm A) vs WITHOUT

| Metric | A (go-pilot) | B (all-Opus) | C (same-model naive) |
|---|--:|--:|--:|
| Mean quality (0-100) | 89.5 | 98.7 | 86.7 |
| Total tokens (Σ fixture medians) | 68703 | 55471 | 73040 |
| Total cost $ | 0.1888 | 13.4333 | 0.2003 |

**Deltas (bootstrap 95% CI over fixtures):**

- **Cost A vs B:** A is 98.6% cheaper (ratio 0.014, CI [0.008, 0.021])
- **Tokens A vs B:** -29.4% fewer (ratio 1.294, CI [0.507, 4.429])
- **Tokens A vs C (compression only):** ratio 0.893, CI [0.760, 1.053]
- **Quality A vs B:** ratio 0.907, CI [0.802, 0.985] (1.0 = parity)

## Per-area verdicts vs pre-registered §2 gates

Gate = quality A ≥ 95% of B **and** cost A ≤ 60% of B **and** tokens A < tokens C.

| Area | qA | qB | qC | $A | $B | tokA | tokC | qFloor | costEff | tokEff | Verdict |
|---|--:|--:|--:|--:|--:|--:|--:|:-:|:-:|:-:|:-:|
| 1 math | 100.0 | 100.0 | 100.0 | 0.0049 | 1.8229 | 5908 | 4241 | ✅ | ✅ | ❌ | keep-on-Opus |
| 2 coding | 100.0 | 100.0 | 100.0 | 0.0063 | 1.8165 | 7658 | 11198 | ✅ | ✅ | ✅ | **WIN** |
| 3 document-qa | 95.9 | 100.0 | 74.1 | 0.0684 | 1.9492 | 17780 | 17651 | ✅ | ✅ | ❌ | keep-on-Opus |
| 4 analysis | 68.8 | 97.8 | 70.3 | 0.0436 | 1.9460 | 11333 | 13213 | ❌ | ✅ | ✅ | keep-on-Opus |
| 5 extraction | 61.7 | 92.9 | 62.5 | 0.0560 | 2.2882 | 14568 | 15459 | ❌ | ✅ | ✅ | keep-on-Opus |
| 6 multi-step-reasoning | 100.0 | 100.0 | 100.0 | 0.0057 | 1.8230 | 6841 | 6566 | ✅ | ✅ | ❌ | keep-on-Opus |
| 7 repo-change | 100.0 | 100.0 | 100.0 | 0.0038 | 1.7876 | 4615 | 4712 | ✅ | ✅ | ✅ | **WIN** |

## Overhead ledger (Arm A machinery, reported separately)

- **Input-token delta A vs C (scaffolding − compression):** 3413 (A 9516 vs C 6103). Positive = net scaffolding overhead; negative = net compression saving.
- **Judge tokens (campaign-level):** Opus 9682 + DeepSeek 91488.
- **DeepSeek judge est cost:** $0.07576.

## Failure scoreboard (counts per arm)

| Failure | A | B | C |
|---|--:|--:|--:|
| error | 1 | 0 | 2 |
| empty | 1 | 0 | 1 |
| truncated | 1 | 0 | 1 |

## Judge reliability

- Inter-judge Pearson correlation (Opus vs DeepSeek overall): **0.327** over 31 rubric outputs.
- Flagged disagreements (|Δ| ≥ 2 on any dimension): **8** · mean max-Δ 1.29.

## Per-fixture detail (trial medians)

| Fixture | Area | qA | qB | qC | tokA | tokB | tokC | $A | $B | $C |
|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| analysis-01 | analysis | 93 | 99 | 94 | 2126 | 1100 | 4498 | 0.0082 | 0.4867 | 0.0173 |
| analysis-02 | analysis | 93 | 96 | 94 | 3306 | 1406 | 4454 | 0.0127 | 0.4771 | 0.0171 |
| analysis-03 | analysis | 90 | 98 | 94 | 5901 | 1558 | 4261 | 0.0227 | 0.4810 | 0.0164 |
| analysis-04 | analysis | 0 | 99 | 0 | NaN | 2360 | NaN | 0.0000 | 0.5011 | 0.0000 |
| code-01 | coding | 100 | 100 | 100 | 617 | 164 | 837 | 0.0005 | 0.4429 | 0.0007 |
| code-02 | coding | 100 | 100 | 100 | 4277 | 1176 | 7397 | 0.0035 | 0.4695 | 0.0061 |
| code-03 | coding | 100 | 100 | 100 | 1841 | 541 | 2116 | 0.0015 | 0.4536 | 0.0018 |
| code-04 | coding | 100 | 100 | 100 | 923 | 450 | 848 | 0.0008 | 0.4505 | 0.0007 |
| docqa-01 | document-qa | 86 | 100 | 99 | 5548 | 1328 | 5894 | 0.0213 | 0.4752 | 0.0227 |
| docqa-02 | document-qa | 99 | 100 | 99 | 4015 | 1295 | 3974 | 0.0154 | 0.4791 | 0.0153 |
| docqa-03 | document-qa | 100 | 100 | 0 | 3507 | 1238 | NaN | 0.0135 | 0.4765 | 0.0000 |
| docqa-04 | document-qa | 99 | 100 | 99 | 4710 | 2415 | 7783 | 0.0181 | 0.5184 | 0.0299 |
| extract-01 | extraction | 73 | 77 | 82 | 1883 | 71 | 1279 | 0.0072 | 0.4423 | 0.0049 |
| extract-02 | extraction | 100 | 100 | 100 | 2154 | 281 | 1547 | 0.0083 | 0.4503 | 0.0060 |
| extract-03 | extraction | 73 | 98 | 68 | 2168 | 33703 | 4376 | 0.0083 | 0.9507 | 0.0168 |
| extract-04 | extraction | 0 | 97 | 0 | 8363 | 145 | 8257 | 0.0322 | 0.4449 | 0.0318 |
| math-01 | math | 100 | 100 | 100 | 769 | 352 | 676 | 0.0006 | 0.4470 | 0.0006 |
| math-02 | math | 100 | 100 | 100 | 1336 | 665 | 973 | 0.0011 | 0.4552 | 0.0008 |
| math-03 | math | 100 | 100 | 100 | 2421 | 808 | 1374 | 0.0020 | 0.4590 | 0.0011 |
| math-04 | math | 100 | 100 | 100 | 1382 | 936 | 1218 | 0.0011 | 0.4617 | 0.0010 |
| reason-01 | multi-step-reasoning | 100 | 100 | 100 | 1343 | 537 | 1198 | 0.0011 | 0.4526 | 0.0010 |
| reason-02 | multi-step-reasoning | 100 | 100 | 100 | 1550 | 914 | 1441 | 0.0013 | 0.4617 | 0.0012 |
| reason-03 | multi-step-reasoning | 100 | 100 | 100 | 841 | 736 | 946 | 0.0007 | 0.4583 | 0.0008 |
| reason-04 | multi-step-reasoning | 100 | 100 | 100 | 3107 | 418 | 2981 | 0.0026 | 0.4505 | 0.0025 |
| repo-01 | repo-change | 100 | 100 | 100 | 793 | 192 | 981 | 0.0007 | 0.4450 | 0.0008 |
| repo-02 | repo-change | 100 | 100 | 100 | 892 | 208 | 671 | 0.0007 | 0.4470 | 0.0006 |
| repo-03 | repo-change | 100 | 100 | 100 | 1534 | 267 | 1352 | 0.0013 | 0.4478 | 0.0011 |
| repo-04 | repo-change | 100 | 100 | 100 | 1396 | 207 | 1708 | 0.0012 | 0.4478 | 0.0014 |

## Honesty section

- Single-campaign, frozen 28-task sample × N trials — **directional**, not a production-grade "consistently better" claim (needs many-repo soak).
- **Single-shot, not the live herdr+Pi agentic loop.** Each arm is one text-in→text-out call through the real governed coordinator (`runTask`); it does NOT run the multi-turn tool loop the user drives interactively. Routing economics (B-vs-A) are fully representative; compression (A-vs-C) is measured at the SMALLEST context (single shot), so a compression win here is a **conservative floor** that grows in a real accumulating-context session, and a compression loss (e.g. scaffolding overhead on tiny tasks) would shrink or flip. A full agentic soak is the separate follow-up.
- Opus priced at API rates for the counterfactual; actual usage was on a Max-plan flat fee. The ~49k system-prompt tax per fresh CLI call dominates Opus cost and is part of why go-pilot routes cheap subtasks off Opus.
- Workhorse $ is a calibrated estimate reconciled to the gateway's settled cumulative spend; per-model split preserves the calibrated ratio.
- Reasoning-model output is non-deterministic even at temperature 0; trials capture the spread. Empties/refusals/timeouts are counted as failures, not folded into quality.
