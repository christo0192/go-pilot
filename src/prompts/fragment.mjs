// Ponytail YAGNI prompt fragment loader + applier.
//
// The lean-worker path deliberately avoids Claude's --system-prompt flag (it
// cache-busts). So this guidance is applied as a CONSTANT PREFIX on the
// worker's USER prompt — a stable prefix stays prompt-cache friendly.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Repo root is two levels up from src/prompts/.
const DEFAULT_FRAGMENT_PATH = fileURLToPath(
  new URL("../../config/prompts/ponytail-yagni.txt", import.meta.url),
);

/**
 * Read the YAGNI fragment file and return its trimmed text.
 * @param {{ path?: string }} [opts] - `opts.path` overrides the default file.
 * @returns {string}
 */
export function loadFragment(opts = {}) {
  const path = opts.path ?? DEFAULT_FRAGMENT_PATH;
  return readFileSync(path, "utf8").trim();
}

/**
 * Prepend the YAGNI fragment to a worker prompt as a constant prefix.
 * @param {string} [prompt] - the original worker prompt.
 * @param {{ path?: string }} [opts]
 * @returns {string} fragment + "\n\n" + prompt, or just the fragment if empty.
 */
export function withYagni(prompt, opts = {}) {
  const fragment = loadFragment(opts);
  if (!prompt) return fragment;
  return fragment + "\n\n" + prompt;
}
