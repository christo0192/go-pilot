---
task: T03
title: Reference > Compressed > Full boundary guard (PLAN Step 3.3)
status: complete
duration: ~9min
files_changed:
  - src/boundary/guard.mjs
  - src/boundary/guard.test.mjs
  - src/boundary/README.md
verification: node_test_30_pass, zero_deps
---

Enforced the core token-efficiency invariant (#1, D7): `guardBoundary(payload)` passes
reference/compressed tiers through, allows `full` only when justified or under an 800-char
threshold, and otherwise DOWNGRADES — to a `reference` if a ref/pointer exists, else to a
truncated+marker `compressed` form — always setting `flagged:true`. Pure/deterministic, unknown
tier throws. Acceptance test proves unjustified full content is never returned raw
(`tier !== "full" || flagged`). Full suite `node --test` 30/30 (router+TOON+boundary), zero deps.

Honest edge note (agent): for marginal over-threshold sizes the truncate+marker can exceed the
original length; realistic downgrade case (content >> threshold) shrinks as intended. Real
compressors (rtk/CCE) are the deferred pilots; "compressed" here is the seam.
