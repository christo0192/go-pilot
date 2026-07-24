[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Distro,
    [Parameter(Mandatory)][string]$LinuxUser,
    [Parameter(Mandatory)][string]$RepoLinuxPath,
    [Parameter(Mandatory)][string]$RepoWindowsPath,
    [switch]$NoDesktopShortcut
)

$ErrorActionPreference = 'Stop'
$InstallDir = Join-Path $env:LOCALAPPDATA 'Programs\Go-pilot'
$StartMenuDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Go-pilot'
$DesktopDir = [Environment]::GetFolderPath('Desktop')

function New-GoPilotShortcut {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$Action,
        [string]$Description = ''
    )
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($Path)
    $shortcut.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    $shortcut.Arguments = "-NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$InstallDir\GoPilot.ps1`" -Action $Action"
    $shortcut.WorkingDirectory = $InstallDir
    $shortcut.IconLocation = "$InstallDir\gopilot.ico,0"
    $shortcut.Description = if ($Description) { $Description } else { $Name }
    $shortcut.Save()
}

New-Item -ItemType Directory -Force -Path $InstallDir, $StartMenuDir | Out-Null

$files = @(
    'GoPilot.ps1',
    'Install-GoPilotApp.ps1',
    'Install-GoPilotFont.ps1',
    'Install-GoPilotVoice.ps1',
    'GoPilotVoice.ps1',
    'Uninstall-GoPilot.ps1'
)
foreach ($file in $files) {
    Copy-Item -Force (Join-Path $RepoWindowsPath "desktop\windows\$file") (Join-Path $InstallDir $file)
}

# Herdr/Windows Terminal profiles use this exact family name. Install one
# checksum-pinned regular face per-user on every fresh install/update.
& (Join-Path $InstallDir 'Install-GoPilotFont.ps1')
Copy-Item -Force (Join-Path $RepoWindowsPath 'desktop\assets\gopilot.ico') (Join-Path $InstallDir 'gopilot.ico')
Copy-Item -Force (Join-Path $RepoWindowsPath 'desktop\assets\gopilot-icon.png') (Join-Path $InstallDir 'gopilot-icon.png')

$package = Get-Content -Raw (Join-Path $RepoWindowsPath 'package.json') | ConvertFrom-Json
$config = [ordered]@{
    distro = $Distro
    linuxUser = $LinuxUser
    repoLinuxPath = $RepoLinuxPath
    repoWindowsPath = $RepoWindowsPath
    # Follow every main commit whose GitHub Actions CI passed. Change to
    # 'stable' to follow deliberate version tags/releases instead.
    updateChannel = 'nightly'
    autoUpdate = $true
    autoStartVoice = $true
}
$existingConfig = Join-Path $InstallDir 'config.json'
if (Test-Path $existingConfig) {
    $old = Get-Content -Raw $existingConfig | ConvertFrom-Json
    foreach ($name in 'updateChannel', 'autoUpdate', 'autoStartVoice') {
        if ($null -ne $old.$name) { $config[$name] = $old.$name }
    }
}
$config | ConvertTo-Json | Set-Content -Encoding UTF8 $existingConfig

New-GoPilotShortcut -Path (Join-Path $StartMenuDir 'Go-pilot.lnk') -Name 'Go-pilot' -Action 'Launch' `
    -Description 'Open or resume Go-pilot'
New-GoPilotShortcut -Path (Join-Path $StartMenuDir 'Go-pilot Voice.lnk') -Name 'Go-pilot Voice' -Action 'Voice' `
    -Description 'Install or start local push-to-talk dictation'
New-GoPilotShortcut -Path (Join-Path $StartMenuDir 'Update Go-pilot.lnk') -Name 'Update Go-pilot' -Action 'Update' `
    -Description 'Check the configured Go-pilot update channel'
New-GoPilotShortcut -Path (Join-Path $StartMenuDir 'Rollback Go-pilot.lnk') -Name 'Rollback Go-pilot' -Action 'Rollback' `
    -Description 'Return to the previous successfully installed Go-pilot commit'
New-GoPilotShortcut -Path (Join-Path $StartMenuDir 'Go-pilot Doctor.lnk') -Name 'Go-pilot Doctor' -Action 'Doctor' `
    -Description 'Verify the Go-pilot installation'
New-GoPilotShortcut -Path (Join-Path $StartMenuDir 'Uninstall Go-pilot.lnk') -Name 'Uninstall Go-pilot' -Action 'Uninstall'

if (-not $NoDesktopShortcut -and $DesktopDir) {
    New-GoPilotShortcut -Path (Join-Path $DesktopDir 'Go-pilot.lnk') -Name 'Go-pilot' -Action 'Launch' `
        -Description 'Open or resume Go-pilot'
}

$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Go-pilot'
New-Item -Force $uninstallKey | Out-Null
New-ItemProperty -Path $uninstallKey -Name DisplayName -Value 'Go-pilot' -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name DisplayVersion -Value $package.version -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name Publisher -Value 'Go-pilot' -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name DisplayIcon -Value "$InstallDir\gopilot.ico" -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name InstallLocation -Value $InstallDir -PropertyType String -Force | Out-Null
$uninstallCommand = "powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$InstallDir\Uninstall-GoPilot.ps1`""
New-ItemProperty -Path $uninstallKey -Name UninstallString -Value $uninstallCommand -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name NoModify -Value 1 -PropertyType DWord -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name NoRepair -Value 1 -PropertyType DWord -Force | Out-Null

Write-Host "Go-pilot application shell installed: $InstallDir" -ForegroundColor Green
Write-Host 'Open Go-pilot from the Start menu; closing its terminal will preserve the headless session.'
