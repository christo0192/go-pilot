# LLM Workflow Model Recommendations

Prepared for: IK AI Systems Review  
Date: 2026-07-06  
Source BRD reviewed: `BRD-Local-API-LLM-Offloading.docx`

## Executive Recommendation

Do not build a pure local framework for Sonnet-class work unless data residency forces it. The BRD's existing conclusion is directionally correct: the best cost-performance design is a routed API layer, with Claude Max kept for final judgment, high-stakes review, and tasks where frontier reliability matters.

Recommended production stack:

1. **Router:** LiteLLM or OpenRouter-compatible gateway.
2. **Core Sonnet-minimum lane:** GLM 5.2, Kimi K2.6, Gemini 3.1/3.5, Qwen3-Coder for coding-heavy workflows, and DeepSeek V3.2 for reasoning-heavy batch workflows after validation.
3. **Frontier ceiling reference lane:** Claude Fable 5, Claude Opus 4.8, and GPT-5.5 are not replacement targets for cheap offload; they define the upper benchmark band when "best possible quality" matters.
4. **Cheap high-volume lane:** DeepSeek V4 Flash, Qwen3-235B Instruct on DeepInfra, GLM 4.7 Flash, Qwen3-32B, Gemma 4/3, Nemotron Super. These are not Sonnet-equivalent recommendations; they are bulk preprocessing, routing, extraction, and draft-generation models.
5. **Research lane:** Perplexity Sonar or Gemini with Google Search grounding, then synthesis by GLM/Kimi/Gemini.
6. **Hallucination control:** evidence-first extraction, citations to row/page/source, schema validation, separate verifier model, and human approval before client-facing output.

Important qualification: no model can be made truly "hallucination proof." The right requirement is "evidence constrained and auditable." That means every generated claim must trace back to a transcript row, document page, URL, or code reference, and unsupported claims must be rejected by a verifier step.

## Benchmark Scope

The core recommendation is **not** "find any cheap model." The benchmark band is:

- **Minimum acceptable quality for core workflows:** Claude Sonnet 4.6 / Claude Sonnet 5 equivalent. A model that only reaches Haiku-level quality should not be used as the main model for creativity, deep research synthesis, document analysis, PR implementation, or heavy coding.
- **Upper benchmark / best-quality ceiling:** Claude Fable 5, Claude Opus 4.8, and GPT-5.5. These are the comparison points for "regardless of cost" recommendations.
- **Cheap pipeline tier:** Haiku-level or below-Sonnet models are still useful, but only for high-volume preprocessing: extraction, classification, routing, chunk summaries, source collection, rough ideation, and verifier passes.

Model tier interpretation used in this document:

| Tier | Role | Models in scope | Production use |
|---|---|---|---|
| Frontier ceiling | Best-quality reference, not necessarily cost target | Claude Fable 5, Claude Opus 4.8, GPT-5.5 | Final high-stakes reasoning, creative polish, hard architecture calls |
| Sonnet-equivalent target | Minimum bar for main workflow recommendations | GLM 5.2, Kimi K2.6, Gemini 3.1 Pro / 3.5 Flash for grounded research, Qwen3-Coder for coding, DeepSeek V3.2 after workflow validation | Main model for the five requested workflows |
| Near-Sonnet / efficient | Useful where quality is good enough but needs spot checks | Kimi K2 0905, GLM 4.7, GLM 4.5 Air | First drafts, non-final synthesis, coding plans |
| Haiku-level bulk | Cheap support lane, not the core benchmark | DeepSeek V4 Flash, Qwen3-235B Instruct, GLM 4.7 Flash, Qwen3-32B, Gemma, Nemotron | Extraction, classification, routing, rough summaries, low-risk batch jobs |

## Provider Fee Notes

OpenRouter currently states:

- Pay-as-you-go platform fee: **5.5%**
- It says it does **not mark up provider pricing**; model catalog prices are the model/provider rates.
- BYOK has monthly no-fee list-price inference allowance, then a **5% fee** after the allowance.
- Failed fallback attempts are not billed; only successful runs are billed.

Use this formula for OpenRouter pay-as-you-go:

`effective price = catalog model price * 1.055`

