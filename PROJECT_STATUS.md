# llama.cpp Router implementation status

Updated: November 5, 2026 (America/New_York).

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

The app is not complete against the full multi-runtime control plan.

1. Deployment memory planning and atomic reservations, including stale telemetry, headroom, resident allocations, and failure/exit release.
2. A worker registry and request routing for independent per-card models and multiple workers sharing a card. Current GPU placement still configures one whole llama.cpp server.
3. Immutable runtime package acquisition, model/build compatibility canaries, draining, activation journal, automatic promotion and rollback. Current package fingerprinting does not implement this update lifecycle.
4. Additional runtime adapters and model/version capability gates. Existing vLLM and TensorRT-LLM WSL management is retained; KoboldCpp, Ollama, LM Studio, Transformers and ExecuTorch serving integration is not completed in this checkout.
5. Per-worker/GPU monitoring in the existing controls and reproducible warm/cold benchmarks with concurrency, power and memory measurements. TTFT currently has tests and a real canary, not full dashboard integration.
6. Final installer and end-to-end validation of the completed app, beyond an update package for an existing portable installation.

RAG remains deferred. Keep unknown capabilities distinct from verified inference. Do not silently change placement or resource budgets to recover from an error.
