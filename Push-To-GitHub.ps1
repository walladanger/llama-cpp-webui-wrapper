$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $Root
try {
    if (-not (Test-Path ".git")) {
        git init
        git branch -M main
    }

    git add web-wrapper Setup-Llama-WebUI.ps1 Run-Llama-WebUI.ps1 Push-To-GitHub.ps1
    git commit -m "Add portable desktop web UI wrapper"

    $HasRemote = $false
    try {
        git remote get-url origin | Out-Null
        $HasRemote = $true
    }
    catch {
        $HasRemote = $false
    }

    if (-not $HasRemote) {
        gh repo create llama-cpp-webui-wrapper --private --source . --remote origin --push
    }
    else {
        git push -u origin main
    }
}
finally {
    Pop-Location
}
