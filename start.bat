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

REM Launch Python Server with auto-restart supervisor loop
where python >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo Launching with Python...
    :python_loop
    python server.py
    echo [WARNING] Server stopped. Auto-restarting in 2 seconds... (Press Ctrl+C to stop)
    ping 127.0.0.1 -n 3 >nul
    goto python_loop
)

where node >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo Launching with Node.js...
    :node_loop
    node server.js
    echo [WARNING] Server stopped. Auto-restarting in 2 seconds... (Press Ctrl+C to stop)
    ping 127.0.0.1 -n 3 >nul
    goto node_loop
)

echo Starting with Python execution alias...
:alias_loop
"C:\Users\DanJaffa\AppData\Local\Python\bin\python.exe" server.py
ping 127.0.0.1 -n 3 >nul
goto alias_loop
