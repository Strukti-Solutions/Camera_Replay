# Teste real com câmera RTSP local (Jortan/Yoosee): sobe o worker de produção só para ela.
# Uso: powershell -ExecutionPolicy Bypass -File .\teste-real-worker.ps1
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path .env)) { Write-Host "Falta o arquivo .env nesta pasta."; exit 2 }
Get-Content .env | ForEach-Object {
    if ($_ -match '^\s*([A-Z0-9_]+)\s*=\s*(.*)$') { Set-Item "env:$($matches[1])" $matches[2].Trim() }
}
$faltando = "DATABASE_URL","R2_ACCOUNT_ID","R2_ACCESS_KEY_ID","R2_SECRET_ACCESS_KEY","R2_BUCKET","CAMERA_CRED_KEY" |
    Where-Object { -not (Get-Item "env:$_" -ErrorAction SilentlyContinue).Value }
if ($faltando) { Write-Host "Preencha no .env: $($faltando -join ', ')"; exit 2 }

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    $ff = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Gyan.FFmpeg*\*\bin" -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($ff) { $env:Path += ";$($ff.FullName)" } else { Write-Host "ffmpeg não encontrado."; exit 2 }
}

$ip = Read-Host "IP da câmera [192.168.0.108]"
if (-not $ip) { $ip = "192.168.0.108" }
$s = Read-Host "Senha RTSP da câmera" -AsSecureString
$p = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
$env:REPLAY_RTSP_URL = "rtsp://admin:$([uri]::EscapeDataString($p))@${ip}:554/onvif1"

if (-not (Test-Path cameras-rtsp.json)) { Copy-Item cameras-rtsp.example.json cameras-rtsp.json }
$env:CAMERAS_RTSP = "cameras-rtsp.json"
if (-not $env:RELAY_LAG_S) { $env:RELAY_LAG_S = "2" }

Write-Host "Subindo o worker (Ctrl+C para parar)..."
py -m replay_worker.main
