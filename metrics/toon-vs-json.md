# TOON vs JSON — token comparison

Token proxy: `tokens = Math.ceil(str.length / 4)` (chars / 4).
Spec measured: task-spec `T02` (with the `files` array-of-objects).

| format | chars | tokens |
| --- | ---: | ---: |
| TOON (`emit`) | 204 | 51 |
| JSON (`JSON.stringify(spec, null, 2)`) | 349 | 88 |

TOON uses **51** tokens vs JSON's **88** — a **42.0%** reduction.