Direct provider APIs such as DeepInfra, Google Gemini API, Perplexity, Moonshot, Z.ai, DeepSeek, Alibaba/Qwen, Fireworks, Together, and Novita can avoid the OpenRouter platform fee, but they may have weaker routing, fewer fallback controls, or different data retention/default logging terms.

## Current Reference Pricing

All prices are USD per 1M tokens unless noted. OpenRouter effective rates include the 5.5% pay-as-you-go platform fee.

| Model | Provider path | Base input/output | OpenRouter effective input/output | Context | Best fit |
|---|---:|---:|---:|---:|---|
| GLM 5.2 | OpenRouter / Z.ai | $0.686 / $2.156 on OpenRouter | $0.724 / $2.275 | 1M | Strongest general alternative for long reasoning, coding, agents |
| Kimi K2.6 | OpenRouter / Moonshot | $0.66 / $3.41 | $0.696 / $3.598 | 262K | Creative, coding, long-horizon generation, agent orchestration |
| Kimi K2 0905 | OpenRouter / Moonshot | $0.60 / $2.50 | $0.633 / $2.638 | 262K | Cheaper Kimi option; strong coding/writing |
| GLM 4.7 | OpenRouter / Z.ai | $0.40 / $1.75 | $0.422 / $1.846 | 203K | Balanced reasoning/coding/writing |
| GLM 4.7 Flash | OpenRouter / Z.ai | $0.06 / $0.40 | $0.063 / $0.422 | 203K | Haiku-level cheap routing, planning, extraction |
| GLM 4.5 Air | OpenRouter / Z.ai | $0.13 / $0.85 | $0.137 / $0.897 | 131K | Low-cost reasoning/doc summarization |
| DeepSeek V3.2 | OpenRouter / DeepInfra / DeepSeek | $0.2288 / $0.3432 on OpenRouter; $0.26 / $0.38 on DeepInfra | $0.241 / $0.362 | 131K-160K | Reasoning, math, tool-use, cheap batch analysis |
| DeepSeek V4 Flash | OpenRouter / DeepInfra | $0.09 / $0.18 | $0.095 / $0.190 | 1M | Very cheap high-volume workflows |
| Qwen3-Coder 480B-A35B | OpenRouter / DeepInfra / Alibaba | $0.22 / $1.80 on OpenRouter; $0.30 / $1.00 on DeepInfra | $0.232 / $1.899 | 256K-1M | Repo-scale coding, PRs, tool calls |
| Qwen3-235B-A22B Instruct | DeepInfra preferred | $0.09 / $0.10 on DeepInfra | OpenRouter page shows higher pricing | 131K-256K | Cheap high-volume instruction following |
| Gemini 3.1 Pro Preview | Google direct / DeepInfra | $2.00 / $12.00 direct for <=200K | N/A | ~1M | Research, long docs, multimodal, grounded search |
| Gemini 3.5 Flash | Google direct / DeepInfra | $1.50 / $9.00 direct | N/A | ~1M | Fast grounded research, general work |
| Gemini 3.1 Flash-Lite | Google direct | $0.25 / $1.50 direct | N/A | ~1M | High-volume cheap multimodal/general tasks |
| Perplexity Sonar | Perplexity direct | $1 / $1 + request fee | N/A | Search product | Web research with citations |
| Perplexity Sonar Deep Research | Perplexity direct | $2 / $8 + citation/reasoning/search fees | N/A | Search product | Deep web research |

Reference OpenAI/Anthropic prices:

| Reference model | Input/output | Notes |
|---|---:|---|
| Claude Fable 5 | $10 / $50 | Top Anthropic creative/frontier tier |
| Claude Opus 4.8 / 4.7 / 4.6 | $5 / $25 | Strong frontier reasoning/coding |
| Claude Sonnet 5 | $2 / $10 through 2026-08-31, then $3 / $15 | Current Sonnet tier |
| Claude Sonnet 4.6 | $3 / $15 | BRD quality anchor |
| Claude Haiku 4.5 | $1 / $5 | Fast/small Anthropic tier |
| GPT-5.5 | $5 / $30 standard short context | OpenAI flagship reference |
| GPT-5.4 | $2.50 / $15 standard short context | Sonnet-class OpenAI reference |
| GPT-5.4-mini | $0.75 / $4.50 | Haiku/Sonnet-lite reference |
| GPT-5.4-nano | $0.20 / $1.25 | Cheap high-volume OpenAI reference |
| GPT-5.3-Codex | $1.75 / $14 | Coding reference |

