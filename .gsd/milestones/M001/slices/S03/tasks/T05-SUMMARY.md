---
task: T05
title: Ponytail YAGNI prompt fragment (PLAN Step 3.8)
status: complete
duration: ~5min
files_changed:
  - config/prompts/ponytail-yagni.txt
  - src/prompts/fragment.mjs
  - src/prompts/README.md
  - src/prompts/fragment.test.mjs
verification: node_test_37_pass, zero_deps
---

Reduced YAGNI fragment (`[YAGNI]`-marked, ~5 lines) applied as a CONSTANT USER-PROMPT PREFIX via
`withYagni(prompt)` — NOT `--system-prompt`, which cache-busts (D16). `loadFragment()` reads the
config file cwd-independently. Tests: marker present, original prompt present, fragment ordered first,
empty prompt → bare fragment. Dispatcher wires `withYagni` at compose time (documented in README).
Suite 37/37, zero deps.
