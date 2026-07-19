@echo off
setlocal EnableExtensions
title Go-pilot one-click setup
REM ===========================================================================
REM  Go-pilot one-click setup for Windows (WSL).
REM  Double-click this file. It asks for ONE key paste, then runs unattended:
REM    - ensures WSL + Ubuntu
REM    - root phase via `wsl -u root` (NO password needed): git/curl, Node 20,
REM      Docker engine, docker group, systemd-on-boot
REM    - restarts WSL so the docker group + systemd take effect
REM    - clones the repo to ~/Go-pilot (Linux home: fast, no NTFS chmod issues)
REM    - runs install.sh --one-click (herdr + Pi + provider + Mem0 services)
REM    - opens a terminal window running herdr
REM  Safe to re-run: every step is idempotent.
REM ===========================================================================

echo.
echo  ============================================================
echo   Go-pilot one-click setup
echo  ============================================================
echo.
echo  Paste your WORKHORSE_GATEWAY_KEY (the one key the workhorse
echo  models need). Press Enter to skip - everything still installs,
echo  models activate when you add the key later.
echo.
set "GOPILOT_WORKHORSE_KEY="
set /p GOPILOT_WORKHORSE_KEY="  Key: "
REM Flow the key into WSL as an env var (never written to a Windows file).
set "WSLENV=GOPILOT_WORKHORSE_KEY/u"

echo.
echo [1/8] Checking WSL...
where wsl.exe >nul 2>nul
if errorlevel 1 (
  echo   WSL is not available on this Windows. Install it from an ADMIN
  echo   PowerShell with:  wsl --install -d Ubuntu
  echo   ...then reboot and double-click this file again.
  goto :fail
)
wsl.exe -- true >nul 2>nul
if errorlevel 1 (
  echo   No working WSL distro found. Installing Ubuntu now...
  wsl.exe --install -d Ubuntu
  echo.
  echo   When Ubuntu finishes its first start ^(it asks you to create a
  echo   Linux username/password^), close it and double-click this file again.
  goto :fail
)

echo [2/8] Detecting the WSL user...
set "WSLUSER="
for /f "usebackq delims=" %%u in (`wsl.exe -- whoami`) do set "WSLUSER=%%u"
if not defined WSLUSER (
  echo   Could not detect the WSL username.
  goto :fail
)
echo   WSL user: %WSLUSER%

echo [3/8] Root phase A: base packages (git, curl)...
wsl.exe -u root -- bash -c "export DEBIAN_FRONTEND=noninteractive; apt-get update -y >/dev/null && apt-get install -y ca-certificates curl git >/dev/null && echo ok"
if errorlevel 1 goto :fail

echo [4/8] Fetching Go-pilot into WSL home (~/Go-pilot)...
wsl.exe -- bash -lc "if [ -d ~/Go-pilot/.git ]; then git -C ~/Go-pilot pull --ff-only; else git clone https://github.com/christo0192/go-pilot.git ~/Go-pilot; fi"
if errorlevel 1 goto :fail

echo [5/8] Root phase B: Node 20 + Docker + docker group + systemd...
wsl.exe -u root -- bash "/home/%WSLUSER%/Go-pilot/scripts/oneclick-root.sh" provision "%WSLUSER%"
if errorlevel 1 goto :fail

echo [6/8] Restarting WSL (activates docker group + systemd)...
wsl.exe --shutdown
timeout /t 8 /nobreak >nul
wsl.exe -u root -- bash "/home/%WSLUSER%/Go-pilot/scripts/oneclick-root.sh" post-restart
if errorlevel 1 goto :fail

echo [7/8] Installing the rig (herdr + Pi + provider + services)...
echo        This is the long step (first run: a few minutes).
wsl.exe -- bash -lc "cd ~/Go-pilot && bash install.sh --one-click"
if errorlevel 1 goto :fail

echo [8/8] Opening the herdr terminal...
where wt.exe >nul 2>nul
if errorlevel 1 (
  start "Go-pilot - herdr" wsl.exe -- bash "/home/%WSLUSER%/Go-pilot/scripts/oneclick-launch.sh"
) else (
  start "" wt.exe wsl.exe -- bash "/home/%WSLUSER%/Go-pilot/scripts/oneclick-launch.sh"
)

echo.
echo  ============================================================
echo   Done. The herdr terminal is opening in its own window.
echo   Re-running this file any time is safe (everything is
echo   idempotent). You can close this window.
echo  ============================================================
echo.
pause
exit /b 0

:fail
echo.
echo  Setup stopped. Read the message above, fix or re-run this file.
echo.
pause
exit /b 1
