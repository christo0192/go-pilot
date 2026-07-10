---
task: S02/T03
title: Per-worker tool subsets (Step 2.3)
status: complete (live tool-exposure check deferred to 2.2 — needs model key)
files_changed: [config/tool-profiles.json, src/router/tool-profiles.mjs, src/router/tool-profiles.test.mjs, docs/workhorse-plane.md]
verification: node_test_172, extract≠code_verified, zero_deps
---
`config/tool-profiles.json` maps each router category → a minimal Pi tool allowlist (JSON not YAML — zero-dep
consistent with router.json). Real Pi built-ins confirmed from source: read/write/edit/bash/grep/find/ls (7; no
glob). `src/router/tool-profiles.mjs`: `piToolArgs(category)` → Pi `--tools` args; unknown→default. Done-when met:
extract→`read,grep,find` (read-only) vs code→`read,edit,write,bash,grep,find` differ correctly. 11 tests. Live
"worker exposes only its tools" check needs a real Pi turn (model key) → folds into 2.2.
