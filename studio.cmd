@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\Start-Studio.ps1"
if errorlevel 1 pause
