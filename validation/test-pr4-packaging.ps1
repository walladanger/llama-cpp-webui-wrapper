param([string] $SourceRoot = (Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference = 'Stop'
$TempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$Fixture = Join-Path $TempBase ('RouterReview-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Fixture | Out-Null
$global:RouterReviewChecks = 0
$global:RouterReviewDownloads = @{}
$global:RouterReviewRequested = @()
$global:RouterReviewStops = 0
function Assert($Condition, [string] $Message) {
    if (-not $Condition) { throw $Message }
    $global:RouterReviewChecks++
}
function Archive([string] $Name, $Files) {
    $Dir = Join-Path $Fixture ([guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $Dir | Out-Null
    foreach ($Entry in $Files.GetEnumerator()) { $File = Join-Path $Dir $Entry.Key; New-Item -ItemType Directory -Force -Path (Split-Path -Parent $File) | Out-Null; Set-Content -LiteralPath $File -Value $Entry.Value }
    $Zip = Join-Path $Fixture $Name
    Compress-Archive -Path (Join-Path $Dir '*') -DestinationPath $Zip
    $Uri = 'https://fixture.invalid/' + $Name
    $global:RouterReviewDownloads[$Uri] = $Zip
    return @{ name = $Name; browser_download_url = $Uri; size = (Get-Item -LiteralPath $Zip).Length }
}
function Invoke-RestMethod($Uri, $Headers, $Method, $ContentType, $Body, $TimeoutSec) {
    if ($Uri -like 'https://api.github.com/*') { return $global:RouterReviewRelease }
    if ($Uri -like '*/health') { return @{ status = 'ok' } }
    return $global:RouterReviewReply
}
function Invoke-WebRequest($Uri, $OutFile, $Headers) {
    if (-not $global:RouterReviewDownloads.ContainsKey($Uri)) { throw "Unexpected download $Uri" }
    $global:RouterReviewRequested += $Uri
    Copy-Item -LiteralPath $global:RouterReviewDownloads[$Uri] -Destination $OutFile
}
function npm { $global:LASTEXITCODE = 0 }
function Start-Process($FilePath, $ArgumentList, [switch] $PassThru, $WindowStyle, $RedirectStandardOutput, $RedirectStandardError) {
    return [pscustomobject]@{ HasExited = $false; Id = 123456; ExitCode = 0 }
}
function Stop-Process($Id, [switch] $Force) { $global:RouterReviewStops++ }
try {
    $Libraries = @('llama-bench-impl.dll', 'llama.dll', 'llama-common.dll', 'ggml.dll', 'ggml-base.dll', 'ggml-cpu.dll')
    $CpuFiles = @{ 'llama-bench.exe' = 'cpu-bench'; 'llama-server.exe' = 'cpu-server' }
    foreach ($Name in $Libraries) { $CpuFiles[$Name] = 'cpu-' + $Name }
    $GpuFiles = @{ 'llama-bench.exe' = 'gpu-bench'; 'llama-server.exe' = 'gpu-server'; 'ggml-cuda.dll' = 'gpu-backend' }
    foreach ($Name in $Libraries) { $GpuFiles[$Name] = 'gpu-' + $Name }
    $Cpu = Archive 'llama-b-review-bin-win-cpu-x64.zip' $CpuFiles
    $Gpu = Archive 'llama-b-review-bin-win-cuda-12.9-x64.zip' $GpuFiles
    $Cuda = Archive 'cudart-llama-bin-win-cuda-12.9-x64.zip' @{ 'runtime/cudart64_12.dll' = 'matching-cuda' }
    $global:RouterReviewRelease = @{ assets = @($Cpu, $Gpu, $Cuda) }
    $App = Join-Path $Fixture 'app'
    $ServerBin = Join-Path $App 'portable-data/bin'
    $BenchBin = Join-Path $App 'portable-data/bench/bin'
    New-Item -ItemType Directory -Path $ServerBin, $BenchBin | Out-Null
    Set-Content -LiteralPath (Join-Path $App 'llama-cpp-release.txt') -Value 'b-review'
    Set-Content -LiteralPath (Join-Path $App 'cuda-version.txt') -Value '12.9'
    Set-Content -LiteralPath (Join-Path $ServerBin 'llama.dll') -Value 'server-runtime'
    Set-Content -LiteralPath (Join-Path $ServerBin 'llama-bench.exe') -Value 'stale-bench'
    Set-Content -LiteralPath (Join-Path $BenchBin 'stale.dll') -Value 'old-runtime'
    $ServerHash = (Get-FileHash -LiteralPath (Join-Path $ServerBin 'llama.dll')).Hash
    & (Join-Path $SourceRoot 'tauri-shell/install-llama-bench.ps1') -Root $App
    Assert ((Get-Content -LiteralPath (Join-Path $BenchBin 'llama-bench.exe') -Raw).Trim() -eq 'cpu-bench') 'CPU benchmark was not isolated'
    foreach ($Name in $Libraries) { Assert ((Get-Content -LiteralPath (Join-Path $BenchBin $Name) -Raw).Trim() -eq ('cpu-' + $Name)) "Missing CPU runtime $Name" }
    Assert (-not (Test-Path -LiteralPath (Join-Path $BenchBin 'stale.dll'))) 'Stale isolated DLL survived'
    Assert ((Get-FileHash -LiteralPath (Join-Path $ServerBin 'llama.dll')).Hash -eq $ServerHash) 'Server runtime was changed'
    Assert ((Get-Content -LiteralPath (Join-Path $ServerBin 'llama-bench.exe') -Raw).Trim() -eq 'stale-bench') 'Bundled benchmark was changed'
    Set-Content -LiteralPath (Join-Path $ServerBin 'ggml-cuda.dll') -Value 'server-cuda'
    & (Join-Path $SourceRoot 'tauri-shell/install-llama-bench.ps1') -Root $App
    foreach ($Name in $Libraries) { Assert ((Get-Content -LiteralPath (Join-Path $BenchBin $Name) -Raw).Trim() -eq ('gpu-' + $Name)) "Mismatched GPU runtime $Name" }
    Assert ((Get-Content -LiteralPath (Join-Path $BenchBin 'cudart64_12.dll') -Raw).Trim() -eq 'matching-cuda') 'Matching CUDA dependency was not installed'
    Assert ((Get-FileHash -LiteralPath (Join-Path $ServerBin 'llama.dll')).Hash -eq $ServerHash) 'GPU install changed server runtime'
    $Broken = $GpuFiles.Clone()
    $Broken.Remove('llama-common.dll')
    $BrokenAsset = Archive 'broken.zip' $Broken
    $BrokenAsset.name = $Gpu.name
    $global:RouterReviewRelease = @{ assets = @($BrokenAsset, $Cuda) }
    $Rejected = $false
    try { & (Join-Path $SourceRoot 'tauri-shell/install-llama-bench.ps1') -Root $App } catch { $Rejected = $true }
    Assert $Rejected 'An incomplete benchmark runtime was accepted'
    Assert ((Get-Content -LiteralPath (Join-Path $BenchBin 'llama.dll') -Raw).Trim() -eq 'gpu-llama.dll') 'Failed install changed the working isolated runtime'
    $global:RouterReviewRelease = @{ assets = @($Cpu, $Gpu, $Cuda) }
    $PackageRoot = Join-Path $Fixture 'package'
    $Shell = Join-Path $PackageRoot 'tauri-shell'
    New-Item -ItemType Directory -Path (Join-Path $Shell 'target/release'), (Join-Path $PackageRoot 'tools/ui/dist') | Out-Null
    foreach ($Name in @('package-portable.ps1', 'install-llama-bench.ps1', 'llama-server.default.json', 'vllm.default.json', 'trtllm.default.json', 'llama-cpp-release.txt', 'cuda-version.txt')) { Copy-Item -LiteralPath (Join-Path $SourceRoot ('tauri-shell/' + $Name)) -Destination $Shell }
    Set-Content -LiteralPath (Join-Path $Shell 'target/release/llama-webui.exe') -Value 'shell'
    Set-Content -LiteralPath (Join-Path $Shell 'target/release/llama-engine-manager.exe') -Value 'manager'
    Set-Content -LiteralPath (Join-Path $PackageRoot 'tools/ui/dist/index.html') -Value 'ui'
    & (Join-Path $Shell 'package-portable.ps1') -Tag 'b-review' -CudaVersion '12.9'
    $Packaged = Join-Path $Shell 'dist/Llama-WebUI'
    Assert ((Get-Content -LiteralPath (Join-Path $Packaged 'llama-cpp-release.txt') -Raw).Trim() -eq 'b-review') 'Package ignored selected release tag'
    Assert ((Get-Content -LiteralPath (Join-Path $Packaged 'cuda-version.txt') -Raw).Trim() -eq '12.9') 'Package ignored selected CUDA version'
    & (Join-Path $Packaged 'install-llama-bench.ps1') -Root $Packaged
    Assert ((Get-Content -LiteralPath (Join-Path $Packaged 'portable-data/bench/bin/llama-bench.exe') -Raw).Trim() -eq 'gpu-bench') 'Packaged installer did not use selected release'
    $Model = Join-Path $Fixture 'test.gguf'
    Set-Content -LiteralPath $Model -Value 'model fixture'
    foreach ($Content in @('UPSTREAM_OK.', 'Result: UPSTREAM_OK', 'A valid answer')) {
        $global:RouterReviewReply = @{ choices = @(@{ message = @{ content = $Content; role = 'assistant' } }) }
        & (Join-Path $SourceRoot 'tauri-shell/smoke-package.ps1') -AppDir $Packaged -Model $Model -Port 62731
        Assert $true 'Non-empty response was rejected'
    }
    foreach ($BadReply in @(@{ choices = @() }, @{ choices = 'invalid' }, @{ choices = @(@{ message = @{ content = '   '; role = 'assistant' } }) }, @{ choices = @(@{ message = @{ content = 'text'; role = 'user' } }) }, @{ choices = @(@{ message = @{ content = @{ invalid = 'shape' }; role = 'assistant' } }) })) {
        $global:RouterReviewReply = $BadReply
        $Rejected = $false
        try { & (Join-Path $SourceRoot 'tauri-shell/smoke-package.ps1') -AppDir $Packaged -Model $Model -Port 62731 } catch { $Rejected = $true }
        Assert $Rejected 'An invalid smoke response was accepted'
    }
    Assert ($global:RouterReviewStops -eq 8) 'Smoke test did not clean up after every response'
    Write-Host "Packaging regressions passed ($global:RouterReviewChecks checks). Network, npm and model execution were mocked."
}
finally {
    $ResolvedFixture = [IO.Path]::GetFullPath($Fixture)
    if (-not $ResolvedFixture.StartsWith($TempBase, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $ResolvedFixture) -notlike 'RouterReview-*') { throw 'Unsafe fixture cleanup path' }
    Remove-Item -LiteralPath $ResolvedFixture -Recurse -Force
}
