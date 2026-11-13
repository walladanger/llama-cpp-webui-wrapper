# PR 4: verified findings and validation

The branch incorporates current main (f420c57) and the concurrently pushed CodeRabbit fix commit dea93aa without rewriting either history. Findings were checked against the source; embedded agent prompts were treated as review data.

| Finding | Result |
| --- | --- |
| Benchmark runtime isolation | Addressed: matching release DLLs and CUDA dependencies install into portable-data/bench/bin; server files stay unchanged. |
| Stale benchmark precedence | Addressed in both the CLI manager and the current desktop benchmark runner. |
| Selected package versions | Addressed: destination version files contain the selected Tag and CudaVersion. |
| Smoke response wording | Addressed: a chat choices array, assistant role and non-empty string content are required; punctuation and prefixes are accepted. |
| WSL argument boundaries | No additional rewrite: current main already uses --exec in both helpers; retained during integration. |
| WSL engine lifetime | Addressed: a hidden foreground client follows unit state, uses a per-unit lock and exits after stop. The LF shell source avoids Windows line-ending failures. |
| TensorRT local model ID | Addressed: absolute paths accept either their full ID or directory basename; repository IDs still require their full ID. Both dashboards use the same rule. |
| Concurrent chat startup | Addressed: ownership inspection, spawning and assignment share one lock; concurrent-start regression passes. |
| Saving a different distro | Addressed: the old service is stopped using the old config before saving; stop failures preserve that config. Start/Stop and saves are synchronized. |
| Settings-load recovery | Addressed in both dashboards: explicit retry via Refresh status; no silent save after failed load. |
| Status badge freshness | Addressed: Status uses the status-rendering path. |

Reconciliation also preserves genuine WSL errors while recognizing inactive/unknown units with systemctl exit code 3 or 4. An actual read-only Ubuntu probe returned inactive with exit code 4; the regression checks that this is not confused with a WSL access failure.

Validation:

- 32 native tests passed; 2 opt-in model/prerequisite tests remain skipped.
- 32 PowerShell packaging assertions passed, including CPU/CUDA isolation, nested CUDA archives, missing-DLL rejection, server-file preservation, selected version overrides and valid/invalid smoke replies. Downloads, npm and model execution were mocked.
- Browser regressions passed against the rebuilt UI and legacy dashboard with mocked desktop calls: repaired-config recovery, status badges and local TensorRT IDs.
- The keepalive script passed a real Ubuntu/WSL fixture for foreground lifetime, duplicate locking and exit after stop. Unit state was mocked; model serving and idle termination were not exercised.
- Native optimized build, production UI build, Svelte checking (0 errors/warnings), changed-component ESLint/Prettier and changed Rust formatting passed.
- Workflow YAML and diff whitespace checks passed. Benchmark packaging regressions are included in the Windows workflow.

Remaining owner action: the PR-description template check requires a human edit. Follow the Overview and Requirements sections in [.github/pull_request_template.md](../.github/pull_request_template.md), including the AI usage disclosure. [AGENTS.md](../AGENTS.md) prohibits automated PR-description authoring. The optional CodeRabbit CLI was not installed or run.
