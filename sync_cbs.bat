@echo off
echo ========================================================
echo  CBS Sports Fantasy - Live Data Sync
echo ========================================================
cd /d "%~dp0"

set "PYTHON_EXE="
if exist "C:\Users\DanJaffa\AppData\Local\Python\pythoncore-3.14-64\python.exe" set "PYTHON_EXE=C:\Users\DanJaffa\AppData\Local\Python\pythoncore-3.14-64\python.exe"
if not defined PYTHON_EXE if exist "C:\Users\DanJaffa\AppData\Local\Python\bin\python.exe" set "PYTHON_EXE=C:\Users\DanJaffa\AppData\Local\Python\bin\python.exe"
if not defined PYTHON_EXE where python >nul 2>nul && set "PYTHON_EXE=python"
if not defined PYTHON_EXE where py >nul 2>nul && set "PYTHON_EXE=py"

if not defined PYTHON_EXE (
    echo [ERROR] Python not found. Please install Python.
    pause
    exit /b 1
)

"%PYTHON_EXE%" scripts\cbs_sync.py --sync
pause
