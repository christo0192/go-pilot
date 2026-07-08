# M001 — Go-pilot Build Roadmap

Maps `PLAN.md` sprints → GSD slices. Ordered by risk (Sprint 0 first — it can invalidate the whole approach).

| Slice | Sprint | Title | Risk | Gate? |
|---|---|---|---|---|
| **S00** | 0 | Validation Gates (scaffold + concurrency + baseline-paradox) | High | 🔒 hard gate |
| S01 | 1 | Substrate + Frontier Plane (Wezterm+Herdr, wrap claude/codex, presence, worktrees) | High | |
| S02 | 2 | Workhorse Plane (LiteLLM, Pi, tool-call repair) — *skipped in pure-anthropic profile* | High | |
| S03 | 3 | Router + Context Tiering (router, TOON, Ref>Compressed>Full, rtk, CCE, agent-comms) | High | |
| S04 | 4 | Memory (boomerang, validation gate, Mem0, promotion, session-recall) | High | |
| S05 | 5 | Workflow Skills + Generalization (brainstorm→…→auto, Phase-0 alignment) | Med | |
| S06 | 6 | Cross-Platform Self-Installing Repo (install.sh/.ps1, compose, verify) | High | |
| S07 | 7 | Instrumentation + Acceptance (metrics, dashboard, sign-off) | Med | |

Each slice's tasks = the steps under its sprint in `PLAN.md` (single source of truth for step detail).

## Sequencing notes
- S00 gates everything. Its T02–T04 are interactive (subscription login, running concurrent sessions) — executed WITH the user, not autonomously.
- Under `pure-anthropic` profile, S02 is skipped; S01/S03/S04 use claude/codex panes only.
- S06 depends on core services existing (S01 substrate + S04 Mem0).
