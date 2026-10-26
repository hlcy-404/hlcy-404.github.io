@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\Sync-Blog.ps1" %*
set "sync_exit=%errorlevel%"
echo.
pause
exit /b %sync_exit%
