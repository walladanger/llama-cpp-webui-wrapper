# Windows shell and WSL2 engines

The Windows package contains `llama-webui.exe` for the bundled llama.cpp chat window and `llama-engine-manager.exe` for background WSL2 engines. The chat window remains a smoke test; API clients can connect directly to a running engine.

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

## Updating llama.cpp

The packaged llama.cpp server is selected by the release tag in `llama-cpp-release.txt` and CUDA version in `cuda-version.txt`. The packager does not advance to the newest release automatically. The source installation script uses the same tag when it downloads a prebuilt server.

This repository has no Git merge base with `ggml-org/llama.cpp`. Do not merge upstream `master` into it. The wrapper uses official release binaries, so routine upstream updates only require changing the pinned tag on a candidate branch. `Setup-Llama-WebUI.ps1` also downloads the pinned release when no server is installed; it does not rebuild the copied C++ source.

The **Upstream release compatibility** workflow checks the Node and Rust wrappers, the pinned release assets, and the CPU server on pull requests. Running it manually also builds the portable CUDA package. After packaging, run `smoke-package.ps1 -Model <path-to-test.gguf> -Device CUDA2` on the intended GPU. The script launches `llama-server`, checks `/health`, requests a short chat answer, and stops the test process. The packager keeps a versioned ZIP beside the latest ZIP so a previous build remains available. The Tauri workflow publishes the release only when manually dispatched on `main`. These checks catch packaging and common runtime failures, but no automated check can guarantee every model and GPU combination works.

If you need to update or modify llama.cpp C++ source itself, first migrate that source into a repository with real upstream history. That is a separate project from updating the packaged wrapper.
