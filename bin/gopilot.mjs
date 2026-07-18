#!/usr/bin/env node
// gopilot — the supported entrypoint into the run coordinator (PLAN Step 8.1).
//
//   gopilot run [--profile <p>] [--dry-run] [--category <c>] [--json] "<task prompt>"
//
// The coordinator (src/coordinator/run.mjs) is the ONLY enforced run path; this
// CLI is a thin front-end over `runTask`. Its primary value today is DRY-RUN:
// print the governed plan (route / model / tools / context tier / sign-off)
// without invoking any model. A live (non-dry) run needs a real dispatcher
// (workhorse / frontier — Step 8.8); until that lands, the CLI refuses a live
// run and points the user at --dry-run.

import { runTask } from "../src/coordinator/run.mjs";
import { validateConfig } from "../src/config/governance.mjs";
import { createProcessDispatcher } from "../src/dispatch/dispatch.mjs";
import { selectProfile } from "../src/config/profile.mjs";
import { classifyRisk } from "../src/router/risk.mjs";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const opts = { profile: undefined, dryRun: false, category: undefined, json: false, mode: undefined, cwd: process.cwd(), allowParallelCost: false };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    switch (a) {
      case "--profile":
      case "-p":
        opts.profile = argv[++i];
        break;
      case "--category":
      case "-c":
        opts.category = argv[++i];
        break;
      case "--dry-run":
      case "-n":
        opts.dryRun = true;
        break;
      case "--json":
        opts.json = true;
        break;
      case "--mode":
        opts.mode = argv[++i];
        break;
      case "--allow-parallel-cost":
        opts.allowParallelCost = true;
        break;
      case "--cwd":
        opts.cwd = resolve(argv[++i]);
        break;
      case "--context":
        opts.contextPath = resolve(argv[++i]);
        break;
      case "--schema":
        opts.schemaPath = resolve(argv[++i]);
        break;
      case "--help":
      case "-h":
        opts.help = true;
        break;
      default:
        if (a.startsWith("-")) throw new Error(`unknown option "${a}"`);
        rest.push(a);
    }
  }
  opts._ = rest;
  return opts;
}

const USAGE = `gopilot — governed run coordinator

Usage:
  gopilot run [options] "<task prompt>"
  gopilot config doctor            validate router.json + models.json (fail-closed)

Options:
  -p, --profile <name>   routing profile [default: CLI > GOPILOT_PROFILE > deploy/.env > config/runtime.json]
  -c, --category <cat>   task class (inferred when the classifier has a high-confidence match)
  -n, --dry-run          print the governed plan without invoking any model
      --mode <mode>       execution mode override
      --allow-parallel-cost  approve the extra spend of a parallel mode (e.g. candidate-race)
      --cwd <path>        repository working directory [default: current directory]
      --context <path>    source document/context file (required for evidence-grounded doc-QA)
      --schema <path>     JSON schema for extraction output validation
      --json             emit machine-readable JSON
  -h, --help             show this help

Notes:
  Live runs execute the resolved Claude, Codex, or Pi adapter. Use --dry-run to inspect
  routing, budgets, tools, retrieval, cache metadata, and validation policy first.`;

