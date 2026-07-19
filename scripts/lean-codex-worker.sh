#!/usr/bin/env bash
# Lean Go-pilot codex (GPT) worker — headless, JSONL output, lean config.
# Codex's system-prompt overhead is already light (~12.5k tok vs Claude's ~44k), but
# --ignore-user-config keeps it lean + reproducible. Flat-rate ChatGPT quota (separate
# from Claude Max).
#
# Usage:  scripts/lean-codex-worker.sh "PROMPT" [model]
#   emits codex JSONL events; final answer is the last item.completed agent_message.
set -euo pipefail
PROMPT="${1:?prompt required}"; MODEL="${2:-}"
ARGS=(exec --json --skip-git-repo-check --sandbox read-only --ignore-user-config)
[ -n "$MODEL" ] && ARGS+=(-m "$MODEL")
# `--` ends option parsing: a prompt that starts with `-` (e.g. an attacker-
# crafted task saying "--sandbox danger-full-access") is treated as the
# positional prompt, NOT as flags that could widen the read-only sandbox.
exec codex "${ARGS[@]}" -- "$PROMPT" </dev/null
