@echo off
setlocal EnableExtensions
set "WR=C:\Users\92893\WorkBuddy\automation-2026-07-22-13-54-50\withdraw-report"
set "WORKBENCH=C:\Users\92893\WorkBuddy\2026-07-28-10-25-30\workbench"
set "PYW=C:\Users\92893\AppData\Local\Programs\Python\Python312\pythonw.exe"
set "PORT=8788"
set "NODE_DIR=C:\Users\92893\.workbuddy\binaries\node\versions\22.22.2"

REM Kill any old workbench on this port (and stale vite 5173)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%PORT%" ^| findstr "LISTENING"') do taskkill /f /pid %%a >nul 2>nul
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5173" ^| findstr "LISTENING"') do taskkill /f /pid %%a >nul 2>nul

REM Build dist if missing
if exist "%WORKBENCH%\dist\index.html" goto RUN
set "PATH=%NODE_DIR%;%PATH%"
cd /d "%WORKBENCH%"
call npm run build > "%WR%\build.log" 2>&1
if errorlevel 1 (
    echo [ERROR] build failed, see %WR%\build.log
    pause
    exit /b 1
)

:RUN
cd /d "%WR%"

REM pythonw = no console window; start detaches it from this bat so the bat can exit cleanly
start "" "%PYW%" compare_backend.py --port %PORT% --host 127.0.0.1 --dist "%WORKBENCH%\dist"

REM Wait for port to listen (max 15s)
set /a COUNT=0
:WAIT_LOOP
set /a COUNT+=1
if %COUNT% GTR 15 goto OPEN_BROWSER
netstat -an | findstr ":%PORT%" | findstr "LISTENING" >nul
if errorlevel 1 (
    timeout /t 1 /nobreak >nul
    goto WAIT_LOOP
)

:OPEN_BROWSER
start "" "http://127.0.0.1:%PORT%/"
exit /b 0
