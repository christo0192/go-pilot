# Go-pilot Live Test — Results

_Generated 2026-07-15T09:56:10.966Z. Directional efficiency proof on a frozen sample (see docs/live-test-plan.md §0 for scope)._

## Reproducibility header

- **Manifest hash:** `4c17e8e19f688f1f856c0f467dbd44b366cf72476c3b9151c66230009db11bfd`
- **Seed:** 20260713 · **Trials:** 1
- **Workhorse rates (calibrated):** kimi-k2.6 $3.847/M · deepseek-v4-pro $0.828/M total tokens
- **Workhorse spend:** est $0.02700 · settled $1.17759 (reconcile scale 43.613)
- **Opus (Arm B) cost @ API rates:** $13.1458 — includes the ~49k Claude-Code system-prompt tax per call (D32), low reasoning effort.
- **Judge tokens:** Opus 505 · DeepSeek 0

## v3 scorecard — reliability-adjusted (raw runs, Opus-only judge)

B2 = lean-Opus baseline, derived analytically from B: same runs and quality; cost at bare Opus API rates on the CLI-reported (cache-exclusive) tokens. B1 cost includes the measured ~65k-token Claude-Code session tax.

| Metric | A (go-pilot) | B1 (Claude-Code Opus) | B2 (lean Opus) | C (naive) |
|---|--:|--:|--:|--:|
| Attempts / successes | 38/35 | 38/37 | 38/37 | 38/33 |
| Success rate | 0.921 | 0.974 | 0.974 | 0.868 |
| Quality when completed | 94.9 | 98.2 | 98.2 | 95.5 |
| Reliability-adjusted quality | 87.4 | 95.6 | 95.6 | 82.9 |
| Total cost $ | 0.3402 | 21.5622 | 1.1401 | 0.4324 |
| Cost per success $ | 0.0097 | 0.5828 | 0.0308 | 0.0131 |
| Tokens per success | 3202 | 1969 | 1969 | 2791 |
| Cached tokens (provider cache hits) | 4715 | 727514 | 727514 | 1536 |
| Cache hit % of input | 26.0 | 95.5 | 95.5 | 15.3 |
| Quality per $  | 256.9 | 4.4 | 83.9 | 191.8 |
| Quality per 1k tokens | 0.78 | 1.31 | 1.31 | 0.90 |

**§11 pass gates:**

- A mean quality ≥ 98: ❌
- A reliability-adjusted quality ≥ 96: ❌
- A cost/success ≤ 20% of B2 (≥80% cheaper): ❌
- A beats C on quality-per-1k-tokens: ❌
- Zero unresolved empties/timeouts in A: ❌

## Headline — WITH (Arm A) vs WITHOUT

| Metric | A (go-pilot) | B (all-Opus) | C (same-model naive) |
|---|--:|--:|--:|
| Mean quality (0-100) | 87.4 | 95.6 | 82.9 |
| Total tokens (Σ fixture medians) | 112077 | 72862 | 92093 |
| Total cost $ | 0.3402 | 21.5622 | 0.4324 |

**Deltas (bootstrap 95% CI over fixtures):**

- **Cost A vs B:** A is 98.4% cheaper (ratio 0.016, CI [0.010, 0.022])
- **Tokens A vs B:** -61.9% fewer (ratio 1.619, CI [0.709, 3.561])
- **Tokens A vs C (compression only):** ratio 1.007, CI [0.856, 1.181]
- **Quality A vs B:** ratio 0.914, CI [0.834, 0.975] (1.0 = parity)

## Per-area verdicts vs pre-registered §2 gates

Gate = quality A ≥ 95% of B **and** cost A ≤ 60% of B **and** tokens A < tokens C.

