$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Wrapper = Join-Path $Root "web-wrapper"
$LogDir = Join-Path $Root "portable-data\logs"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

if (-not (Test-Path (Join-Path $Wrapper "dist\main.js"))) {
    Write-Host "The desktop wrapper is not installed yet. Running setup first..."
    & (Join-Path $Root "Setup-Llama-WebUI.ps1")
}

Push-Location $Wrapper
try {
    npm run start *> (Join-Path $LogDir "desktop-wrapper.log")
}
finally {
    Pop-Location
}
