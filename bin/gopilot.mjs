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

function parseArgs(argv) {
  const opts = { profile: "pure-anthropic", dryRun: false, category: undefined, json: false };
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
      case "--help":
      case "-h":
        opts.help = true;
        break;
      default:
        rest.push(a);
    }
  }
  opts._ = rest;
  return opts;
}

const USAGE = `gopilot — governed run coordinator

Usage:
  gopilot run [options] "<task prompt>"

Options:
  -p, --profile <name>   routing profile (pure-anthropic | hybrid | open-first) [default: pure-anthropic]
  -c, --category <cat>   task class (orchestrate|plan|code|analyze|draft|extract|classify|summarize|code-review|lateral)
  -n, --dry-run          print the governed plan without invoking any model
      --json             emit machine-readable JSON
  -h, --help             show this help

Notes:
  A live (non-dry) run requires the workhorse/frontier dispatcher (Step 8.8).
  Until then, only --dry-run is supported; live runs fall back to a dry-run plan.`;

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
  return lines.join("\n");
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const opts = parseArgs(argv.slice(1));

  if (opts.help || command === "help" || !command) {
    process.stdout.write(USAGE + "\n");
    process.exit(command ? 0 : 1);
  }

  if (command !== "run") {
    process.stderr.write(`gopilot: unknown command "${command}".\n\n${USAGE}\n`);
    process.exit(1);
  }

  const prompt = opts._.join(" ").trim();
  if (!prompt) {
    process.stderr.write('gopilot run: a task prompt is required, e.g. gopilot run --dry-run "add a dark mode toggle"\n');
    process.exit(1);
  }

  // Live dispatch is not wired yet (Step 8.8). Force dry-run and tell the user.
  let dryRun = opts.dryRun;
  if (!dryRun) {
    process.stderr.write(
      "gopilot: live dispatch requires the workhorse/frontier dispatcher (Step 8.8), " +
        "which is not configured. Showing the governed DRY-RUN plan instead.\n\n",
    );
    dryRun = true;
  }

  let res;
  try {
    res = await runTask(
      { category: opts.category, prompt },
      { profile: opts.profile, dryRun },
    );
  } catch (err) {
    process.stderr.write(`gopilot: ${err.message}\n`);
    process.exit(1);
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(res, null, 2) + "\n");
  } else {
    process.stdout.write(renderPlan(res) + "\n");
  }
  process.exit(0);
}

main();
