---
name: herdr-panes
description: Managing herdr worker panes — spawning, running commands, monitoring, and cleaning up panes/workspaces; the file+done-marker result pattern. Use when delegation panes leak, herdr misbehaves, or you need custom pane orchestration beyond pi-delegate.sh.
---

# Herdr Panes

herdr is the terminal pane orchestrator. `pi-delegate.sh` already handles the full pane lifecycle (spawn → run → collect → auto-close); use these commands only for debugging or custom flows.

## Commands

```bash
herdr status server                      # is the headless server up?
herdr server &                           # start it (delegate does this automatically)
herdr workspace create --label X --no-focus   # returns root_pane.pane_id (JSON)
herdr pane split --current --direction right --no-focus   # split beside current pane (inside herdr)
herdr pane split <pane-id> --direction right --no-focus   # split a specific pane
herdr pane run <pane-id> "<command>"     # run a shell command in the pane
herdr pane rename <pane-id> "wk:kimi"    # label it in the sidebar
herdr pane close <pane-id>               # close pane (kills its process)
herdr workspace close <ws-id>            # close a whole workspace
```

Pane/workspace IDs come back as JSON: `.result.pane.pane_id` / `.result.root_pane.pane_id`; workspace id = the part before `:`.

## Result capture — file + done-marker (the ONLY reliable headless pattern)

`herdr pane read` returns EMPTY in headless use — never rely on pane buffers. Instead the worker writes its result to a file and touches `<outfile>.done` as the completion signal; the caller polls for the marker with a deadline. This is what `pi-worker.sh` + `pi-delegate.sh` implement.

## Hygiene

- Every spawned worker pane MUST be closed after result collection — including on timeout (closing the pane kills a stuck worker). `pi-delegate.sh` does this in all paths.
- Inside herdr, split `--current` so workers appear beside the orchestrator pane (user can watch); standalone, create a throwaway workspace and close the whole workspace after.
- Leaked panes: `herdr pane close <id>` / `herdr workspace close <id>` — worker panes are named `wk:<model>`.
