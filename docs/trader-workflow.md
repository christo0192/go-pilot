# Trader workflow — the rich file/doc layer over the rig

Go-pilot's orchestration runs in the terminal (Herdr panes driving Claude/Codex/Pi).
Traders also need a **document surface**: journals, fills, watchlists, research PDFs,
CSV exports from the broker. This is the practical setup that layers a rich
file/doc experience on top of the rig — without leaving the keyboard.

## 1. The shell: VSCode Remote-WSL + Herdr in the integrated terminal

Run VSCode on Windows, connected to WSL2/Ubuntu with the **Remote - WSL** extension.
Open the repo folder inside WSL (`code .` from the repo in Ubuntu). Then:

- **Left:** VSCode's file explorer + editor — real tabs, PDF/Excel/CSV previews, git gutter.
- **Bottom / right:** the **integrated terminal running Herdr** (`herdr`), where the
  orchestrator and its worker panes live. `Ctrl+\`` toggles it; drag it to a side pane
  for a two-column "editor + agents" cockpit.

You get VSCode's document tooling and Herdr's multi-agent panes in one window.

## 2. The terminal doc-toolkit (installed by `./install.sh --tools`)

All user-local (`~/.local/bin`), no sudo. Keyboard-first document handling:

| Tool | What it does | Try it |
|---|---|---|
| **yazi** | Blazing file manager + previews — the in-terminal "sidebar" | `yazi` |
| **glow** | Render Markdown beautifully in the terminal | `glow trade-journal.md` |
| **visidata** | Explore CSV / XLSX / JSON fills & exports interactively | `vd fills.csv` |
| **pandoc** | Convert Markdown → docx / html / PDF | see below |
| **md2pdf / md2docx** | Zero-dep wrappers around pandoc | `scripts/md2pdf.sh journal.md` |

### md → PDF / docx / html

- **PDF** (true, self-contained): `scripts/md2pdf.sh journal.md` — uses
  `pandoc --pdf-engine=weasyprint`. If weasyprint isn't present it emits standalone
  HTML plus browser-print instructions.
- **Word doc** (native, always works with just pandoc): `scripts/md2docx.sh journal.md` —
  ideal for traders who share in Excel/Word.
- **HTML → browser print** (the no-engine fallback): `pandoc journal.md -s --embed-resources -o journal.html`,
  then open in Edge/Chrome and `Ctrl+P → Save as PDF`.

## 3. Recommended VSCode extensions for traders

- **vscode-pdf** (tomoki1207) — view broker/research PDFs inline.
- **Excel Viewer** (GrapeCity) or **Edit csv** (janisdd) — grid-view CSV/XLSX fills.
- **Rainbow CSV** — column-aware coloring + inline SQL-like queries over CSV.
- **Markdown Preview Enhanced** (shd101wyy) — live journal preview, diagrams, export.
- **Markdown PDF** (yzane) — one-click Markdown → PDF from the editor (Chromium-based;
  a GUI alternative to `md2pdf.sh`).

## 4. The aesthetic (reproduce the look)

The rig ships a hand-tuned Herdr theme in `config/herdr-config.toml`
(**Catppuccin**, auto light/dark, mauve `#cba6f7` accent). `./install.sh` copies it to
`~/.config/herdr/config.toml` **only if you don't already have one** (it never clobbers;
it backs up first if you opt to replace). Reload live with `herdr server reload-config`.

To match it in **Windows Terminal**, add to the WSL/Ubuntu profile in `settings.json`:

```jsonc
{
  "useAcrylic": true,
  "opacity": 82,                                   // subtle blur behind the rig
  "font": { "face": "JetBrainsMono NL Nerd Font Mono", "size": 11 },
  "colorScheme": "Catppuccin Mocha"                // import from catppuccin/windows-terminal
}
```

The **Nerd Font** matters — yazi and Herdr use glyph icons that only render with a
patched font. Grab "JetBrainsMono NL Nerd Font" from nerdfonts.com and install it on Windows.

## 5. A day in the rig

1. `code .` in WSL → VSCode opens the repo, integrated terminal runs `herdr`.
2. Agents work in Herdr panes; you review diffs and PDFs in the editor column.
3. Log the session in `trade-journal.md`; `glow` it in-terminal, `vd fills.csv` to eyeball fills.
4. `scripts/md2docx.sh trade-journal.md` (or `md2pdf.sh`) to hand a clean doc to your desk.
