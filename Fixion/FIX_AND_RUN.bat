@echo off
setlocal enabledelayedexpansion
echo ==========================================
echo    FIXION AI - PORT REPAIR ^& STARTUP
echo ==========================================
echo [1/2] Searching for zombie processes on port 8000...

set FOUND=0
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8000') do (
    set PID=%%a
    if not "!PID!"=="0" (
        echo [!] Found blocking process (PID: !PID!). Killing it...
        taskkill /F /PID !PID! >nul 2>&1
        set FOUND=1
    )
)

if "!FOUND!"=="0" (
    echo [OK] Port 8000 is already clear.
) else (
    echo [OK] Port 8000 has been cleared.
)

timeout /t 1 >nul
echo [2/2] Starting Reliability Engine v1.2 Gold...
python main.py
pause
