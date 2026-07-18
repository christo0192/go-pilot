# Hybrid experiment — DeepSeek→Kimi synthesis

_Generated from out-v3-hybrid (arm D/Dcand), out-v3-deepseek (A/B), out-v3-trim (Kimi A). Seed 20260713, 3 trials (Kimi/Opus frozen at 1)._

## Report 1 — All-task ablation (does unconditional synthesis help or hurt?)

Quality = Opus-judge mean per area. HYB = final hybrid (synth-or-fallback). CAND = DeepSeek candidate (pre-synthesis). Δsynth = HYB − CAND (Kimi's isolated contribution).

| Area | Kimi-only | DeepSeek-only | Cand (DS pre-synth) | Hybrid final | Δsynth (HYB−CAND) | Opus |
|---|--:|--:|--:|--:|--:|--:|
| analysis | 89.4 | 88.1 | n/a | n/a | n/a | 95 |
| creative-writing | 85 | 86.3 | n/a | n/a | n/a | 92.5 |
| document-qa | 80.8 | 94.6 | n/a | n/a | n/a | 99.6 |
| extraction | 88.9 | 87.2 | n/a | n/a | n/a | 96.1 |
| spreadsheet-analysis | 58.3 | 91.7 | n/a | n/a | n/a | 98.3 |

### Tokens per area (Σ fixture medians)

| Area | Kimi-only | DeepSeek-only | Hybrid |
|---|--:|--:|--:|
| analysis | 21371 | 11024 | 0 |
| creative-writing | 7608 | 6791 | 0 |
| document-qa | 27187 | 12932 | 0 |
| extraction | 11267 | 7956 | 0 |
| spreadsheet-analysis | 14507 | 10278 | 0 |

### Per-dimension Kimi contribution (HYB − CAND, judge points ×10)

- **analysis**: n/a
- **creative-writing**: n/a
- **document-qa**: n/a
- **extraction**: n/a
- **spreadsheet-analysis**: n/a

### Hybrid reliability & fidelity

- Runs: 0 · synth used: 0 · **fell back to DeepSeek: 0** (NaN%)
- Numeric preservation on synth-used finals: mean 0% · numeric regressions vs candidate: 0 · citation regressions: 0
- Pack-vs-source grounding (numbers in pack found in source): mean 0%

## Report 2 — Selective production policy

Policy = **hybrid synthesis for analysis/creative/doc-qa; DeepSeek-only for extraction/spreadsheet.**

| Variant | Mean quality | Total tokens | Total cost $ |
|---|--:|--:|--:|
| Kimi-only (all) | 81.9 | 81940 | $0.3152 |
| DeepSeek-only (all) | 90 | 48981 | $0.0406 |
| Hybrid everywhere | n/a | 0 | $0.0000 |
| **Selective policy** | **88.7** | **18234** | **$0.0151** |

## Promotion gates

| Gate | Value | Verdict |
|---|--:|:-:|
| Narrative Δquality (HYB−CAND) ≥ 2 | null | ❌ |
| No category loses > 1 pt | 0 | ✅ |
| Zero numeric/citation regressions | 0num/0cit | ✅ |
| Hybrid reliability-adjusted quality ≥ 92 | null | ❌ |
| Total tokens below Kimi-only | 0 vs 81940 | ✅ |
| Cost ≥ 50% below Kimi-only | $0.0000 vs $0.3152 | ✅ |
| Failed Kimi falls back to DeepSeek (cost counted) | 0 fallbacks | ✅ |

**5/7 gates pass.**
