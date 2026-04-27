@echo off
title Wingo Game Server Starter
echo ==========================================
echo   Wingo Game - Server Setup ^& Start
echo ==========================================
echo.

:: [1/4] Check if Node.js is installed
echo [1/4] Checking Node.js installation...
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [!] ERROR: Node.js is not installed!
    echo Please install it from: https://nodejs.org/
    pause
    exit /b
)
node -v
echo [OK] Node.js is ready.

echo.

:: [2/4] Checking dependencies
echo [2/4] Checking dependencies...
if not exist node_modules (
    echo [!] node_modules not found. Installing dependencies...
    call npm install
) else (
    echo [OK] Dependencies already installed.
)

echo.

:: [3/4] Starting Backend Server
echo [3/4] Starting Backend Server...
echo [TIP] Keep this window open while playing!
echo [TIP] If the window closes instantly, check 'error_log.txt' in this folder.
echo.
echo 🌐 Open your browser at: http://localhost:5555
echo.

:: Run node and ensure window stays open if it fails
node server.js
if %ERRORLEVEL% neq 0 (
    echo.
    echo [!] ERROR: The server crashed on startup.
    echo Please check 'error_log.txt' for details.
    pause
)

pause
