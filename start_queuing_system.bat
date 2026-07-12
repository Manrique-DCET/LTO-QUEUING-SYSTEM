@echo off
title LTO Queuing System Server
cd /d "%~dp0"

echo ====================================================================
echo   LTO SMART QUEUEING SYSTEM
echo ====================================================================
echo.
echo   [*] Starting the local server...
echo   [*] Please DO NOT close this window while using the queue system.
echo   [*] Minimizing this window is okay.
echo.
echo ====================================================================
echo.

:: Launch the portal in the default browser 2 seconds after server boots
start /min cmd /c "timeout /t 2 >nul && start http://localhost:3000"

:: Run node server (this blocks the window and keeps it open)
node server.js

if %errorlevel% neq 0 (
    echo.
    echo   [ERROR] Failed to start server.
    echo   Make sure Node.js is installed on this PC and port 3000 is free.
    echo.
    pause
)
