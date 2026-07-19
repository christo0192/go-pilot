@echo off
setlocal EnableExtensions
title Go-pilot setup
set "SCRIPT_DIR=%~dp0"
set "SETUP_PS=%SCRIPT_DIR%setup-windows.ps1"
if not exist "%SETUP_PS%" (
  set "SETUP_DIR=%TEMP%\GoPilotSetup"
  if not exist "%TEMP%\GoPilotSetup" mkdir "%TEMP%\GoPilotSetup"
  set "SETUP_PS=%TEMP%\GoPilotSetup\setup-windows.ps1"
  echo Downloading the signed-in-repository setup companion...
  powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/christo0192/go-pilot/main/setup-windows.ps1' -OutFile '%TEMP%\GoPilotSetup\setup-windows.ps1'"
  if errorlevel 1 (
    echo Could not download setup-windows.ps1. Check your internet connection.
    pause
    exit /b 1
  )
)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SETUP_PS%" -BootstrapPath "%~f0"
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  echo.
  echo Go-pilot setup stopped. Review the error above, then run this file again.
  pause
)
exit /b %RC%