## Workflow 1: Creativity, Brainstorming, Webinar Decks, PPT Frameworks

### Best Capability Regardless Of Cost

**Primary:** Kimi K2.6  
**Why:** Strong creative generation, UI/deck/web-style output, long context, and agentic orchestration. It is a good fit for brainstorming, webinar narratives, slide outlines, landing-page copy, and first-draft presentation structures.

**Alternative premium:** GLM 5.2  
**Why:** Stronger general reasoning index and 1M context. Better when the creative work must be grounded in many input docs, transcripts, competitive material, or detailed brand constraints.

**Google alternative:** Gemini 3.1 Pro Preview or Gemini 3.5 Flash  
**Why:** Useful when creativity includes multimodal assets, web-grounded research, document/image inputs, or Google Search grounding.

**Equivalent OpenAI/Anthropic comparison:**  
Kimi K2.6 and GLM 5.2 are closest to Claude Sonnet/Fable-style first-draft creative work, but not reliably above Claude Fable 5 or Opus/Fable for final polish. Against OpenAI, they sit around GPT-5.4/GPT-5.5 creative utility depending on prompt and task, with much lower token cost.

### Cheaper Efficient Choice

**Primary:** GLM 4.7 or Kimi K2 0905  
**Why:** Enough quality for ideation, outlines, webinar structures, slide storyboards, and draft copy at materially lower price than Claude Sonnet 4.6.

**High-volume cheap lane:** GLM 4.7 Flash or Qwen3-235B Instruct  
**Why:** Good for generating 20 alternate titles, campaign angles, topic clusters, slide skeletons, and rough first drafts before a stronger model rewrites.

### Recommended Workflow

Use cheap model for idea breadth, premium model for synthesis:

1. GLM 4.7 Flash or Qwen3-235B generates 15-30 concepts.
2. Kimi K2.6 or GLM 5.2 ranks and merges the best ideas.
3. Claude Max or human reviewer finalizes client-facing slide language only when needed.

## Workflow 2: Deep Web Research, Scraping, Data Gathering

### Best Capability Regardless Of Cost

**Primary:** Perplexity Sonar Deep Research  
**Why:** It is built for search-first research, citations, multi-step web retrieval, and source-backed answers. It charges token costs plus search/citation/reasoning fees, so it is not the cheapest for every query, but it is the most directly aligned with "deep research in web and scrape/get data."

**Alternative premium:** Gemini 3.5 Flash or Gemini 3.1 Pro with Google Search grounding  
**Why:** Google Search grounding is a clean way to reduce stale answers and get current facts. Gemini is also useful when the workflow mixes web pages, PDFs, images, video, or long context.

**Synthesis model after retrieval:** GLM 5.2 or Kimi K2.6  
**Why:** Use retrieval/search tools to collect sources, then a strong reasoning/writing model to synthesize. Do not rely on the model's memory for current facts.

**Equivalent OpenAI/Anthropic comparison:**  
Perplexity Sonar Deep Research maps closest to OpenAI Deep Research or Claude with web/search tools. Gemini grounded search is a strong alternative to OpenAI/Anthropic web-enabled flows. GLM/Kimi are better as post-search synthesizers than as standalone search engines.

### Cheaper Efficient Choice

**Primary:** Perplexity Sonar, not Deep Research  
**Why:** Sonar is much cheaper than deep research for ordinary source-finding and gives citations. Use low/medium search context for most tasks.

**Alternative:** Own scraper/search tool + DeepSeek V4 Flash or Qwen3-235B Instruct  
**Why:** For high volume, pay for search separately using a search API or crawler, then summarize with a cheap model. This is usually cheaper than asking a premium web-research model to browse repeatedly.

### Recommended Workflow

1. Search layer: Perplexity Search API/Sonar, Google Search grounding, Brave/Tavily/SerpAPI, or internal crawler.
2. Extraction layer: cheap model extracts facts into JSON with URL/title/date/snippet.
3. Synthesis layer: GLM 5.2, Kimi K2.6, or Gemini Pro produces final report.
4. Verifier layer: a second model checks every claim has a source URL and quoted support.

