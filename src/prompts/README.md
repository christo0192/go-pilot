# Worker prompt fragments

`withYagni(prompt)` prepends the Ponytail YAGNI fragment
(`config/prompts/ponytail-yagni.txt`) to a worker's **user** prompt.

Why the user prompt and not Claude's `--system-prompt`: lean worker panes avoid
`--system-prompt` because it cache-busts. A constant prefix on the user prompt
stays prompt-cache friendly, so the guidance rides along without breaking caching.

The dispatcher wraps every lean worker call as `withYagni(taskPrompt)` — the
fragment is emitted first, then a blank line, then the task. An empty task
yields just the fragment. Override the source file in tests via `opts.path`.
