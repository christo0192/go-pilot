# Security Policy

## Reporting

Open a GitHub issue titled `[security]` (no exploit details), or contact the maintainer
directly; you'll get a response within a few days. Do not post secrets or working
exploits publicly.

## Design posture

- **Zero runtime dependencies by design (D20).** The harness is plain Node ESM using
  `node:*` builtins + `fetch` only — no npm supply chain to audit or compromise.
  `package.json` has no `dependencies`; CI fails if one appears.
- **Secrets never in git.** All keys live in gitignored `deploy/.env` (template:
  `deploy/.env.example`). Scripts read keys at runtime and never print them; a unit
  test greps scripts for accidental key echoes. CI runs a full-history gitleaks scan.
- **Subscription credentials are never proxied.** Claude/Codex run via their official
  CLIs with native login; API keys only ever go to the user's own gateway.
- **Workhorse workers are least-privilege by policy.** Repo-editing subtasks should run
  in sandboxed git worktrees (`pi-delegate --sandbox`) and merge only after diff review
  by the orchestrator. Untrusted document content delegated to workers is fenced as
  evidence with an ignore-embedded-instructions contract.
- **Local services bind to localhost.** Mem0/LiteLLM dev compose is loopback-only;
  the prod compose profile forces auth and refuses to start without secrets.

## Known accepted risks (single-operator posture)

- Worker agents run with tool access on the delegating repo (Pi `-a`); container-grade
  isolation is deliberately out of scope pre-v1.x.
- The hosted workhorse gateway URL is public; access is gated by per-user keys. Keep
  per-key budgets/rate limits enabled on the gateway.

## Key hygiene

- `deploy/.env` is created `chmod 600` by the installer.
- Rotate any key that ever appears in a chat log, screenshot, or terminal recording.
