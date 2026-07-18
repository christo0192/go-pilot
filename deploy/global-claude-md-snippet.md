<!-- OPTIONAL: paste this section into your global ~/.claude/CLAUDE.md to make Claude Code
     auto-orchestrate in EVERY repo (not just inside Go-pilot). install.sh prints a reminder
     but never edits your global CLAUDE.md for you. -->

## GO-PILOT ORCHESTRATION (available in every repo)

For a **substantial multi-step task**, act as ORCHESTRATOR: delegate content-production subtasks to cheap workhorse models and keep control (plan/route/verify/assemble) yourself — full procedure in the global `gopilot-orchestrate` skill (load it before orchestrating). Do trivial one-liners and pure questions directly.

- Primitive: `pi-delegate [--raw] --repair --class <label> <deepseek|kimi25> "<subtask>"` (on PATH; agentic workers edit the CURRENT repo; panes auto-close; metrics auto-logged).
- deepseek = code/math/analysis/repo-edit/draft default · kimi25 = validated extraction + doc-QA · unsure/high-risk → orchestrator judgment.
- Verify every worker result deterministically; repair/escalate per the skill; never present unvalidated workhorse output.
- BILLING: Kimi/DeepSeek only via `pi-delegate`; NEVER Claude/Opus via Pi or API (`pi --model opus` = metered extra usage — you are the frontier path).
- Opt-out: if the user's task says `workhorse-only`, assemble only, never final-write. If `pi-delegate` is unavailable (no herdr/pi/key on this machine), fall back to doing the task yourself and say so.
- Inside the Go-pilot repo itself, its project `CLAUDE.md` + project skills take precedence.
