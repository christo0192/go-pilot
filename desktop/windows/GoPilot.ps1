[CmdletBinding()]
param(
    [ValidateSet('Launch', 'Update', 'Rollback', 'Doctor', 'Voice', 'Uninstall')]
    [string]$Action = 'Launch',
    [ValidateSet('stable', 'nightly')]
    [string]$Channel,
    [switch]$Silent
)

$ErrorActionPreference = 'Stop'
$InstallDir = $PSScriptRoot
$ConfigPath = Join-Path $InstallDir 'config.json'
$LogDir = Join-Path $env:LOCALAPPDATA 'Go-pilot\logs'
$LogPath = Join-Path $LogDir 'launcher.log'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-LauncherLog([string]$Message) {
    "$(Get-Date -Format o) $Message" | Add-Content -Encoding UTF8 $LogPath
}

if (-not (Test-Path $ConfigPath)) { throw "Go-pilot launcher config is missing: $ConfigPath" }
$Config = Get-Content -Raw $ConfigPath | ConvertFrom-Json
if ($Channel) {
    $Config.updateChannel = $Channel
    $Config | ConvertTo-Json | Set-Content -Encoding UTF8 $ConfigPath
}

function Invoke-GoPilotWsl {
    param([Parameter(Mandatory)][string[]]$Arguments, [switch]$IgnoreExitCode)
    & wsl.exe -d $Config.distro -u $Config.linuxUser -- @Arguments | ForEach-Object { Write-Host $_ }
    $code = $LASTEXITCODE
    if (-not $IgnoreExitCode -and $code -ne 0) { throw "WSL command failed with exit code $code" }
    return $code
}

function Sync-InstalledAssets {
    $installer = Join-Path $Config.repoWindowsPath 'desktop\windows\Install-GoPilotApp.ps1'
    if (-not (Test-Path $installer)) {
        Write-LauncherLog "asset refresh skipped; installer not found at $installer"
        return
    }
    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $installer `
        -Distro $Config.distro -LinuxUser $Config.linuxUser `
        -RepoLinuxPath $Config.repoLinuxPath -RepoWindowsPath $Config.repoWindowsPath `
        -NoDesktopShortcut *> $null
}

function Start-VoiceController {
    $voice = Join-Path $InstallDir 'GoPilotVoice.ps1'
    $model = Join-Path $InstallDir 'voice\models\ggml-small.en-q5_1.bin'
    if ((Test-Path $voice) -and (Test-Path $model)) {
        Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @(
            '-NoLogo', '-NoProfile', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', "`"$voice`""
        ) | Out-Null
    }
}

try {
    switch ($Action) {
        'Launch' {
            if ($Config.autoUpdate) {
                try {
                    Write-LauncherLog "automatic $($Config.updateChannel) update check"
                    Invoke-GoPilotWsl -Arguments @('bash', "$($Config.repoLinuxPath)/scripts/gopilot-update.sh", '--channel', $Config.updateChannel, '--auto') | Out-Null
                    Sync-InstalledAssets
                } catch {
                    # An unavailable update service must never prevent local work.
                    Write-LauncherLog "automatic update skipped: $($_.Exception.Message)"
                }
            }
            if ($Config.autoStartVoice) { Start-VoiceController }
            $launchArgs = @(
                'wsl.exe', '-d', $Config.distro, '-u', $Config.linuxUser, '--',
                'bash', "$($Config.repoLinuxPath)/scripts/gopilot-session.sh", 'attach'
            )
            if (Get-Command wt.exe -ErrorAction SilentlyContinue) {
                Start-Process wt.exe -ArgumentList $launchArgs | Out-Null
            } else {
                Start-Process wsl.exe -ArgumentList @(
                    '-d', $Config.distro, '-u', $Config.linuxUser, '--',
                    'bash', "$($Config.repoLinuxPath)/scripts/gopilot-session.sh", 'attach'
                ) | Out-Null
            }
        }
        'Update' {
            $code = Invoke-GoPilotWsl -Arguments @('bash', "$($Config.repoLinuxPath)/scripts/gopilot-update.sh", '--channel', $Config.updateChannel) -IgnoreExitCode
            if ($code -eq 0) { Sync-InstalledAssets }
            if (-not $Silent) {
                $message = if ($code -eq 0) { 'Go-pilot is up to date.' } else { "Update stopped with exit code $code. See $LogPath" }
                Add-Type -AssemblyName PresentationFramework
                [System.Windows.MessageBox]::Show($message, 'Go-pilot update') | Out-Null
            }
        }
        'Rollback' {
            $code = Invoke-GoPilotWsl -Arguments @('bash', "$($Config.repoLinuxPath)/scripts/gopilot-update.sh", '--rollback') -IgnoreExitCode
            if ($code -eq 0) { Sync-InstalledAssets }
            if (-not $Silent) {
                $message = if ($code -eq 0) { 'Go-pilot returned to the previously installed commit.' } else { "Rollback stopped with exit code $code. See $LogPath" }
                Add-Type -AssemblyName PresentationFramework
                [System.Windows.MessageBox]::Show($message, 'Go-pilot rollback') | Out-Null
            }
        }
        'Doctor' {
            $args = @(
                'wsl.exe', '-d', $Config.distro, '-u', $Config.linuxUser, '--',
                'bash', '-lc', "cd '$($Config.repoLinuxPath)' && bash install.sh --doctor; printf '\nPress Enter to close...'; read"
            )
            if (Get-Command wt.exe -ErrorAction SilentlyContinue) {
                Start-Process wt.exe -ArgumentList $args | Out-Null
            } else {
                Start-Process wsl.exe -ArgumentList $args[1..($args.Count - 1)] | Out-Null
            }
        }
        'Voice' {
            $model = Join-Path $InstallDir 'voice\models\ggml-small.en-q5_1.bin'
            if (-not (Test-Path $model)) {
                & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $InstallDir 'Install-GoPilotVoice.ps1')
                if ($LASTEXITCODE -ne 0) { throw 'Local voice installation did not complete.' }
            }
            Start-VoiceController
        }
        'Uninstall' {
            & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $InstallDir 'Uninstall-GoPilot.ps1')
        }
    }
} catch {
    Write-LauncherLog "$Action failed: $($_.Exception.Message)"
    if (-not $Silent) {
        Add-Type -AssemblyName PresentationFramework
        [System.Windows.MessageBox]::Show($_.Exception.Message, "Go-pilot $Action failed") | Out-Null
    }
    exit 1
}
