# llama-cpp-webui-wrapper

Portable desktop manager for llama.cpp, WSL2 inference engines, and llama-bench.

![CI](https://img.shields.io/github/actions/workflow/status/walladanger/llama-cpp-webui-wrapper/tauri-shell.yml?branch=main&label=CI) ![License](https://img.shields.io/github/license/walladanger/llama-cpp-webui-wrapper) ![Release](https://img.shields.io/github/v/release/walladanger/llama-cpp-webui-wrapper)

<!-- SCREENSHOT PLACEHOLDER: hero image of built-in web UI running in the native Windows window -->
_Screenshot coming soon._

## Features

- Bundles a pinned ggml-org/llama.cpp release and its web UI in a standalone Windows application.
- Starts and monitors vLLM or TensorRT-LLM in WSL2 from the desktop dashboard.
- Runs llama-bench on local GGUF models and saves the results.
- Fast, native desktop window via Tauri 2.
- Node.js fallback wrapper that uses an existing Edge or Chrome installation.
- Simple configuration via a standard JSON file.
- Portable mode: models, settings and logs in a single directory folder.
- Direct download and sync of model catalogs.

## Architecture

```mermaid
flowchart TD
    User([User]) --> Dashboard[Tauri engine dashboard]
    Dashboard --> Server[Bundled llama-server chat test]
    Dashboard --> VLLM[vLLM in WSL2]
    Dashboard --> TRT[TensorRT-LLM in WSL2]
    Dashboard --> Bench[llama-bench]
    Clients[Other apps and coding agents] --> Server
    Clients --> VLLM
    Clients --> TRT
    Server <--> Models[(portable-data/models)]
```

The Tauri dashboard manages background engines and benchmarks. Its llama.cpp chat test starts the bundled `llama-server` on port 18080 and opens that server's web UI in a separate window. The older `web-wrapper` remains a Node.js fallback. Models, configuration, and logs live in `portable-data`.

## Quick start

### Portable app (Windows x64 CUDA)

1. Download `Llama-WebUI-windows-x64-cuda.zip` from the
   [releases page](https://github.com/walladanger/llama-cpp-webui-wrapper/releases).
2. Extract the ZIP file.
3. Put `.gguf` model files in `portable-data\models`.
4. Double-click `llama-webui.exe` to open the engine dashboard. Use **Open llama.cpp chat test** for the bundled server's chat UI.

### From source (Windows)

Prerequisites: CMake, Visual Studio Build Tools, Node.js (for web-wrapper),
Rust (optional, for tauri-shell).

```powershell
# Run the setup script to build the server, UI and shells.
.\Setup-Llama-WebUI.ps1

# Start the application using the generated desktop shortcut or script.
.\Run-Llama-WebUI.ps1
```

## Configuration

The server reads `portable-data\config\llama-server.json`. The launcher and
wrappers will pass these settings to `llama-server` when starting.

| Setting | Purpose | Default |
| --- | --- | --- |
| `ctx_size` | Context window size | `0` |
| `fit` | Enable context fitting | `true` |
| `fit_target` | Fit target | `"1024"` |
| `fit_ctx` | Fit context | `"4096"` |
| `n_gpu_layers` | Number of layers to offload to GPU | `-1` |
| `gpu_placement` | GPU placement strategy | `"manual"` |
| `flash_attn` | Flash attention | `"auto"` |
| `concurrent_slots` | Number of concurrent requests | `8` |

## Screenshots

<!-- SCREENSHOT PLACEHOLDER: hero image of the terminal log window alongside the native UI -->
_Screenshot coming soon._

## Roadmap

See issues.

## License & credits

[MIT License](LICENSE)

Based on ggml-org/llama.cpp. For llama.cpp documentation, see
[docs/README-llama.cpp.md](docs/README-llama.cpp.md).
