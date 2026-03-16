@echo off
setlocal
cd /d "%~dp0"
node ".\scripts\generate-controller-manifest.js"
if errorlevel 1 (
    echo Failed to regenerate controller-manifest.js
    pause
    exit /b 1
)
echo Generated controller-manifest.js