## Workflow 3: Document Analysis, Transcript/Excel Analysis, Multi-Perspective Summaries, Next Actions

### Best Capability Regardless Of Cost

**Primary:** GLM 5.2  
**Why:** 1M context, strong reasoning ranking, and good long-horizon instruction following. Best fit when the Excel/transcript volume is large and the model must hold multiple perspectives at once.

**Alternative premium:** Gemini 3.1 Pro Preview  
**Why:** Strong long-context document analysis and useful when inputs include PDFs, spreadsheets, images, or mixed document types.

**Alternative:** Kimi K2.6  
**Why:** Good for document generation and multi-step writing when the goal is a polished analysis document or deck after extraction.

**Equivalent OpenAI/Anthropic comparison:**  
GLM 5.2 and Gemini Pro are closest to Claude Sonnet 5 / GPT-5.4 for long document reasoning. They are not a guaranteed substitute for Claude Opus/Fable on final judgment-heavy summaries. For pure transcript summarization and action extraction, they should beat Haiku-level models and cost less than Sonnet 4.6.

### Cheaper Efficient Choice

**Primary:** DeepSeek V3.2  
**Why:** Very low output price and strong reasoning/tool-use profile. Good for chunked transcript analysis, cause/effect extraction, meeting themes, and first-pass next actions.

**Alternative:** Qwen3-235B Instruct on DeepInfra  
**Why:** Extremely cheap for high-volume structured extraction and instruction following. Use it for first-pass row labeling, entity extraction, tagging, and categorization.

**Haiku-level fallback:** GLM 4.7 Flash or DeepSeek V4 Flash  
**Why:** Both are cheap enough for repeated passes over large Excel/transcript batches.

### Hallucination-Control Architecture

Use this for PA call transcripts and Excel analysis:

1. **Normalize input:** convert Excel rows/transcripts into stable row IDs and speaker/time IDs.
2. **Extract only:** first model pass extracts facts, quotes, objections, client signals, questions, and action items into JSON. No prose.
3. **Cite every claim:** each extracted item must include `source_row_id`, `speaker`, `timestamp`, or `document_page`.
4. **Generate perspectives:** second pass writes summaries from sales, customer success, operations, and risk perspectives using only extracted facts.
5. **Verifier model:** separate model rejects unsupported claims, invented numbers, missing row IDs, and action items not grounded in the transcript.
6. **Human review:** required before client-facing use.

Recommended model pair:

| Step | Cost-efficient model | Premium model |
|---|---|---|
| Extraction | Qwen3-235B Instruct, DeepSeek V4 Flash, GLM 4.7 Flash | GLM 5.2 |
| Perspective summaries | DeepSeek V3.2, GLM 4.7 | GLM 5.2, Kimi K2.6 |
| Verification | DeepSeek V3.2 or GLM 4.7 Flash | Gemini 3.1 Pro or GLM 5.2 |
| Final polish | Kimi K2.6 or GLM 5.2 | Claude Max only when needed |

## Workflow 4: Coding, PR Creation, Code Understanding, Architecture, Sprint Planning

### Best Capability Regardless Of Cost

**Primary:** GLM 5.2  
**Why:** Long-context, project-level software engineering and complex multi-step automation. Artificial Analysis places GLM 5.2 near current frontier models while costing far less than OpenAI/Anthropic frontier models.

**Alternative:** Qwen3-Coder 480B-A35B  
**Why:** Purpose-built for repo-scale coding, tool use, and long-context repository understanding. Qwen describes it as comparable to Claude Sonnet for agentic coding and repository-scale work.

**Alternative:** Kimi K2.6 or Kimi K2 0905  
**Why:** Strong coding, frontend generation, UI/UX, and agentic coding tasks. Kimi K2 0905 reports SWE-Bench Verified around 69.2 versus Claude Sonnet 4 at 72.7 in its comparison table.

**Equivalent OpenAI/Anthropic comparison:**  
GLM 5.2 and Qwen3-Coder should be compared to Claude Sonnet 4.6/5 and GPT-5.3-Codex/GPT-5.4 for architecture, planning, and PR drafting. They are not guaranteed to replace Claude Opus/Fable for ambiguous product judgment, but they are credible Sonnet-class engineering alternatives at lower token cost.

