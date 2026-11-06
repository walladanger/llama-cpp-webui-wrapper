# llama.cpp Router

A Windows desktop application for running local language models, controlling their runtime settings, and developing toward a multi-runtime inference router.

![CI](https://img.shields.io/github/actions/workflow/status/walladanger/llama-cpp-webui-wrapper/tauri-shell.yml?branch=main&label=CI) ![License](https://img.shields.io/github/license/walladanger/llama-cpp-webui-wrapper) ![Release](https://img.shields.io/github/v/release/walladanger/llama-cpp-webui-wrapper)

> **Development status - November 6, 2026:** The GPU-profile, desktop-control and hover-help update is implemented and tested in [draft PR #5](https://github.com/walladanger/llama-cpp-webui-wrapper/pull/5). It has not been merged into main or declared a finished production release. Published release packages may predate that update.

[Completed work](docs/project-status/COMPLETED.md) | [Planned work and completion checks](docs/project-status/PLANNED.md) | [Printable completed report](docs/project-status/print/Llama_Router_Completed_Work_2026-11-06.pdf) | [Printable roadmap](docs/project-status/print/Llama_Router_Planned_Work_2026-11-06.pdf)

## What the app does

llama.cpp Router puts a local inference server inside a Windows desktop workflow. The shell starts the server, opens its web UI in a native window and exposes controls for model locations, launch settings and diagnostics. llama.cpp continues to load the model, allocate tensors and generate responses on the CPU/GPU.

The tested update lets users choose physical GPUs, preserve their order across device renumbering, inspect a launch before restarting, and get detailed explanations for technical inputs. It also includes model/log pages and separate management controls for WSL vLLM, TensorRT-LLM and llama-bench.

The longer-term goal is a server-oriented runtime manager: one large model across selected GPUs, different models on different cards, or several workers sharing a card under memory admission rules. Independent workers, cross-runtime request routing and atomic VRAM reservations are still unfinished. The current GPU profile configures one whole llama.cpp server.

Local inference runs on the workstation. Model downloads use their configured online sources. Optional provider connections and broader cloud routing are a later direction; they are not required for the basic local llama.cpp workflow.

## How it works

1. **Choose the model and settings.** Use local GGUF files, choose model folders, and set the server's GPU placement, context, cache and related launch options. The development update adds the Models-page profile editor and contextual guides.

2. **Resolve hardware and validate the request.** The wrapper discovers runtime devices, resolves saved physical GPU UUIDs to the current device order, and rejects incompatible or malformed settings before startup.

3. **Start a managed local server.** The desktop shell starts llama-server with an argument array and its own child environment, then checks readiness. The runtime loads model weights and performs inference; the wrapper controls startup and settings.

4. **Use chat or connect an API client.** The web UI appears inside the desktop window. API clients can connect to the running llama.cpp server's compatible endpoints. The Windows Tauri build uses localhost port 18080; other launch modes may differ.

5. **Inspect results and change deliberately.** Read status and logs, inspect the saved launch plan, and use hover help to understand controls. Saving launch settings does not move an already loaded model; restart the app to apply those changes.

### Which part owns which job?

| Part | Responsibility |
| --- | --- |
| Windows shell | Native window, server startup/readiness and desktop controls. |
| Web UI | Chat, model/log pages, settings and contextual documentation. |
| Launch profile | Durable user intent: selected GPUs, context, caches and related launch choices. |
| Runtime adapter / launcher | Validate settings and translate them into the options accepted by the chosen binary. |
| llama.cpp server | Actual model loading, tensor allocation, inference and the runtime's API endpoints. |
| Future worker/router layer | Per-model processes, memory admission and request routing; not completed by this update. |

Two 24 GB cards provide nominal aggregate capacity; they do not become one transparent 48 GB allocation. Split weights are ratios rather than hard GiB quotas. Context, KV caches, buffers, display use and other workloads also consume memory.

## Completed development work

The following features are implemented in the tested update. Their merge/release status is separate from their implementation status.

| Area | Delivered behavior | Boundary |
| --- | --- | --- |
| [C01 - Windows desktop launch and update build](docs/project-status/COMPLETED.md) | The Windows shell and companion manager compile, and a portable update package contains the updated binaries, UI, source snapshot and validation records. | This is an update for an existing portable installation. It does not establish that a complete new-machine installer is finished. |
| [C02 - Model, log and engine-control workspace](docs/project-status/COMPLETED.md) | The development UI includes local model-folder, model-list, cache/log-folder and log-viewing controls. Separate pages expose management controls for WSL vLLM, TensorRT-LLM and llama-bench. | Control availability is not a claim that every WSL engine has completed real model inference testing. Full service validation remains planned. |
| [C03 - GPU discovery with a CUDA identity fallback](docs/project-status/COMPLETED.md) | The runtime discovers the available GPUs on the validation machine: two RTX 3090s and one RTX 4070. | Missing monitoring readings remain unknown. Detection on this machine does not certify every AMD, Intel or other backend. |
| [C04 - Durable, ordered GPU selection](docs/project-status/COMPLETED.md) | A profile can save an ordered set of physical GPU UUIDs rather than relying on CUDA index numbers that may change. | UUID selection chooses devices for one managed server. It does not create one independent model worker per GPU. |
| [C05 - Real dual-3090 layer-split inference](docs/project-status/COMPLETED.md) | One model was loaded across both RTX 3090s using layer splitting and explicit allocation weights. | This is a small-model correctness result. Large-model capacity, tensor mode, mixed-card performance and multi-worker concurrency are not proven by this test. |
| [C06 - Versioned, durable launch profiles](docs/project-status/COMPLETED.md) | Version 1 profiles preserve settings and extension data, track revisions and protect against stale saves. | The current editor manages the active whole-server launch profile. A complete deployment/profile manager for multiple workers is still to come. |
| [C07 - Consistent launch validation in Node and Rust](docs/project-status/COMPLETED.md) | Both launch compilers check numeric ranges, Boolean values, GPU split/cache combinations, quoting and managed option conflicts. | Static validation checks the request. It cannot prove that every model fits or that an experimental mode works on a particular binary. |
| [C08 - Protected child environment and redacted diagnostics](docs/project-status/COMPLETED.md) | Managed environment variables and extra arguments cannot bypass the validated settings, and credential values are redacted from launch diagnostics. | This is launch-envelope protection, not a claim of a comprehensive security audit or completed multi-provider credential management. |
| [C09 - Launch editor and requested/effective preview](docs/project-status/COMPLETED.md) | The Models page contains a collapsible launch-profile editor, physical GPU selector, saved-launch preview and runtime-inspection controls. | Launch changes require an app restart. The controls currently configure the whole server, not individual model instances. |
| [C10 - Global hover help and input guidance](docs/project-status/COMPLETED.md) | Actions and inputs can reveal a circled question button, compact help, and a nearly full-window documentation panel with black translucent styling and background blur. | Suggested values are examples for comparison. They are never applied automatically and do not replace a model's own configuration requirements. |
| [C11 - Package identity and bounded capability inspection](docs/project-status/COMPLETED.md) | The wrapper fingerprints the installed executables/DLLs and captures bounded version/help evidence for the selected runtime. | This does not implement automatic downloads, live package replacement, compatibility promotion or rollback. |
| [C12 - Streaming timing and reproducible correctness checks](docs/project-status/COMPLETED.md) | A reusable canary records runtime/model hashes, resolved settings, allocation logs, generated output, first-token timing and available token counts. | Timing is currently a test-runner capability. A live monitoring dashboard, repeated benchmarks and production performance guarantees are not finished. |

The [expanded completed report](docs/project-status/COMPLETED.md) explains how each item works and the evidence supporting it.

### Validation snapshot

| Check | Observed result |
| --- | --- |
| Node wrapper suite | 145 tests passed. |
| Native suite | 14 tests passed: 13 app tests and one CUDA-helper test. |
| Svelte checking | Zero errors and zero warnings. |
| UI delivery | Production build, changed-file lint/formatting and profile/help browser checks passed. |
| Windows binaries | Release binaries compiled. |
| Hardware discovery | CUDA exposed two RTX 3090s and one RTX 4070 on the validation host. |
| Real inference | Qwen2.5 0.5B Instruct Q4_K_M returned READY through dual-3090 streaming chat, including reversed UUID selection; logs show 25/25 layers offloaded. |
| Configuration tested | llama.cpp build 12125, commit 7d516e25e, CUDA 12.4 package; 2048 context, one sequence. |

These are correctness checks for the tested configuration. They are not evidence that a large model fits, that tensor mode is faster, or that multi-worker concurrency is ready. Independent review remains outstanding. A feature advertised by a binary's help output is not marked as successful model inference.

NVML initialization currently fails on the validation host. The CUDA identity fallback works, but unavailable power, utilization, temperature, free-memory or driver-version readings remain unknown rather than being displayed as zero.

## Planned work, in priority order

**Performance validation is before Additional runtimes.** The order below is the project to-do priority, not a claim that later work is already running or a promise of delivery dates.

| Priority | Workstream | Current state | Completion outcome |
| --- | --- | --- | --- |
| 1 | **GPU memory planning and reservations** | Not implemented | Prevent the wrapper's managed workloads from promising the same free VRAM to more than one worker. |
| 2 | **Independent workers and request routing** | Not implemented | Support one large model across cards, a different model on each card, and multiple models sharing a card when memory allows. |
| 3 | **Live GPU and worker monitoring** | Partial: identity and timing utilities exist | Show what each GPU and worker is doing in the existing app controls. |
| 4 | **Validated runtime updates and rollback** | Not implemented: package inspection exists | Obtain compatible runtime updates without losing saved profiles or replacing a working package prematurely. |
| 5 | **Performance validation** | Partial: short correctness canaries passed | Establish repeatable performance and capacity evidence before expanding runtime coverage. |
| 6 | **Additional runtimes** | Partial: vLLM/TensorRT-LLM management controls exist | Expand the router through runtime-specific adapters after the performance-validation priority. |
| 7 | **Final installer and fresh-install experience** | Partial: portable build/update and source setup exist | Let a user install and launch the completed app with clear prerequisites, a working shortcut and no manual server-start sequence. |
| 8 | **Independent review, integration and release** | Pending | Turn the tested development update into a reviewed, integrated release with an accurate support boundary. |

The [expanded roadmap](docs/project-status/PLANNED.md) includes implementation work, dependencies and checkboxes for deciding when each item is actually complete.

### Performance validation before runtime expansion

The next performance work will use fixed model/runtime hashes, quantization, prompts, context, cache settings and output limits. Comparisons will separate cold model loading from warm inference and include repeated measurements, not a single short response.

Start with one 3090 and dual-3090 layer splitting. Tensor comparisons require an eligible exact model/build; mixed-card and concurrency 1/2/4 tests require sufficient memory. Retain correctness results, raw timings, actual output-token counts and errors. Report peak memory and power/energy only when the measurement source can supply them reliably.

### Runtime support boundary

| Runtime | Current position |
| --- | --- |
| llama.cpp | Primary managed local engine; dual-card layer inference checked on a small model. |
| vLLM | WSL management controls exist; fuller real-model serving validation remains. |
| TensorRT-LLM | WSL management controls exist; GPU/model compatibility and inference remain to be established for the intended setup. |
| KoboldCpp | Adapter integration planned. |
| Ollama | Adapter/provider integration planned. |
| LM Studio | Adapter/provider integration planned; expose only controls supported by its detected interface. |
| Transformers | Isolated worker/environment integration planned. |
| ExecuTorch | Target retained; artifact/delegate compatibility must be validated before serving support is claimed. |

RAG and document-ingestion work remain deferred while the runtime/server foundation is completed.

## Using the app

### Published portable packages

1. Check the [releases page](https://github.com/walladanger/llama-cpp-webui-wrapper/releases) for a published Windows package and read its release notes. A main-branch release may not contain the draft update described here.
2. Extract the complete portable package. Keep its configuration, model locations and runtime files together as documented by that release.
3. Add suitable GGUF models, then launch the Windows executable.

The separate development update package is intended for an existing compatible portable installation. It is not a full fresh-install installer and does not include a replacement model collection.

### Development update from source

The tested source is currently on `codex/router-gpu-profiles-help-20261106`, associated with [PR #5](https://github.com/walladanger/llama-cpp-webui-wrapper/pull/5). Review the scripts and prerequisites before running the setup.

```powershell
git clone https://github.com/walladanger/llama-cpp-webui-wrapper.git
cd llama-cpp-webui-wrapper
git switch --track origin/codex/router-gpu-profiles-help-20261106
.\Setup-Llama-WebUI.ps1
.\Run-Llama-WebUI.ps1
```

Source builds need Node.js for the UI/wrapper and the Rust/Windows build environment for the Tauri shell. The source setup can obtain a CPU server when none is installed; GPU execution requires a compatible runtime package and NVIDIA driver. WSL engines have separate installation and model requirements. See the [development shell notes](https://github.com/walladanger/llama-cpp-webui-wrapper/blob/codex/router-gpu-profiles-help-20261106/tauri-shell/README.md).

### Configuration and help

The launcher reads `portable-data/config/llama-server.json` and turns the saved settings into runtime arguments. The updated Models page adds the launch-profile editor. Legacy flat settings migrate on read; saving writes a versioned profile with revision protection.

Hover an action or input to reveal its help button. Click it, or focus the control and press F1, to read the larger guide. Suggested values explain starting points and trade-offs; opening help never applies them automatically. Saving launch settings does not reconfigure a model already loaded into memory. Restart the app to apply them.

## Project records

- [Expanded completed work](docs/project-status/COMPLETED.md)
- [Ordered roadmap and completion checklist](docs/project-status/PLANNED.md)
- [Printable completed report](docs/project-status/print/Llama_Router_Completed_Work_2026-11-06.pdf)
- [Printable planned-work report](docs/project-status/print/Llama_Router_Planned_Work_2026-11-06.pdf)
- [Development implementation notes](https://github.com/walladanger/llama-cpp-webui-wrapper/blob/codex/router-gpu-profiles-help-20261106/PROJECT_STATUS.md)
- [Draft implementation PR #5](https://github.com/walladanger/llama-cpp-webui-wrapper/pull/5)

## License and credits

[MIT License](LICENSE). Based on ggml-org/llama.cpp. The desktop wrapper owns launch/control behavior; the upstream runtime owns inference. See [the preserved llama.cpp documentation](docs/README-llama.cpp.md) and [security guidance](SECURITY.md).
