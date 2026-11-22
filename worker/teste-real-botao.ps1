# Botão virtual que aperta o botão de verdade na API de produção.
# Uso: powershell -ExecutionPolicy Bypass -File .\teste-real-botao.ps1
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$t = Read-Host "Token do botão (43 caracteres, do /admin)" -AsSecureString
$env:REPLAY_BOTAO_TOKEN = ([Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($t))).Trim()
$slug = Read-Host "Slug da arena (o que vem depois de /a/ no link; Enter para pular)"

$app = ""
if (Test-Path .env) {
    Get-Content .env | ForEach-Object { if ($_ -match '^\s*APP_URL\s*=\s*(.+)$') { $app = $matches[1].Trim().TrimEnd("/") } }
}
if (-not $app) { $app = Read-Host "URL do app na Vercel (https://...)" }
if ($slug) { py -m replay_worker.botao_virtual --app $app --arena "$app/a/$slug" }
else { py -m replay_worker.botao_virtual --app $app }
