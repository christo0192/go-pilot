# S05: Workflow Skills + Generalization

Pi installed this session (`npm i -g @earendil-works/pi-coding-agent@0.80.6`, user-writable npm prefix, no sudo).

## Tasks
- [x] **T01: Pi workflow skills + Phase-0 gate (Steps 5.1 + 5.2)** ✅ 2026-07-10
  `.pi/skills/{phase-0-align,brainstorm,explore,plan,execute,auto}/SKILL.md` — project-discoverable Pi skills
  mirroring Go-pilot's muscle-memory. `auto` chains the others by `/skill:` name. Phase-0 gate (5.2) records a
  user↔orchestrator alignment artifact and hard-blocks `plan`/`auto` until aligned. Verified: Pi RPC
  `get_commands` lists all 6 (source=skill, project scope); model smoke (gpt-4o-mini) confirmed phase-0-align
  expands + asks the 4 alignment questions before planning. SKILL.md format per Pi docs/skills.md (name+description
  frontmatter). Skills chosen over prompt-templates (richer, model-invocable, chainable).

## Notes
- Sprint 5 = 5.1 + 5.2 only; both done → Sprint 5 100%.
- These serve the Pi-orchestrated profile (hybrid/open-first); pure-anthropic uses the existing Claude/GSD skills.
  The set makes the rig's workflow identical regardless of which orchestrator is switched in (D5).
