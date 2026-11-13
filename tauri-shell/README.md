# Windows shell and WSL2 engines

The Windows package contains `llama-webui.exe`, a dashboard for background engines and benchmarks. Use its buttons to edit settings, start or stop vLLM and TensorRT-LLM, inspect status and logs, install a missing llama-bench, and run a GGUF benchmark. **Open llama.cpp chat test** starts the bundled llama-server on port 18080 and opens its web UI in a separate window. Set `LLAMA_CPP_PORT` to change that port. The test window refuses to connect to a server started by another app. API clients connect directly to the running engine. The companion `llama-engine-manager.exe` provides the same engine and benchmark commands for scripts.

## vLLM

Install vLLM and a model in WSL2 separately. Edit `portable-data\config\vllm.json` in the portable package to choose the WSL distro, `vllm` executable, model, port, GPU IDs, context length, and GPU memory share. Then run:

```powershell
.\llama-engine-manager.exe vllm start
.\llama-engine-manager.exe vllm status
.\llama-engine-manager.exe vllm logs
.\llama-engine-manager.exe vllm stop
```

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:73b82c692b2a473fb181050fbe417d1df3053babe1adcdbeca5bde7abb579f37 -->

The default API is `http://127.0.0.1:8000/v1`. The manager binds vLLM to WSL loopback and checks its health and served model from Windows. The service continues when the chat window closes. For both WSL engines, the manager leaves a foreground WSL process monitoring the systemd user unit. This keeps the distribution alive until the unit stops; no idle timeout setting is required. Changing the distro through Save settings first stops the service in the old distro. Other setting changes require a stop and restart.

<!-- /coderabbit-ai-generated:v1 -->

The default 0.5B model verifies the connection. For coding work, use a stronger model. A Codex CLI custom provider needs `wire_api="responses"`, `base_url="http://127.0.0.1:8000/v1"`, and `requires_openai_auth=false`. Set `max_model_len` high enough for Codex's instructions. The manager defaults to vLLM's native sampler because FlashInfer's JIT sampler may need a matching CUDA compiler and headers in WSL2.

## TensorRT-LLM

Install TensorRT-LLM in a separate WSL2 environment using [NVIDIA's installation guide](https://nvidia.github.io/TensorRT-LLM/installation/installation-guide.html). Its CUDA, MPI, and Python requirements differ from vLLM. Edit `portable-data\config\trtllm.json` with the WSL distro, the absolute path to `trtllm-serve` if it is in a virtual environment, a supported model, a free port, and optional GPU IDs. The default port is 8001, separate from vLLM's 8000.

The [current tested hardware list](https://nvidia.github.io/TensorRT-LLM/supported-hardware.html) names data center GPUs such as A100 and L40. An [earlier support matrix](https://nvidia.github.io/TensorRT-LLM/1.0.0/reference/support-matrix.html) includes Ampere SM86 and Ada SM89, the architectures used by GeForce RTX 30 and 40 series. Neither page proves that the current release and a chosen model work on this machine. Successful TensorRT-LLM inference here remains unverified; test a small model before relying on the service.

```powershell
.\llama-engine-manager.exe trtllm installed
.\llama-engine-manager.exe trtllm start
.\llama-engine-manager.exe trtllm status
.\llama-engine-manager.exe trtllm logs
.\llama-engine-manager.exe trtllm stop
```

The manager starts an independent WSL2 user service, disables NVIDIA usage telemetry for that service, checks `/health` and `/v1/models` from Windows, and leaves it running when the chat window closes. TensorRT-LLM has not yet passed a real model request on this machine. Check its API behavior with your intended client before relying on it. The chat window continues to use llama.cpp.

## llama-bench and startup prompts

The official pinned llama.cpp package normally includes `llama-bench.exe`. If it is missing, the dashboard displays a download prompt on startup for the matching pinned release. The download is optional. To install or run it manually:

```powershell
.\llama-engine-manager.exe bench install
.\llama-engine-manager.exe bench run C:\path\to\model.gguf
.\llama-engine-manager.exe bench run C:\path\to\model.gguf CUDA2
```

The benchmark runs 512 prompt tokens and 128 generated tokens, repeats each test three times, and saves the Markdown output to `portable-data\logs\llama-bench.md`. It measures llama.cpp itself; it does not benchmark the vLLM or TensorRT-LLM API. If TensorRT-LLM is missing in the configured WSL distro, the dashboard displays an installation guide prompt on startup. It does not install TensorRT-LLM automatically because the required system packages and CUDA toolkit depend on the WSL environment.

## Updating llama.cpp

The packaged llama.cpp server is selected by the release tag in `llama-cpp-release.txt` and CUDA version in `cuda-version.txt`. The packager does not advance to the newest release automatically. The source installation script uses the same tag when it downloads a prebuilt server.

This repository has no Git merge base with `ggml-org/llama.cpp`. Do not merge upstream `master` into it. The wrapper uses official release binaries, so routine upstream updates only require changing the pinned tag on a candidate branch. `Setup-Llama-WebUI.ps1` also downloads the pinned release when no server is installed; it does not rebuild the copied C++ source.

The **Upstream release compatibility** workflow checks the Node and Rust wrappers, the pinned release assets, and the CPU server on pull requests. Running it manually also builds the portable CUDA package. After packaging, run `smoke-package.ps1 -Model <path-to-test.gguf> -Device CUDA2` on the intended GPU. The script launches `llama-server`, checks `/health`, requests a short chat answer, and stops the test process. The packager keeps a versioned ZIP beside the latest ZIP so a previous build remains available. The Tauri workflow publishes the release only when manually dispatched on `main`. These checks catch packaging and common runtime failures, but no automated check can guarantee every model and GPU combination works.

If you need to update or modify llama.cpp C++ source itself, first migrate that source into a repository with real upstream history. That is a separate project from updating the packaged wrapper.
