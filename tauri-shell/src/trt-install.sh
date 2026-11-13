#!/bin/bash
set -Eeuo pipefail
export DEBIAN_FRONTEND=noninteractive
step() { printf '\nROUTER_STEP:%s:%s\n' "$1" "$2"; }
trap 'echo "Setup stopped. Review the last error, then Retry installation. Existing model downloads are retained." >&2' ERR
user=$1
id "$user" >/dev/null
. /etc/os-release
[ "$ID" = ubuntu ] || { echo "Choose an Ubuntu installation." >&2; exit 1; }
[ "$(uname -m)" = x86_64 ] || { echo 'Automatic setup requires x64 Ubuntu.' >&2; exit 1; }
use_group=1
if command -v docker >/dev/null && backend=$(timeout 8 docker info --format '{{.OperatingSystem}}' 2>/dev/null) && [ "$backend" = 'Docker Desktop' ]; then
  use_group=0
  step 1 'Reusing Docker Desktop'
  step 2 'Using Docker Desktop GPU support without changing Linux packages or Docker services'
else
  [ "$VERSION_ID" = 24.04 ] || [ "$VERSION_ID" = 22.04 ] || { echo 'Native Docker setup supports Ubuntu 22.04 and 24.04. Enable Docker Desktop integration or select a supported Ubuntu installation.' >&2; exit 1; }
existing_docker=false
if systemctl is-active --quiet docker; then
  existing_docker=true
  if ! docker info --format '{{json .Runtimes}}' | grep -q '"nvidia"'; then
    if [ -n "$(docker ps -q)" ]; then
      echo 'Docker has running containers and needs NVIDIA support. Stop those containers when convenient, then retry setup.' >&2
      exit 1
    fi
    existing_docker=false
  fi
fi
step 1 'Installing Linux prerequisites'
# apt locking is bounded; interrupted dpkg is reported rather than silently repaired.
apt-get -o DPkg::Lock::Timeout=120 update
apt-get -o DPkg::Lock::Timeout=120 install -y --no-install-recommends ca-certificates curl gnupg
if ! command -v docker >/dev/null; then apt-get -o DPkg::Lock::Timeout=120 install -y --no-install-recommends docker.io; fi
step 2 'Installing NVIDIA container support'
work=$(mktemp -d)
trap 'rm -f "$work/key" "$work/key.gpg" "$work/repo"; rmdir "$work"' EXIT
curl --fail --show-error --location --retry 3 --connect-timeout 30 https://nvidia.github.io/libnvidia-container/gpgkey -o "$work/key"
gpg --batch --dearmor -o "$work/key.gpg" "$work/key"
install -m 0644 "$work/key.gpg" /usr/share/keyrings/llama-router-nvidia-container.gpg
curl --fail --show-error --location --retry 3 --connect-timeout 30 https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list -o "$work/repo"
sed 's#deb https://#deb [signed-by=/usr/share/keyrings/llama-router-nvidia-container.gpg] https://#g' "$work/repo" > /etc/apt/sources.list.d/llama-router-nvidia-container.list
apt-get -o DPkg::Lock::Timeout=120 update
apt-get -o DPkg::Lock::Timeout=120 install -y --no-install-recommends nvidia-container-toolkit
# Preserve an existing Docker configuration. Do not restart an already running daemon.
if ! grep -q '"nvidia"' /etc/docker/daemon.json 2>/dev/null; then
  if [ "$existing_docker" = true ]; then
    echo 'Docker is already running without NVIDIA support. Stop other containers, configure NVIDIA Container Toolkit, and retry. Setup will not restart your existing containers.' >&2
    exit 1
  fi
  nvidia-ctk runtime configure --runtime=docker
