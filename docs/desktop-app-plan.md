# Go-pilot desktop application plan

Status: implemented and locally verified on `feat/desktop-resume-voice-updates`; release review pending.

## Outcome

Go-pilot installs as a Windows application with an icon and Start menu entry,
while the existing Node/Herdr runtime continues to run inside the dedicated
Ubuntu WSL distribution. Closing the visible terminal detaches the client; it
does not stop the named, headless Herdr server. Reopening Go-pilot attaches to
the same session. If WSL or the server was restarted, Herdr restores its saved
layout and Go-pilot continues the most recent dedicated Pi conversation.

The first release deliberately uses a small, auditable PowerShell application
shell instead of embedding a second terminal emulator. A future Tauri shell can
replace it without changing the session, voice, or update contracts below.

## Architecture

```text
Windows Start menu / Go-pilot.ps1
  |-- launch --> wsl.exe --> gopilot-session.sh attach
  |                         |-- detached named Herdr server: gopilot
  |                         `-- managed Pi workspace + persistent Pi session
  |-- voice  --> local whisper.cpp controller --> safe paste to Windows Terminal
  |-- update --> gopilot-update.sh --> verified stable/nightly Git target
  `-- doctor --> install.sh --doctor
```

## Delivery phases

1. **Persistent runtime**
   - Add a named `gopilot` Herdr session controller.
   - Start the server detached/headless and poll its health before attaching.
   - Create one managed Go-pilot workspace on first launch.
   - Leave the server and Pi alive when the visible client closes.
   - Restore the latest dedicated Pi session after an actual server restart.

2. **Windows application shell**
   - Install versioned launcher assets under
     `%LOCALAPPDATA%\Programs\Go-pilot`.
   - Create Start menu and optional desktop shortcuts with the Go-pilot icon.
   - Register a per-user uninstall entry without requiring administrator rights.
   - Expose Launch, Voice, Update, Doctor, and Uninstall actions.

3. **Local speech-to-text**
   - Install a pinned Windows x64 `whisper.cpp` binary and quantized
     `small.en` model after explicit user action.
   - Verify both downloads by SHA-256 before extraction/use.
   - Provide a global F8 toggle, voice-activity detection, clipboard output,
     and terminal paste without automatically pressing Enter.
   - Refuse automatic paste outside an allowlisted terminal process.

4. **Updates and rollback**
   - Stable follows the latest non-prerelease GitHub Release.
   - Nightly follows `main` only when the matching GitHub Actions CI run passed.
   - Refuse to alter a checkout with tracked local changes.
   - Validate the candidate in a temporary worktree before fast-forwarding.
   - Record the previous and installed commits for recovery/audit.
   - Re-run the idempotent installer after an update and refresh Windows assets.

5. **Release quality**
   - Extend installer and lifecycle tests on all portable platforms.
   - Parse all PowerShell entrypoints in Windows CI.
   - Keep the existing unit, integration, routing, metrics, zero-dependency,
     shellcheck, installer-doctor, and gitleaks gates.
   - Publish setup assets and checksums from version tags.
   - Pin Pi and Herdr to official sources, install Herdr's official
     Pi/Claude/Codex integrations, and preload its verified pane-command skill.

## Quality scoring rubric

Every release is scored out of 100. A stable release requires **90+ overall**,
no critical security finding, and every mandatory gate below. A nightly build
requires all automated gates but may ship with documented usability gaps.

| Dimension | Weight | Release evidence |
|---|---:|---|
| Resume correctness | 25 | Client close preserves live process; server restart restores workspace and Pi continuation |
| Install/uninstall reliability | 20 | Clean Windows parse/doctor tests; idempotent re-run; per-user uninstall |
| Update safety | 20 | Dirty-tree refusal, green-CI target, candidate validation, fast-forward only, audit state |
| Voice privacy and safety | 15 | Local inference, pinned hashes, terminal allowlist, no implicit Enter |
| Regression quality | 15 | Existing routing/metrics/unit/integration gates remain green |
| Documentation and operability | 5 | User runbook, recovery steps, channel behavior and limitations |

Mandatory acceptance cases:

- Closing Windows Terminal and reopening Go-pilot returns to the same Herdr
  session without spawning a duplicate server or Pi process.
- Restarting the named Herdr server restores the managed workspace; when its
  pane is idle, Pi starts with `--continue` against the dedicated session store.
- Update failure leaves the currently installed commit runnable.
- Voice output never submits a prompt automatically.
- Secrets and Pi/Herdr session data are not placed in release artifacts.

## Explicit limitations of the first release

- Exact in-flight process continuity requires the WSL instance and headless
  server to remain alive. After a machine/WSL restart, the terminal process is
  recreated and Pi continues its saved conversation; a tool call interrupted
  at the instant of shutdown may need to be retried.
- The PowerShell shell provides application behavior and shortcuts, but a
  signed MSI/MSIX/Tauri package remains a later distribution milestone. Until
  code signing is configured, browser downloads may show Windows SmartScreen.
- The initial bundled model is English. Multilingual model selection is a
  planned settings-screen enhancement.
