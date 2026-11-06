$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Wrapper = Join-Path $Root "web-wrapper"
$DataDir = Join-Path $Root "portable-data"
$BinDir = Join-Path $DataDir "bin"
$LogDir = Join-Path $DataDir "logs"
$ModelsDir = Join-Path $DataDir "models"
$Desktop = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $Desktop "llama.cpp WebUI.lnk"
$RunScript = Join-Path $Root "Run-Llama-WebUI.ps1"
$NpmCache = Join-Path $DataDir "npm-cache"
$ShellDir = Join-Path $Root "tauri-shell"
$UiDir = Join-Path $Root "tools\ui"
$ShellExe = Join-Path $Root "llama-webui.exe"
$ManagerExe = Join-Path $Root "llama-engine-manager.exe"
$ReleaseTag = (Get-Content -LiteralPath (Join-Path $ShellDir "llama-cpp-release.txt") -Raw).Trim()

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)]
        [string] $FilePath,
        [string[]] $Arguments = @(),
        [string] $WorkingDirectory = $Root
    )

    Push-Location $WorkingDirectory
    try {
        & $FilePath @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "$FilePath exited with code $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }
}

New-Item -ItemType Directory -Force -Path $BinDir, $LogDir, $ModelsDir, (Join-Path $DataDir "config"), (Join-Path $DataDir "cache"), $NpmCache | Out-Null
$VllmConfig = Join-Path $DataDir "config\vllm.json"
if (-not (Test-Path $VllmConfig)) {
    Copy-Item -LiteralPath (Join-Path $ShellDir "vllm.default.json") -Destination $VllmConfig
}
$TrtllmConfig = Join-Path $DataDir "config\trtllm.json"
if (-not (Test-Path $TrtllmConfig)) {
    Copy-Item -LiteralPath (Join-Path $ShellDir "trtllm.default.json") -Destination $TrtllmConfig
}

Write-Host "Installing the desktop wrapper..."
Invoke-Checked -FilePath "npm" -Arguments @("install", "--cache", $NpmCache) -WorkingDirectory $Wrapper
Invoke-Checked -FilePath "npm" -Arguments @("run", "build") -WorkingDirectory $Wrapper
Write-Host "Building the stock web UI with engine pages..."
Invoke-Checked -FilePath "npm" -Arguments @("ci", "--cache", $NpmCache) -WorkingDirectory $UiDir
Invoke-Checked -FilePath "npm" -Arguments @("run", "build") -WorkingDirectory $UiDir
$UiTarget = Join-Path $DataDir "ui"
New-Item -ItemType Directory -Path $UiTarget -Force | Out-Null
Get-ChildItem -LiteralPath (Join-Path $UiDir "dist") | Copy-Item -Destination $UiTarget -Recurse -Force

$ServerExe = Join-Path $BinDir "llama-server.exe"
if (-not (Test-Path $ServerExe)) {
    $Release = Invoke-RestMethod -Uri "https://api.github.com/repos/ggml-org/llama.cpp/releases/tags/$ReleaseTag" -Headers @{ "User-Agent" = "llama-cpp-web-wrapper-setup" }
    $Asset = $Release.assets | Where-Object { $_.name -eq "llama-$ReleaseTag-bin-win-cpu-x64.zip" } | Select-Object -First 1
    if (-not $Asset) { throw "Could not find the CPU Windows x64 llama.cpp asset for pinned release $ReleaseTag." }

    $Archive = Join-Path $DataDir $Asset.name
    $ExtractDir = [IO.Path]::GetFullPath((Join-Path $DataDir "llama-release"))
    $ResolvedDataDir = [IO.Path]::GetFullPath($DataDir)
    if (-not $ExtractDir.StartsWith($ResolvedDataDir + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe extract path: $ExtractDir" }
    Write-Host "Downloading pinned llama.cpp $ReleaseTag..."
    Invoke-WebRequest -Uri $Asset.browser_download_url -OutFile $Archive -Headers @{ "User-Agent" = "llama-cpp-web-wrapper-setup" }
    if (Test-Path -LiteralPath $ExtractDir) { Remove-Item -LiteralPath $ExtractDir -Recurse -Force }
    Expand-Archive -LiteralPath $Archive -DestinationPath $ExtractDir -Force
    $DownloadedServer = Get-ChildItem -LiteralPath $ExtractDir -Filter "llama-server.exe" -Recurse | Select-Object -First 1
    if (-not $DownloadedServer) { throw "Downloaded release did not contain llama-server.exe." }
    Get-ChildItem -LiteralPath $DownloadedServer.DirectoryName | Copy-Item -Destination $BinDir -Recurse -Force
    if (-not (Test-Path $ServerExe)) { throw "Downloaded release did not contain llama-server.exe." }
}

$Cargo = Get-Command cargo -ErrorAction SilentlyContinue
if ($Cargo) {
    Write-Host "Building the Tauri desktop shell..."
    Invoke-Checked -FilePath "cargo" -Arguments @("build", "--release") -WorkingDirectory $ShellDir
    Copy-Item -LiteralPath (Join-Path $ShellDir "target\release\llama-webui.exe") -Destination $ShellExe -Force
    Copy-Item -LiteralPath (Join-Path $ShellDir "target\release\llama-engine-manager.exe") -Destination $ManagerExe -Force
}
elseif (-not (Test-Path $ShellExe)) {
    Write-Warning "Rust was not found, so the Tauri shell was not built. Put a built llama-webui.exe in $Root to use it."
}
if (-not (Test-Path $ManagerExe)) {
    Write-Warning "The WSL2 engine manager is unavailable. Build tauri-shell with cargo or copy llama-engine-manager.exe to $Root."
}

Write-Host "Creating desktop shortcut..."
$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
if (Test-Path $ShellExe) {
    $Shortcut.TargetPath = $ShellExe
    $Shortcut.Arguments = ""
    $Shortcut.IconLocation = "$ShellExe,0"
}
else {
    $Shortcut.TargetPath = "powershell.exe"
    $Shortcut.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$RunScript`""
    $Shortcut.IconLocation = "powershell.exe,0"
}
$Shortcut.WorkingDirectory = $Root
$Shortcut.Save()

Write-Host ""
Write-Host "Setup complete."
Write-Host "Put .gguf model files in: $ModelsDir"
Write-Host "Launch from the desktop shortcut or run: $RunScript"
