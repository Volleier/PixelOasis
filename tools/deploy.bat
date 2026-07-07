@echo off
setlocal
cd /d "%~dp0.."
set "PROJECT_ROOT=%cd%"

echo Building PixelOasis deployable Photoshop plugin...
node "%~dp0deploy-plugin.mjs"
if errorlevel 1 (
  echo.
  echo Build failed. Make sure Node.js is installed and available in PATH.
  echo.
  pause
  exit /b 1
)

echo.
echo Done. Deployable plugin directory:
echo %PROJECT_ROOT%\PixelOasis
echo.
pause
