#Requires -Version 5.1
<#
.SYNOPSIS
    Go-pilot Windows bootstrap — idempotent parity of install.sh.

.DESCRIPTION
    Brings a Windows machine to a "Go-pilot ready" state:
      * ensures Node LTS + Docker are present (winget preferred, choco fallback),
      * templates deploy/.env from deploy/.env.example (never overwrites),
      * sparse-clones the Mem0 build context into deploy/mem0-src,
      * brings up the self-hosted Mem0 (Tier-2 memory) stack via docker compose,
      * runs `node --test` and polls the Mem0 /docs endpoint,
      * prints a READY report.

    IDEMPOTENT: re-running is a no-op when everything is already in place. No
    destructive changes are ever made (existing deploy/.env, mem0-src, volumes
    and running containers are left untouched).

    Run from an ELEVATED PowerShell if any install (Node / Docker) is required —
    winget/choco package installs need admin. If Node + Docker are already
    installed, a normal (non-elevated) shell is fine.

.PARAMETER Full
    Also install the optional full rig (global npm agents such as
    @earendil-works/pi-coding-agent). Off by default.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\install.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\install.ps1 -Full
#>

[CmdletBinding()]
param(
    [switch]$Full
)

$ErrorActionPreference = 'Stop'

# Make emoji / box-drawing in the READY report render on Windows PowerShell 5.1.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

# Anchor every path to the repo root (this script's dir) so cwd doesn't matter.
$RepoRoot   = $PSScriptRoot
$DeployDir  = Join-Path $RepoRoot 'deploy'
$ComposeArg = Join-Path $DeployDir 'docker-compose.yml'
$Mem0Url    = 'http://localhost:8888'
$Mem0Docs   = "$Mem0Url/docs"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function Write-Section {
    param([Parameter(Mandatory)][string]$Title)
    Write-Host ''
    Write-Host ('=' * 68) -ForegroundColor DarkCyan
    Write-Host ("  $Title") -ForegroundColor Cyan
    Write-Host ('=' * 68) -ForegroundColor DarkCyan
}

