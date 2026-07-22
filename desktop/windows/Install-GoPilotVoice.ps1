[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$VoiceDir = Join-Path $PSScriptRoot 'voice'
$BinDir = Join-Path $VoiceDir 'bin'
$ModelDir = Join-Path $VoiceDir 'models'
$WhisperVersion = 'v1.9.1'
$WhisperUrl = 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.1/whisper-bin-x64.zip'
$WhisperSha256 = '7d8be46ecd31828e1eb7a2ecdd0d6b314feafd82163038ab6092594b0a063539'
$ModelUrl = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en-q5_1.bin'
$ModelSha256 = 'bfdff4894dcb76bbf647d56263ea2a96645423f1669176f4844a1bf8e478ad30'
$ModelPath = Join-Path $ModelDir 'ggml-small.en-q5_1.bin'

function Get-VerifiedFile {
    param(
        [Parameter(Mandatory)][string]$Url,
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Sha256,
        [Parameter(Mandatory)][string]$Label
    )
    if (Test-Path $Path) {
        $existing = (Get-FileHash -Algorithm SHA256 $Path).Hash.ToLowerInvariant()
        if ($existing -eq $Sha256) {
            Write-Host "$Label already installed and verified."
            return
        }
        Remove-Item -Force $Path
    }
    Write-Host "Downloading $Label..." -ForegroundColor Cyan
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Path
    $actual = (Get-FileHash -Algorithm SHA256 $Path).Hash.ToLowerInvariant()
    if ($actual -ne $Sha256) {
        Remove-Item -Force $Path
        throw "$Label SHA-256 mismatch; the download was deleted."
    }
}

New-Item -ItemType Directory -Force -Path $VoiceDir, $BinDir, $ModelDir | Out-Null
$archive = Join-Path $VoiceDir "whisper-$WhisperVersion-x64.zip"
Get-VerifiedFile -Url $WhisperUrl -Path $archive -Sha256 $WhisperSha256 -Label "whisper.cpp $WhisperVersion"

$extractDir = Join-Path $VoiceDir 'extract'
if (Test-Path $extractDir) { Remove-Item -Recurse -Force $extractDir }
New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
Expand-Archive -Force -Path $archive -DestinationPath $extractDir
$stream = Get-ChildItem -Recurse -File $extractDir | Where-Object Name -eq 'whisper-stream.exe' | Select-Object -First 1
if (-not $stream) { throw 'The verified whisper.cpp archive did not contain whisper-stream.exe.' }
Copy-Item -Force (Join-Path $stream.Directory.FullName '*') $BinDir
Remove-Item -Recurse -Force $extractDir

Get-VerifiedFile -Url $ModelUrl -Path $ModelPath -Sha256 $ModelSha256 -Label 'quantized Whisper small.en model'

$settings = Join-Path $VoiceDir 'settings.json'
if (-not (Test-Path $settings)) {
    [ordered]@{
        hotkeyVirtualKey = 119
        hotkeyName = 'F8'
        language = 'en'
        autoPaste = $true
        allowedProcesses = @('WindowsTerminal', 'wezterm-gui', 'cmd', 'powershell', 'pwsh')
    } | ConvertTo-Json | Set-Content -Encoding UTF8 $settings
}

Write-Host ''
Write-Host 'Local Go-pilot voice is ready.' -ForegroundColor Green
Write-Host 'Press F8 once to start listening and F8 again to stop.'
Write-Host 'Final text is pasted only into an allowlisted terminal and Enter is never pressed.'
