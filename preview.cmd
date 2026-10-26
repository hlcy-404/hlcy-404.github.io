@echo off
cd /d "%~dp0"
docker info >nul 2>&1
if errorlevel 1 (
  echo Start Docker Desktop, wait until it is ready, then run preview.cmd again.
  pause
  exit /b 1
)
echo Preview will be available at http://127.0.0.1:4000 after the first build.
echo Press Ctrl+C to stop. First run downloads Ruby dependencies.
docker compose up
set "preview_exit=%errorlevel%"
pause
exit /b %preview_exit%
