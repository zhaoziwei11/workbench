@echo off
REM Start the workbench desktop app (Electron).
REM Run this by double-clicking. Requires dependencies installed (npm install).
REM If you changed source code, run "npm run build" first to refresh dist/.
cd /d "%~dp0"
call npm run electron
