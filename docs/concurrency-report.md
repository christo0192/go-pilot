# Concurrent-Session Safety Report (S00/T02)

**Status:** ✅ PASS (provisional) — recorded 2026-07-08.

## Windows / WSL2 — result

**10 concurrent `claude` sessions spawned successfully under one Claude Max login.**

| Concurrency | Result | Notes |
|---|---|---|
| 10 sessions | ✅ all spawned | far above the ~4–5 panes the pure-anthropic layout needs |

**Max safe concurrent Claude sessions:** ≥10 (well beyond design need of ~4–5).
**Verdict for pure-anthropic multi-pane:** **GO** — session-count concurrency is not a blocker.

### Residual risk to watch (throughput, not session count)
Claude Max rate-limits bite on **token throughput**, not the number of open sessions. 10
sessions *spawning* proves session-count headroom; it does not yet prove sustained heavy
**simultaneous load** is throttle-free. Monitor for 429s / slowdowns when many panes are
generating at once during real runs.
**Fallback trigger (if throughput 429s appear):** stagger/queue worker panes so no more than
N are actively generating at once (N tuned from observed limits). Not needed unless throughput
throttling shows up.

## macOS (teammate) — TODO at Sprint 6 fresh-machine verify.
