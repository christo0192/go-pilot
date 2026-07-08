# Task-Class GO / NO-GO Decisions (S00/T04)

> ⏳ PENDING — filled after the baseline-paradox rig (T03) runs each class.
> GO only if multi-pane ≥20% token cut AND ≤5% quality loss vs single-agent (PLAN #10).

| Task class | tokens_single | tokens_multi | Δtokens | quality_single | quality_multi | Δquality | Verdict |
|---|---|---|---|---|---|---|---|
| Ads analysis | | | | | | | |
| MIS reporting | | | | | | | |
| Transcript analysis | | | | | | | |
| Deck drafting | | | | | | | |
| Coding | | | | | | | |

**Rule:** GO if `tokens_multi ≤ 0.80 × tokens_single` and `quality_multi ≥ 0.95 × quality_single`; else NO-GO → keep single-agent for that class.
