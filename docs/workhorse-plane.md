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

## Per-worker tool subsets (Step 2.3)

The router picks *which model* runs a task; **tool profiles** pick *which tools
that worker may use*. Instead of every worker booting with all of Pi's tools, each
work-category gets a MINIMAL, correct allowlist (least privilege) — an extraction
worker gets read-only search; a coding worker gets the full mutate+shell set.

- **Config:** [`config/tool-profiles.json`](../config/tool-profiles.json) — one
  entry per router category → an allowlist of Pi tool names, plus a `default`.
  JSON (not the YAML the plan named) keeps us zero-dep and consistent with
  `config/router.json` — no parser needed.
- **Helper:** [`src/router/tool-profiles.mjs`](../src/router/tool-profiles.mjs) —
  `loadToolProfiles(path?)` reads the JSON; `piToolArgs(category, {profiles})`
  returns the Pi CLI flags for that category. Deterministic; an unknown category
  falls back to the read-only `default`.

Pi exposes exactly **7 built-in tools** (from the pi-coding-agent source,
`createAllTools`) — note file-finding is `find`, there is **no `glob`**:

| Tool | Does | Pi group |
|---|---|---|
| `read` | read a file | read-only, coding, all |
| `grep` | search file contents (ripgrep) | read-only, all |
| `find` | find files by name/glob | read-only, all |
| `ls` | list a directory | read-only, all |
| `edit` | in-place edit an existing file | coding, all |
| `write` | create / overwrite a file | coding, all |
| `bash` | run a shell command | coding, all |

Pi accepts an allowlist via `--tools/-t <csv>` (or `--no-tools/-nt` for none), so
`piToolArgs('extract')` → `["--tools","read,grep,find"]` and
`piToolArgs('code')` → `["--tools","read,edit,write,bash,grep,find"]`.

Category → tool subset (rationale in the JSON):

| Category | Tools | Why |
|---|---|---|
| orchestrate | read, write, grep, find | delegates; updates state/task files, no code edits/shell |
| plan | read, grep, find | plan is its returned output, not a file it writes |
| code | read, edit, write, bash, grep, find | full implementer set |
| analyze | read, bash, grep, find | may run read-only commands; produces findings, not edits |
| draft | read, write, grep, find | authors new content (write), no shell/edit |
| extract | read, grep, find | read-only; data returned, not written |
| classify | read, grep | most minimal — read + signal search |
| summarize | read, grep | read the content, return a summary |
| code-review | read, bash, grep, find | reads + runs tests/linters, must NOT mutate the code |
| lateral | read, grep, find | read-only ideation |
| *(unknown)* | read, grep, find, ls (`default`) | safe read-only least-privilege fallback |

**How a worker gets its set:** a dispatcher routes the task to `{plane, model}`
(`route()`), then calls `piToolArgs(task.category, {profiles})` and splices those
flags into the `pi` invocation for that worker's pane. Model choice and tool
choice are independent knobs keyed off the same category.

> **Live verification is deferred to Step 2.2.** Pi has no headless RPC that lists
> a session's *active built-in tools* (`get_commands` only lists extension/prompt/
> skill commands), and confirming exposure requires a real turn — which needs a
> model API key. With no key present, `pi -p` exits at model init before any tool
> setup. Once a key exists (2.2), a one-shot prompt + `tool_execution_*` events
> confirm a worker started with `piToolArgs('extract')` can only read.

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

## Tool-call reliability layer (Step 2.4)

Weak open models are cheap but emit malformed tool calls (missing required
fields, wrong types, hallucinated arguments). The reliability layer catches
every bad call, feeds the model the **exact** error, and re-prompts it — bounded
retries — so the workhorse plane's tool calls become trustworthy without paying
for a frontier model.

### Core logic — `src/toolcall/repair.mjs` (zero-dep, `node --test`)

Plain ESM, no dependencies, fully unit-tested (`src/toolcall/repair.test.mjs`).
Three exports:

- **`validateToolCall(call, schema)` → `{ ok, errors }`** — `call = { name,
  arguments }`; `schema = { required?, properties?: { field: { type } },
  additionalProperties? }`. A small dependency-free validator: required-field
  presence, primitive type checks (`string` / `number` / `boolean` / `object` /
  `array`, distinguishing array-vs-object and rejecting `NaN`), and unknown-field
  flagging when `additionalProperties: false`. Errors are precise,
  human-readable strings — they get fed back to the model verbatim, e.g.
  `Missing required field "query".` / `Field "limit" must be of type number, got
  string.`
- **`buildRepairPrompt(call, errors)` → string** — a concise correction message
  naming the tool and every specific error, instructing the model to re-emit the
  call correctly.
- **`runRepairLoop({ call, schema, reCall, maxRetries=2 })`** — validates; if ok
  returns `{ ok:true, call, attempts }`; else calls the **injected** async
  `reCall(repairPrompt)` up to `maxRetries` times, re-validating each returned
  call, and returns `{ ok:false, call, attempts, errors }` if still invalid.
  `reCall` is injected so the loop is testable with a fake — **no model needed**
  (that is exactly how the unit tests exercise it).

### Pi wrapper — `.pi/extensions/tool-call-repair.ts`

A project-local Pi extension that hooks the **`tool_call`** lifecycle event
(fires before a tool executes and can block). It **imports the tested `.mjs`
core directly** — Pi loads extensions via jiti, which resolves the relative
`../../src/toolcall/repair.mjs` import cleanly (verified headlessly), so there is
no duplicated validator. Flow per call:

1. Look up a schema for `event.toolName` in `config/toolcall-schemas.json`
   (absent → the extension no-ops on that tool).
2. `validateToolCall(event.input, schema)`. Valid → let it execute (and reset the
   tool's retry budget).
3. Invalid → `return { block: true, reason: buildRepairPrompt(...) }`. Pi feeds
   the `reason` back to the model as the tool result, which re-prompts it — **Pi's
   own turn loop is the re-prompt mechanism**. After `maxRetries` (2) consecutive
   invalid attempts for a tool it fails **open** (lets the call through with a
   warning) so the agent is never wedged.

`runRepairLoop` is the standalone/testable form of this same bounded loop with an
explicit injected `reCall`; the extension relies on Pi's implicit re-prompt
instead. `config/toolcall-schemas.json` maps tool name → schema (keys starting
with `_` are documentation, ignored by the loader). The `/toolcall-schemas`
command lists which tools have an enforced schema.

**Headless load check (passed):**

```bash
printf '%s\n' '{"id":"1","type":"get_commands"}' | pi --mode rpc -a --no-session --offline
```

Pi discovers the project-local extension and returns its `toolcall-schemas`
command (`source: extension`) — proving the extension loaded and the `.mjs`
import resolved without error.

### Reliability measurement — DEFERRED (pending a provider key)

The before/after **tool-call-success-rate** measurement on a real flaky open
model requires a live provider — LiteLLM has **no key yet**. That measurement is
deliberately deferred (no numbers are fabricated). It completes once
`OPENROUTER_API_KEY` is set in `deploy/.env`: point a Pi workhorse pane at the
LiteLLM gateway, run a fixed tool-calling task set with the extension disabled vs
enabled, and compare valid-first-call and eventual-success rates.