function renderPlan(res) {
  const p = res.plan;
  const lines = [
    `verdict:      ${res.verdict}`,
    `profile:      ${p.profile}`,
    `category:     ${p.category ?? "(none — judgment path)"}`,
    `route:        ${p.needsJudgment ? "LLM judgment (no deterministic rule)" : `${p.plane} / ${p.model}`}`,
    `tools:        ${p.tools.join(" ")}`,
    `context tier: ${p.contextTier}`,
    `sign-off:     ${p.signedOff ? "signed-off (multi-agent allowed)" : "NOT signed off"}`,
    `execution:    ${p.execution}${p.downgraded ? " (downgraded to safe single-agent default — D17)" : ""}`,
    `dispatched:   ${res.dispatched}`,
  ];
  if (p.fallback) lines.push(`fallback:     ${p.fallback.plane} / ${p.fallback.model}`);
  if (res.dispatched && res.result != null) {
    const result = typeof res.result === "string" ? res.result : (res.result.text ?? JSON.stringify(res.result, null, 2));
    lines.push("", "result:", result);
  }
  return lines.join("\n");
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  let opts;
  try { opts = parseArgs(argv.slice(1)); }
  catch (err) { process.stderr.write(`gopilot: ${err.message}\n`); process.exitCode = 1; return; }

  if (opts.help || command === "help" || command === "--help" || command === "-h" || !command) {
    process.stdout.write(USAGE + "\n");
    process.exitCode = command ? 0 : 1;
    return;
  }

  if (command === "config") {
    const sub = opts._[0];
    if (sub !== "doctor") {
      process.stderr.write(`gopilot config: unknown subcommand "${sub ?? ""}". Try: gopilot config doctor\n`);
      process.exitCode = 1;
      return;
    }
    const { ok, errors, warnings } = validateConfig();
    for (const w of warnings) process.stdout.write(`warning: ${w}\n`);
    if (opts.json) {
      process.stdout.write(JSON.stringify({ ok, errors, warnings }, null, 2) + "\n");
    } else if (ok) {
      process.stdout.write(`config doctor: OK — router + model registry are consistent (${warnings.length} warning(s)).\n`);
    } else {
      for (const e of errors) process.stderr.write(`error: ${e}\n`);
      process.stderr.write(`config doctor: FAILED — ${errors.length} error(s).\n`);
    }
    process.exitCode = ok ? 0 : 1;
    return;
  }

  if (command !== "run") {
    process.stderr.write(`gopilot: unknown command "${command}".\n\n${USAGE}\n`);
    process.exitCode = 1;
    return;
  }

  const prompt = opts._.join(" ").trim();
  if (!prompt) {
    process.stderr.write('gopilot run: a task prompt is required, e.g. gopilot run --dry-run "add a dark mode toggle"\n');
    process.exitCode = 1;
    return;
  }

  let res;
  try {
    const profile = selectProfile({ cliProfile: opts.profile });
    const risk = classifyRisk(prompt);
    const category = opts.category || (risk.confidence === "high" ? risk.category : undefined);
    const context = opts.contextPath ? readFileSync(opts.contextPath, "utf8") : undefined;
    const schema = opts.schemaPath ? JSON.parse(readFileSync(opts.schemaPath, "utf8")) : undefined;
    const dispatch = createProcessDispatcher({ root: REPO_ROOT });
    const outputFormat = schema || /\bjson\b/i.test(prompt) ? "json" : undefined;
    res = await runTask(
      { category, prompt, context, schema, outputFormat },
      {
        profile,
        dryRun: opts.dryRun,
        mode: opts.mode,
        allowParallelCost: opts.allowParallelCost,
        cwd: opts.cwd,
        dispatch,
        judgeRoute: (_task, { mapping }) => {
          const preferred = risk.confidence === "low" || risk.route === "frontier-final"
            ? "orchestrate"
            : risk.route === "kimi25" ? "doc-qa" : "summarize";
          const rule = mapping.categories?.[preferred] || mapping.categories?.orchestrate;
          if (!rule) throw new Error("judgment route could not resolve a governed default");
          return { ...rule, category: null, deterministic: false };
        },
        stateDir: resolve(opts.cwd, ".gopilot"),
        eventLogPath: resolve(opts.cwd, ".gopilot", "events.jsonl"),
        logPath: resolve(opts.cwd, ".gopilot", "metrics.jsonl"),
      },
    );
  } catch (err) {
    process.stderr.write(`gopilot: ${err.message}\n`);
    process.exitCode = 1;
    return;
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(res, null, 2) + "\n");
  } else {
    process.stdout.write(renderPlan(res) + "\n");
  }
  process.exitCode = 0;
}

main();
