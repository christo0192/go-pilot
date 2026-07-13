#!/usr/bin/env node
// CLI for the deterministic risk classifier. The orchestrator runs this FIRST
// for every subtask and logs suggestion vs actual route (auditability).
// Usage: node scripts/classify.mjs "<task text>"     (or pipe the task on stdin)
import { readFileSync } from "node:fs";
import { classifyRisk } from "../src/router/risk.mjs";

const arg = process.argv.slice(2).join(" ").trim();
const text = arg && arg !== "-" ? arg : readFileSync(0, "utf8");
console.log(JSON.stringify(classifyRisk(text)));
