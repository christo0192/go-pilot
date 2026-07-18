# Hybrid experiment (DeepSeek→Kimi synthesis) — SHELVED

**Status: DROPPED (2026-07-18). See `.gsd/DECISIONS.md` D38.**

This documents an experiment that was designed, built, partially run, and then
formally shelved — kept as a record so the reasoning isn't lost.

## What it was

A two-stage "arm D" pipeline added to `scripts/baseline-rig/campaign.mjs`:

1. **DeepSeek** produces a candidate answer (the fallback baseline).
2. **DeepSeek** produces a compact evidence pack (facts / spans / computed / uncertainty).
3. **Kimi** writes the final answer from the pack ONLY.
4. **Validate** the synthesis (non-empty, not truncated, ≥80% of the pack's numbers
   preserved). If it fails, **fall back to the DeepSeek candidate** — so a Kimi
   failure never becomes a campaign failure, while its tokens/cost are still counted.

A companion `Dcand` record captured the pre-synthesis DeepSeek candidate so the
paired `HYB − CAND` delta isolates Kimi's contribution despite DeepSeek nondeterminism.

## Why it was dropped (not finished)

Run to **11/63** (analysis fixtures only) before being shelved. Formally dropped because:

1. **Stale synthesizer.** Arm D hardcodes `kimi-ikey` (K2.6) as the writer. K2.6 was
   subsequently retired in favor of K2.5, which strictly dominated it (90.0 vs 81.9
   mean quality, cheaper, more reliable). Finishing arm D would have benchmarked the
   *weaker* Kimi as the synthesizer.
2. **Poor early economics.** **9 of the 11** analysis runs (82%) failed synthesis
   validation and fell back to the DeepSeek candidate — i.e. the hybrid paid for
   three model calls to ship DeepSeek's own answer. On analysis the extra Kimi pass
   was almost pure overhead.
3. **Superseded.** The K2.5 selective-routing result — doc-QA and extraction → K2.5,
   a single call — already captures "use the better Kimi where it measurably helps,"
   without the three-call cost or the reliability tax of a mandatory synthesis leg.

## What was kept

- The **arm-D harness** remains in `campaign.mjs` (with `numTokens` / `numPreservation`
  helpers and unit tests). If a K2.5-as-synthesizer hybrid is ever worth testing, swap
  `synthModel` to `kimi-k2.5-ikey` and re-run clean into a fresh output dir.
- `compare-hybrid.mjs` remains (degrades gracefully when the output dir is absent).
- The partial gitignored output (`out-v3-hybrid`, 11 analysis records, ungraded) was
  removed to avoid a future session mistaking it for a resumable run.
