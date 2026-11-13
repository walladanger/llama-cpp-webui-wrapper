param([string] $Root = (Split-Path -Parent $PSScriptRoot))

$ErrorActionPreference = "Stop"
$Root = [IO.Path]::GetFullPath($Root)
$Pinned = Join-Path $Root "llama-cpp-release.txt"
if (-not (Test-Path -LiteralPath $Pinned)) { $Pinned = Join-Path $Root "tauri-shell\llama-cpp-release.txt" }
$Tag = (Get-Content -LiteralPath $Pinned -Raw).Trim()
if ($Tag -notmatch '^[A-Za-z0-9._-]+$') { throw "Invalid pinned llama.cpp tag: $Tag" }

$Data = Join-Path $Root "portable-data"
$Cache = Join-Path $Data "cache\llama-bench-$Tag"
$Bin = Join-Path $Data "bin"
New-Item -ItemType Directory -Force -Path $Cache, $Bin | Out-Null
$Release = Invoke-RestMethod -Uri "https://api.github.com/repos/ggml-org/llama.cpp/releases/tags/$Tag" -Headers @{ "User-Agent" = "llama-webui-bench-installer" }
$CudaFile = Join-Path $Root "cuda-version.txt"
if (-not (Test-Path -LiteralPath $CudaFile)) { $CudaFile = Join-Path $Root "tauri-shell\cuda-version.txt" }
$AssetName = "llama-$Tag-bin-win-cpu-x64.zip"
if ((Test-Path -LiteralPath (Join-Path $Bin "ggml-cuda.dll")) -and (Test-Path -LiteralPath $CudaFile)) {
    $CudaVersion = (Get-Content -LiteralPath $CudaFile -Raw).Trim()
    if ($CudaVersion -notmatch '^\d+\.\d+$') { throw "Invalid CUDA version: $CudaVersion" }
    $AssetName = "llama-$Tag-bin-win-cuda-$CudaVersion-x64.zip"
}
$Asset = $Release.assets | Where-Object { $_.name -eq $AssetName } | Select-Object -First 1
if (-not $Asset) { throw "Pinned release $Tag has no $AssetName" }
$Archive = Join-Path $Cache $Asset.name
$Extract = Join-Path $Cache ("extract-" + [guid]::NewGuid().ToString("N"))
Invoke-WebRequest -Uri $Asset.browser_download_url -OutFile $Archive -Headers @{ "User-Agent" = "llama-webui-bench-installer" }
Expand-Archive -LiteralPath $Archive -DestinationPath $Extract -Force
$Bench = Get-ChildItem -LiteralPath $Extract -Filter "llama-bench.exe" -Recurse | Select-Object -First 1
if (-not $Bench) { throw "Pinned release $Tag has no llama-bench.exe" }
if ($AssetName -like "*-cuda-*") {
    $RuntimeName = "cudart-llama-bin-win-cuda-$CudaVersion-x64.zip"
    $Runtime = $Release.assets | Where-Object { $_.name -eq $RuntimeName } | Select-Object -First 1
    if (-not $Runtime) { throw "Pinned release $Tag has no $RuntimeName" }
    $RuntimeArchive = Join-Path $Cache $Runtime.name
    Invoke-WebRequest -Uri $Runtime.browser_download_url -OutFile $RuntimeArchive -Headers @{ "User-Agent" = "llama-webui-bench-installer" }
    Expand-Archive -LiteralPath $RuntimeArchive -DestinationPath $Bench.DirectoryName -Force
}
foreach ($Name in @("llama-bench-impl.dll", "llama.dll", "llama-common.dll", "ggml.dll", "ggml-base.dll")) {
    if (-not (Test-Path -LiteralPath (Join-Path $Bench.DirectoryName $Name))) { throw "Pinned release $Tag has no $Name" }
}
$BenchBin = Join-Path $Data "bench\bin"
New-Item -ItemType Directory -Force -Path $BenchBin | Out-Null
# Clear only benchmark-owned runtime files; the server directory stays unchanged.
Get-ChildItem -LiteralPath $BenchBin -File | Where-Object { $_.Extension -eq ".dll" -or $_.Name -eq "llama-bench.exe" } | ForEach-Object { Remove-Item -LiteralPath $_.FullName }
Get-ChildItem -LiteralPath $Bench.DirectoryName -Filter "*.dll" -File | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $BenchBin -Force }
Copy-Item -LiteralPath $Bench.FullName -Destination $BenchBin -Force
if (-not (Test-Path -LiteralPath (Join-Path $BenchBin "llama-bench.exe"))) { throw "llama-bench.exe was not installed" }
Write-Host "Installed llama-bench from pinned llama.cpp $Tag at $BenchBin"
