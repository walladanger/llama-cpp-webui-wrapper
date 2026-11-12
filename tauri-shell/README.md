# Windows shell and WSL2 engines

## Full Windows installation

Download the [0.1.3 full Windows installer](https://github.com/walladanger/llama-cpp-webui-wrapper/releases/download/v0.1.3/LlamaCpp-Router-0.1.3-Windows-x64-Setup.exe), run Setup and open Router from its shortcut. It supports fresh installs and upgrades, includes the pinned llama.cpp/CUDA and benchmark files, and preserves your models and settings. See [release details](../docs/releases/0.1.3/README.md).


The Windows package opens the stock llama.cpp web UI as its main window on port 18080. Its sidebar has separate vLLM, TensorRT-LLM, and llama-bench pages. Those pages use the local desktop bridge to edit settings, start or stop WSL2 services, inspect status and logs, install a missing llama-bench, and run a GGUF benchmark. The browser view shows the same pages, but engine controls require the Windows app. The window refuses to connect to a server started by another app. API clients connect directly to the running engine. The companion `llama-engine-manager.exe` provides the same engine and benchmark commands for scripts.

The main window has a custom title bar. The Models page can select multiple external GGUF folders without moving files, choose the Hugging Face download cache, load or unload models, and start a GGUF download from a Hugging Face repository. Selected folders are saved in `portable-data/config/app-paths.json` and exposed through a generated `external-models.ini` preset. The Logs page can choose a log folder, open it in File Explorer, read local log files, and view the vLLM or TensorRT-LLM service journal. Cache and log folder changes take effect after restarting the app.

## vLLM

Install vLLM and a model in WSL2 separately. Edit `portable-data\config\vllm.json` in the portable package to choose the WSL distro, `vllm` executable, model, port, GPU IDs, context length, and GPU memory share. Then run:

```powershell
.\llama-engine-manager.exe vllm start
.\llama-engine-manager.exe vllm status
.\llama-engine-manager.exe vllm logs
.\llama-engine-manager.exe vllm stop
```

The default API is `http://127.0.0.1:8000/v1`. The manager binds vLLM to WSL loopback and checks its health and served model from Windows. The service continues when the chat window closes.

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

The manager starts an independent WSL2 user service, disables NVIDIA usage telemetry for that service, checks `/health` and `/v1/models` from Windows, and leaves it running when the app closes. TensorRT-LLM has not yet passed a real model request on this machine. Check its API behavior with your intended client before relying on it. Chat continues to use llama.cpp.

## llama-bench and startup prompts

The official pinned llama.cpp package normally includes `llama-bench.exe`. If it is missing, the dashboard displays a download prompt on startup for the matching pinned release. The download is optional. To install or run it manually:

```powershell
.\llama-engine-manager.exe bench install
.\llama-engine-manager.exe bench run C:\path\to\model.gguf
.\llama-engine-manager.exe bench run C:\path\to\model.gguf CUDA2
```

The benchmark runs 512 prompt tokens and 128 generated tokens, repeats each test three times, and saves the Markdown output to `portable-data\logs\llama-bench.md`. It measures llama.cpp itself; it does not benchmark the vLLM or TensorRT-LLM API. If TensorRT-LLM is missing in the configured WSL distro, the dashboard displays an installation guide prompt on startup. The TensorRT page now offers guided automatic setup. It checks existing Linux installations and can reuse Docker Desktop, or install native prerequisites on supported Ubuntu versions. Downloads and system changes start only when requested from that setup page.

## Updating llama.cpp

The packaged llama.cpp server is selected by the release tag in `llama-cpp-release.txt` and CUDA version in `cuda-version.txt`. The packager does not advance to the newest release automatically. The source installation script uses the same tag when it downloads a prebuilt server.

This repository has no Git merge base with `ggml-org/llama.cpp`. Do not merge upstream `master` into it. The wrapper uses official release binaries, so routine upstream updates only require changing the pinned tag on a candidate branch. `Setup-Llama-WebUI.ps1` also downloads the pinned release when no server is installed; it does not rebuild the copied C++ source.

The **Upstream release compatibility** workflow checks the Node and Rust wrappers, the pinned release assets, and the CPU server on pull requests. Running it manually also builds the portable CUDA package. After packaging, run `smoke-package.ps1 -Model <path-to-test.gguf> -Device CUDA2` on the intended GPU. The script launches `llama-server`, checks `/health`, requests a short chat answer, and stops the test process. The packager keeps a versioned ZIP beside the latest ZIP so a previous build remains available. The Tauri workflow publishes the release only when manually dispatched on `main`. These checks catch packaging and common runtime failures, but no automated check can guarantee every model and GPU combination works.

If you need to update or modify llama.cpp C++ source itself, first migrate that source into a repository with real upstream history. That is a separate project from updating the packaged wrapper.

## Context help

Hover an action, major panel, or input to reveal a circled question mark. After a short pause, a compact black translucent card explains the control and shows starting-value examples when available. Click the question mark, or focus a control and press F1, for a nearly full-window documentation panel with an overview, suggested values and explanations, instructions, and troubleshooting. Escape or Close returns to the control. Help never activates the underlying action, applies suggestions, or displays input credentials.

The main chat UI, Models, Logs, engine pages, benchmarks, and desktop loading/manager pages share this behavior. Settings field help uses the existing settings registry descriptions and options; technical fields add authored recommendations. Examples are comparison starting points, not hardware guarantees or replacements for a model author’s sampling recipe. GPU visibility is described separately from multi-GPU parallelism.

The shared source is `tools/ui/static/context-help.js`, `context-help-catalog.js`, and `context-help.css`. Add `data-help-key` for a catalogue topic, with optional `data-help-title`, `data-help-summary`, `data-help-default`, and `data-help-options` for a specific control or group. Delegated events cover dynamically rendered controls. `npm run sync:help` copies the shared files to `tauri-shell/ui`; `npm run build` includes that sync. Run `npm run test:help` from `tools/ui` for browser regression checks. Set `ROUTER_TEST_BROWSER` to an installed Chromium executable when needed.

Technical references: [llama.cpp server parameters](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md), [vLLM memory conservation](https://docs.vllm.ai/en/latest/configuration/conserving_memory/), and [vLLM parallelism](https://docs.vllm.ai/en/latest/serving/parallelism_scaling/). Actual defaults remain those supplied by the packaged engine and selected model.

## Durable launch profiles and GPU identity

Open Models → llama.cpp GPU and launch profile in the Windows app. Edit the existing server settings, save, and use Preview saved launch to inspect the resolved request. Restart the app to apply launch changes. These controls configure one whole server; they do not yet create independent per-card model workers.

The profile file remains `portable-data/config/llama-server.json`. Legacy flat settings load without rewriting the file. A save writes schema version 1 with id, name, revision, and settings; unknown extension fields survive. Saves validate before writing, use an exclusive lock and an atomic file replacement, and reject a stale revision. If a crashed writer leaves a `.lock` file, close the app and confirm no writer is running before removing that lock. Keep your existing configuration when applying an update.

Select physical cards in the order you want their allocation weights interpreted. Every saved UUID must be present; the wrapper does not replace a missing card with another GPU. An inherited or custom CUDA visibility list must agree with the selected UUIDs. When NVIDIA NVML is unavailable, the bounded companion command `llama-engine-manager.exe cuda-inventory` can read names, PCI addresses, total memory, and UUIDs from the Windows CUDA driver without creating a model context. It leaves unavailable free-memory and driver-version readings unknown.

Inspect runtime package shows the SHA-256 identity of adjacent executables/DLLs and bounded version/help evidence. Help advertisement is distinct from successful inference; advanced model-specific features remain unverified until tested. Actual startup checks advertised flags. Diagnostics redact custom environment values and credential arguments. P2P is disabled by default, including removal of an inherited GGML_CUDA_P2P variable.

Run `node scripts/validate-runtime.mjs --executable <llama-server.exe> --model <model.gguf> --device CUDA1,CUDA2 --tensor-split 1,1 --output <result.json>` from `web-wrapper` for a bounded streaming canary. For durable identity validation, use `--gpu-uuids <ordered,UUIDs> --helper <llama-engine-manager.exe>` instead of transient device numbers. It records the model/package hashes, allocations, context, generated content, and client-observed TTFT. This is a correctness canary, not a repeated performance benchmark.