| Area | qA | qB | qC | $A | $B | tokA | tokC | qFloor | costEff | tokEff | Verdict |
|---|--:|--:|--:|--:|--:|--:|--:|:-:|:-:|:-:|:-:|
| 1 math | 100.0 | 100.0 | 100.0 | 0.0042 | 2.0008 | 5051 | 5074 | ✅ | ✅ | ✅ | **WIN** |
| 2 coding | 100.0 | 100.0 | 100.0 | 0.0084 | 1.9832 | 10172 | 6006 | ✅ | ✅ | ❌ | keep-on-Opus |
| 3 document-qa | 80.8 | 99.6 | 79.6 | 0.1046 | 3.1014 | 27187 | 24142 | ❌ | ✅ | ❌ | keep-on-Opus |
| 4 analysis | 89.4 | 95.0 | 90.0 | 0.0822 | 2.1569 | 21371 | 18711 | ❌ | ✅ | ❌ | keep-on-Opus |
| 5 extraction | 88.9 | 96.1 | 72.2 | 0.0433 | 5.4910 | 11267 | 10307 | ❌ | ✅ | ❌ | keep-on-Opus |
| 6 multi-step-reasoning | 100.0 | 100.0 | 100.0 | 0.0050 | 1.9951 | 6010 | 7176 | ✅ | ✅ | ✅ | **WIN** |
| 7 repo-change | 80.0 | 80.0 | 80.0 | 0.0074 | 2.1676 | 8904 | 6838 | ✅ | ✅ | ❌ | keep-on-Opus |
| 8 spreadsheet-analysis | 58.3 | 98.3 | 64.2 | 0.0558 | 1.6595 | 14507 | 9436 | ❌ | ✅ | ❌ | keep-on-Opus |
| 9 creative-writing | 85.0 | 92.5 | 43.8 | 0.0293 | 1.0067 | 7608 | 4403 | ❌ | ✅ | ❌ | keep-on-Opus |

## Overhead ledger (Arm A machinery, reported separately)

- **Input-token delta A vs C (scaffolding − compression):** 4926 (A 13435 vs C 8509). Positive = net scaffolding overhead; negative = net compression saving.
- **Judge tokens (campaign-level):** Opus 505 + DeepSeek 0.
- **DeepSeek judge est cost:** $0.00000.

## Failure scoreboard (counts per arm)

| Failure | A | B | C |
|---|--:|--:|--:|
| empty | 2 | 0 | 0 |
| truncated | 1 | 0 | 0 |
| error | 0 | 0 | 4 |

## Judge reliability

- Inter-judge Pearson correlation (Opus vs DeepSeek overall): **n/a** over 0 rubric outputs.
- Flagged disagreements (|Δ| ≥ 2 on any dimension): **0** · mean max-Δ n/a.

## Per-fixture detail (trial medians)

