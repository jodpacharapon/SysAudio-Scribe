@echo off
REM ---------------------------------------------------------------------------
REM  Double-click launcher for SysAudio-Scribe.
REM
REM  Why not the packaged .exe?
REM  Windows Smart App Control blocks unsigned executables, and this app ships
REM  unsigned. The official Electron binary IS trusted, so we run the production
REM  bundle (out/) through it instead. Same app, no security downgrade.
REM
REM  Requires: npm install (once), and out/ built (this script builds if missing).
REM ---------------------------------------------------------------------------
cd /d "%~dp0"

if not exist "out\main\index.js" (
  echo Building app for the first time, please wait...
  call npm run build
  if errorlevel 1 (
    echo.
    echo Build failed. Run "npm install" first, then try again.
    pause
    exit /b 1
  )
)

start "" /b npx electron .
exit /b 0
