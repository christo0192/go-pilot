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

## 2026-07-08 — Where the 44k comes from + how to cut it (MEASURED) ⭐⭐
Trivial "reply ok" on haiku, varying config (total tokens / cost):
- A. default:                 45,369 / $0.0580   (cc=28010 cr=17294)
- B. no MCP:                  43,877 / $0.0472   (MCP tool schemas ≈ 19% of cost)
- C. --setting-sources project (skip global ~/.claude/CLAUDE.md + user skills): 31,416 / $0.0228  (cc 28k→10k) — BIGGEST lever
- D. project-only + no MCP:   31,154 / $0.0223   → ~62% cost cut vs default
- E. --system-prompt replace: 43,648 / $0.0875   (busts prompt cache → worse; avoid)
BREAKDOWN: the 44k is mostly the USER's heavy global CLAUDE.md (the big pipeline/routing doc) + user-level skills, then MCP tool schemas (Adobe/Figma/Canva/Slack/Vercel...), then base CC prompt+tools. It is NOT inherent to Claude Code.
LEAN WORKER CONFIG (D15): `claude -p --setting-sources project --strict-mcp-config --mcp-config '{"mcpServers":{}}'` → ~60% cheaper per worker call. Lowers fan-out fixed overhead ~44k→~31k (and cost 2.5x lower), so fan-out breaks even on much smaller tasks. Do NOT use --system-prompt replace (cache-busts).

## 2026-07-09 — S01/T01: Herdr installed + orchestration loop PROVEN ⭐⭐⭐
- herdr 0.7.3 → ~/.local/bin/herdr. Headless `herdr server` + socket API work WITHOUT a TTY (great for automation/cron).
- Verified: workspace create/list, api snapshot, pane split, and the FULL LOOP:
  `pane run` (dispatch) → `wait output --match <marker>` (block till done) → `pane read --source recent-unwrapped` (clean result).
- `herdr wait output/agent-status` is the built-in boomerang/completion primitive — no polling/sleep needed. `herdr agent start/send/wait/read` for wrapped-agent panes.
- `herdr integration install claude` writes a hook to /mnt/c/Users/Admin/.claude/hooks/herdr-agent-state.sh (+ likely settings.json). User has a heavy existing hook setup → inspect + back up before installing (T02).
- Server running in background this session (task bg7g5a10h). Full command reference: panes/herdr-orchestration.md.
- DESIGN: worker one-shots = lean `claude -p` via `pane run` (deterministic, token-accounted, cheapest). Interactive orchestrator pane = `agent start -- claude` + integration for TUI state.

## 2026-07-09 — S01/T02: full worker mechanic proven + real cost
- Orchestrator → lean `claude -p` worker in a herdr pane → `wait output` (boomerang) → `pane read`+parse JSON. result='WORKER_OK', $0.0032, 24,265 tok — ~18x cheaper than default $0.058 (warm cache). No ~/.claude change.
- GOTCHA: `herdr wait output --match` also matches the ECHOED command line. Never use a sentinel that appears literally in the dispatched command; match a result-only token (total_cost_usd / "result") or signal out-of-band.
