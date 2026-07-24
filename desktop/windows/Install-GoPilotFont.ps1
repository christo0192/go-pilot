[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Version = 'v3.4.0'
$FileName = 'JetBrainsMonoNLNerdFontMono-Regular.ttf'
$ExpectedSha256 = 'd83b3639f2a78e6d6da2cc2a7de4c2fc6817819a2199a6213790b3f7573710d1'
$Url = "https://github.com/ryanoasis/nerd-fonts/raw/$Version/patched-fonts/JetBrainsMono/NoLigatures/Regular/$FileName"
$FontDir = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Fonts'
$Destination = Join-Path $FontDir $FileName
$RegistryPath = 'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Fonts'
$RegistryName = 'JetBrainsMonoNL NFM (TrueType)'
$LegacyFamily = 'JetBrainsMono NL Nerd Font Mono'
$CurrentFamily = 'JetBrainsMonoNL NFM'

function Update-WindowsTerminalFontFamily {
    $settingsPaths = @(
        (Join-Path $env:LOCALAPPDATA 'Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json'),
        (Join-Path $env:LOCALAPPDATA 'Packages\Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe\LocalState\settings.json'),
        (Join-Path $env:LOCALAPPDATA 'Microsoft\Windows Terminal\settings.json')
    )
    foreach ($path in $settingsPaths) {
        if (-not (Test-Path $path)) { continue }
        $text = [IO.File]::ReadAllText($path)
        if (-not $text.Contains($LegacyFamily)) { continue }
        $backup = "$path.gopilot-font-backup"
        if (-not (Test-Path $backup)) { Copy-Item $path $backup }
        $updated = $text.Replace($LegacyFamily, $CurrentFamily)
        [IO.File]::WriteAllText($path, $updated, [Text.UTF8Encoding]::new($false))
        Write-Host "Updated Windows Terminal font family; backup: $backup" -ForegroundColor Green
    }
}

function Test-GoPilotFont {
    if (-not (Test-Path $Destination)) { return $false }
    $actual = (Get-FileHash -Algorithm SHA256 -Path $Destination).Hash.ToLowerInvariant()
    return $actual -eq $ExpectedSha256
}

if (Test-GoPilotFont) {
    New-Item -Force -Path $RegistryPath | Out-Null
    New-ItemProperty -Force -Path $RegistryPath -Name $RegistryName -Value $Destination -PropertyType String | Out-Null
    Write-Host 'JetBrainsMono NL Nerd Font Mono is already installed and verified.' -ForegroundColor Green
} else {
    $download = Join-Path ([IO.Path]::GetTempPath()) "gopilot-$FileName"
    try {
        Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $download
        $actual = (Get-FileHash -Algorithm SHA256 -Path $download).Hash.ToLowerInvariant()
        if ($actual -ne $ExpectedSha256) {
            throw "font checksum mismatch: expected $ExpectedSha256, received $actual"
        }
        New-Item -ItemType Directory -Force -Path $FontDir | Out-Null
        Copy-Item -Force $download $Destination
        New-Item -Force -Path $RegistryPath | Out-Null
        New-ItemProperty -Force -Path $RegistryPath -Name $RegistryName -Value $Destination -PropertyType String | Out-Null
        Write-Host 'Installed and verified JetBrainsMono NL Nerd Font Mono for this Windows user.' -ForegroundColor Green
    } finally {
        Remove-Item -Force $download -ErrorAction SilentlyContinue
    }
}

# Nerd Fonts v3 shortened family names. Repair only the exact obsolete name
# previously documented by Go-pilot and preserve the original settings once.
Update-WindowsTerminalFontFamily
