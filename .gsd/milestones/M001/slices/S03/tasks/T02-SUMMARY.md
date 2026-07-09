---
task: T02
title: TOON task-spec format (PLAN Step 3.2)
status: complete
duration: ~10min
files_changed:
  - src/toon/toon.mjs
  - src/toon/toon.test.mjs
  - src/toon/README.md
  - metrics/toon-vs-json.md
verification: node_test_18_pass, toon_42pct_smaller, zero_deps
---

Implemented TOON emit/parse for task-spec artifacts (D7). Tabular encoding for arrays-of-uniform-
objects (field header declared once, one comma-delimited row per element) — no repeated keys/braces/
quotes — plus indentation-based key/value, quote-on-demand. Type distinction preserved across the
round trip (string `"42"` stays a string; bare `42` parses numeric) via the quoting trigger.

Acceptance met: `parse(emit(x))` deep-equals `x` across plain / array-of-objects / quoting-edge-case
specs, empty arrays, and null fields. Token proxy (chars/4) on the T02 spec: **TOON 51 vs JSON 88 →
42% reduction** (metrics/toon-vs-json.md). Full suite `node --test` 18/18 (10 router + 8 TOON), zero deps.
