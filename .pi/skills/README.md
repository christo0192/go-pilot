# Go-pilot Pi Workflow Skills

Pi skills that reproduce Go-pilot's workflow muscle-memory so a **Pi-orchestrated** project runs the
same stages the team already knows from the pure-Anthropic (Claude Code / GSD) profile.

## The set

| Skill | Stage | Invoke | Makes changes? |
|-------|-------|--------|----------------|
| `phase-0-align` | Phase-0 alignment **gate** | `/skill:phase-0-align` | records `.pi/state/alignment.md` only |
| `brainstorm` | Diverge/converge on approaches | `/skill:brainstorm` | no |
| `explore` | Scout the codebase/system | `/skill:explore` | no |
| `plan` | Decompose into steps (**gated**) | `/skill:plan` | writes `.pi/state/plan.md` |
| `execute` | Implement one step + verify | `/skill:execute` | yes (one step) |
| `auto` | Autonomous loop over all stages | `/skill:auto` | yes (drives the loop) |

## How they are discovered

These live in `.pi/skills/`, so **Pi auto-discovers them** whenever `pi` runs anywhere in this repo
(project skills are loaded from `.pi/skills/` in cwd and ancestors up to the git root, per
`docs/skills.md`). Each skill is a directory containing a `SKILL.md` with `name` + `description`
frontmatter. No settings entry is needed. The project must be **trusted** for project-local skills to
load (`pi -a` / `--approve` for a one-shot headless run, or accept the trust prompt interactively).

Invoke a skill with `/skill:<name>`; any text after the command is appended as `User: <args>`, e.g.
`/skill:phase-0-align add a dark-mode toggle`.

## The workflow (and the gate)

```
phase-0-align ──(records alignment)──▶ brainstorm? ──▶ explore? ──▶ plan ──▶ execute (loop)
     ▲  gate: plan/auto refuse to run                                │
     └────────────────────────────────────────────────────────────  auto drives all of the above
```

- **Phase-0 gate (Step 5.2):** `plan` refuses to produce a plan until `.pi/state/alignment.md` exists
  with `status: aligned`. `phase-0-align` is the only stage that requires a human exchange; it forces
  agreement on goal, constraints, success criteria, and scope, and records it. This is a deterministic
  block, not a suggestion — the artifact's presence is the machine-checkable signal.
- `brainstorm` and `explore` are **conditional** — run them only when there is real design ambiguity
  or unfamiliar code (YAGNI applies to process too).
- `execute` enforces **validate-before-compress**: no step is "done" until its Done-when check passes;
  failures propagate in full, never smoothed into a summary.
- `auto` is the coordinator — it references the others by their `/skill:` names and keeps resumable
  state under `.pi/state/`.

## Runtime state (created by the skills, not committed)

- `.pi/state/alignment.md` — Phase-0 gate artifact.
- `.pi/state/plan.md` — ordered plan with per-step Done-when + done ticks.
- `.pi/state/auto-state.json` — `{ stage, current_step, status, updated }` for resume.

## Mapping: pure-anthropic vs Pi-orchestrated profiles

Go-pilot runs the same architecture under three model profiles (`pure-anthropic`, `hybrid`,
`open-first`); only *which model tier fills each stage* changes. These skills are the **Pi-side**
expression of the workflow the pure-anthropic profile gets from Claude Code + GSD commands:

| Workflow stage | pure-anthropic (Claude Code / GSD) | Pi-orchestrated (this set) |
|----------------|------------------------------------|----------------------------|
| Alignment gate | AskUserQuestion / discuss-before-commit | `/skill:phase-0-align` |
| Brainstorm | `/brainstorm`, `superpowers:brainstorming` | `/skill:brainstorm` |
| Explore | `/gsd-scout`, `Explore` agent | `/skill:explore` |
| Plan | `/create-plan`, `EnterPlanMode` | `/skill:plan` |
| Execute | `/execute`, `superpowers:executing-plans` | `/skill:execute` |
| Auto loop | `/gsd-auto` | `/skill:auto` |

Behavior is profile-agnostic; set the model tier per stage with Pi's `/model` (keep alignment +
planning on the stronger tier; cheap-but-reliable models can run explore/execute fan-out — D15/D16
lean-worker economics). The stage *contract* is identical across profiles, so a teammate moving
between a Claude-orchestrated and a Pi-orchestrated project keeps the same muscle memory.

## Design note (decision recorded)

Authored as **skills** (directories with `SKILL.md`), not prompt-templates. Rationale: skills carry a
`description` that Pi surfaces in the system prompt for model-driven invocation *and* register as
`/skill:` commands, so `auto` can reference the other stages by name and the orchestrator can load a
stage on demand — richer than a flat `/name` prompt-template expansion. They live in `.pi/skills/`
(project-discoverable in this repo) rather than `.agents/skills/` so they are Pi-native and travel
with the repo without extra settings wiring.