### Cheaper Efficient Choice

**Primary:** Qwen3-Coder through DeepInfra or OpenRouter  
**Why:** Best coding-specialized cost/performance option. Choose provider by output mix: DeepInfra has higher input but lower output than OpenRouter in the observed prices.

**Alternative:** GLM 4.7  
**Why:** Good general coding and planning at lower price than Kimi K2.6/GLM 5.2.

**Planning-only cheap lane:** GLM 4.7 Flash or DeepSeek V4 Flash  
**Why:** Good for ticket breakdowns, sprint task lists, PR descriptions, test plans, and changelog drafts.

### Recommended Workflow

1. Cheap model creates issue breakdown, acceptance criteria, and implementation plan.
2. Qwen3-Coder or GLM 5.2 reads repo context and prepares PR.
3. Separate verifier model reviews diff for missed requirements and tests.
4. Security/static tools run outside the LLM: Semgrep, CodeQL, dependency audit, secret scan.

## Workflow 5: Heavy Coding, Refactor, Build From Scratch, Cybersecurity Checks

### Best Capability Regardless Of Cost

**Primary:** GLM 5.2  
**Why:** Best non-OpenAI/non-Anthropic candidate for long-running engineering tasks, project-level implementation, and architecture-to-code workflows.

**Secondary:** Qwen3-Coder 480B-A35B  
**Why:** Best specialized open coding model for repo-scale implementation, tool use, and PR generation. Use it when the task is primarily code rather than business reasoning.

**Secondary:** Kimi K2.6  
**Why:** Strong for building new apps, frontend/UI generation, documents/websites/spreadsheets, and multi-agent project decomposition.

**Security-specific note:** do not rely on any LLM alone for cybersecurity. Use scanners and deterministic tools first, then use the LLM to triage/fix findings.

**Equivalent OpenAI/Anthropic comparison:**  
GLM 5.2 maps closest to Claude Sonnet 5 / GPT-5.5 high for agentic engineering, though Claude/Opus/Fable may still win on difficult ambiguous tasks. Qwen3-Coder maps closest to GPT-5.3-Codex and Claude Sonnet coding tiers. Kimi K2.6 maps closest to Sonnet-class coding plus stronger creative/frontend generation.

### Cheaper Efficient Choice

**Primary:** Qwen3-Coder for implementation + GLM 4.7 Flash for planning/review chores  
**Why:** Keeps the expensive coding model focused on actual code changes while cheap models handle tickets, docs, test matrix, summaries, and PR commentary.

**Alternative:** DeepSeek V3.2  
**Why:** Cheap reasoning and coding support. Better for algorithmic reasoning and batch code review than for large full-repo implementation.

**High-volume code review lane:** DeepSeek V4 Flash or GLM 4.7 Flash  
**Why:** Useful for first-pass smells, missing tests, simple refactor suggestions, and PR summary generation, with a stronger model doing final review.

### Recommended Workflow

1. Planning: GLM 4.7 Flash or DeepSeek V4 Flash.
2. Implementation: GLM 5.2 or Qwen3-Coder.
3. Refactor validation: run tests, typecheck, lint, Semgrep/CodeQL/dependency audit.
4. LLM security triage: GLM 5.2 or DeepSeek V3.2 explains scanner findings and proposes fixes.
5. Final PR review: GLM 5.2 or Claude Max for critical projects.

## Haiku-Level Cheap Models For Heavy-Volume Pipelines

These are candidates to replace Claude Haiku 4.5 for bulk non-final work. Claude Haiku 4.5 is $1 / $5, so all options below are materially cheaper.

