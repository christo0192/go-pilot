@echo off
setlocal EnableExtensions
title Go-pilot setup
set "SCRIPT_DIR=%~dp0"
set "SETUP_DIR=%TEMP%\GoPilotSetup"
set "SETUP_PS=%TEMP%\GoPilotSetup\setup-windows.ps1"
set "SETUP_CMD=%TEMP%\GoPilotSetup\setup.cmd"
if not exist "%SETUP_DIR%" mkdir "%SETUP_DIR%"

REM Always run from a local Windows path. This handles setup.cmd launched from
REM \wsl.localhost, a network share, Downloads, or a directory containing spaces.
if /I not "%~f0"=="%SETUP_CMD%" copy /Y "%~f0" "%SETUP_CMD%" >nul
if exist "%SCRIPT_DIR%setup-windows.ps1" (
  if /I not "%SCRIPT_DIR%setup-windows.ps1"=="%SETUP_PS%" copy /Y "%SCRIPT_DIR%setup-windows.ps1" "%SETUP_PS%" >nul
) else (
  echo Downloading the Go-pilot setup companion...
  powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/christo0192/go-pilot/main/setup-windows.ps1' -OutFile '%SETUP_PS%'"
)
if not exist "%SETUP_PS%" (
  echo Could not prepare setup-windows.ps1. Check your internet connection.
  pause
  exit /b 1
)

pushd "%SETUP_DIR%"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SETUP_PS%" -BootstrapPath "%SETUP_CMD%"
set "RC=%ERRORLEVEL%"
popd
if not "%RC%"=="0" (
  echo.
  echo Go-pilot setup stopped. Review the error above, then run this file again.
  pause
)
exit /b %RC%
