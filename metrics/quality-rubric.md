# Quality Score Rubric (S00/T03)

Used to compare single-agent vs multi-pane output quality so token savings aren't bought
with quality loss. Score each run 0–100; multi-pane must stay within **≤5%** of single-agent
(PLAN #10) to count as a GO.

## Dimensions (weight)
- **Correctness / factual grounding (35)** — claims trace to source; no invented numbers/rows.
- **Completeness (20)** — all required outputs present (no dropped rows/sections).
- **Instruction adherence (15)** — followed the task spec + format.
- **Usefulness of conclusions (20)** — actionable, decision-ready (for analysis/report tasks).
- **Coherence / polish (10)** — readable, consistent.

## Method
- Same input + same task spec to both single-agent and multi-pane.
- Score blind where possible (hide which is which).
- Log: task_class, tokens_single, tokens_multi, quality_single, quality_multi, retries.
- GO if: `tokens_multi ≤ 0.80 × tokens_single` AND `quality_multi ≥ 0.95 × quality_single`.

## Task classes to test (T04)
ads analysis · MIS reporting · transcript analysis · deck drafting · coding.
