#!/usr/bin/env node
// CLI for src/validation — the orchestrator pipes worker output through this.
// Usage:
//   <worker-output> | node scripts/validate.mjs json [--schema schema.json]
//   <worker-output> | node scripts/validate.mjs numeric --expected 42 [--tolerance 0.01]
//   <worker-output> | node scripts/validate.mjs citations --ids doc1.s1,doc1.s2 [--min 1]
//   node scripts/validate.mjs code --run "node --test x.test.mjs" [--cwd dir]
// Prints a JSON verdict; exit 0 = valid, 1 = invalid, 4 = usage error.
import { readFileSync } from "node:fs";
import { validateJson, validateCode, validateNumeric, validateCitations } from "../src/validation/validate.mjs";

const [type, ...rest] = process.argv.slice(2);
const opts = {};
for (let i = 0; i < rest.length; i += 2) opts[rest[i]?.replace(/^--/, "")] = rest[i + 1];

function out(res) {
  console.log(JSON.stringify(res));
  process.exit(res.ok ? 0 : 1);
}

let res;
switch (type) {
  case "json": {
    const schema = opts.schema ? JSON.parse(readFileSync(opts.schema, "utf8")) : undefined;
    res = validateJson(readFileSync(0, "utf8"), { schema });
    delete res.value; // verdict only; the artifact is already on disk/stdout upstream
    out(res);
    break;
  }
  case "numeric":
    if (opts.expected == null) { console.error("numeric needs --expected"); process.exit(4); }
    out(validateNumeric(readFileSync(0, "utf8"), { expected: Number(opts.expected), tolerance: Number(opts.tolerance ?? 0) }));
    break;
  case "citations":
    out(validateCitations(readFileSync(0, "utf8"), {
      evidenceIds: (opts.ids ?? "").split(",").filter(Boolean),
      minCitations: Number(opts.min ?? 1),
    }));
    break;
  case "code":
    if (!opts.run) { console.error("code needs --run '<cmd>'"); process.exit(4); }
    out(validateCode({ runCmd: opts.run, cwd: opts.cwd, timeoutMs: Number(opts.timeout ?? 60000) }));
    break;
  default:
    console.error("usage: validate.mjs <json|numeric|citations|code> [flags]");
    process.exit(4);
}
