@echo off
setlocal
cd /d "%~dp0.."
set "PROJECT_ROOT=%cd%"

echo Starting PixelOasis Online Model Gateway...
node "%~dp0start-online-gateway.mjs"
if errorlevel 1 (
  echo.
  echo Online gateway failed to start.
  echo.
  pause
  exit /b 1
)

echo.
echo Online gateway stopped.
pause