| Fixture | Area | qA | qB | qC | tokA | tokB | tokC | $A | $B | $C |
|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| analysis-01 | analysis | 93 | 98 | 95 | 2603 | 1193 | 2663 | 0.0100 | 0.5366 | 0.0102 |
| analysis-02 | analysis | 88 | 93 | 93 | 7861 | 1558 | 4033 | 0.0302 | 0.5425 | 0.0155 |
| analysis-03 | analysis | 90 | 95 | 85 | 3972 | 2018 | 4996 | 0.0153 | 0.5347 | 0.0192 |
| analysis-04 | analysis | 88 | 95 | 88 | 6935 | 2354 | 7019 | 0.0267 | 0.5431 | 0.0270 |
| code-01 | coding | 100 | 100 | 100 | 1031 | 228 | 632 | 0.0009 | 0.4866 | 0.0005 |
| code-02 | coding | 100 | 100 | 100 | 6578 | 1077 | 3281 | 0.0054 | 0.5092 | 0.0027 |
| code-03 | coding | 100 | 100 | 100 | 1648 | 490 | 1255 | 0.0014 | 0.4945 | 0.0010 |
| code-04 | coding | 100 | 100 | 100 | 915 | 460 | 838 | 0.0008 | 0.4929 | 0.0007 |
| creative-hard-01 | creative-writing | 75 | 93 | 0 | 3847 | 984 | NaN | 0.0148 | 0.5076 | 0.0385 |
| creative-medium-01 | creative-writing | 95 | 93 | 88 | 3761 | 699 | 4403 | 0.0145 | 0.4991 | 0.0169 |
| data-easy-01 | spreadsheet-analysis | 100 | 100 | 100 | 1838 | 667 | 1602 | 0.0071 | 0.4979 | 0.0062 |
| data-hard-01 | spreadsheet-analysis | 75 | 95 | 0 | 12669 | 4099 | NaN | 0.0487 | 0.5885 | 0.0539 |
| data-medium-01 | spreadsheet-analysis | 0 | 100 | 93 | NaN | 3639 | 7834 | 0.0000 | 0.5731 | 0.0301 |
| docqa-01 | document-qa | 0 | 100 | 0 | 8397 | 2632 | NaN | 0.0323 | 0.5499 | 0.0308 |
| docqa-02 | document-qa | 100 | 100 | 95 | 4635 | 1445 | 4431 | 0.0178 | 0.5297 | 0.0170 |
| docqa-03 | document-qa | 95 | 100 | 95 | 3459 | 1528 | 4349 | 0.0133 | 0.5305 | 0.0167 |
| docqa-04 | document-qa | 95 | 100 | 98 | 4736 | 2377 | 8351 | 0.0182 | 0.4727 | 0.0321 |
| docqa-hard-05 | document-qa | 98 | 98 | 93 | 4307 | 1346 | 5280 | 0.0166 | 0.5215 | 0.0203 |
| docqa-medium-05 | document-qa | 98 | 100 | 98 | 1653 | 797 | 1731 | 0.0064 | 0.4970 | 0.0067 |
| extract-01 | extraction | 83 | 87 | 83 | 1154 | 34334 | 1465 | 0.0044 | 1.0166 | 0.0056 |
| extract-02 | extraction | 100 | 97 | 100 | 1604 | 389 | 1557 | 0.0062 | 1.0033 | 0.0060 |
| extract-03 | extraction | 73 | 97 | 73 | 2137 | 683 | 2786 | 0.0082 | 1.0173 | 0.0107 |
| extract-04 | extraction | 100 | 97 | 0 | 2346 | 191 | NaN | 0.0090 | 0.4871 | 0.0308 |
| extract-hard-05 | extraction | 100 | 100 | 100 | 2921 | 575 | 1662 | 0.0112 | 0.9861 | 0.0064 |
| extract-medium-05 | extraction | 77 | 100 | 77 | 1105 | 510 | 2837 | 0.0043 | 0.9806 | 0.0109 |
| math-01 | math | 100 | 100 | 100 | 1008 | 358 | 1322 | 0.0008 | 0.5141 | 0.0011 |
| math-02 | math | 100 | 100 | 100 | 1121 | 497 | 930 | 0.0009 | 0.4921 | 0.0008 |
| math-03 | math | 100 | 100 | 100 | 1556 | 593 | 1759 | 0.0013 | 0.4947 | 0.0015 |
| math-04 | math | 100 | 100 | 100 | 1366 | 815 | 1063 | 0.0011 | 0.4998 | 0.0009 |
| reason-01 | multi-step-reasoning | 100 | 100 | 100 | 986 | 628 | 1316 | 0.0008 | 0.4960 | 0.0011 |
| reason-02 | multi-step-reasoning | 100 | 100 | 100 | 1041 | 806 | 1495 | 0.0009 | 0.5001 | 0.0012 |
| reason-03 | multi-step-reasoning | 100 | 100 | 100 | 1029 | 700 | 866 | 0.0009 | 0.4985 | 0.0007 |
| reason-04 | multi-step-reasoning | 100 | 100 | 100 | 2954 | 775 | 3499 | 0.0024 | 0.5005 | 0.0029 |
| repo-01 | repo-change | 100 | 100 | 100 | 794 | 193 | 694 | 0.0007 | 0.3925 | 0.0006 |
| repo-02 | repo-change | 100 | 100 | 100 | 883 | 170 | 886 | 0.0007 | 0.4872 | 0.0007 |
| repo-03 | repo-change | 100 | 100 | 100 | 1983 | 217 | 1869 | 0.0016 | 0.3940 | 0.0015 |
| repo-04 | repo-change | 100 | 100 | 100 | 2376 | 236 | 1083 | 0.0020 | 0.3960 | 0.0009 |
| repo-hard-05 | repo-change | 0 | 0 | 0 | 2868 | 601 | 2306 | 0.0024 | 0.4978 | 0.0019 |

## Honesty section

- Single-campaign, frozen 28-task sample × N trials — **directional**, not a production-grade "consistently better" claim (needs many-repo soak).
- **Single-shot, not the live herdr+Pi agentic loop.** Each arm is one text-in→text-out call through the real governed coordinator (`runTask`); it does NOT run the multi-turn tool loop the user drives interactively. Routing economics (B-vs-A) are fully representative; compression (A-vs-C) is measured at the SMALLEST context (single shot), so a compression win here is a **conservative floor** that grows in a real accumulating-context session, and a compression loss (e.g. scaffolding overhead on tiny tasks) would shrink or flip. A full agentic soak is the separate follow-up.
- Opus priced at API rates for the counterfactual; actual usage was on a Max-plan flat fee. The ~49k system-prompt tax per fresh CLI call dominates Opus cost and is part of why go-pilot routes cheap subtasks off Opus.
- Workhorse $ is a calibrated estimate reconciled to the gateway's settled cumulative spend; per-model split preserves the calibrated ratio.
- Reasoning-model output is non-deterministic even at temperature 0; trials capture the spread. Empties/refusals/timeouts are counted as failures, not folded into quality.
