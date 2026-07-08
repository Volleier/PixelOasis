@echo off
setlocal
cd /d "%~dp0.."
set "PROJECT_ROOT=%cd%"

echo Starting PixelOasis Model Gateway...
node "%~dp0start-gateway.mjs"
if errorlevel 1 (
  echo.
  echo Gateway failed to start. Make sure:
  echo   1. Node.js is installed and available in PATH.
  echo   2. Dependencies are installed ^(run: cd services\model-gateway ^&^& npm install^)
  echo   3. config.yaml has correct paths and ports.
  echo.
  pause
  exit /b 1
)

echo.
echo Gateway stopped.
pause
