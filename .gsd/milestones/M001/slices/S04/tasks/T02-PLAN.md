# S04/T02 — Validation gate before compression (PLAN Step 4.2)
See S04-PLAN.md for scope. `src/memory/gate.mjs`: `mustPass(result, checks)` → {passed, failures};
`gateThenCompress(result, checks, compressFn)` compresses only if all checks pass, else returns FULL
result untouched with summarized:false. Failures never summarized. Node ESM, zero deps, `node --test`.
