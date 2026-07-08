@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0.."

set LOCAL_CONFIG=%cd%\config.local.yaml
set TEMPLATE_CONFIG=%cd%\config.yaml
set PLUGIN_DIR=%cd%\PixelOasis

echo ========================================
echo   PixelOasis Plugin Migration Tool
echo ========================================
echo.

:: ── Step 1: Resolve config ──
set CONFIG_FILE=
if exist "%LOCAL_CONFIG%" (
    set "CONFIG_FILE=%LOCAL_CONFIG%"
    echo [Config] Using config.local.yaml
) else if exist "%TEMPLATE_CONFIG%" (
    echo [Config] No config.local.yaml found.
    echo   Copying config.yaml to config.local.yaml for you...
    copy "%TEMPLATE_CONFIG%" "%LOCAL_CONFIG%" >nul
    if exist "%LOCAL_CONFIG%" (
        set "CONFIG_FILE=%LOCAL_CONFIG%"
        echo [Config] Created config.local.yaml — please edit it with your Photoshop path.
        echo   File: %LOCAL_CONFIG%
        echo.
        start notepad "%LOCAL_CONFIG%"
        echo   Edit and save the file, then press any key to continue...
        pause >nul
    ) else (
        echo ERROR: Failed to create config.local.yaml
        pause
        exit /b 1
    )
) else (
    echo ERROR: No config file found ^(config.yaml or config.local.yaml^)
    pause
    exit /b 1
)

:: ── Step 2: Parse plugin_path from YAML ──
set "PS_PATH="
for /f "usebackq tokens=1,* delims=: " %%a in (`type "!CONFIG_FILE!" ^| findstr "plugin_path:"`) do (
    set "PS_PATH=%%b"
)
:: Strip surrounding quotes and trailing spaces
set PS_PATH=!PS_PATH:"=!
set PS_PATH=!PS_PATH:'=!
:: Trim leading/trailing spaces
for /f "tokens=*" %%a in ("!PS_PATH!") do set PS_PATH=%%a

if "!PS_PATH!"=="" (
    echo ERROR: Could not parse plugin_path from !CONFIG_FILE!
    echo Expected line like:   plugin_path: "D:/Adobe/Adobe Photoshop 2026/Plug-ins"
    pause
    exit /b 1
)
echo [Config] Photoshop Plug-ins: !PS_PATH!

:: ── Step 3: Validate PS path ──
if not exist "!PS_PATH!\" (
    echo.
    echo ERROR: Directory does not exist: !PS_PATH!
    echo Open config.local.yaml and update plugin_path with the correct Photoshop Plug-ins folder.
    pause
    exit /b 1
)

:: ── Step 4: Build if needed ──
if not exist "%PLUGIN_DIR%\manifest.json" (
    echo.
    echo [Build] Plugin not built yet. Running deploy first...
    call "%~dp0deploy.bat"
    if errorlevel 1 (
        echo ERROR: Build failed.
        pause
        exit /b 1
    )
)

:: ── Step 5: Verify build output ──
if not exist "%PLUGIN_DIR%\manifest.json" (
    echo ERROR: Build output not found at %PLUGIN_DIR%
    pause
    exit /b 1
)

:: ── Step 6: Remove old plugin ──
set "DEST_DIR=!PS_PATH!\PixelOasis"
if exist "!DEST_DIR!\" (
    echo.
    echo [Clean] Removing old plugin: !DEST_DIR!
    rmdir /s /q "!DEST_DIR!"
)

:: ── Step 7: Move plugin ──
echo.
echo [Migrate] Moving PixelOasis to Photoshop Plug-ins...
move "%PLUGIN_DIR%" "!PS_PATH!\" >nul 2>&1
if errorlevel 1 (
    echo ERROR: Failed to move plugin.
    echo   - Make sure Photoshop is closed.
    echo   - You may need to run as Administrator.
    pause
    exit /b 1
)

echo.
echo ========================================
echo   Migration complete!
echo   Plugin: !DEST_DIR!
echo ========================================
echo.
pause
