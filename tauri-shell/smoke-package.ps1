param(
    [string] $AppDir = (Join-Path $PSScriptRoot "dist\Llama-WebUI"),
    [Parameter(Mandatory = $true)] [string] $Model,
    [string] $Device = "",
    [int] $Port = 8091
)

$ErrorActionPreference = "Stop"
if ($Port -lt 1 -or $Port -gt 65535) { throw "Invalid port: $Port" }
$AppDir = (Resolve-Path -LiteralPath $AppDir).Path
$Model = (Resolve-Path -LiteralPath $Model).Path
$Server = Join-Path $AppDir "portable-data\bin\llama-server.exe"
if (-not (Test-Path -LiteralPath $Server)) { throw "Missing $Server" }

$Client = [Net.Sockets.TcpClient]::new()
try {
    try {
        $Client.Connect("127.0.0.1", $Port)
        throw "Port $Port is already in use"
    }
    catch [Net.Sockets.SocketException] { }
}
finally {
    $Client.Dispose()
}

$Logs = Join-Path $AppDir "portable-data\logs"
New-Item -ItemType Directory -Force -Path $Logs | Out-Null
$Args = @("-m", "`"$Model`"", "--host", "127.0.0.1", "--port", "$Port", "-c", "2048", "-ngl", "99")
if ($Device) { $Args += @("--device", $Device) }
$Process = Start-Process -FilePath $Server -ArgumentList $Args -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $Logs "smoke-server.out.log") -RedirectStandardError (Join-Path $Logs "smoke-server.err.log")

try {
    $Ready = $false
    for ($Attempt = 0; $Attempt -lt 90; $Attempt++) {
        if ($Process.HasExited) { throw "llama-server exited with code $($Process.ExitCode)" }
        try {
            $Health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2
            if ($Health.status -eq "ok") { $Ready = $true; break }
        }
        catch { }
        Start-Sleep -Seconds 1
    }
    if (-not $Ready) { throw "llama-server did not become healthy on port $Port" }

    $Body = @{ model = (Split-Path -Leaf $Model); messages = @(@{ role = "user"; content = "Reply with exactly UPSTREAM_OK" }); max_tokens = 24 } | ConvertTo-Json -Depth 5
    $Reply = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/v1/chat/completions" -Method Post -ContentType "application/json" -Body $Body -TimeoutSec 30
    if ($Reply.choices -isnot [array] -or $Reply.choices.Count -eq 0) { throw "Chat response has no choices" }
    $Text = $Reply.choices[0].message.content
    if ($Reply.choices[0].message.role -ne "assistant" -or $Text -isnot [string] -or [string]::IsNullOrWhiteSpace($Text)) { throw "Chat response has no text content" }
    $DeviceLabel = if ($Device) { $Device } else { "default GPU" }
    Write-Host "Passed: llama-server health and chat on $DeviceLabel"
}
finally {
    if (-not $Process.HasExited) { Stop-Process -Id $Process.Id -Force }
}