| Model | Provider path | Price | Why consider it | Main caution |
|---|---:|---:|---|---|
| DeepSeek V4 Flash | DeepInfra/OpenRouter | $0.09 / $0.18 | Very cheap, 1M context, strong enough for extraction, summaries, routing | Not final-polish quality |
| Qwen3-235B-A22B Instruct | DeepInfra | $0.09 / $0.10 | Excellent price for structured instruction following | Verify long reasoning quality on your data |
| GLM 4.7 Flash | OpenRouter/Z.ai | $0.06 / $0.40 | Strong 30B-class agentic/coding cheap lane | Output price higher than DeepSeek V4 Flash |
| GLM 4.5 Air | OpenRouter/Z.ai | $0.13 / $0.85 | Better reasoning than many small models; thinking mode | More expensive than Flash options |
| Qwen3-32B | DeepInfra | $0.08 / $0.28 | Cheap, simple to use, good local/API fallback | 40K context on DeepInfra listing |
| Gemma 4 31B Turbo | DeepInfra | $0.12 / $0.37 | Good general instruction following and summarization | Less proven for agentic coding |
| Nemotron 3 Super 120B-A12B | DeepInfra | $0.085 / $0.40 | Efficient reasoning/agent candidate | Validate factuality before production |
| Gemini 3.1 Flash-Lite | Google direct | $0.25 / $1.50 | Multimodal, Google ecosystem, generous context | More expensive than DeepSeek/Qwen for pure text |

Best default for high-volume pipelines:

- **Extraction/classification:** Qwen3-235B Instruct or DeepSeek V4 Flash.
- **Cheap reasoning:** DeepSeek V3.2.
- **Cheap planning/coding support:** GLM 4.7 Flash.
- **Multimodal/high-context cheap work:** Gemini 3.1 Flash-Lite.

## Suggested Routing Policy

| Task type | First model | Escalate to | Final polish |
|---|---|---|---|
| Brainstorming variants | GLM 4.7 Flash | Kimi K2.6 | Claude Max only for client-final |
| Webinar/deck outline | GLM 4.7 or Kimi K2 0905 | Kimi K2.6 / GLM 5.2 | Claude Max optional |
| Web research | Perplexity Sonar / search API | Sonar Deep Research / Gemini grounded | GLM 5.2 or Kimi K2.6 |
| Transcript extraction | Qwen3-235B / DeepSeek V4 Flash | DeepSeek V3.2 | GLM 5.2 |
| Transcript final summary | DeepSeek V3.2 | GLM 5.2 / Gemini Pro | Claude Max if high-stakes |
| Sprint planning | GLM 4.7 Flash | Qwen3-Coder / GLM 5.2 | Human review |
| PR implementation | Qwen3-Coder | GLM 5.2 | Claude Max for critical review |
| Heavy refactor | Qwen3-Coder / GLM 5.2 | Claude Max if stuck | Tests + scanner required |
| Security triage | DeepSeek V3.2 | GLM 5.2 | Human/security review |

## Provider Recommendations

### Lowest Friction

**OpenRouter**

Use when you want one API key, provider fallback, routing, easy model switching, and logging/spend controls. Accept the 5.5% pay-as-you-go fee as an operational convenience cost.

### Lowest Token Cost

**DeepInfra**

Use for DeepSeek, Qwen, Gemma, Llama, Nemotron, and some Gemini/Claude routes. It has no long-term contracts/upfront costs in its pricing page and often has very low rates for high-volume text models.

### Best Web Research Product

**Perplexity**

Use Sonar for source-backed answers and Sonar Deep Research for multi-step research. Expect request/search/citation/reasoning fees in addition to token costs.

### Best Grounded Search + Multimodal

**Google Gemini API**

Use Gemini 3.5 Flash or 3.1 Pro with Google Search grounding for current web research, document/image/video inputs, and long context. Google includes 5,000 search-grounding prompts/requests per month shared across Gemini 3 before charging search fees, according to the pricing page.

### Model-Vendor Direct

Use Moonshot/Z.ai/DeepSeek/Alibaba direct APIs when procurement, data policy, or pricing is better than aggregators. Validate reliability and support before making them production-critical.

## Pilot Plan

Run a 30-day pilot with five lanes:

1. **Creative lane:** Kimi K2.6 plus GLM 4.7 Flash.
2. **Research lane:** Perplexity Sonar + GLM 5.2 synthesis.
3. **Document analysis lane:** Qwen3-235B extraction + GLM 5.2 summary + DeepSeek V3.2 verifier.
4. **Coding planning lane:** GLM 4.7 Flash + Qwen3-Coder.
5. **Heavy coding lane:** Qwen3-Coder primary, GLM 5.2 escalation.

Success criteria:

