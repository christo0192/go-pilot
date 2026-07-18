# Production routing metrics

Generated from the frozen 3-trial Arm-A ledgers in `out-v3-k25` and `out-v3-deepseek`. Latest record per run key wins. No model calls or estimated quality values are introduced by this report.

## Selected K2.5 routes

| Area | Complete runs | Quality /100 | Reliability | Tokens/success | Cost/success | Max latency | Quality vs DeepSeek |
|---|---:|---:|---:|---:|---:|---:|---:|
| document-QA | 18/18 | 97.1 | 100.0% | 4,404 | $0.0125 | 143s | +2.5 |
| extraction | 18/18 | 89.4 | 100.0% | 2,485 | $0.0070 | 166s | +2.2 |

Across these two production-selected areas: **93.3/100 quality**, **100.0% reliability**, **3,444 tokens/success**, and **$0.0098 per success** over 36 replicated runs. Versus DeepSeek on the same fixtures, quality is **+2.4 points** and tokens/success are **+91.4%**.

## Interpretation

- Document-QA clears its promotion evidence: quality >=97, 100% reliability, and no observed fixture regression.
- Extraction is a deliberate tradeoff: it improves the area mean over DeepSeek, but its 89.4 score remains below the 90 quality gate and includes one fixture regression. The production schema/citation validator and DeepSeek fallback added after these runs protect format and mechanical reliability; their quality lift is **not** claimed until a fresh controlled campaign measures it.
- This scorecard covers model-facing quality/cost/token evidence. Unit and integration verification belongs in the engineering handover, not in these benchmark figures.
