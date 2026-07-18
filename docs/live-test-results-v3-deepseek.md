# Go-pilot Live Test — Results

_Generated 2026-07-17T18:23:06.875Z. Directional efficiency proof on a frozen sample (see docs/live-test-plan.md §0 for scope)._

## Reproducibility header

- **Manifest hash:** `4c17e8e19f688f1f856c0f467dbd44b366cf72476c3b9151c66230009db11bfd`
- **Seed:** 20260713 · **Trials:** 3
- **Workhorse rates (calibrated):** kimi-k2.6 $3.847/M · deepseek-v4-pro $0.828/M total tokens
- **Workhorse spend:** est $0.25384 · settled $0.23342 (reconcile scale 0.920)
- **Opus (Arm B) cost @ API rates:** $0.0000 — includes the ~49k Claude-Code system-prompt tax per call (D32), low reasoning effort.
- **Judge tokens:** Opus 1160 · DeepSeek 0

## v3 scorecard — reliability-adjusted (raw runs, Opus-only judge)

B2 = lean-Opus baseline, derived analytically from B: same runs and quality; cost at bare Opus API rates on the CLI-reported (cache-exclusive) tokens. B1 cost includes the measured ~65k-token Claude-Code session tax.

| Metric | A (go-pilot) | B1 (Claude-Code Opus) | B2 (lean Opus) | C (naive) |
|---|--:|--:|--:|--:|
| Attempts / successes | 63/63 | 21/21 | 21/21 | 63/63 |
| Success rate | 1.000 | 1.000 | 1.000 | 1.000 |
| Quality when completed | 90.1 | 96.9 | 96.9 | 90.5 |
| Reliability-adjusted quality | 90.1 | 96.9 | 96.9 | 90.5 |
| Total cost $ | 0.1232 | 13.4155 | 0.9196 | 0.1306 |
| Cost per success $ | 0.0020 | 0.6388 | 0.0438 | 0.0021 |
| Tokens per success | 2361 | 3048 | 3048 | 2504 |
| Cached tokens (provider cache hits) | 15360 | 433679 | 433679 | 11264 |
| Cache hit % of input | 36.1 | 92.7 | 92.7 | 35.6 |
| Quality per $  | 731.7 | 7.2 | 105.3 | 692.8 |
| Quality per 1k tokens | 0.61 | 1.51 | 1.51 | 0.57 |

**§11 pass gates:**

- A mean quality ≥ 98: ❌
- A reliability-adjusted quality ≥ 96: ❌
- A cost/success ≤ 20% of B2 (≥80% cheaper): ✅
- A beats C on quality-per-1k-tokens: ✅
- Zero unresolved empties/timeouts in A: ✅

## Headline — WITH (Arm A) vs WITHOUT

| Metric | A (go-pilot) | B (all-Opus) | C (same-model naive) |
|---|--:|--:|--:|
| Mean quality (0-100) | 90.0 | 96.9 | 91.7 |
| Total tokens (Σ fixture medians) | 48981 | 64018 | 48940 |
| Total cost $ | 0.0406 | 13.4155 | 0.0405 |

**Deltas (bootstrap 95% CI over fixtures):**

- **Cost A vs B:** A is 99.7% cheaper (ratio 0.003, CI [0.002, 0.004])
- **Tokens A vs B:** 23.5% fewer (ratio 0.765, CI [0.321, 1.930])
- **Tokens A vs C (compression only):** ratio 1.001, CI [0.919, 1.102]
- **Quality A vs B:** ratio 0.930, CI [0.898, 0.959] (1.0 = parity)

## Per-area verdicts vs pre-registered §2 gates

Gate = quality A ≥ 95% of B **and** cost A ≤ 60% of B **and** tokens A < tokens C.

| Area | qA | qB | qC | $A | $B | tokA | tokC | qFloor | costEff | tokEff | Verdict |
|---|--:|--:|--:|--:|--:|--:|--:|:-:|:-:|:-:|:-:|
| 1 math | n/a | n/a | n/a | 0.0000 | 0.0000 | 0 | 0 | ❌ | ❌ | ❌ | keep-on-Opus |
| 2 coding | n/a | n/a | n/a | 0.0000 | 0.0000 | 0 | 0 | ❌ | ❌ | ❌ | keep-on-Opus |
| 3 document-qa | 94.6 | 99.6 | 95.0 | 0.0107 | 3.1014 | 12932 | 12648 | ❌ | ✅ | ❌ | keep-on-Opus |
| 4 analysis | 88.1 | 95.0 | 88.1 | 0.0091 | 2.1569 | 11024 | 10963 | ❌ | ✅ | ❌ | keep-on-Opus |
| 5 extraction | 87.2 | 96.1 | 92.2 | 0.0066 | 5.4910 | 7956 | 8105 | ❌ | ✅ | ✅ | keep-on-Opus |
| 6 multi-step-reasoning | n/a | n/a | n/a | 0.0000 | 0.0000 | 0 | 0 | ❌ | ❌ | ❌ | keep-on-Opus |
| 7 repo-change | n/a | n/a | n/a | 0.0000 | 0.0000 | 0 | 0 | ❌ | ❌ | ❌ | keep-on-Opus |
| 8 spreadsheet-analysis | 91.7 | 98.3 | 92.5 | 0.0085 | 1.6595 | 10278 | 11029 | ❌ | ✅ | ✅ | keep-on-Opus |
| 9 creative-writing | 86.3 | 92.5 | 86.3 | 0.0056 | 1.0067 | 6791 | 6195 | ❌ | ✅ | ❌ | keep-on-Opus |

