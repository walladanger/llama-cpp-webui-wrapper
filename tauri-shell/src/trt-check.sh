#!/bin/bash
set -eu
check() { printf 'ROUTER_CHECK|%s|%s|%s\n' "$1" "$2" "$3"; }
if uname -r | grep -Eiq 'microsoft-standard|WSL2'; then check wsl pass 'WSL 2 is ready'; else check wsl blocked 'This distribution must use WSL 2. Convert it in Windows WSL settings, then check again.'; fi
. /etc/os-release
desktop=false
if command -v docker >/dev/null && backend=$(timeout 8 docker info --format '{{.OperatingSystem}}' 2>/dev/null) && [ "$backend" = 'Docker Desktop' ]; then
  desktop=true
  check docker pass 'Docker Desktop is available and will be reused; no Linux Docker/toolkit installation is needed'
else
  check docker warning 'Setup will install native Docker and NVIDIA container tools on supported Ubuntu versions'
fi
if [ "$ID" = ubuntu ] && { [ "$desktop" = true ] || [ "$VERSION_ID" = 24.04 ] || [ "$VERSION_ID" = 22.04 ]; }; then check linux pass "Ubuntu $VERSION_ID"; else check linux blocked 'Automatic setup supports Ubuntu 22.04 and 24.04. Choose Ubuntu-24.04 under Advanced.'; fi
if systemctl --user show-environment >/dev/null 2>&1; then check services pass 'Background services are available'; else check services blocked 'Enable systemd in /etc/wsl.conf, restart this distribution, then check again.'; fi
if command -v nvidia-smi >/dev/null; then smi=nvidia-smi; else smi=/usr/lib/wsl/lib/nvidia-smi; fi
if gpu=$($smi --query-gpu=name,driver_version --format=csv,noheader 2>/dev/null) && [ -n "$gpu" ]; then check gpu pass "$(echo "$gpu" | tr '\n' ';')"; check compatibility warning 'GPU detected. The container CUDA check will verify driver access. Model and GPU support still depend on NVIDIA runtime support.'; else check gpu blocked 'NVIDIA GPU access is unavailable in WSL. Update the Windows NVIDIA driver and WSL, then check again.'; fi
free_kb=$(df -Pk / | awk 'NR==2 {print $4}')
if [ "$free_kb" -ge 41943040 ]; then check disk pass 'At least 40 GB is available in Linux'; else check disk blocked 'Free at least 40 GB in this distribution for the runtime. Models require additional space.'; fi
if id -un >/dev/null && command -v bash >/dev/null; then check account pass "Install for $(id -un)"; fi