- 30-50% reduction in Claude Max usage for background/batch tasks.
- No unsupported claims in transcript summaries after verifier pass.
- No dropped Excel rows in chunked workflows.
- Coding PRs must pass tests/lint/security scans before review.
- Monthly non-Claude API spend stays under the approved budget.

## Final Recommendation By Use Case

| Use case | Frontier ceiling comparison | Sonnet-minimum non-OpenAI/non-Anthropic recommendation | Cheaper support model, not Sonnet-equivalent | Notes |
|---|---|---|---|---|
| Creativity / decks / webinar frameworks | Claude Fable 5, Claude Opus 4.8, GPT-5.5 | Kimi K2.6 or GLM 5.2 | GLM 4.7 / Kimi K2 0905 / GLM 4.7 Flash | Kimi is strongest for creative generation; GLM 5.2 for long-context grounded creative work |
| Deep web research | GPT-5.5 / Claude Fable-style deep research agent with tools | Perplexity Sonar Deep Research, Gemini grounded search, then GLM 5.2/Kimi K2.6 synthesis | Perplexity Sonar + cheap summarizer | Separate search/retrieval from synthesis |
| Document/transcript/Excel analysis | Claude Opus 4.8, GPT-5.5, Claude Fable 5 for final high-stakes judgment | GLM 5.2 or Gemini 3.1 Pro; DeepSeek V3.2 only after workflow validation | Qwen3-235B / DeepSeek V4 Flash for extraction | Use verifier and citations; not model-only |
| Coding planning / PR creation | Claude Opus 4.8, GPT-5.5, GPT-5.3-Codex | GLM 5.2 or Qwen3-Coder | GLM 4.7 / GLM 4.7 Flash for planning and PR text | Keep cheap model for PR text and sprint tasks |
| Heavy coding/refactor/security | Claude Opus 4.8, GPT-5.5, GPT-5.3-Codex, Claude Fable 5 | GLM 5.2 + Qwen3-Coder | DeepSeek V3.2 / GLM 4.7 Flash for review chores | Always pair with tests and security scanners |
| Haiku-level high-volume pipelines | Not applicable; this is intentionally below the core benchmark | Not applicable | DeepSeek V4 Flash, Qwen3-235B, GLM 4.7 Flash | Best cost lane for extraction, tagging, routing, rough summaries |

## Sources Checked

- OpenRouter pricing and platform fee: https://openrouter.ai/pricing
- OpenRouter GLM 5.2 model page: https://openrouter.ai/z-ai/glm-5.2/api
- OpenRouter Kimi K2.6 model page: https://openrouter.ai/moonshotai/kimi-k2.6/api
- OpenRouter Kimi K2 0905 model page: https://openrouter.ai/moonshotai/kimi-k2-0905/api
- OpenRouter GLM 4.7 / GLM 4.7 Flash pages: https://openrouter.ai/z-ai/glm-4.7/api and https://openrouter.ai/z-ai/glm-4.7-flash/api
- OpenRouter DeepSeek V3.2 / V4 Flash pages: https://openrouter.ai/deepseek/deepseek-v3.2/api and https://openrouter.ai/deepseek/deepseek-v4-flash/api
- OpenRouter Qwen3-Coder page: https://openrouter.ai/qwen/qwen3-coder/api
- DeepInfra pricing: https://deepinfra.com/pricing
- Anthropic Claude pricing: https://platform.claude.com/docs/en/about-claude/pricing
- OpenAI API pricing: https://developers.openai.com/api/docs/pricing
- Google Gemini pricing: https://ai.google.dev/gemini-api/docs/pricing
- Perplexity pricing: https://docs.perplexity.ai/docs/getting-started/pricing
- Artificial Analysis leaderboard: https://artificialanalysis.ai/leaderboards/models
- GLM official GitHub/model notes: https://github.com/zai-org/GLM-4.5
- Kimi K2 0905 Hugging Face model card: https://huggingface.co/moonshotai/Kimi-K2-Instruct-0905
- Qwen3-Coder Hugging Face model card: https://huggingface.co/Qwen/Qwen3-Coder-480B-A35B-Instruct
- DeepSeek V3.2 Hugging Face model card: https://huggingface.co/deepseek-ai/DeepSeek-V3.2
