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

Write-Host "Installing the desktop wrapper..."
Invoke-Checked -FilePath "npm" -Arguments @("install", "--cache", $NpmCache) -WorkingDirectory $Wrapper
Invoke-Checked -FilePath "npm" -Arguments @("run", "build") -WorkingDirectory $Wrapper

$CMake = Get-Command cmake -ErrorAction SilentlyContinue
if ($CMake) {
    Write-Host "Building llama-server with the bundled web UI..."
    Invoke-Checked -FilePath "cmake" -Arguments @("-S", $Root, "-B", (Join-Path $Root "build"), "-DCMAKE_BUILD_TYPE=Release")
    Invoke-Checked -FilePath "cmake" -Arguments @("--build", (Join-Path $Root "build"), "--config", "Release", "--target", "llama-server")
}
else {
    Write-Warning "CMake was not found. Trying to install the official Windows llama-server release into portable-data\bin instead."
    $ServerExe = Join-Path $BinDir "llama-server.exe"
    if (-not (Test-Path $ServerExe)) {
        $Releases = Invoke-RestMethod -Uri "https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=20" -Headers @{ "User-Agent" = "llama-cpp-web-wrapper-setup" }
        $Asset = $null
        foreach ($Release in $Releases) {
            $Asset = $Release.assets |
                Where-Object { $_.name -match "llama-.*-bin-win-cpu-x64\.zip$" } |
                Select-Object -First 1
            if ($Asset) {
                break
            }
        }

        if (-not $Asset) {
            throw "Could not find a CPU Windows x64 llama.cpp release asset."
        }

        $Archive = Join-Path $DataDir $Asset.name
        $ExtractDir = Join-Path $DataDir "llama-release"
        Write-Host "Downloading $($Asset.name)..."
        Invoke-WebRequest -Uri $Asset.browser_download_url -OutFile $Archive -Headers @{ "User-Agent" = "llama-cpp-web-wrapper-setup" }
        if (Test-Path $ExtractDir) {
            Remove-Item -LiteralPath $ExtractDir -Recurse -Force
        }
        Expand-Archive -LiteralPath $Archive -DestinationPath $ExtractDir -Force
        Copy-Item -Path (Join-Path $ExtractDir "*") -Destination $BinDir -Recurse -Force
        $DownloadedServer = Get-ChildItem -Path $BinDir -Filter "llama-server.exe" -Recurse | Select-Object -First 1
        if (-not $DownloadedServer) {
            throw "Downloaded release did not contain llama-server.exe."
        }
    }
}

Write-Host "Creating desktop shortcut..."
$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = "powershell.exe"
$Shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$RunScript`""
$Shortcut.WorkingDirectory = $Root
$Shortcut.IconLocation = "powershell.exe,0"
$Shortcut.Save()

Write-Host ""
Write-Host "Setup complete."
Write-Host "Put .gguf model files in: $ModelsDir"
Write-Host "Launch from the desktop shortcut or run: $RunScript"