fi
if [ "$existing_docker" = false ]; then systemctl restart docker; else systemctl start docker; fi
usermod -aG docker "$user"
fi
step 3 'Downloading TensorRT-LLM 1.2.0 (this can take a while)'
image=nvcr.io/nvidia/tensorrt-llm/release:1.2.0
docker pull "$image"
# Use the resolved immutable digest for subsequent launches, never latest.
image=$(docker image inspect --format '{{index .RepoDigests 0}}' "$image")
[[ "$image" =~ ^nvcr.io/nvidia/tensorrt-llm/release@sha256:[a-f0-9]{64}$ ]]
step 4 'Verifying CUDA, GPU access, and the runtime'
docker run --rm --gpus all --entrypoint python "$image" -c 'import torch; import tensorrt_llm; assert torch.cuda.is_available(), "CUDA is unavailable: update the Windows NVIDIA driver"; assert all(torch.cuda.get_device_capability(i)[0] >= 8 for i in range(torch.cuda.device_count())), "NVIDIA Ampere or newer is required"; print("Runtime version:", tensorrt_llm.__version__); print("CUDA GPUs:", torch.cuda.device_count())'
docker run --rm --gpus all --entrypoint trtllm-serve "$image" --help >/dev/null
step 5 'Saving the managed launcher'
install -d -m 0755 /opt/llama-router/trtllm/bin
launcher=$(mktemp /opt/llama-router/trtllm/bin/.serve.XXXXXX)
{
  echo '#!/bin/bash'
  printf 'image=%q\n' "$image"
  printf 'use_group=%q\n' "$use_group"
  cat <<'LAUNCHER'
set -euo pipefail
name="llama-router-trtllm-$(id -u)"
# Refresh Docker group membership without requiring a logout or WSL restart.
docker_cmd() {
  if [ "$use_group" = 1 ]; then /usr/bin/sg docker -c "$(printf '%q ' /usr/bin/docker "$@")";
  else /usr/bin/docker "$@"; fi
}
if [ "${1:-}" = --router-stop ]; then
  docker_cmd rm -f "$name" >/dev/null 2>&1 || true
  exit 0
fi
gpus=(--gpus all)
if [ -n "${CUDA_VISIBLE_DEVICES:-}" ]; then gpus=(--gpus "\"device=${CUDA_VISIBLE_DEVICES}\""); fi
# Publish only on localhost. Docker Desktop does not require host networking to be enabled.
serve_args=("$@")
port=8001
saw_host=false
for ((i=0; i<${#serve_args[@]}; i++)); do
  if [ "${serve_args[i]}" = --port ]; then
    port=${serve_args[i+1]:-}
    [[ "$port" =~ ^[0-9]{1,5}$ ]] && ((10#$port >= 1 && 10#$port <= 65535)) || { echo 'Port must be 1 to 65535' >&2; exit 2; }
  elif [ "${serve_args[i]}" = --host ]; then
    [ $((i+1)) -lt ${#serve_args[@]} ] || { echo 'Missing host value' >&2; exit 2; }
    serve_args[i+1]=0.0.0.0
    saw_host=true
  fi
done
if [ "$saw_host" = false ]; then serve_args+=(--host 0.0.0.0); fi
# Cache model weights in a named Linux volume across starts and setup retries.
cmd=(/usr/bin/docker run --rm --init --name "$name" -p "127.0.0.1:$port:$port" --ipc host "${gpus[@]}" --ulimit memlock=-1 --ulimit stack=67108864 -e TRTLLM_NO_USAGE_STATS=1 -v "llama-router-trtllm-cache-$(id -u):/root/.cache" --entrypoint trtllm-serve "$image" "${serve_args[@]}")
if [ "$use_group" = 1 ]; then exec /usr/bin/sg docker -c "$(printf '%q ' "${cmd[@]}")";
else exec "${cmd[@]}"; fi
LAUNCHER
} > "$launcher"
chmod 0755 "$launcher"
mv -f "$launcher" /opt/llama-router/trtllm/bin/trtllm-serve
step 6 'Installation complete. Choose Start to download and load your model.'
