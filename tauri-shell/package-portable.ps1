# Build the portable app folder and zip: llama-webui.exe + llama-server (CUDA build from ggml-org/llama.cpp releases).
param(
    [string] $ShellExe = (Join-Path $PSScriptRoot "target\release\llama-webui.exe"),
    [string] $OutDir = (Join-Path $PSScriptRoot "dist"),
    [string] $Repo = "ggml-org/llama.cpp"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

if (-not (Test-Path $ShellExe)) { throw "Shell not built: $ShellExe" }

$Headers = @{ "User-Agent" = "llama-webui-packager" }
if ($env:GITHUB_TOKEN) { $Headers["Authorization"] = "Bearer $env:GITHUB_TOKEN" }

# Newest release that has both the CUDA server zip and the matching cudart zip.
$Releases = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases?per_page=10" -Headers $Headers
$Pick = $null
foreach ($Release in $Releases) {
    $Servers = $Release.assets | Where-Object { $_.name -match '^llama-.*-bin-win-cuda-([\d.]+)-x64\.zip$' }
    $Best = $Servers | Sort-Object { [version]([regex]::Match($_.name, 'cuda-([\d.]+)-x64').Groups[1].Value) } -Descending
    foreach ($Server in $Best) {
        $Cuda = [regex]::Match($Server.name, 'cuda-([\d.]+)-x64').Groups[1].Value
        $Runtime = $Release.assets | Where-Object { $_.name -eq "cudart-llama-bin-win-cuda-$Cuda-x64.zip" } | Select-Object -First 1
        if ($Runtime) { $Pick = @{ Tag = $Release.tag_name; Server = $Server; Runtime = $Runtime; Cuda = $Cuda }; break }
    }
    if ($Pick) { break }
}
if (-not $Pick) { throw "No release in $Repo has a Windows CUDA build with its cudart zip." }
Write-Host "Using $($Pick.Tag), CUDA $($Pick.Cuda)"

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
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "llama-server.default.json") -Destination (Join-Path $App "portable-data\config\llama-server.json")
@"
llama.cpp WebUI - portable

1. Put .gguf model files in portable-data\models
2. Double-click llama-webui.exe

Server settings (GPU placement, context, flash attention, ...): portable-data\config\llama-server.json
Logs: portable-data\logs\llama-server.log
Bundled llama.cpp: $($Pick.Tag), CUDA $($Pick.Cuda). Needs an NVIDIA driver new enough for CUDA $($Pick.Cuda).
"@ | Set-Content -Path (Join-Path $App "README.txt") -Encoding ascii

$ZipOut = Join-Path $OutDir "Llama-WebUI-windows-x64-cuda.zip"
if (Test-Path $ZipOut) { Remove-Item -LiteralPath $ZipOut -Force }
Compress-Archive -Path $App -DestinationPath $ZipOut -CompressionLevel Optimal
Remove-Item -LiteralPath $Work -Recurse -Force
"tag=$($Pick.Tag)" | Out-File -FilePath (Join-Path $OutDir "llama-cpp-tag.txt") -Encoding ascii
Write-Host "Wrote $ZipOut ($([math]::Round((Get-Item $ZipOut).Length / 1MB)) MB)"
