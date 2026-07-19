[CmdletBinding()]
param(
  [switch]$Resume,
  [string]$BootstrapPath = (Join-Path $PSScriptRoot 'setup.cmd')
)

$ErrorActionPreference = 'Stop'
$Distro = 'Ubuntu'
$RepoUrl = 'https://github.com/christo0192/go-pilot.git'
$RepoDir = '~/Go-pilot'
$ResumeName = 'GoPilotSetupResume'

function Step([string]$Text) { Write-Host "`n==> $Text" -ForegroundColor Cyan }
function Fail([string]$Text) { throw $Text }
function Invoke-Wsl([string[]]$Arguments) {
  & wsl.exe -d $Distro @Arguments
  if ($LASTEXITCODE -ne 0) { Fail "WSL command failed (exit $LASTEXITCODE): $($Arguments -join ' ')" }
}
function Test-Administrator {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($id)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
function Set-Resume {
  $cmd = 'cmd.exe /c ""{0}""' -f $BootstrapPath
  New-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce' `
    -Name $ResumeName -Value $cmd -PropertyType String -Force | Out-Null
}
function Clear-Resume {
  Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce' `
    -Name $ResumeName -ErrorAction SilentlyContinue
}
function Read-Secret([string]$Prompt) {
  $secure = Read-Host $Prompt -AsSecureString
  if ($secure.Length -eq 0) { return '' }
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

try {
  Write-Host "`n============================================================"
  Write-Host ' Go-pilot one-click setup (Windows + Ubuntu WSL)'
  Write-Host "============================================================`n"

  if (-not (Test-Administrator)) {
    Step 'Requesting Administrator permission for WSL setup'
    $args = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -BootstrapPath `"$BootstrapPath`""
    $process = Start-Process powershell.exe -Verb RunAs -ArgumentList $args -Wait -PassThru
    exit $process.ExitCode
  }

  if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
    Step 'Enabling Windows features required by WSL'
    Set-Resume
    & dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
    if ($LASTEXITCODE -ne 0) { Fail 'Windows could not enable WSL.' }
    & dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
    if ($LASTEXITCODE -ne 0) { Fail 'Windows could not enable Virtual Machine Platform.' }
    Write-Host 'Windows may restart now. Setup will resume automatically after sign-in.' -ForegroundColor Yellow
    Restart-Computer -Confirm
    exit 0
  }

  Step 'Selecting the dedicated Ubuntu distribution'
  $distros = @(& wsl.exe --list --quiet | ForEach-Object { $_.Replace([char]0, '').Trim() })
  if ($Distro -notin $distros) {
    Set-Resume
    & wsl.exe --install -d $Distro --no-launch
    if ($LASTEXITCODE -ne 0) { Fail 'Ubuntu installation failed.' }
  }

  # Launching as root completes distro registration without the interactive
  # Ubuntu username wizard. We create a predictable non-root user ourselves.
  Step 'Initializing Ubuntu'
  & wsl.exe -d $Distro -u root -- true
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'Ubuntu needs a Windows restart. Setup will resume after sign-in.' -ForegroundColor Yellow
    Set-Resume
    Restart-Computer -Confirm
    exit 0
  }

  $actualUser = (& wsl.exe -d $Distro -- whoami).Trim()
  if ($LASTEXITCODE -ne 0) { Fail 'Could not determine the Ubuntu default user.' }
  if ($actualUser -eq 'root') {
    $linuxUser = ($env:USERNAME.ToLowerInvariant() -replace '[^a-z0-9_-]', '')
    if ($linuxUser -notmatch '^[a-z_]') { $linuxUser = "user$linuxUser" }
    if ([string]::IsNullOrWhiteSpace($linuxUser)) { $linuxUser = 'gopilot' }
    $bootstrap = @"
set -e
id '$linuxUser' >/dev/null 2>&1 || useradd -m -s /bin/bash '$linuxUser'
# A final user section wins without deleting any pre-existing WSL settings.
printf '\n[user]\ndefault=$linuxUser\n' >> /etc/wsl.conf
"@
    Invoke-Wsl @('-u', 'root', '--', 'bash', '-c', $bootstrap)
    & wsl.exe --terminate $Distro
    Start-Sleep -Seconds 5
    $actualUser = (& wsl.exe -d $Distro -- whoami).Trim()
    if ($actualUser -ne $linuxUser) { Fail "Ubuntu default user is '$actualUser', expected '$linuxUser'." }
  } else {
    $linuxUser = $actualUser
    Write-Host "Using existing Ubuntu user '$linuxUser'; its files and settings are preserved."
  }

  $key = Read-Secret 'Paste WORKHORSE_GATEWAY_KEY (input is hidden)'
  if ([string]::IsNullOrWhiteSpace($key)) { Fail 'A workhorse gateway key is required for a ready installation.' }
  $oldWslenv = $env:WSLENV
  $parts = @($oldWslenv -split ':' | Where-Object { $_ -and $_ -notmatch '^GOPILOT_WORKHORSE_KEY(?:/|$)' })
  $env:WSLENV = (@($parts) + 'GOPILOT_WORKHORSE_KEY/u') -join ':'
  $env:GOPILOT_WORKHORSE_KEY = $key

  Step 'Installing base packages'
  Invoke-Wsl @('-u', 'root', '--', 'bash', '-c', 'export DEBIAN_FRONTEND=noninteractive; apt-get update -y >/dev/null && apt-get install -y ca-certificates curl git >/dev/null')

  Step 'Fetching Go-pilot safely into the Linux filesystem'
  $fetch = "if [ -d $RepoDir/.git ]; then git -C $RepoDir diff --quiet && git -C $RepoDir diff --cached --quiet || { echo 'Existing Go-pilot checkout has local changes; refusing to overwrite.' >&2; exit 20; }; git -C $RepoDir pull --ff-only; else git clone '$RepoUrl' $RepoDir; fi"
  Invoke-Wsl @('--', 'bash', '-lc', $fetch)

  Step 'Provisioning Node, Docker, and systemd'
  Invoke-Wsl @('-u', 'root', '--', 'bash', "/home/$linuxUser/Go-pilot/scripts/oneclick-root.sh", 'provision', $linuxUser)
  & wsl.exe --terminate $Distro
  Start-Sleep -Seconds 6
  Invoke-Wsl @('-u', 'root', '--', 'bash', "/home/$linuxUser/Go-pilot/scripts/oneclick-root.sh", 'post-restart')

  Step 'Installing Herdr, Pi, Claude Code, Codex CLI, and Go-pilot'
  Invoke-Wsl @('--', 'bash', '-lc', "cd $RepoDir && bash install.sh --one-click")
  Clear-Resume

  Step 'Opening Herdr with Claude Code and Codex ready for subscription sign-in'
  $launch = "wsl.exe -d $Distro -- bash /home/$linuxUser/Go-pilot/scripts/oneclick-launch.sh"
  if (Get-Command wt.exe -ErrorAction SilentlyContinue) {
    Start-Process wt.exe -ArgumentList @('wsl.exe', '-d', $Distro, '--', 'bash', "/home/$linuxUser/Go-pilot/scripts/oneclick-launch.sh")
  } else {
    Start-Process cmd.exe -ArgumentList @('/c', 'start', 'Go-pilot', $launch)
  }
  Write-Host "`nREADY. In Herdr, run 'claude' and 'codex' once to complete subscription login." -ForegroundColor Green
  exit 0
} catch {
  Write-Host "`nSETUP FAILED: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host 'Nothing was reported ready. Fix the error and double-click setup.cmd again.' -ForegroundColor Yellow
  exit 1
} finally {
  $env:GOPILOT_WORKHORSE_KEY = $null
}
