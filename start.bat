@echo off
title 2026 Fantasy Football Auction Draft Command Center
echo ================================================================
echo   Starting 2026 Fantasy Football Auction Draft Command Center...
echo   Auto-restart enabled
echo ================================================================
cd /d "%~dp0"

REM Check and launch Ollama with llama3.2:1b (fast, CPU-friendly) in background
set "OLLAMA=%LOCALAPPDATA%\Programs\Ollama\ollama.exe"
if exist "%OLLAMA%" (
    echo [AI] Starting local Ollama with llama3.2:1b in background...
    start /min "Ollama Model Runner" cmd /c ""%OLLAMA%" run llama3.2:1b"
) else (
    echo [INFO] Ollama not found. Using Gemini Cloud or manual Ollama.
)

REM Locate Python Executable
set "PYTHON_EXE="
if exist "C:\Users\DanJaffa\AppData\Local\Python\pythoncore-3.14-64\python.exe" set "PYTHON_EXE=C:\Users\DanJaffa\AppData\Local\Python\pythoncore-3.14-64\python.exe"
if not defined PYTHON_EXE if exist "C:\Users\DanJaffa\AppData\Local\Python\bin\python.exe" set "PYTHON_EXE=C:\Users\DanJaffa\AppData\Local\Python\bin\python.exe"
if not defined PYTHON_EXE where python >nul 2>nul && set "PYTHON_EXE=python"
if not defined PYTHON_EXE where py >nul 2>nul && set "PYTHON_EXE=py"

if defined PYTHON_EXE (
    echo [OK] Launching with Python (%PYTHON_EXE%)...
    :python_loop
    "%PYTHON_EXE%" server.py
    echo [WARNING] Server stopped. Auto-restarting in 2 seconds... (Press Ctrl+C to stop)
    ping 127.0.0.1 -n 3 >nul
    goto python_loop
)

where node >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo [OK] Launching with Node.js...
    :node_loop
    node server.js
    echo [WARNING] Server stopped. Auto-restarting in 2 seconds... (Press Ctrl+C to stop)
    ping 127.0.0.1 -n 3 >nul
    goto node_loop
)

echo [ERROR] Neither Python nor Node.js could be found.
pause
