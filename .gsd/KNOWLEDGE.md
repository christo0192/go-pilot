# Knowledge & Lessons (append-only)

## 2026-07-08 — Environment (WSL2 Ubuntu 26.04)
- Installed: git 2.53.0, node v22.23.1, npm 10.9.8, python3 3.14.4, **claude 2.1.204 (Claude Code)**, **codex-cli 0.143.0**.
- NOT installed: wezterm, herdr, pi, rtk, docker. → pure-anthropic profile can start immediately (claude+codex present); hybrid needs docker + herdr + pi + litellm.
- No pip/ensurepip in system python3; no poppler. PDF text extraction worked via `npm i pdf-parse` (v2 API: `new PDFParse({data:buf}).getText()`). Useful for reading future PDF research docs.
- Builder is on Windows/WSL2; teammates on Mac. Cross-platform is a hard requirement.

## Open questions to resolve in Sprint 0
- Max concurrent `claude` sessions under ONE Claude Max login before rate-limit/session-file contention (T02). This is the make-or-break for pure-anthropic multi-pane. codex/GPT is separate ChatGPT quota (independent).
