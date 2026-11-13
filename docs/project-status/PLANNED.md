# llama.cpp Router: planned work and completion checks

> Historical snapshot: the report below records November 6, 2026. The 0.1.3 full installer is now published and its source is integrated into main. See the [current overview](../../README.md) and [release validation and remaining limits](../releases/0.1.3/README.md).

Snapshot: November 6, 2026. Current implementation: [draft PR #5](https://github.com/walladanger/llama-cpp-webui-wrapper/pull/5).

The tested development update is in draft PR #5. Its implemented features have not been merged into main or established as a finished production release. A portable update exists; a complete fresh-install release is still pending.

Performance validation is prioritized before additional runtimes. The following order is the project to-do order; some technical checks can be prepared in parallel without changing those priorities. No shipping dates or completion percentage are implied.

## Priority order

| Priority | Workstream | Current state |
| --- | --- | --- |
| 1 | GPU memory planning and reservations | Not implemented |
| 2 | Independent workers and request routing | Not implemented |
| 3 | Live GPU and worker monitoring | Partial: identity and timing utilities exist |
| 4 | Validated runtime updates and rollback | Not implemented: package inspection exists |
| 5 | Performance validation | Partial: short correctness canaries passed |
| 6 | Additional runtimes | Partial: vLLM/TensorRT-LLM management controls exist |
| 7 | Final installer and fresh-install experience | Partial: portable build/update and source setup exist |
| 8 | Independent review, integration and release | Pending |

## P01 - GPU memory planning and reservations

**Current state:** Not implemented.

**Goal:** Prevent the wrapper's managed workloads from promising the same free VRAM to more than one worker.

**Work to complete**

- Calculate usable memory after configurable headroom, pending reservations and expected growth.
- Treat stale or missing telemetry as uncertain; avoid double-counting memory already resident on a card.
- Acquire reservations atomically across selected GPUs and release them after failure, cancellation or process exit.

**Completion checks**

- [ ] Two simultaneous starts cannot claim the same remaining budget.
- [ ] Startup failure and out-of-memory paths release their reservations.
- [ ] Profiles keep their requested placement and budgets; no silent fallback rewrites them.

**Dependencies and limits:** Reliable inventory and sufficiently fresh memory readings are required. External GPU applications can still consume VRAM outside the wrapper's control.

## P02 - Independent workers and request routing

**Current state:** Not implemented.

**Goal:** Support one large model across cards, a different model on each card, and multiple models sharing a card when memory allows.

**Work to complete**

- Give each managed model instance its own ID, configuration, process/endpoint and health state.
- Track ownership, free ports, startup/stop behavior and request destinations in a worker registry.
- Add queueing, cancellation and failure cleanup; preserve the lifecycle of attached external providers.

**Completion checks**

- [ ] A dual-card model and two per-card models have distinct resolved plans.
- [ ] Requests reach the intended model and worker; port collisions and cancellation have tested behavior.
- [ ] Stopping or failing one worker does not incorrectly stop an unrelated provider.

**Dependencies and limits:** Memory admission from P01 must govern shared-card starts. The current whole-server placement controls do not provide this behavior by themselves.

## P03 - Live GPU and worker monitoring

**Current state:** Partial: identity and timing utilities exist.

**Goal:** Show what each GPU and worker is doing in the existing app controls.

**Work to complete**

- Display available VRAM, utilization, power and temperature with worker membership.
- Add active requests, queue/load state, tokens per second and client-observed TTFT.
- Refresh at a bounded rate, reduce work when hidden and distinguish missing readings from real zeros.

**Completion checks**

- [ ] Each reading identifies its GPU or worker and whether it is current or unavailable.
- [ ] TTFT and throughput labels use documented definitions and are not confused with connection readiness or server-only timing.
- [ ] Monitoring survives missing NVML data without invented values or an unresponsive UI.

**Dependencies and limits:** Worker ownership comes from P02. NVML initialization currently fails on the validation host; CUDA identity discovery does not replace power/utilization telemetry.

## P04 - Validated runtime updates and rollback

**Current state:** Not implemented: package inspection exists.

**Goal:** Obtain compatible runtime updates without losing saved profiles or replacing a working package prematurely.

**Work to complete**

- Download authoritative artifacts into immutable staged package directories with hashes and version records.
- Check required options and run isolated load/generation canaries for the intended model/build.
- Wait for affected workers to drain, journal activation and retain known-good packages for recovery.

**Completion checks**

- [ ] Corrupt packages, missing flags and failed canaries leave the active runtime intact.
- [ ] Locked DLLs, interrupted activation and failed restarts have tested recovery paths.
- [ ] Profiles survive update and rollback; the active package is identifiable.

**Dependencies and limits:** This depends on capability inspection and worker ownership. The existing pinned b12125 package and fingerprints are a foundation, not an automatic updater.

## P05 - Performance validation

**Current state:** Partial: short correctness canaries passed.

**Goal:** Establish repeatable performance and capacity evidence before expanding runtime coverage.

**Work to complete**

- Use fixed model hashes, quantization, prompts, generation limits, context and cache policies.
- Compare one 3090 with dual-3090 layer mode; test tensor mode only when that exact model/build is eligible. Add mixed-card tests only when hardware and memory permit.
- Separate cold loading from warm inference, warm up, then repeat runs at concurrency 1, 2 and 4 where admission allows.

**Completion checks**

- [ ] Retain raw results plus runtime, adapter, model, driver and topology identities.
- [ ] Report median/tail latency, TTFT, actual output-token counts, throughput, errors and peak VRAM; include power/energy only when reliable sampling is available.
- [ ] Check correctness before accepting a faster configuration and avoid general claims from a single small-model run.

**Dependencies and limits:** This work is explicitly prioritized before P06 Additional runtimes. Monitoring and reservations improve the evidence; each comparison must state any measurements still unavailable.

## P06 - Additional runtimes

**Current state:** Partial: vLLM/TensorRT-LLM management controls exist.

**Goal:** Expand the router through runtime-specific adapters after the performance-validation priority.

**Work to complete**

- Finish real model/endpoint validation for the existing WSL vLLM and TensorRT-LLM controls.
- Add KoboldCpp, Ollama and LM Studio integration using the interfaces each runtime actually supports.
- Provide isolated, versioned worker environments for Transformers; retain ExecuTorch as a target requiring artifact/delegate validation. Cloud-provider routing is a later requested direction.

**Completion checks**

- [ ] Each adapter states which controls are supported, unsupported or unknown for its detected version.
- [ ] Health, model identity, requests and lifecycle behavior are verified without pretending llama.cpp flags are universal.
- [ ] Do not claim generic Windows multi-GPU serving for an untested runtime or delegate.

**Dependencies and limits:** P05 Performance validation comes first in the roadmap. Runtime installation, model compatibility and management authority must be established separately for each adapter.

## P07 - Final installer and fresh-install experience

**Current state:** Partial: portable build/update and source setup exist.

**Goal:** Let a user install and launch the completed app with clear prerequisites, a working shortcut and no manual server-start sequence.

**Work to complete**

- Finish the installer flow, prerequisite checks, installation paths and first-run setup.
- Preserve model locations, saved profiles, caches and logs during application updates.
- Verify upgrade, uninstall/reinstall and fresh-machine behavior, including informative errors when a dependency is missing.

**Completion checks**

- [ ] A clean supported Windows installation can start the intended server and UI through the installed shortcut.
- [ ] Existing model files and settings survive an update.
- [ ] The installer is tested as an installer; a portable ZIP alone does not satisfy this gate.

**Dependencies and limits:** The final installer must package the intended completed behavior. The current update is for an existing portable installation.

## P08 - Independent review, integration and release

**Current state:** Pending.

**Goal:** Turn the tested development update into a reviewed, integrated release with an accurate support boundary.

**Work to complete**

- Complete independent review, resolve findings and run the relevant CI/end-to-end checks on the final commit.
- Review the draft PR, integrate approved changes and build versioned release artifacts.
- Publish release notes, validation evidence and known limitations that distinguish implemented controls from verified serving support.

**Completion checks**

- [ ] The reviewed code and release artifacts identify the same source state.
- [ ] Required checks and reviewer findings are resolved or explicitly documented.
- [ ] Published instructions and the landing page match what a new user actually receives.

**Dependencies and limits:** PR #5 is open and draft as of this snapshot. No production-ready completion percentage or delivery date is asserted.

## Scope held for later

RAG and document-ingestion work remain deferred while the runtime/server foundation is completed. A saved GPU profile does not currently provide independent model workers, automatic memory admission or universal runtime routing.

See [completed development work](COMPLETED.md) for the implemented foundation and its evidence.
