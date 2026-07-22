[CmdletBinding()]
param([switch]$KeepShortcuts)

$ErrorActionPreference = 'Stop'
$InstallDir = $PSScriptRoot
$StartMenuDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Go-pilot'
$DesktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Go-pilot.lnk'

Add-Type -AssemblyName PresentationFramework
$answer = [System.Windows.MessageBox]::Show(
    'Remove the Windows Go-pilot launcher and local voice model? The WSL runtime, conversations, configuration, and Docker data will be kept.',
    'Uninstall Go-pilot',
    [System.Windows.MessageBoxButton]::YesNo,
    [System.Windows.MessageBoxImage]::Question
)
if ($answer -ne [System.Windows.MessageBoxResult]::Yes) { exit 0 }

Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*GoPilotVoice.ps1*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

if (-not $KeepShortcuts) {
    Remove-Item -Recurse -Force $StartMenuDir -ErrorAction SilentlyContinue
    Remove-Item -Force $DesktopShortcut -ErrorAction SilentlyContinue
}
Remove-Item -Recurse -Force 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Go-pilot' -ErrorAction SilentlyContinue

# A running script cannot delete its own directory. Use a short-lived, hidden
# cmd process after this PowerShell process exits.
$escaped = $InstallDir.Replace('"', '""')
Start-Process cmd.exe -WindowStyle Hidden -ArgumentList "/d /c timeout /t 2 /nobreak >nul & rmdir /s /q `"$escaped`"" | Out-Null
[System.Windows.MessageBox]::Show('Go-pilot launcher removed. WSL runtime and saved conversations were preserved.', 'Go-pilot') | Out-Null
