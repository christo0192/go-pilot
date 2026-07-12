# Go-pilot Live Test — Results

_Generated 2026-07-12T21:10:26.847Z. Directional efficiency proof on a frozen sample (see docs/live-test-plan.md §0 for scope)._

## Reproducibility header

- **Manifest hash:** `e318bbc52d44ff4fd7c43d4f2f4c1093b3d16d8f34ac9569763b65c4ab7ed69c`
- **Seed:** 12648430 · **Trials:** 1
- **Workhorse rates (calibrated):** kimi-k2.6 $3.847/M · deepseek-v4-pro $0.828/M total tokens
- **Workhorse spend:** est $0.04842 · settled $0.04663 (reconcile scale 0.963)
- **Opus (Arm B) cost @ API rates:** $0.0000 — includes the ~49k Claude-Code system-prompt tax per call (D32), low reasoning effort.
- **Judge tokens:** Opus n/a · DeepSeek n/a

## Headline — WITH (Arm A) vs WITHOUT

| Metric | A (go-pilot) | B (all-Opus) | C (same-model naive) |
|---|--:|--:|--:|
| Mean quality (0-100) | n/a | 96.9 | n/a |
| Total tokens (Σ fixture medians) | 27331 | 46900 | 31144 |
| Total cost $ | 0.0226 | 6.1834 | 0.0258 |

**Deltas (bootstrap 95% CI over fixtures):**

- **Cost A vs B:** A is 99.6% cheaper (ratio 0.004, CI [0.003, 0.005])
- **Tokens A vs B:** 41.7% fewer (ratio 0.583, CI [0.201, 2.459])
- **Tokens A vs C (compression only):** ratio 0.878, CI [0.606, 1.232]
- **Quality A vs B:** ratio n/a, CI [n/a, n/a] (1.0 = parity)

## Per-area verdicts vs pre-registered §2 gates

Gate = quality A ≥ 95% of B **and** cost A ≤ 60% of B **and** tokens A < tokens C.

| Area | qA | qB | qC | $A | $B | tokA | tokC | qFloor | costEff | tokEff | Verdict |
|---|--:|--:|--:|--:|--:|--:|--:|:-:|:-:|:-:|:-:|
| 1 math | n/a | n/a | n/a | 0.0000 | 0.0000 | 0 | 0 | ❌ | ❌ | ❌ | keep-on-Opus |
| 2 coding | n/a | n/a | n/a | 0.0000 | 0.0000 | 0 | 0 | ❌ | ❌ | ❌ | keep-on-Opus |
| 3 document-qa | n/a | 100.0 | n/a | 0.0094 | 1.9492 | 11365 | 9850 | ❌ | ✅ | ❌ | keep-on-Opus |
| 4 analysis | n/a | 97.8 | n/a | 0.0082 | 1.9460 | 9859 | 10052 | ❌ | ✅ | ✅ | keep-on-Opus |
| 5 extraction | n/a | 92.9 | n/a | 0.0051 | 2.2882 | 6107 | 11242 | ❌ | ✅ | ✅ | keep-on-Opus |
| 6 multi-step-reasoning | n/a | n/a | n/a | 0.0000 | 0.0000 | 0 | 0 | ❌ | ❌ | ❌ | keep-on-Opus |
| 7 repo-change | n/a | n/a | n/a | 0.0000 | 0.0000 | 0 | 0 | ❌ | ❌ | ❌ | keep-on-Opus |

## Overhead ledger (Arm A machinery, reported separately)

- **Input-token delta A vs C (scaffolding − compression):** 1294 (A 5523 vs C 4229). Positive = net scaffolding overhead; negative = net compression saving.
- **Judge tokens (campaign-level):** Opus 0 + DeepSeek 0.
- **DeepSeek judge est cost:** $n/a.

## Failure scoreboard (counts per arm)

| Failure | A | B | C |
|---|--:|--:|--:|
| empty | 0 | 0 | 1 |
| truncated | 0 | 0 | 1 |

## Judge reliability

- Inter-judge Pearson correlation (Opus vs DeepSeek overall): **0.248** over 12 rubric outputs.
- Flagged disagreements (|Δ| ≥ 2 on any dimension): **n/a** · mean max-Δ n/a.

## Per-fixture detail (trial medians)

| Fixture | Area | qA | qB | qC | tokA | tokB | tokC | $A | $B | $C |
|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| analysis-01 | analysis | n/a | 99 | n/a | 1182 | 1100 | 1511 | 0.0010 | 0.4867 | 0.0013 |
| analysis-02 | analysis | n/a | 96 | n/a | 2130 | 1406 | 2719 | 0.0018 | 0.4771 | 0.0023 |
| analysis-03 | analysis | n/a | 98 | n/a | 2898 | 1558 | 3440 | 0.0024 | 0.4810 | 0.0028 |
| analysis-04 | analysis | n/a | 99 | n/a | 3649 | 2360 | 2382 | 0.0030 | 0.5011 | 0.0020 |
| docqa-01 | document-qa | n/a | 100 | n/a | 3394 | 1328 | 4351 | 0.0028 | 0.4752 | 0.0036 |
| docqa-02 | document-qa | n/a | 100 | n/a | 2757 | 1295 | 1762 | 0.0023 | 0.4791 | 0.0015 |
| docqa-03 | document-qa | n/a | 100 | n/a | 2566 | 1238 | 1702 | 0.0021 | 0.4765 | 0.0014 |
| docqa-04 | document-qa | n/a | 100 | n/a | 2648 | 2415 | 2035 | 0.0022 | 0.5184 | 0.0017 |
| extract-01 | extraction | n/a | 77 | n/a | 1129 | 71 | 940 | 0.0009 | 0.4423 | 0.0008 |
| extract-02 | extraction | n/a | 100 | n/a | 1152 | 281 | 752 | 0.0010 | 0.4503 | 0.0006 |
| extract-03 | extraction | n/a | 98 | n/a | 1240 | 33703 | 1295 | 0.0010 | 0.9507 | 0.0011 |
| extract-04 | extraction | n/a | 97 | n/a | 2586 | 145 | 8255 | 0.0021 | 0.4449 | 0.0068 |

## Honesty section

- Single-campaign, frozen 28-task sample × N trials — **directional**, not a production-grade "consistently better" claim (needs many-repo soak).
- **Single-shot, not the live herdr+Pi agentic loop.** Each arm is one text-in→text-out call through the real governed coordinator (`runTask`); it does NOT run the multi-turn tool loop the user drives interactively. Routing economics (B-vs-A) are fully representative; compression (A-vs-C) is measured at the SMALLEST context (single shot), so a compression win here is a **conservative floor** that grows in a real accumulating-context session, and a compression loss (e.g. scaffolding overhead on tiny tasks) would shrink or flip. A full agentic soak is the separate follow-up.
- Opus priced at API rates for the counterfactual; actual usage was on a Max-plan flat fee. The ~49k system-prompt tax per fresh CLI call dominates Opus cost and is part of why go-pilot routes cheap subtasks off Opus.
- Workhorse $ is a calibrated estimate reconciled to the gateway's settled cumulative spend; per-model split preserves the calibrated ratio.
- Reasoning-model output is non-deterministic even at temperature 0; trials capture the spread. Empties/refusals/timeouts are counted as failures, not folded into quality.
