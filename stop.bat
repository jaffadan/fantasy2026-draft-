@echo off
title Stopping Fantasy Auction Draft Server
echo ================================================================
echo   Stopping Fantasy Football Auction Draft Server...
echo ================================================================

echo [1/3] Terminating web server on port 3000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000" ^| findstr "LISTENING"') do (
    taskkill /f /pid %%a >nul 2>nul
)

echo [2/3] Terminating Python and Node server processes...
taskkill /f /im python.exe /fi "WINDOWTITLE eq 2026 Fantasy*" >nul 2>nul
taskkill /f /im node.exe /fi "WINDOWTITLE eq 2026 Fantasy*" >nul 2>nul

echo [3/3] Terminating background Ollama AI runners...
taskkill /f /im ollama.exe >nul 2>nul
taskkill /f /im ollama_llama_server.exe >nul 2>nul

echo ================================================================
echo   All servers and AI background processes stopped cleanly.
echo ================================================================
ping 127.0.0.1 -n 3 >nul
exit /b
