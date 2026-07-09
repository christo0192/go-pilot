# TOON — Token-Oriented Object Notation (task-spec subset)

TOON is a compact text encoding for task-spec artifacts that serializes in fewer
tokens than JSON. `emit(obj)` -> TOON string, `parse(str)` -> object.

- **No braces.** Indentation (2 spaces per level) carries structure; scalars are `key: value`.
- **Tabular arrays.** An array of uniform objects declares its field names ONCE in a
  header (`files[2]{path,action}:`) then writes one compact comma row per element —
  keys and quotes are never repeated per item. Arrays of strings are `key[N]: a,b,c`;
  empty arrays are `key[0]:`.
- **Minimal quoting.** String scalars stay bare unless they contain a delimiter
  (`,`/`:`), a quote, a newline, leading/trailing whitespace, or would otherwise parse
  back as a number/boolean/null — then they are double-quoted with `\` escaping.
- **Round-trip guarantee.** For the supported shape, `parse(emit(x))` deep-equals `x`.

Supported types: string, number, boolean, null, array-of-strings,
array-of-uniform-objects, and one level of object nesting. This is a **task-spec-scoped
subset**, not a general/full TOON implementation. See `metrics/toon-vs-json.md` for the
measured token savings (~42% vs pretty JSON on a real spec).
