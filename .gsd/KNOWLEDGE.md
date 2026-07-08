# Knowledge & Lessons (append-only)

## 2026-07-08 — Environment (WSL2 Ubuntu 26.04)
- Installed: git 2.53.0, node v22.23.1, npm 10.9.8, python3 3.14.4, **claude 2.1.204 (Claude Code)**, **codex-cli 0.143.0**.
- NOT installed: wezterm, herdr, pi, rtk, docker. → pure-anthropic profile can start immediately (claude+codex present); hybrid needs docker + herdr + pi + litellm.
- No pip/ensurepip in system python3; no poppler. PDF text extraction worked via `npm i pdf-parse` (v2 API: `new PDFParse({data:buf}).getText()`). Useful for reading future PDF research docs.
- Builder is on Windows/WSL2; teammates on Mac. Cross-platform is a hard requirement.

## Open questions to resolve in Sprint 0
- Max concurrent `claude` sessions under ONE Claude Max login before rate-limit/session-file contention (T02). This is the make-or-break for pure-anthropic multi-pane. codex/GPT is separate ChatGPT quota (independent).

## 2026-07-08 — Concurrency (T02)
- 10 concurrent `claude` sessions spawn fine under one Claude Max login (Windows/WSL2). Design needs only ~4–5 → ample headroom.
- Key nuance: Max limits are token-THROUGHPUT based, not session-count based. "Spawned" ≠ "ran heavy load without throttle." Watch for 429s only under sustained parallel generation; mitigate by staggering active generators, not by capping open sessions.

## 2026-07-08 — Baseline rig (T03) + the fixed-overhead finding ⭐
- Rig works: `claude -p --output-format json` → parse usage/cost; run.py compares single vs multi, writes metrics/runs/.
- ⭐ KEY: each Claude Code `-p` call carries ~44k tokens of system-prompt overhead (skills+MCP+CLAUDE.md) — even "reply ok" cost $0.057 / 44.8k tokens.
- Consequence: MULTI-PANE FAN-OUT HAS A HIGH FIXED COST PER PANE. Trivial fan-out LOSES (smoke test: multi = 3x tokens, 2.6x cost = NO-GO). Multi-pane only wins when per-subtask REAL work >> ~44k fixed overhead, OR workers use a much cheaper per-token rate that beats the multiplication.
- DESIGN IMPLICATION: worker panes must run LEAN — minimal system prompt, skills+MCP DISABLED — to shrink the ~44k fixed cost. This is a strong argument for lean Pi worker panes (tiny system prompt) over full Claude Code worker panes in hybrid; and for a stripped worker settings profile in pure-anthropic. Feeds Sprint 1/2/3.
- This is precisely the "baseline paradox" the T04 gate must measure on REAL task classes (big-work tasks may flip to GO).
