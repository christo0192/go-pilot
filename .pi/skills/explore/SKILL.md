---
name: explore
description: Scout and understand the codebase or system before building. Use when the user says "explore", "understand", "how does X work", "where is Y", "map the system", or before planning a change to unfamiliar code. Returns structured findings (key files, entry points, patterns, risks) and makes NO changes.
---

# Explore

Investigate before building. Mirrors Go-pilot's phase-4 scout. Read-only: never edits or mutates.

## When to use

Before planning or executing any change to code you do not already fully understand. Also to answer
open-ended "how/where/what" questions about the system.

## Procedure

1. **State the question** precisely: what must be true/known before you can plan safely?

2. **Search broad, then narrow.** Start with structure (dir listing, entry points, config), then grep
   for the specific symbols/strings. Use multiple naming conventions if the first misses. Prefer
   many cheap targeted reads over reading whole large files.

3. **Trace the real path** — follow the actual call/data flow for the feature in question, not just
   where names appear. Note where it enters, where it persists, where it exits.

4. **Report structured findings** (this is a boomerang summary — compress, don't dump):
   - **Key files** — absolute paths + one line each on their role.
   - **Entry points / seams** — where a change would hook in.
   - **Existing patterns/conventions** to follow (so new work matches).
   - **Risks / unknowns** — anything that could invalidate a plan.
   - **Answer** — the direct answer to the framing question.

## Rules

- **Reference > Compressed > Full** (#1): report file paths + short excerpts, not pasted full files.
  Load-bearing exact text only.
- Read-only. No edits, installs, or mutating commands.
- Distinguish *observed* (you read it) from *inferred* (you are guessing). Never smooth over gaps.
- Absolute paths in findings so the next stage can act without re-searching.

## Chains to

`/skill:plan` (findings become the plan's factual basis). Loops with `/skill:brainstorm` when
exploration reveals the chosen approach won't fit.
