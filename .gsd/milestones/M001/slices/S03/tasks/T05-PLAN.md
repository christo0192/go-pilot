# T05 — Ponytail YAGNI prompt fragment (PLAN Step 3.8)

## Goal
Apply the reduced Ponytail YAGNI fragment to worker system prompts. Constraint (D16): the lean-worker
path AVOIDS `--system-prompt` (cache-busting), so the fragment is a constant PREFIX prepended to the
worker's user prompt (constant prefix stays cacheable).

## Deliverables (Node ESM, zero deps)
1. `config/prompts/ponytail-yagni.txt` — the reduced YAGNI fragment (a few lines: build only what the
   task asks; no speculative abstraction/config/flags; prefer the simplest thing that passes acceptance).
2. `src/prompts/fragment.mjs` — `withYagni(prompt, opts={})` returns the fragment + "\n\n" + prompt;
   `loadFragment(opts={})` reads the file (opts.path override). Pure aside from the file read.
3. `src/prompts/fragment.test.mjs` (`node --test`): composed prompt contains BOTH the fragment marker
   and the original prompt; ordering (fragment first); empty prompt handled.
4. Acceptance: worker prompts can include the fragment; a sample composed prompt is unaffected in meaning.

## Out of scope
Live worker run; modifying lean-worker.sh (the dispatcher wires withYagni later). Do NOT modify package.json.
