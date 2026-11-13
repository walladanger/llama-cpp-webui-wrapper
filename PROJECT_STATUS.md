# llama.cpp Router implementation status

> Historical implementation snapshot: the notes below record November 6, 2026. The 0.1.3 full installer is published and its source is integrated into main. See the [current overview](README.md) and [release validation](docs/releases/0.1.3/README.md).

Updated: November 6, 2026.

This records the tested Windows working copy used for the GPU profiles and contextual help update. Its source changes are submitted to walladanger/llama-cpp-webui-wrapper for review. No existing installed application was replaced.

## Implemented and verified

- Node and Rust share launch-constraint fixtures, numeric ranges, Boolean validation, cache/split constraints, and managed option aliases. Accepted numeric text is emitted as canonical numeric arguments. Explicit context and requested floating-point caches are preserved.
- Legacy settings migrate on read without rewriting the original file. Version 1 profiles preserve extension fields, expose a revision, validate before saving, reject stale saves, and use locked atomic replacement.
- Managed environment variables cannot bypass settings; probe/launch device visibility is consistent; inherited P2P is removed by default. Launch diagnostics redact custom environment values and credential arguments.
- Ordered physical GPU UUID selection resolves fresh runtime IDs, rejects unavailable cards, and refuses conflicting visibility overrides. A bounded read-only CUDA driver helper retrieves identities when NVML fails.
- Rust device/version/help probes have deadlines and output limits. Installed executable/DLL package fingerprints and advertised flags are distinct from actual model verification.
- The existing Models page now contains a collapsible launch-profile editor, saved launch preview, physical GPU selector, and runtime inspection. Existing main layout is retained. Launch changes require an app restart.
- Authored hover-help documentation and explained starting values cover the new launch inputs. Existing global help and its black translucent documentation panel are retained.
- A reusable streaming canary records package/model hashes, resolved settings, allocation logs, generated output, TTFT, content TTFT, and actual token counts. Role-only and empty stream events do not end TTFT; unavailable values remain null.

## Validation evidence

- Node wrapper suite: 145 tests passed.
- Native suite: 14 tests passed (13 app tests plus 1 CUDA-helper test). The shared launch contract is exercised by both compilers.
- Svelte check: 0 errors and 0 warnings. Production UI build passed.
- Built-app browser checks passed for profile saving/revision refresh, preview, unavailable GPU inventory, contextual help, and narrow-window layout.
- Global help browser checks passed. Its dynamic-removal check was isolated from a reflow-induced hover over another valid panel.
- Final Windows release binaries compiled successfully after the review fixes. Independent review was blocked by a file-reading tool stall; the author performed a separate review and added regression tests for its findings.

Live runtime: llama.cpp build 12125, commit 7d516e25e, CUDA 12.4 package.
Live model: Qwen2.5 0.5B Instruct Q4_K_M, 2048-token context, one sequence.

Both direct CUDA selection and reversed ordered 3090 UUID selection returned READY through streaming chat. Logs show 25/25 layers offloaded, with model and KV buffers on both 3090s. Raw results are in validation/dual-3090-canary.json and validation/dual-3090-uuid-canary.json. The UUID canary observed roughly 25 ms to first generated content. These short correctness checks are not repeated benchmarks or evidence that a large model, tensor mode, or multiple workers fit.

This host exposes one RTX 4070 and two RTX 3090s to CUDA. NVML initialization fails here; the CUDA identity fallback works. Power, utilization, temperature, free-memory and exact driver-version telemetry must remain unavailable where the relevant probe cannot supply them.

## Remaining work

The app is not complete against the full multi-runtime control plan. Performance validation is prioritized before Additional runtimes.

1. **GPU memory planning and reservations.** Account for stale telemetry, headroom, resident allocations and concurrent starts. Release reservations after startup failure, cancellation or worker exit.
2. **Independent workers and request routing.** Add a worker registry, lifecycle management, request destinations, queueing and cancellation for per-card models and workers sharing a card. Current GPU placement configures one whole llama.cpp server.
3. **Live GPU and worker monitoring.** Integrate available VRAM, utilization, power, temperature, active requests, tokens per second and documented TTFT into the existing controls. Keep unavailable readings distinct from zero.
4. **Validated runtime updates and rollback.** Add immutable package acquisition, model/build canaries, draining, activation records and rollback. Fingerprints alone do not implement the update lifecycle.
5. **Performance validation.** Retain fixed hashes, prompts, quantization, context and cache settings. Separate cold loading from warm inference, repeat measurements, and compare one 3090 with dual-3090 layer splitting. Test tensor mode only for eligible model/build combinations and concurrency 1/2/4 only when memory permits. Retain raw timings, actual token counts, errors and peak VRAM; measure power/energy only when available. Short correctness canaries do not establish general performance.
6. **Additional runtimes.** Complete actual model-serving validation for existing WSL vLLM/TensorRT-LLM management. Add runtime-specific adapters and model/version gates for KoboldCpp, Ollama, LM Studio and isolated Transformers workers. Validate ExecuTorch artifacts/delegates before claiming serving support. Do not apply llama.cpp flags as universal controls.
7. **Final installer and fresh-install experience.** Finish prerequisites, installation paths, first run, shortcuts, upgrade preservation, uninstall/reinstall and clean-machine checks. A portable update ZIP does not complete this gate.
8. **Independent review, integration and release.** Complete independent review, resolve findings, run final end-to-end checks and publish accurate release notes and versioned artifacts. The implementation PR remains draft and unmerged.

The expanded [completed report](https://github.com/walladanger/llama-cpp-webui-wrapper/blob/main/docs/project-status/COMPLETED.md) and [planned-work checklist](https://github.com/walladanger/llama-cpp-webui-wrapper/blob/main/docs/project-status/PLANNED.md) are published on main, with printable PDFs linked from both documents and the [project landing page](https://github.com/walladanger/llama-cpp-webui-wrapper).

RAG remains deferred. Keep unknown capabilities distinct from verified inference. Do not silently change placement or resource budgets to recover from an error.
