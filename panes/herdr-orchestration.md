# Herdr Orchestration Reference (verified 2026-07-09, herdr 0.7.3)

The core orchestrator↔worker mechanic — all verified working **headlessly** (server + socket API,
no TTY). This is the substrate Go-pilot's router builds on. Everything returns JSON.

## Server
```
herdr server                 # headless server (persistent); socket at ~/.config/herdr/herdr.sock
herdr status server          # {status: running, protocol: 16, ...}
herdr server stop
```

## Workspaces / panes
```
herdr workspace create --label NAME --no-focus     # -> workspace w1, root pane w1:p1
herdr workspace list
herdr api snapshot                                  # full JSON: workspaces/tabs/panes/agents
herdr pane split w1:p1 --direction right            # add a worker pane
herdr pane list --workspace w1
```

## The orchestration loop (VERIFIED)
```
herdr pane run  <pane> "<command>"                          # dispatch: runs command text + Enter
herdr wait output <pane> --match "<marker>" --timeout MS    # BLOCK until output appears (boomerang sync)
herdr pane read <pane> --source recent-unwrapped --lines N  # read clean result text
```
`--source recent-unwrapped` gives the cleanest de-wrapped text. `herdr wait` avoids polling/sleep.

## Agent-native primitives (for wrapped agents like claude/codex/pi)
```
herdr integration install claude|codex|pi|...    # adds a state-reporting hook for that agent
herdr agent start <name> --cwd P --workspace W --split right -- <argv...>   # spawn an agent in a pane
herdr agent send <target> "<text>"               # type into the agent
herdr agent wait <target> --status idle|done --timeout MS   # wait for agent state
herdr agent read <target> --source recent-unwrapped
herdr agent list
```

## Go-pilot mapping
- **Worker one-shot (recommended):** `pane run` a **lean** `claude -p` (see scripts/lean-worker.sh) →
  `wait output --match <sentinel>` → `pane read`. Deterministic, token-accounted, cheapest.
- **Interactive agent pane:** `agent start -- claude` + `integration install claude` for TUI state
  detection (idle/working/blocked/done in the sidebar). Use for the orchestrator / long-running panes.
- **worktree per pane:** `herdr worktree <subcommand>` (S01/T05).
