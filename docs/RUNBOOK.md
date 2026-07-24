# Runbook — common failures and fixes

First move for ANY weirdness: `node scripts/gopilot-status.mjs` (gateway, spend,
per-model failure rates, breakers, leaked panes) and `bash install.sh --doctor`
(what's missing on this machine).

| Symptom | Likely cause | Fix |
|---|---|---|
| `[delegate breaker] X OPEN` | 3 consecutive failures on that model in 10 min | Wait out the 5-min cooloff (auto-reroutes to sibling meanwhile), or `--force-model` after checking `node scripts/gopilot-status.mjs`. Persistent → gateway/model issue, check `curl -s $GW/health`. |
| `[delegate budget] spend >= cap` (exit 7) | Settled gateway spend hit `GOPILOT_SPEND_CAP_USD` (default $7) | Raise the cap env var deliberately, or top up/rotate the key. `--allow-over-budget` for a single call. Spend is CUMULATIVE per key. |
| Delegation returns empty (exit 2) | Reasoning model burned the whole output budget (esp. Kimi) | `--repair` retries strict then swaps sibling automatically. Manual: raise `--max-tokens`, prefer deepseek. |
| Kimi 30–166s or timeout (exit 3) | K2.5 reasoning cannot be disabled and latency is inherently spiky | Expected. Keep K2.5 on validated extraction/doc-QA; use DeepSeek for latency-sensitive work. `--repair` reassigns mechanical failures. |
| Agentic usage `null` in ledger | Pi session log not found (concurrent identical tasks, or ~/.pi moved) | Harmless (latency/outcome still logged). Check `~/.pi/agent/sessions/` exists; distinctive task text disambiguates. |
| Worker edited the wrong repo | Called delegate from the wrong cwd (workers run in CALLER's dir) | `cd` to the target repo first, or `DELEGATE_CWD=/path`. Repo edits should use `--sandbox` anyway — review the diff before applying. |
| Leaked `wk:*` panes | Crash mid-delegation before cleanup | `herdr pane close <id>` / `herdr workspace close <id>`. Status command counts them. |
| `pi-delegate: command not found` | PATH shim missing | `./install.sh` (re-runs are safe), or call `scripts/pi-delegate.sh` by path. |
| Pi says "No models available" | ikey provider missing from `~/.pi/agent/models.json` | `./install.sh` or `scripts/pi-ikey.sh` re-installs it (path templated per machine). |
| Gateway 401 | Key rotated/expired in `deploy/.env` | Update `WORKHORSE_GATEWAY_KEY`; verify: `scripts/pi-delegate.sh --raw deepseek "say OK"`. |
| Claude ignores orchestration in another repo | Global skill/CLAUDE.md section missing on this machine | `./install.sh` installs the skill; paste `deploy/global-claude-md-snippet.md` into `~/.claude/CLAUDE.md` for auto-routing. |
| Windows Terminal says `Unable to find ... JetBrainsMono NL Nerd Font Mono` | Nerd Fonts v3 renamed that family to `JetBrainsMonoNL NFM` | Run **Update Go-pilot** or rerun `setup.cmd`; the app installer verifies the pinned v3.4.0 face, backs up Terminal settings, and migrates only the obsolete family reference. Close and reopen Windows Terminal afterward. |
| Cache hit appears inconsistent | Pi `CH` is the latest call while arrow counters are cumulative | Run `node scripts/gopilot-status.mjs`; it reports latest, cumulative, eligible-warm performance, and cold reasons separately. |
| Benchmark interrupted (quota/rate limit) | Max plan window exhausted mid-campaign | Nothing lost: re-run the exact same campaign command — the ledger checkpoint skips completed runs. |
| `deploy/.env` perms check fails on WSL | NTFS mount (`/mnt/c`) ignores chmod | Known WSL limitation; acceptable on a single-user box. Move the repo into the Linux filesystem for real 600 semantics. |

## Billing invariants (never break)
- Kimi/DeepSeek only via `pi-delegate` (Pi → gateway).
- NEVER `pi --model opus` or Claude via API — metered "extra usage". Claude Code IS the frontier path.

## Escalation
Wedged state you can't explain → capture `gopilot-status --json`, the last lines of
`scripts/baseline-rig/out/delegate-log.jsonl`, and open an issue titled `[incident]`.
