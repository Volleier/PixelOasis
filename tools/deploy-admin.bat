@echo off
setlocal
cd /d "%~dp0.."
set "PROJECT_ROOT=%cd%"

echo [1/3] Building deployable plugin...
node tools\deploy-plugin.mjs

echo [2/3] Checking destination directory...
set "DEST=C:\Program Files\Adobe\Adobe Photoshop 2026\Plug-ins\PixelOasis"
if not exist "%DEST%" (
    echo Creating "%DEST%"...
    mkdir "%DEST%"
)

echo [3/3] Copying plugin files...
robocopy "%PROJECT_ROOT%\PixelOasis" "%DEST%" /MIR /NFL /NDL /NJH /NJS /nc /ns /np

echo Granting permission to Users group for seamless future deployments...
icacls "%DEST%" /grant Users:(OI)(CI)F /T /Q >nul 2>&1

echo.
echo ========================================================
echo PixelOasis successfully deployed to:
echo %DEST%
echo ========================================================
echo.
pause
