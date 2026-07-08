# S00/T02 — Concurrent-Session Safety Spike (interactive)

**Question:** How many concurrent `claude` sessions can run under ONE Claude Max login
before rate-limit errors or session-file/lock contention appear? (Decision D11 / PLAN #11)

**Why it gates everything:** the pure-anthropic multi-pane design assumes you can run
Opus + Sonnet + Haiku panes at once under one Max subscription. If you can't, the frontier
plane needs a queued/staggered fallback before any router is built.

> ⚠️ Must be run by **you** — it requires your interactive subscription login and your
> machine. An autonomous agent cannot (and per D2/D13 must not) drive subscription auth.

## Procedure

Run each level, note results. Use a trivial identical prompt in each pane (e.g. "summarize
this 200-word paragraph") so load is comparable.

1. **Baseline (1 session):** one `claude` pane on Opus. Confirm it responds normally.
2. **2 concurrent:** open a 2nd terminal, run `claude` on Sonnet at the same time. Fire both.
3. **3 concurrent:** add a 3rd `claude` on Haiku.
4. **4 concurrent:** add a 4th `claude`.
5. **+ codex:** add one `codex` (GPT) session alongside — confirm it's independent quota.

For each level record: rate-limit / 429 errors? delayed responses? session-file or lock
conflicts? any dropped/garbled turns?

## Record results in `docs/concurrency-report.md`

| Concurrency | Result | Rate-limit? | Contention? | Notes |
|---|---|---|---|---|
| 1 (Opus) | | | | |
| 2 (Opus+Sonnet) | | | | |
| 3 (+Haiku) | | | | |
| 4 | | | | |
| +codex | | | | |

**Decision to record:** max safe concurrent Claude sessions = ___ ; fallback trigger = ___
(e.g. "stagger/queue when >N panes active"). Repeat on a Mac when a teammate is available.

### Fastest way to help me capture this
In this Claude Code session you can run a command with the `!` prefix (e.g. `! claude --version`).
For the actual concurrency test, open separate WezTerm/terminal tabs yourself and paste the
observed results back here — I'll fill in `docs/concurrency-report.md` and set the GO/NO-GO.
