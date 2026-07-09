# T02 — TOON task-spec format (PLAN Step 3.2)

## Goal
Adopt TOON (Token-Oriented Object Notation) for task-spec artifacts so plans/specs cross pane
boundaries in fewer tokens than JSON (D7). Provide an emit/parse helper; prove round-trip + a
recorded token comparison vs the JSON equivalent.

## Design (Node ESM, zero deps — D20)
- `src/toon/toon.mjs` exports `emit(obj)` → TOON string and `parse(str)` → object.
- TOON core idea (implement this subset): indentation-based key/value; arrays of uniform objects
  emitted as a tabular block (declare field names once, then one compact row per item) instead of
  repeating keys+braces+quotes per element. Quote strings only when they contain delimiters/whitespace
  that would break parsing. Scalars: string/number/boolean/null.
- Scope to the task-spec shape we actually use (id, category, prompt, depends[], acceptance[], files[]).
  It need not be a general TOON implementation — but `parse(emit(x))` MUST deep-equal `x` for that shape.

## Deliverables
1. `src/toon/toon.mjs` — `emit` + `parse`.
2. `src/toon/toon.test.mjs` (`node --test`): round-trip on ≥3 representative task specs (incl. one with
   an array-of-objects and one with quoting edge cases); assert `parse(emit(x))` deep-equals `x`.
3. A token comparison: a small script or test that JSON.stringifies the same spec and compares a
   token proxy (e.g. `tokens ≈ Math.ceil(chars/4)`, or word-count) for TOON vs JSON. Record the numbers
   in `metrics/toon-vs-json.md` (TOON must be fewer). State the proxy used.
4. `src/toon/README.md` — 8 lines: what TOON is here, the tabular-array rule, round-trip guarantee.

## Acceptance
- `node --test` green including the round-trip tests.
- `metrics/toon-vs-json.md` shows TOON < JSON on the token proxy for at least one real task spec.
- Zero new deps.

## Out of scope
- Full/general TOON spec compliance; router changes; wiring TOON into dispatch (later).
