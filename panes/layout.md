# Herdr Pane / Workspace Layout (S01)

> Stub — finalized in Sprint 1 (Step 1.1) once Herdr is installed and the socket API is wired.

## pure-anthropic profile (target layout)

```
workspace:1  orchestrator   → claude  (Opus)      # plans, delegates, owns merge-back
workspace:2  worker-A       → claude  (Sonnet)    # bulk execution
workspace:3  worker-B       → claude  (Sonnet)    # parallel bulk
workspace:4  high-volume    → claude  (Haiku)     # extraction / cheap grunt
workspace:5  lateral        → codex   (GPT)       # coding expertise, exception-routing only
```

Concurrency of workspaces 1–4 is bounded by the T02 concurrency finding.

## hybrid profile
Replace worker/high-volume panes with Pi workers pointed at LiteLLM (DeepSeek/Kimi/GLM/MiniMax).

## Socket wiring (to define in S01)
- create workspace, split pane, read-screen, send — verified via herdr Unix socket API.
- orchestrator spawns/monitors/steers workers; claude-presence guards concurrent writes.
