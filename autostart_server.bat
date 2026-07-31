@echo off
setlocal EnableExtensions
set "WR=C:\Users\92893\WorkBuddy\automation-2026-07-22-13-54-50\withdraw-report"
set "WORKBENCH=C:\Users\92893\WorkBuddy\2026-07-28-10-25-30\workbench"
set "PYW=C:\Users\92893\AppData\Local\Programs\Python\Python312\pythonw.exe"
set "PORT=8788"

REM Self-heal: kill any existing listener on this port (e.g. a stale instance)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%PORT% " ^| findstr "LISTENING"') do taskkill /f /pid %%a >nul 2>nul

cd /d "%WR%"
start "" "%PYW%" compare_backend.py --port %PORT% --host 127.0.0.1 --dist "%WORKBENCH%\dist"
exit /b 0
