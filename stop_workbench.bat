@echo off
setlocal EnableExtensions
set "PORT=8788"

set "KILLED=0"

REM Scan every LISTENING socket on this port and kill its owner PID
for /f "tokens=*" %%L in ('netstat -aon ^| findstr ":%PORT%  " ^| findstr "LISTENING"') do (
    for /f "tokens=5" %%P in ("%%L") do (
        taskkill /f /pid %%P >nul 2>nul
        if not errorlevel 1 set "KILLED=1"
    )
)

if "%KILLED%"=="1" (
    echo [OK] Workbench backend stopped
) else (
    echo [INFO] No running workbench backend found on port %PORT%
)
exit /b 0
