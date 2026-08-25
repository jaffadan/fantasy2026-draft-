@echo off
setlocal EnableDelayedExpansion
title CBS Sports Fantasy - Live Data Sync
echo ========================================================
echo   CBS Sports Fantasy - Live Data Sync
echo ========================================================
cd /d "%~dp0"

set "PYTHON_EXE="

if exist "C:\Users\DanJaffa\AppData\Local\Python\pythoncore-3.14-64\python.exe" (
    set "PYTHON_EXE=C:\Users\DanJaffa\AppData\Local\Python\pythoncore-3.14-64\python.exe"
)

if not defined PYTHON_EXE (
    if exist "C:\Users\DanJaffa\AppData\Local\Python\bin\python.exe" (
        set "PYTHON_EXE=C:\Users\DanJaffa\AppData\Local\Python\bin\python.exe"
    )
)

if not defined PYTHON_EXE (
    where python >nul 2>nul
    if !ERRORLEVEL! EQU 0 set "PYTHON_EXE=python"
)

if not defined PYTHON_EXE (
    where py >nul 2>nul
    if !ERRORLEVEL! EQU 0 set "PYTHON_EXE=py"
)

if not defined PYTHON_EXE (
    echo [ERROR] Python not found on your computer.
    pause
    exit /b 1
)

echo [OK] Using Python: %PYTHON_EXE%
"%PYTHON_EXE%" scripts\cbs_sync.py --sync
echo.
pause
