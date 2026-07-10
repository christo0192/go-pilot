# Workhorse plane — LiteLLM gateway

The **workhorse plane** runs background/bulk work on cheap open models so worker
panes carry **zero Claude Code overhead**. Pi workers speak the OpenAI protocol
to a single gateway; the gateway fans out to Kimi / GLM / DeepSeek / Qwen /
MiniMax.

- **Gateway:** [LiteLLM](https://docs.litellm.ai) — OpenAI-compatible proxy at
  `http://localhost:4000` (`LITELLM_BASE_URL`), image
  `ghcr.io/berriai/litellm:main-stable`.
- **Config:** [`deploy/litellm.yaml`](../deploy/litellm.yaml) — the `model_list`
  + settings, heavily commented.
- **Service:** the `litellm` service in
  [`deploy/docker-compose.yml`](../deploy/docker-compose.yml), independent of the
  mem0/postgres stack.

## Activate-by-key design (D31)

One config serves every user (`pure-anthropic` / `hybrid` / `open-first`). A
model is usable **only if its provider key is present** in `deploy/.env`; a blank
key just leaves that model inactive — nothing to comment out. With **no** keys
the proxy still boots and serves health (0 working models is fine).

- **OpenRouter is universal:** the single `OPENROUTER_API_KEY` reaches every
  model. This is the easiest `open-first` path.
- **Direct vendor keys are optional overrides:** `MOONSHOT_API_KEY` (Kimi),
  `ZAI_API_KEY` (GLM), `DEEPSEEK_API_KEY`, `MINIMAX_API_KEY`. When a role has both
  a direct and an OpenRouter deployment (same `model_name`), LiteLLM prefers the
  direct route and fails over to OpenRouter via `num_retries` — so whichever key
  you set wins, with no config edits.

## Model aliases → router categories

`config/router.json` routes work-type → `{plane, model}`. The `workhorse`-plane
aliases (below) are encoded from
[`research docs/LLM-Workflow-Model-Recommendations.md`](../research%20docs/LLM-Workflow-Model-Recommendations.md):

| Alias | Model | Used for (open-first / hybrid categories) |
|---|---|---|
| `glm` | GLM 5.2 | orchestrate, analyze |
| `glm-flash` | GLM 4.7 Flash | plan, classify |
| `kimi` | Kimi K2.6 | draft, lateral |
| `kimi-lite` | Kimi K2 0905 | cheaper Kimi (drafts, coding plans) |
| `deepseek` | DeepSeek V3.2 | summarize, code-review |
| `deepseek-flash` | DeepSeek V4 Flash | very cheap high-volume extract |
| `qwen-coder` | Qwen3-Coder 480B | code |
| `qwen` | Qwen3-235B Instruct | extract |
| `minimax` | MiniMax | long-context general/creative |

`hybrid` keeps high-stakes categories (orchestrate, plan, code-review, lateral)
on the **frontier** plane and offloads the rest to the workhorse; `open-first`
runs everything on the workhorse.

## Add / remove a provider

Edit `deploy/litellm.yaml`: append a `- model_name: <role>` block with
`litellm_params` (`model: <provider>/<id>`, `api_key: os.environ/VARNAME`), or
delete a block. Add the key slot to `deploy/.env(.example)` and pass it through in
the `litellm` service `environment:`. The clean `model_name` aliases are the
stable contract `config/router.json` calls.

## Run

```bash
cd deploy && docker compose up -d litellm      # boots even with no provider keys
```

## Verify

```bash
node scripts/verify-litellm.mjs
```

Lists what LiteLLM loaded and probes each model with a tiny "say OK" completion,
printing PASS / FAIL / SKIP(no key). With no provider keys it reports 0 working
models and exits 0 — proving gateway + verifier work; live routing awaits a key.
Set `OPENROUTER_API_KEY` in `deploy/.env` and re-run to see PASS rows.
