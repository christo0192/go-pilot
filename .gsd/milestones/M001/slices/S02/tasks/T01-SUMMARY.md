---
task: S02/T01
title: LiteLLM gateway (Docker) + provider-agnostic routing config (Step 2.1)
status: complete (infra; live routing awaits a provider key)
duration: ~15min
files_changed: [deploy/docker-compose.yml, deploy/litellm.yaml, deploy/.env.example, .env.example, scripts/verify-litellm.mjs, config/router.json, docs/workhorse-plane.md]
verification: litellm_boots_health_200, 9_models_loaded, verify_0pass_9skip_0fail, node_test_145
---
LiteLLM workhorse gateway (ghcr.io/berriai/litellm:main-stable, amd64+arm64) added to deploy compose, independent
of mem0/postgres. `deploy/litellm.yaml` = 9 workhorse aliases (glm/glm-flash/kimi/kimi-lite/deepseek/deepseek-flash/
qwen/qwen-coder/minimax), each with a direct-vendor deployment + an OpenRouter deployment under the same model_name
(num_retries fails over to whichever key is set). ACTIVATE-BY-KEY design (D31): boots + serves health with 0 keys.
Filled config/router.json hybrid + open-first profiles with the category→model table from the research doc.
`scripts/verify-litellm.mjs` (zero-dep) pings /v1/models + a tiny completion per model → PASS/FAIL/SKIP.
VERIFIED: gateway up (health 200), 9 models loaded, verify = 0 PASS/9 SKIP(no key)/0 FAIL, node --test 145/145.
NEXT (needs ≥1 provider key, OpenRouter recommended): live model routing, then 2.2 Pi worker via LiteLLM in a
herdr pane, 2.3 tool-profiles, 2.4 tool-call repair Pi extension, 2.5 constrained decoding.
