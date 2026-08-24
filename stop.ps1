# PowerShell Shutdown Script for Fantasy Auction Draft & Ollama
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  🛑 Stopping Fantasy Auction Draft Server & AI..." -ForegroundColor Yellow
Write-Host "================================================================" -ForegroundColor Cyan

# 1. Stop process listening on port 3000
try {
    $p = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
    if ($p) {
        Write-Host "Stopping web server process (PID: $p)..." -ForegroundColor Magenta
        Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
    }
} catch {}

# 2. Stop server.py / server.js
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'server\.py|server\.js' } | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}

# 3. Stop Ollama
Get-Process -Name "ollama", "ollama_llama_server" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  ✅ All servers and AI background processes stopped." -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Cyan
