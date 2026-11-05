# Build the portable app folder and zip with a selected llama.cpp CUDA release.
param(
    [string] $ShellExe = (Join-Path $PSScriptRoot "target\release\llama-webui.exe"),
    [string] $OutDir = (Join-Path $PSScriptRoot "dist"),
    [string] $Repo = "ggml-org/llama.cpp",
    [string] $Tag = "",
    [string] $CudaVersion = ""
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

if (-not (Test-Path $ShellExe)) { throw "Shell not built: $ShellExe" }
$ManagerExe = Join-Path $PSScriptRoot "target\release\llama-engine-manager.exe"
if (-not (Test-Path $ManagerExe)) { throw "Engine manager not built: $ManagerExe. Run cargo build --release --bins." }
if (-not $Tag) { $Tag = (Get-Content -LiteralPath (Join-Path $PSScriptRoot "llama-cpp-release.txt") -Raw).Trim() }
if (-not $CudaVersion) { $CudaVersion = (Get-Content -LiteralPath (Join-Path $PSScriptRoot "cuda-version.txt") -Raw).Trim() }
if ($Tag -notmatch '^[A-Za-z0-9._-]+$') { throw "Invalid llama.cpp release tag: $Tag" }
if ($CudaVersion -notmatch '^\d+\.\d+$') { throw "Invalid CUDA version: $CudaVersion" }

$Headers = @{ "User-Agent" = "llama-webui-packager" }
if ($env:GITHUB_TOKEN) { $Headers["Authorization"] = "Bearer $env:GITHUB_TOKEN" }

$Release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/tags/$Tag" -Headers $Headers
$Server = $Release.assets | Where-Object { $_.name -eq "llama-$Tag-bin-win-cuda-$CudaVersion-x64.zip" } | Select-Object -First 1
$Runtime = $Release.assets | Where-Object { $_.name -eq "cudart-llama-bin-win-cuda-$CudaVersion-x64.zip" } | Select-Object -First 1
if (-not $Server -or -not $Runtime) { throw "Release $Tag lacks the Windows CUDA $CudaVersion server or matching runtime asset." }
$Pick = @{ Tag = $Tag; Server = $Server; Runtime = $Runtime; Cuda = $CudaVersion }
Write-Host "Using pinned llama.cpp $Tag, CUDA $CudaVersion"

$Work = Join-Path $OutDir "work"
$App = Join-Path $OutDir "Llama-WebUI"
foreach ($Dir in @($Work, $App)) { if (Test-Path $Dir) { Remove-Item -LiteralPath $Dir -Recurse -Force } }
$Bin = Join-Path $App "portable-data\bin"
New-Item -ItemType Directory -Force -Path $Work, $Bin, (Join-Path $App "portable-data\models"), (Join-Path $App "portable-data\config") | Out-Null

foreach ($Asset in @($Pick.Server, $Pick.Runtime)) {
    $Zip = Join-Path $Work $Asset.name
    Write-Host "Downloading $($Asset.name) ($([math]::Round($Asset.size / 1MB)) MB)"
    Invoke-WebRequest -Uri $Asset.browser_download_url -OutFile $Zip -Headers @{ "User-Agent" = "llama-webui-packager" }
    Expand-Archive -LiteralPath $Zip -DestinationPath $Bin -Force
}

# Some releases nest files in a folder; flatten so llama-server.exe sits in portable-data\bin.
$Server = Get-ChildItem -Path $Bin -Filter "llama-server.exe" -Recurse | Select-Object -First 1
if (-not $Server) { throw "The release did not contain llama-server.exe." }
if ($Server.DirectoryName -ne $Bin) {
    Get-ChildItem -Path $Server.DirectoryName | Move-Item -Destination $Bin -Force
}

Copy-Item -LiteralPath $ShellExe -Destination (Join-Path $App "llama-webui.exe")
Copy-Item -LiteralPath $ManagerExe -Destination (Join-Path $App "llama-engine-manager.exe")
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "llama-server.default.json") -Destination (Join-Path $App "portable-data\config\llama-server.json")
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "vllm.default.json") -Destination (Join-Path $App "portable-data\config\vllm.json")
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "trtllm.default.json") -Destination (Join-Path $App "portable-data\config\trtllm.json")
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "install-llama-bench.ps1") -Destination (Join-Path $App "install-llama-bench.ps1")
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "llama-cpp-release.txt") -Destination (Join-Path $App "llama-cpp-release.txt")
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "cuda-version.txt") -Destination (Join-Path $App "cuda-version.txt")
@"
llama.cpp WebUI - portable

1. Put .gguf model files in portable-data\models
2. Double-click llama-webui.exe to open the engine dashboard
3. Use Open llama.cpp chat test for the bundled llama-server chat window (port 18080)

Server settings (GPU placement, context, flash attention, ...): portable-data\config\llama-server.json
Logs: portable-data\logs\llama-server.log
Optional WSL2 vLLM manager: llama-engine-manager.exe vllm start|status|stop|logs
Optional WSL2 TensorRT-LLM manager: llama-engine-manager.exe trtllm start|status|stop|logs
Benchmark: llama-engine-manager.exe bench run PATH-TO-MODEL.gguf
Configure portable-data\config\vllm.json first. vLLM and model weights are installed inside WSL2, not bundled.
Bundled llama.cpp: $($Pick.Tag), CUDA $($Pick.Cuda). Needs an NVIDIA driver new enough for CUDA $($Pick.Cuda).
"@ | Set-Content -Path (Join-Path $App "README.txt") -Encoding ascii

$ZipOut = Join-Path $OutDir "Llama-WebUI-windows-x64-cuda.zip"
$VersionedZip = Join-Path $OutDir "Llama-WebUI-windows-x64-cuda-$CudaVersion-$Tag.zip"
Compress-Archive -Path $App -DestinationPath $VersionedZip -CompressionLevel Optimal -Force
Copy-Item -LiteralPath $VersionedZip -Destination $ZipOut -Force
Remove-Item -LiteralPath $Work -Recurse -Force
"tag=$($Pick.Tag)" | Out-File -FilePath (Join-Path $OutDir "llama-cpp-tag.txt") -Encoding ascii
Write-Host "Wrote $ZipOut ($([math]::Round((Get-Item $ZipOut).Length / 1MB)) MB)"
