import { existsSync, readFileSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";
import { estimateTokens } from "../boundary/guard.mjs";

export function discoverInstructions(cwd = process.cwd(), opts = {}) {
  const stop = resolve(opts.root || parse(resolve(cwd)).root);
  const chain = [];
  let current = resolve(cwd);
  for (;;) {
    chain.push(current);
    if (current === stop || dirname(current) === current) break;
    current = dirname(current);
  }
  chain.reverse();
  const files = [];
  for (const dir of chain) {
    for (const name of opts.names || ["AGENTS.md", ".gopilot-rules.md"]) {
      const path = resolve(dir, name);
      if (!existsSync(path)) continue;
      const content = readFileSync(path, "utf8");
      files.push({ path, content, tokens: estimateTokens(content) });
    }
  }
  const text = files.map((file) => `### ${file.path}\n${file.content}`).join("\n\n");
  return { files, text, tokens: estimateTokens(text) };
}