function Test-Command {
    param([Parameter(Mandatory)][string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Write-Ok   { param([string]$M) Write-Host "  [ok]   $M"   -ForegroundColor Green }
function Write-Info { param([string]$M) Write-Host "  [info] $M"   -ForegroundColor Gray  }
function Write-Warn { param([string]$M) Write-Host "  [warn] $M"   -ForegroundColor Yellow }

# Install a package via winget (preferred) or choco (fallback). Returns $true if
# an install was attempted, $false if neither package manager is available (the
# caller then prints manual guidance). Guarded by the caller's Test-Command.
function Install-Package {
    param(
        [Parameter(Mandatory)][string]$WingetId,
        [Parameter(Mandatory)][string]$ChocoId,
        [Parameter(Mandatory)][string]$DisplayName
    )
    if (Test-Command 'winget') {
        Write-Info "Installing $DisplayName via winget ($WingetId)..."
        winget install --id $WingetId --exact --silent `
            --accept-package-agreements --accept-source-agreements
        return $true
    }
    elseif (Test-Command 'choco') {
        Write-Info "Installing $DisplayName via choco ($ChocoId)..."
        choco install $ChocoId -y
        return $true
    }
    else {
        return $false
    }
}

# ---------------------------------------------------------------------------
# 1. Environment detection
# ---------------------------------------------------------------------------

Write-Section '1/7  Environment detection'

if (-not $IsWindows -and $env:OS -ne 'Windows_NT') {
    # $IsWindows exists on PowerShell 7+; on 5.1 fall back to $env:OS.
    throw 'install.ps1 targets Windows. On macOS/Linux/WSL use install.sh instead.'
}
Write-Ok "Windows detected ($([Environment]::OSVersion.VersionString))."

$hasWinget = Test-Command 'winget'
$hasChoco  = Test-Command 'choco'
if ($hasWinget)     { Write-Ok   'winget available (preferred package manager).' }
elseif ($hasChoco)  { Write-Ok   'choco available (winget not found; using choco).' }
else                { Write-Warn 'Neither winget nor choco found. Missing tools must be installed manually.' }

# Docker flavour: Docker Desktop exposes `docker` on the Windows PATH. If it is
# absent we assume Docker Desktop needs installing (WSL-provided docker is only
# reachable from inside WSL, not this Windows PowerShell session).
if (Test-Command 'docker') {
    Write-Ok 'docker found on PATH (Docker Desktop or WSL-integrated Docker Desktop).'
} else {
    Write-Info 'docker not on PATH — will offer Docker Desktop install below.'
}

# ---------------------------------------------------------------------------
# 2. Node LTS
# ---------------------------------------------------------------------------

Write-Section '2/7  Node.js LTS'

if (Test-Command 'node') {
    Write-Ok "Node already installed: $(node -v)"
} else {
    $attempted = Install-Package -WingetId 'OpenJS.NodeJS.LTS' -ChocoId 'nodejs-lts' -DisplayName 'Node.js LTS'
    if (-not $attempted) {
        Write-Warn 'Cannot auto-install Node. Download the LTS installer manually:'
        Write-Warn '    https://nodejs.org/en/download'
        throw 'Node.js is required. Install it, then re-run install.ps1.'
    }
    if (Test-Command 'node') {
        Write-Ok "Node installed: $(node -v)"
    } else {
        Write-Warn 'Node was installed but is not yet on this session PATH.'
        Write-Warn 'Open a NEW PowerShell window and re-run install.ps1.'
        throw 'Node not visible in current session — restart shell and re-run.'
    }
}

# ---------------------------------------------------------------------------
# 3. Docker (Docker Desktop)
# ---------------------------------------------------------------------------

Write-Section '3/7  Docker'

if (Test-Command 'docker') {
    Write-Ok "Docker already installed: $(docker --version)"
} else {
    $attempted = Install-Package -WingetId 'Docker.DockerDesktop' -ChocoId 'docker-desktop' -DisplayName 'Docker Desktop'
    if (-not $attempted) {
        Write-Warn 'Cannot auto-install Docker. Download Docker Desktop manually:'
        Write-Warn '    https://www.docker.com/products/docker-desktop/'
        throw 'Docker is required. Install it, then re-run install.ps1.'
    }
    Write-Warn 'Docker Desktop was installed. It may require you to:'
    Write-Warn '   - sign in to a Docker account,'
    Write-Warn '   - enable WSL2 backend / virtualization,'
    Write-Warn '   - RESTART Windows before the docker CLI works.'
    Write-Warn 'After Docker Desktop is running, re-run install.ps1 to finish.'
    throw 'Docker Desktop installed — start it (and restart if prompted), then re-run.'
}

# ---------------------------------------------------------------------------
# 3b. Optional full rig  (-Full)
# ---------------------------------------------------------------------------

if ($Full) {
    Write-Section '3b/7  Optional full rig (-Full)'
    $globalNpm = @(
        '@earendil-works/pi-coding-agent'
    )
    foreach ($pkg in $globalNpm) {
        # `npm ls -g` exits non-zero when absent; use that as the guard.
        $installed = $false
        try {
            npm ls -g $pkg --depth 0 *> $null
            if ($LASTEXITCODE -eq 0) { $installed = $true }
        } catch { $installed = $false }

        if ($installed) {
            Write-Ok "$pkg already installed globally."
        } else {
            Write-Info "Installing $pkg globally (npm i -g)..."
            npm i -g $pkg
            Write-Ok "$pkg installed."
        }
    }
} else {
    Write-Info 'Skipping optional full rig (pass -Full to install pi-coding-agent etc.).'
}

# ---------------------------------------------------------------------------
# 4. Config templating  (idempotent)
# ---------------------------------------------------------------------------

Write-Section '4/7  Config (deploy/.env)'

$envExample = Join-Path $DeployDir '.env.example'
$envTarget  = Join-Path $DeployDir '.env'

if (-not (Test-Path $envExample)) {
    throw "Missing template: $envExample — is this the Go-pilot repo root?"
}
if (Test-Path $envTarget) {
    Write-Ok 'deploy/.env already exists — leaving it untouched.'
} else {
    Copy-Item -Path $envExample -Destination $envTarget
    Write-Ok 'Created deploy/.env from deploy/.env.example.'
    Write-Warn 'TODO: edit deploy/.env and set OPENAI_API_KEY (Mem0 embedder needs it).'
}

# ---------------------------------------------------------------------------
# 5. Mem0 build context  (sparse clone, guarded)
# ---------------------------------------------------------------------------

Write-Section '5/7  Mem0 build context (deploy/mem0-src)'

$mem0Src = Join-Path $DeployDir 'mem0-src'

if (Test-Path $mem0Src) {
    Write-Ok 'deploy/mem0-src already present — skipping clone.'
} else {
    if (-not (Test-Command 'git')) {
        Write-Warn 'git not found. Install it (winget install Git.Git) then re-run.'
        throw 'git is required to fetch the Mem0 build context.'
    }
    Write-Info 'Sparse-cloning mem0ai/mem0 (server dir only, blobless, depth 1)...'
    git clone --filter=blob:none --no-checkout --depth 1 `
        https://github.com/mem0ai/mem0.git $mem0Src
    Push-Location $mem0Src
    try {
        git sparse-checkout set server
        git checkout
    } finally {
        Pop-Location
    }
    Write-Ok 'Mem0 build context ready at deploy/mem0-src.'
}

# ---------------------------------------------------------------------------
# 6. Bring up the stack
# ---------------------------------------------------------------------------

Write-Section '6/7  docker compose up'

Write-Info "Starting Mem0 + pgvector (first run builds the image)..."
# Compose builds the image on first `up` (the mem0 service has a build: context),
# then reuses it — so this stays idempotent across re-runs.
docker compose -f $ComposeArg up -d
if ($LASTEXITCODE -ne 0) {
    Write-Warn 'docker compose up failed. Is Docker Desktop running?'
    throw 'docker compose up returned a non-zero exit code.'
}
Write-Ok 'Compose stack requested (detached).'

# ---------------------------------------------------------------------------
# 7. Verify + READY report
# ---------------------------------------------------------------------------

Write-Section '7/7  Verify'

# 7a. Unit tests (zero-dep node --test).
Write-Info 'Running node --test ...'
$testsPassed = $false
try {
    node --test
    $testsPassed = ($LASTEXITCODE -eq 0)
} catch {
    $testsPassed = $false
}
if ($testsPassed) { Write-Ok 'node --test passed.' }
else              { Write-Warn 'node --test reported failures (see output above).' }

# 7b. Poll Mem0 /docs for HTTP 200 (up to ~120s; the image build can be slow).
Write-Info "Polling $Mem0Docs for HTTP 200 (up to 120s)..."
$mem0Ready   = $false
$deadline    = (Get-Date).AddSeconds(120)
while ((Get-Date) -lt $deadline) {
    try {
        $resp = Invoke-WebRequest -Uri $Mem0Docs -UseBasicParsing -TimeoutSec 5
        if ($resp.StatusCode -eq 200) { $mem0Ready = $true; break }
    } catch {
        # not up yet — wait and retry
    }
    Start-Sleep -Seconds 5
}
if ($mem0Ready) { Write-Ok "Mem0 is serving at $Mem0Docs (HTTP 200)." }
else            { Write-Warn "Mem0 did not answer 200 at $Mem0Docs within 120s." }

# 7c. On Mem0 failure, surface the container logs to help diagnose.
if (-not $mem0Ready) {
    Write-Warn 'Dumping mem0 container logs (last lines):'
    docker compose -f $ComposeArg logs mem0
}

# ---------------------------------------------------------------------------
# READY report
# ---------------------------------------------------------------------------

Write-Section 'Go-pilot install summary'

$nodeVer   = if (Test-Command 'node')   { node -v }          else { 'not found' }
$dockerVer = if (Test-Command 'docker') { docker --version } else { 'not found' }
$envHasKey = $false
if (Test-Path $envTarget) {
    $envHasKey = [bool](Select-String -Path $envTarget -Pattern '^\s*OPENAI_API_KEY=.+' -Quiet)
}

Write-Host ''
if ($mem0Ready -and $testsPassed) {
    Write-Host '  ✅ Go-pilot ready' -ForegroundColor Green
} else {
    Write-Host '  ⚠  Go-pilot installed with warnings (see above)' -ForegroundColor Yellow
}
Write-Host ''
$composeVer = 'absent'
try { $composeVer = (docker compose version --short 2>$null); if (-not $composeVer) { $composeVer = 'absent' } } catch { $composeVer = 'absent' }

Write-Host  "  OS             : $([Environment]::OSVersion.VersionString)"
Write-Host  "  Node           : $nodeVer"
Write-Host  "  Docker         : $dockerVer"
Write-Host  "  docker compose : $composeVer"
Write-Host  "  Mem0 URL       : $Mem0Url  (docs: $Mem0Docs)"
Write-Host  "  node --test    : $(if ($testsPassed) { 'passed' } else { 'FAILING / not run' })"
Write-Host  "  Mem0           : $(if ($mem0Ready) { 'up (HTTP 200)' } else { 'NOT reachable' })"
Write-Host  "  Full rig (-Full): $(if ($Full) { 'enabled' } else { 'skipped' })"
Write-Host ''

$todos = @()
if (-not $envHasKey) { $todos += 'Set OPENAI_API_KEY in deploy/.env (Mem0 embedder).' }
if (-not $mem0Ready) { $todos += "Check Docker Desktop is running; review: docker compose -f deploy/docker-compose.yml logs mem0" }
if (-not $testsPassed) { $todos += 'Investigate failing node --test output.' }

if ($todos.Count -gt 0) {
    Write-Host '  TODO:' -ForegroundColor Yellow
    foreach ($t in $todos) { Write-Host "    - $t" -ForegroundColor Yellow }
} else {
    Write-Host '  No outstanding TODOs. Re-running install.ps1 is a safe no-op.' -ForegroundColor Green
}
Write-Host ''
