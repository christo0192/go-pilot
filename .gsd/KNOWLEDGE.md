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

## 2026-07-09 — S01 COMPLETE (frontier-plane substrate proven)
- T03 codex worker: `codex exec --json --skip-git-repo-check --sandbox read-only --ignore-user-config` → JSONL events; final answer = last item.completed agent_message; usage in turn.completed. Codex overhead ~12.5k tok (< Claude 44k). ChatGPT auth, separate quota. Wrapper scripts/lean-codex-worker.sh.
- T05 worktree: `herdr worktree create --cwd REPO --branch B --base HEAD --path P --json` → linked worktree + own workspace/pane; `herdr worktree remove --workspace ID --force`. git worktree-per-pane = primary write-safety.
- T04 lock: scripts/pane-lock.sh (flock) serializes shared-checkout writers (verified). claude-presence deferred.

## 2026-07-09 — S03 Router + Context Tiering
- Node's built-in `node --test` + `node:assert/strict` gives a real, CI-usable test gate with ZERO installs —
  ideal for the self-bootstrapping cross-platform repo (no pip on this machine's python3 3.14). All S03
  modules are zero-dep ESM; the whole suite is 42 tests, runs + exits clean via `node --test`.
- GOTCHA: `net.Server` has NO `closeAllConnections()` (that's `http.Server` only) — calling it is a silent
  no-op (undefined), leaving accepted sockets alive so `server.close()` hangs forever. Track accepted sockets
  in a Set and `.destroy()` them before `close()`. This bit T06 until fixed; watch for it in any node:net code.
- Token efficiency (measured): TOON task-specs are ~42% smaller than pretty JSON on the chars/4 proxy —
  worth using for all cross-pane specs.
- Router design that worked: key on WORK-TYPE (code/extract/plan/…), not business domain, so the pending
  per-class GO table (D17) doesn't block routing; multi-pane fan-out stays opt-in per validated class.

## 2026-07-09 — S04 + parallel-agent testing
- Two-tier memory pipeline shipped as zero-dep Node ESM: store→gate→promotion→mem0-adapter→recall. The gate
  BEFORE compression is load-bearing (#6): failing results propagate FULL and are never summarized; promotion
  only persists gate-passing keeper-kinds (decision/summary/pref) so Tier-2 can't be bloated/contaminated.
- GOTCHA (parallel subagents): when two agents run concurrently in the SAME checkout and each runs the FULL
  `node --test`, one can transiently fail on the OTHER's half-written test file (looks like a flaky test).
  It is NOT a code defect. Always confirm suspicious counts with a SERIAL re-run (`for i in 1..N; node --test`)
  before diagnosing a bug. Here: 28 serial runs = 0 fails; the "flake" was T05 reading T04's mid-write file.
- Recall token-budgeting: compare char length vs `maxTokens*4` (exact inverse of the chars/4 proxy) and drop
  whole bullets; truncate only the top bullet if it alone overflows — guarantees the injection never exceeds budget.

## 2026-07-09 — S07 Instrumentation + Acceptance
- #10 numeric-acceptance harness shipped as zero-dep Node ESM (src/metrics/): metrics(record+computeRun) →
  acceptance(evaluate vs ≥20%/≤5% targets) → signoff(per-class GO vs revert). One shared metrics-record
  contract; router overhead is ALWAYS its own line item, never subtracted from token savings.
- Parallel-agent race mitigation (confirmed working): when spawning concurrent agents that add sibling test
  files, instruct each to run ONLY its own file (`node --test <file>`) during dev, and have the orchestrator
  run the FULL suite serially afterward. Eliminates the half-written-file false-flake seen in S04. 115/115 clean.
- D17 residual made concrete: per-class sign-off DEFAULTS to revert-to-single when a class has no live data —
  the safe no-negative-return default. Live sign-off just needs baseline-rig runs fed into signoff().

## 2026-07-09 — Self-hosting Mem0 (real integration)
- The prebuilt `mem0/mem0-api-server` image is ARM64-ONLY — `docker manifest inspect` said "exists" but
  `compose up` failed "no matching manifest for linux/amd64". Always check the image ARCH (not just existence)
  before trusting a prebuilt image on x86_64; build from source when there's no amd64 variant.
- Mem0 OSS server needs: pgvector Postgres + `alembic upgrade head` (prod Dockerfile does NOT migrate — add it
  to the compose command) + an app DB via init-db.sh + a real EMBEDDER (OpenAI default). `AUTH_DISABLED=true`
  removes JWT/api-key for local. Endpoints (verified in server/main.py): POST /memories, POST /search, no /v1/.
- Blobless+sparse clone got just server/ fast after a full `git clone` timed out:
  `git clone --filter=blob:none --no-checkout --depth 1 <repo> dst && cd dst && git sparse-checkout set server && git checkout`.

## 2026-07-09 — Mem0 live bring-up (3 bugs, in order)
1. sandbox couldn't reach dockerd (not in docker group, no sudo) → `sudo chmod 666 /var/run/docker.sock`
   (dev convenience; resets on daemon restart; revert `chmod 660`).
2. Mem0 slim image: `psycopg` "no pq wrapper available" (libpq missing) → add `pip install psycopg[binary]`
   to the compose start command (bundles libpq; no apt needed).
3. `sqlite3 unable to open database file` → Mem0's core keeps a SQLite history DB at
   HISTORY_DB_PATH=/app/history/history.db; the dir must exist → mount a volume at /app/history.
Prod Dockerfile does NOT run migrations → command must `alembic upgrade head` before uvicorn.
Native Docker in WSL2 (Ubuntu 26.04 has systemd on): `apt install docker.io docker-compose-v2` +
`systemctl enable --now docker` — no Docker Desktop, no Windows restart.

## 2026-07-09 — S06 installers
- install.sh made sourceable via `[[ "${BASH_SOURCE[0]}" == "$0" ]]` guard so its functions (OS detect, .env
  templating, `have` guards) can be unit-tested without running the sudo/apt install lines.
- Best idempotency test for an installer: run it on an already-provisioned box and assert every step no-ops +
  exit 0 — that IS the "second run is a no-op" acceptance. install.sh passed this live.
- Node on Ubuntu: prefer NodeSource setup_20.x over apt `nodejs` (archive can lag < v20).

## 2026-07-10 — Code review quality gate (DoD /review)
Full Code-Reviewer pass on all src/ modules: 0 Critical, 2 Major (FIXED), 6 Minor, 5 Nits. Verdict: core clean
(real purity boundaries, prototype-pollution guards, honest degrade chains, leak-free sockets).
FIXED + tested (174/174):
- cce-retrieve.mjs ranking matched the ABSOLUTE path (incl. cwd) → a query token appearing in the cwd (e.g.
  "pilot") inflated every file's score. Now matches basename(f).
- promotion.mjs had no per-item isolation once async: one failed adapter.add aborted the whole batch + hid which
  keepers already landed. Now try/catch per item → skipped {reason:"add-failed: ..."}.
- metrics.mjs validateRecord now requires quality.single > 0 (was only isNumber) → avoids Infinity/NaN drop%.
DEFERRED (Minor/Nit, tracked, non-blocking): toon.parse throws bare TypeError (not SyntaxError) on truncated
array-of-objects input; mem0-client id/score contract tolerance vs mock (undefined id when server+caller give
none; scores unbounded); store.mjs claim marker has no TTL/heartbeat (crash between claim+complete = stuck task);
cce-retrieve cwd not shell-escaped in `sh -c` (process-controlled, low risk — prefer argv to grep); tool-profiles
doesn't validate names against PI_BUILTIN_TOOLS. Revisit if these surface at scale.
