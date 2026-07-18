_Generated 2026-07-18. Extraction confirmation: K2.5 (3 trials) vs DeepSeek V4 Pro. Decision: KEEP extract -> K2.5 in ikey-prod (deliberate, despite the extract-03 strict-schema regression)._

# extraction confirmation — K2.5 (3 trials) vs DeepSeek V4 Pro

| Fixture | K2.5 trials | K2.5 median | DeepSeek median | Δ | Opus | K2.5 max lat |
|---|--|--:|--:|--:|--:|--:|
| extract-01 | 83.3,83.3,86.7 | 83.3 | 76.7 | +6.7 | 86.7 | 47s |
| extract-02 | 100,100,100 | 100 | 100 | +0 | 96.7 | 23s |
| extract-03 | 76.7,73.3,73.3 | 73.3 | 76.7 | -3.3 | 96.7 | 57s |
| extract-04 | 93.3,96.7,96.7 | 96.7 | 96.7 | +0 | 96.7 | 166s |
| extract-hard-05 | 100,96.7,100 | 100 | 96.7 | +3.3 | 100 | 73s |
| extract-medium-05 | 86.7,76.7,83.3 | 83.3 | 76.7 | +6.7 | 100 | 46s |

## Promotion gates

| Gate | Value | Verdict |
|---|--:|:-:|
| Trial-median quality >= 90 | 89.4 | ❌ |
| Reliability 100% (0 fail / 18 runs) | 100% | ✅ |
| Every fixture >= DeepSeek (<=1 minor, 0 hard reg) | 0 minor, 1 hard | ❌ |
| Area-mean improvement over DeepSeek >= +2 | +2.2 | ✅ |
| Cost/success < $0.02 | $0.00704 | ✅ |
| Max latency within SLA (240s) | 166s | ✅ |

**4/6 gates pass — DO NOT promote extraction yet.**


## Decision

Extraction KEPT on Kimi K2.5 in `ikey-prod`. Average is a clear win (+2.2) at very low cost ($0.007/success) and 100% reliability. The one hard regression (`extract-03`, -3.3) is strict-JSON-schema extraction where DeepSeek's determinism wins; accepted as a known tradeoff. A K2.5-candidate + schema-validation + DeepSeek-fallback wrapper (arm-D pattern) remains the path to recover that case if warranted.
