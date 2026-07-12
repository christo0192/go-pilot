// Phase-3 smoke gate: one real governed task per plane through runTask +
// ikey-hybrid, proving end-to-end (route -> gateway/CLI -> usage -> spend).
import { runTask } from "../../src/coordinator/run.mjs";
import { createBenchmarkDispatcher } from "./ikey-dispatch.mjs";

const dispatch = createBenchmarkDispatcher();

const tasks = [
  { category: "summarize", prompt: "In ONE sentence, summarize: mitochondria produce ATP via cellular respiration and are called the powerhouse of the cell." },
  { category: "code", prompt: "Write a Python function is_palindrome(s) that ignores case and non-alphanumerics. Return only the function." },
];

for (const t of tasks) {
  const res = await runTask(t, {
    profile: "ikey-hybrid",
    dispatch,
    retrieve: false,
    rules: false,
    captureWorkspace: false,
  });
  const u = res.usage || {};
  console.log(`\n=== [${t.category}] -> ${res.plan.plane}/${res.plan.model} (${res.plan.provider}) ===`);
  console.log("verdict:", res.verdict, "| validated:", res.validated);
  console.log("tokens:", JSON.stringify(u.tokens), "| costUsd:", u.costUsd, "| latencyMs:", u.latencyMs);
  console.log("output:", (res.result?.text || "").slice(0, 200).replace(/\n/g, " "));
}
