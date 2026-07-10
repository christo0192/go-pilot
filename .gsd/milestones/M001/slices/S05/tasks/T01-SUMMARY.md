---
task: S05/T01
title: Pi workflow skills (brainstorm→…→auto) + Phase-0 alignment gate (Steps 5.1+5.2)
status: complete
duration: ~12min (+ Pi install)
files_changed: [.pi/skills/phase-0-align/SKILL.md, .pi/skills/brainstorm/SKILL.md, .pi/skills/explore/SKILL.md, .pi/skills/plan/SKILL.md, .pi/skills/execute/SKILL.md, .pi/skills/auto/SKILL.md, .pi/skills/README.md]
verification: pi_rpc_get_commands_lists_6, model_smoke_phase0_behaves
---
Installed Pi 0.80.6 (npm -g, user prefix, no sudo). Authored 6 project-discoverable Pi skills under
`.pi/skills/` (SKILL.md dir format per docs/skills.md, name+description frontmatter): phase-0-align (the 5.2
alignment gate — records goal/constraints/success/scope to a runtime artifact and hard-blocks plan/auto until
aligned), brainstorm, explore, plan, execute, and auto (chains the others by /skill: name, mirroring gsd-auto).

VERIFIED: `printf '{"type":"get_commands"}' | pi --mode rpc -a --no-session` lists all 6 as source=skill,
project scope (independently re-confirmed). Model smoke via `--provider openai --model gpt-4o-mini` (nano had an
"encrypted content" provider quirk) confirmed phase-0-align expands and asks the 4 alignment questions before
planning. Skills chosen over prompt-templates (chainable + model-invocable). Serves the Pi-orchestrated profile;
pure-anthropic keeps the existing Claude/GSD skills — same workflow either way (D5). node --test unaffected (135).