## Overhead ledger (Arm A machinery, reported separately)

- **Input-token delta A vs C (scaffolding − compression):** 2280 (A 9081 vs C 6801). Positive = net scaffolding overhead; negative = net compression saving.
- **Judge tokens (campaign-level):** Opus 1160 + DeepSeek 0.
- **DeepSeek judge est cost:** $0.00000.

## Failure scoreboard (counts per arm)

| Failure | A | B | C |
|---|--:|--:|--:|
| _(none)_ | 0 | 0 | 0 |

## Judge reliability

- Inter-judge Pearson correlation (Opus vs DeepSeek overall): **n/a** over 0 rubric outputs.
- Flagged disagreements (|Δ| ≥ 2 on any dimension): **0** · mean max-Δ n/a.

## Per-fixture detail (trial medians)

| Fixture | Area | qA | qB | qC | tokA | tokB | tokC | $A | $B | $C |
|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| analysis-01 | analysis | 93 | 98 | 93 | 1439 | 1193 | 2172 | 0.0012 | 0.5366 | 0.0018 |
| analysis-02 | analysis | 90 | 93 | 93 | 2510 | 1558 | 1924 | 0.0021 | 0.5425 | 0.0016 |
| analysis-03 | analysis | 83 | 95 | 83 | 4133 | 2018 | 3033 | 0.0034 | 0.5347 | 0.0025 |
| analysis-04 | analysis | 88 | 95 | 85 | 2942 | 2354 | 3834 | 0.0024 | 0.5431 | 0.0032 |
| creative-hard-01 | creative-writing | 93 | 93 | 88 | 4361 | 984 | 3726 | 0.0036 | 0.5076 | 0.0031 |
| creative-medium-01 | creative-writing | 80 | 93 | 85 | 2430 | 699 | 2469 | 0.0020 | 0.4991 | 0.0020 |
| data-easy-01 | spreadsheet-analysis | 98 | 100 | 100 | 918 | 667 | 821 | 0.0008 | 0.4979 | 0.0007 |
| data-hard-01 | spreadsheet-analysis | 78 | 95 | 78 | 5615 | 4099 | 5985 | 0.0046 | 0.5885 | 0.0050 |
| data-medium-01 | spreadsheet-analysis | 100 | 100 | 100 | 3745 | 3639 | 4223 | 0.0031 | 0.5731 | 0.0035 |
| docqa-01 | document-qa | 90 | 100 | 93 | 2466 | 2632 | 2682 | 0.0020 | 0.5499 | 0.0022 |
| docqa-02 | document-qa | 98 | 100 | 98 | 2102 | 1445 | 1698 | 0.0017 | 0.5297 | 0.0014 |
| docqa-03 | document-qa | 98 | 100 | 98 | 2014 | 1528 | 1884 | 0.0017 | 0.5305 | 0.0016 |
| docqa-04 | document-qa | 98 | 100 | 95 | 2325 | 2377 | 2004 | 0.0019 | 0.4727 | 0.0017 |
| docqa-hard-05 | document-qa | 88 | 98 | 90 | 2800 | 1346 | 3204 | 0.0023 | 0.5215 | 0.0027 |
| docqa-medium-05 | document-qa | 98 | 100 | 98 | 1225 | 797 | 1176 | 0.0010 | 0.4970 | 0.0010 |
| extract-01 | extraction | 77 | 87 | 83 | 965 | 34334 | 1106 | 0.0008 | 1.0166 | 0.0009 |
| extract-02 | extraction | 100 | 97 | 100 | 1491 | 389 | 807 | 0.0012 | 1.0033 | 0.0007 |
| extract-03 | extraction | 77 | 97 | 100 | 1327 | 683 | 1316 | 0.0011 | 1.0173 | 0.0011 |
| extract-04 | extraction | 97 | 97 | 87 | 1392 | 191 | 2079 | 0.0012 | 0.4871 | 0.0017 |
| extract-hard-05 | extraction | 97 | 100 | 100 | 1549 | 575 | 1506 | 0.0013 | 0.9861 | 0.0012 |
| extract-medium-05 | extraction | 77 | 100 | 83 | 1232 | 510 | 1291 | 0.0010 | 0.9806 | 0.0011 |

## Honesty section

- Single-campaign, frozen 28-task sample × N trials — **directional**, not a production-grade "consistently better" claim (needs many-repo soak).
- **Single-shot, not the live herdr+Pi agentic loop.** Each arm is one text-in→text-out call through the real governed coordinator (`runTask`); it does NOT run the multi-turn tool loop the user drives interactively. Routing economics (B-vs-A) are fully representative; compression (A-vs-C) is measured at the SMALLEST context (single shot), so a compression win here is a **conservative floor** that grows in a real accumulating-context session, and a compression loss (e.g. scaffolding overhead on tiny tasks) would shrink or flip. A full agentic soak is the separate follow-up.
- Opus priced at API rates for the counterfactual; actual usage was on a Max-plan flat fee. The ~49k system-prompt tax per fresh CLI call dominates Opus cost and is part of why go-pilot routes cheap subtasks off Opus.
- Workhorse $ is a calibrated estimate reconciled to the gateway's settled cumulative spend; per-model split preserves the calibrated ratio.
- Reasoning-model output is non-deterministic even at temperature 0; trials capture the spread. Empties/refusals/timeouts are counted as failures, not folded into quality.
