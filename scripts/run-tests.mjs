#!/usr/bin/env node
// Zero-dep test bucketer. Categorizes *.test.mjs by filename suffix and runs
// only the requested bucket via the built-in `node --test` runner.
//
//   unit         hermetic: no sockets, no external process, no env deps
//   integration  real I/O against an in-process fake / loopback socket
//                 (always runnable — no external service required)
//   live         needs a real external CLI/service; SELF-SKIPS when absent
//   all          everything (equivalent to a bare `node --test`)
//
// Suffix convention:
//   *.live.test.mjs         -> live
//   *.integration.test.mjs  -> integration
//   *.test.mjs (otherwise)  -> unit
//
// Discovery walks the filesystem itself (no shell globs) so the split behaves
// identically on POSIX and Windows, and in locked-down CI.

import { readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEARCH_ROOTS = ["src", "bin", "scripts"];
const SKIP_DIRS = new Set(["node_modules", ".git", "deploy"]);

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // root may not exist (e.g. no bin/ tests yet)
  }
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".") continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full, out);
    } else if (e.isFile() && e.name.endsWith(".test.mjs")) {
      out.push(full);
    }
  }
  return out;
}

function bucketOf(file) {
  const name = file.split(sep).pop();
  if (name.endsWith(".live.test.mjs")) return "live";
  if (name.endsWith(".integration.test.mjs")) return "integration";
  return "unit";
}

const bucket = (process.argv[2] || "unit").toLowerCase();
const VALID = new Set(["unit", "integration", "live", "all"]);
if (!VALID.has(bucket)) {
  console.error(`unknown bucket "${bucket}". use: ${[...VALID].join(" | ")}`);
  process.exit(2);
}

const all = SEARCH_ROOTS.flatMap((r) => walk(join(ROOT, r), []));
const files = (bucket === "all" ? all : all.filter((f) => bucketOf(f) === bucket)).sort();

if (files.length === 0) {
  console.log(`no ${bucket} test files found — nothing to run.`);
  process.exit(0);
}

console.log(`running ${files.length} ${bucket} test file(s):`);
for (const f of files) console.log(`  ${f.slice(ROOT.length + 1)}`);

const res = spawnSync(process.execPath, ["--test", ...files], {
  stdio: "inherit",
  cwd: ROOT,
});
process.exit(res.status ?? 1);
