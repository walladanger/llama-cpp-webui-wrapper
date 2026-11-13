param([string] $Root = (Split-Path -Parent $PSScriptRoot))

$ErrorActionPreference = "Stop"
$Root = [IO.Path]::GetFullPath($Root)
$Pinned = Join-Path $Root "llama-cpp-release.txt"
if (-not (Test-Path -LiteralPath $Pinned)) { $Pinned = Join-Path $Root "tauri-shell\llama-cpp-release.txt" }
$Tag = (Get-Content -LiteralPath $Pinned -Raw).Trim()
if ($Tag -notmatch '^[A-Za-z0-9._-]+$') { throw "Invalid pinned llama.cpp tag: $Tag" }

$Data = Join-Path $Root "portable-data"
$Cache = Join-Path $Data "cache\llama-bench-$Tag"
$ServerBin = Join-Path $Data "bin"
$Bin = Join-Path $Data "bench\bin"
New-Item -ItemType Directory -Force -Path $Cache, $Bin | Out-Null
$Release = Invoke-RestMethod -Uri "https://api.github.com/repos/ggml-org/llama.cpp/releases/tags/$Tag" -Headers @{ "User-Agent" = "llama-webui-bench-installer" }
$CudaFile = Join-Path $Root "cuda-version.txt"
if (-not (Test-Path -LiteralPath $CudaFile)) { $CudaFile = Join-Path $Root "tauri-shell\cuda-version.txt" }
$AssetName = "llama-$Tag-bin-win-cpu-x64.zip"
if ((Test-Path -LiteralPath (Join-Path $ServerBin "ggml-cuda.dll")) -and (Test-Path -LiteralPath $CudaFile)) {
    $CudaVersion = (Get-Content -LiteralPath $CudaFile -Raw).Trim()
    if ($CudaVersion -notmatch '^\d+\.\d+$') { throw "Invalid CUDA version: $CudaVersion" }
    $AssetName = "llama-$Tag-bin-win-cuda-$CudaVersion-x64.zip"
}
$Asset = $Release.assets | Where-Object { $_.name -eq $AssetName } | Select-Object -First 1
if (-not $Asset) { throw "Pinned release $Tag has no $AssetName" }
$Archive = Join-Path $Cache $Asset.name
$Extract = Join-Path $Cache "extract"
Invoke-WebRequest -Uri $Asset.browser_download_url -OutFile $Archive -Headers @{ "User-Agent" = "llama-webui-bench-installer" }
if (Test-Path -LiteralPath $Extract) { Remove-Item -LiteralPath $Extract -Recurse -Force }
Expand-Archive -LiteralPath $Archive -DestinationPath $Extract -Force
$Bench = Get-ChildItem -LiteralPath $Extract -Filter "llama-bench.exe" -Recurse | Select-Object -First 1
if (-not $Bench) { throw "Pinned release $Tag has no llama-bench.exe" }
$Install = Join-Path $Extract "install"
New-Item -ItemType Directory -Force -Path $Install | Out-Null
Copy-Item -LiteralPath $Bench.FullName -Destination $Install
Get-ChildItem -LiteralPath $Bench.DirectoryName -Filter "*.dll" -File | Copy-Item -Destination $Install
if ($AssetName -like "*-cuda-*") {
    $RuntimeName = "cudart-llama-bin-win-cuda-$CudaVersion-x64.zip"
    $Runtime = $Release.assets | Where-Object { $_.name -eq $RuntimeName } | Select-Object -First 1
    if (-not $Runtime) { throw "Pinned release $Tag has no $RuntimeName" }
    $RuntimeZip = Join-Path $Cache $RuntimeName
    Invoke-WebRequest -Uri $Runtime.browser_download_url -OutFile $RuntimeZip
    $RuntimeExtract = Join-Path $Extract "runtime"
    Expand-Archive -LiteralPath $RuntimeZip -DestinationPath $RuntimeExtract -Force
    Get-ChildItem -LiteralPath $RuntimeExtract -Filter "*.dll" -File -Recurse | Copy-Item -Destination $Install -Force
}
if (Test-Path -LiteralPath $Bin) { Remove-Item -LiteralPath $Bin -Recurse -Force }
Move-Item -LiteralPath $Install -Destination $Bin
if (-not (Test-Path -LiteralPath (Join-Path $Bin "llama-bench.exe"))) { throw "llama-bench.exe was not installed" }
Write-Host "Installed llama-bench from pinned llama.cpp $Tag at $Bin"
