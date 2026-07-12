import { spawn } from "node:child_process";
import { resolve } from "node:path";

// Cap child output so a runaway/huge provider response can't OOM the
// orchestrator: the timeout bounds TIME, this bounds BYTES.
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

// Model aliases only ever come from the validated registry, but the dispatcher
// is also a standalone export — reject anything that isn't a safe alias so a
// hostile value can never reach a CLI as a flag (must NOT start with `-`).
const SAFE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

// Scrub common secret shapes before a child's output is surfaced in an Error
// (which flows into logs/events). Defense-in-depth: children inherit the env.
export function redactSecrets(text) {
  return String(text)
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]{8,}/gi, "$1***")
    .replace(/([A-Za-z0-9_]*(?:API_KEY|MASTER_KEY|TOKEN|SECRET)\s*[=:]\s*)\S+/gi, "$1***");
}

function runProcess(command, args, opts = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd || process.cwd(),
      env: { ...process.env, ...(opts.env || {}) },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let outLen = 0;
    let errLen = 0;
    let settled = false;
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const overflow = (stream) => {
      child.kill("SIGTERM");
      finish(() => reject(new Error(`${command} ${stream} exceeded ${MAX_OUTPUT_BYTES} bytes`)));
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(() => reject(new Error(`dispatcher timed out after ${opts.timeoutMs}ms`)));
    }, opts.timeoutMs || 900000);
    child.stdout.on("data", (chunk) => {
      outLen += chunk.length;
      if (outLen > MAX_OUTPUT_BYTES) return overflow("stdout");
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      errLen += chunk.length;
      if (errLen > MAX_OUTPUT_BYTES) return overflow("stderr");
      stderr += chunk.toString();
    });
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (code) => finish(() => {
      if (code !== 0) reject(new Error(`${command} exited ${code}: ${redactSecrets((stderr || stdout).slice(-4000))}`));
      else resolvePromise({ stdout, stderr, code });
    }));
    if (opts.stdin) child.stdin.end(opts.stdin);
    else child.stdin.end();
  });
}

function parseClaude(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A non-JSON preamble (banner/warning) must not throw a raw SyntaxError that
    // could echo provider output back out.
    throw new Error("claude dispatcher: output was not valid JSON");
  }
  return {
    result: { text: parsed.result || parsed.content || "", raw: parsed },
    usage: {
      tokens: parsed.usage ? {
        input: parsed.usage.input_tokens ?? 0,
        output: parsed.usage.output_tokens ?? 0,
        cacheRead: parsed.usage.cache_read_input_tokens ?? 0,
        cacheWrite: parsed.usage.cache_creation_input_tokens ?? 0,
        total: (parsed.usage.input_tokens ?? 0) + (parsed.usage.output_tokens ?? 0),
      } : undefined,
      costUsd: parsed.total_cost_usd,
    },
  };
}

function parseCodex(raw) {
  const lines = raw.split("\n").filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
  const messages = lines.filter((event) => event.type === "item.completed" && event.item?.type === "agent_message");
  const final = messages.at(-1)?.item?.text || messages.at(-1)?.item?.content || "";
  const usageEvent = [...lines].reverse().find((event) => event.usage || event.type === "turn.completed");
  return { result: { text: final, raw: lines }, usage: usageEvent?.usage || {} };
}

export function createProcessDispatcher(opts = {}) {
  const root = opts.root || process.cwd();
  return async function dispatch(request) {
    if (!request.plane || !request.model) throw new Error("dispatcher requires a resolved plane and model");
    if (typeof request.model !== "string" || !SAFE_MODEL.test(request.model)) {
      throw new Error(`dispatcher: unsafe model alias "${request.model}"`);
    }
    const timeoutMs = request.contract?.timeoutMs || opts.timeoutMs || 900000;
    if (request.plane === "frontier" && ["opus", "sonnet", "haiku"].includes(request.model)) {
      const script = opts.claudeScript || resolve(root, "scripts", "lean-worker.sh");
      const out = await runProcess(script, [request.model, "--max-turns", String(request.contract?.maxTurns || 20)], {
        cwd: request.cwd || root,
        stdin: request.prompt,
        timeoutMs,
      });
      return parseClaude(out.stdout);
    }
    if (request.plane === "frontier" && request.model === "codex") {
      const script = opts.codexScript || resolve(root, "scripts", "lean-codex-worker.sh");
      const out = await runProcess(script, [request.prompt], { cwd: request.cwd || root, timeoutMs });
      return parseCodex(out.stdout);
    }
    if (request.plane === "workhorse") {
      const script = opts.piScript || resolve(root, "scripts", "pi-gopilot.sh");
      const out = await runProcess(script, ["--model", request.model, "--print", request.prompt], {
        cwd: request.cwd || root,
        timeoutMs,
        env: { GOPILOT_MODEL: request.model },
      });
      return { result: { text: out.stdout.trim(), raw: out.stdout }, usage: {} };
    }
    throw new Error(`no dispatcher for ${request.plane}/${request.model}`);
  };
}

export { runProcess, parseClaude, parseCodex };
