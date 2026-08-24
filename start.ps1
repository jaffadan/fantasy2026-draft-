# PowerShell Launcher for 2026 Fantasy Football Auction Draft Command Center
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $scriptDir

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  ⚡ 2026 Fantasy Football Auction Draft Command Center" -ForegroundColor Yellow
Write-Host "  🔄 Auto-restart enabled" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Cyan

# Launch Ollama with llama3.2 if available
if (Get-Command ollama -ErrorAction SilentlyContinue) {
    Write-Host "[AI] Starting local Ollama with llama3.2 in background..." -ForegroundColor Magenta
    Start-Process -FilePath "ollama" -ArgumentList "run llama3.2" -WindowStyle Minimized
} else {
    Write-Host "[INFO] Ollama not found in PATH. (You can use Google Gemini Cloud or start Ollama manually)" -ForegroundColor Gray
}

# Start Python server
$pythonBin = "C:\Users\DanJaffa\AppData\Local\Python\bin\python.exe"
if (Get-Command python -ErrorAction SilentlyContinue) {
    $pythonBin = "python"
}

Write-Host "Launching server at http://localhost:3000..." -ForegroundColor Cyan
& $pythonBin server.py
