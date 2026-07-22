[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class GoPilotNative {
    [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@

$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\GoPilotVoiceController', [ref]$created)
if (-not $created) { exit 0 }

$VoiceDir = Join-Path $PSScriptRoot 'voice'
$Whisper = Join-Path $VoiceDir 'bin\whisper-stream.exe'
$Model = Join-Path $VoiceDir 'models\ggml-small.en-q5_1.bin'
$Settings = Get-Content -Raw (Join-Path $VoiceDir 'settings.json') | ConvertFrom-Json
$Transcript = Join-Path $VoiceDir 'live-transcript.txt'
$IconPath = Join-Path $PSScriptRoot 'gopilot.ico'
$process = $null
$listening = $false
$offset = 0L
$partial = ''
$wasDown = $false

$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = New-Object System.Drawing.Icon($IconPath)
$tray.Text = 'Go-pilot Voice — F8 toggles local dictation'
$tray.Visible = $true

function Show-VoiceNotice([string]$Title, [string]$Text) {
    $tray.BalloonTipTitle = $Title
    $tray.BalloonTipText = $Text
    $tray.ShowBalloonTip(2500)
}

function Get-ForegroundProcessName {
    $pidValue = [uint32]0
    $window = [GoPilotNative]::GetForegroundWindow()
    [void][GoPilotNative]::GetWindowThreadProcessId($window, [ref]$pidValue)
    try { return (Get-Process -Id $pidValue -ErrorAction Stop).ProcessName }
    catch { return '' }
}

function Publish-Transcript([string]$Text) {
    $clean = (($Text -split "`r?`n") | ForEach-Object {
        ($_ -replace '^\[[^\]]+\]\s*', '').Trim()
    } | Where-Object { $_ }) -join ' '
    if ([string]::IsNullOrWhiteSpace($clean)) { return }

    $previous = ''
    try { if ([System.Windows.Forms.Clipboard]::ContainsText()) { $previous = [System.Windows.Forms.Clipboard]::GetText() } } catch {}
    [System.Windows.Forms.Clipboard]::SetText($clean)

    $foreground = Get-ForegroundProcessName
    $allowed = @($Settings.allowedProcesses) -contains $foreground
    if ($Settings.autoPaste -and $allowed) {
        # Windows Terminal's paste chord. Deliberately never send Enter.
        [System.Windows.Forms.SendKeys]::SendWait('^+v')
        Start-Sleep -Milliseconds 200
        if ($previous) { [System.Windows.Forms.Clipboard]::SetText($previous) }
    } else {
        Show-VoiceNotice 'Go-pilot Voice' "Transcript copied. Automatic paste blocked for '$foreground'."
    }
}

function Read-NewTranscript {
    if (-not (Test-Path $Transcript)) { return }
    try {
        $stream = [System.IO.File]::Open($Transcript, 'Open', 'Read', 'ReadWrite')
        try {
            if ($offset -gt $stream.Length) { $offset = 0 }
            [void]$stream.Seek($offset, 'Begin')
            $reader = New-Object System.IO.StreamReader($stream)
            $chunk = $reader.ReadToEnd()
            $offset = $stream.Position
        } finally { $stream.Dispose() }
    } catch { return }
    if (-not $chunk) { return }
    $partial += $chunk
    $blocks = $partial -split "(?:`r?`n){2,}"
    if ($partial -match "(?:`r?`n){2,}$") {
        $partial = ''
    } else {
        $partial = $blocks[-1]
        if ($blocks.Count -gt 1) { $blocks = $blocks[0..($blocks.Count - 2)] } else { $blocks = @() }
    }
    foreach ($block in $blocks) { Publish-Transcript $block }
}

function Start-Listening {
    if ($process -and -not $process.HasExited) { return }
    Set-Content -Encoding UTF8 -Path $Transcript -Value ''
    $script:offset = 0
    $script:partial = ''
    # Windows PowerShell 5.1 joins ArgumentList arrays without reliable quoting,
    # so quote the two paths explicitly (LocalAppData commonly contains spaces).
    $argumentLine = "--step 0 --length 10000 --keep 200 --model `"$Model`" --language $($Settings.language) --file `"$Transcript`""
    $script:process = Start-Process -FilePath $Whisper -ArgumentList $argumentLine -WindowStyle Hidden -PassThru
    $script:listening = $true
    [System.Media.SystemSounds]::Asterisk.Play()
    Show-VoiceNotice 'Go-pilot Voice' 'Listening locally. Speak, then pause. Press F8 again to stop.'
}

function Stop-Listening {
    if ($process -and -not $process.HasExited) {
        Read-NewTranscript
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
    $script:listening = $false
    [System.Media.SystemSounds]::Exclamation.Play()
    Show-VoiceNotice 'Go-pilot Voice' 'Microphone stopped. Press F8 to listen again.'
}

try {
    Show-VoiceNotice 'Go-pilot Voice ready' 'Press F8 to start or stop local dictation.'
    while ($true) {
        $down = ([GoPilotNative]::GetAsyncKeyState([int]$Settings.hotkeyVirtualKey) -band 0x8000) -ne 0
        if ($down -and -not $wasDown) {
            if ($listening) { Stop-Listening } else { Start-Listening }
        }
        $wasDown = $down
        if ($listening) {
            if ($process.HasExited) {
                $listening = $false
                Show-VoiceNotice 'Go-pilot Voice stopped' 'The speech engine exited; press F8 to retry.'
            } else {
                Read-NewTranscript
            }
        }
        [System.Windows.Forms.Application]::DoEvents()
        Start-Sleep -Milliseconds 80
    }
} finally {
    if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
    $tray.Visible = $false
    $tray.Dispose()
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
