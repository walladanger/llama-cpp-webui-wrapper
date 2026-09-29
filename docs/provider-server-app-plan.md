# Provider Server App Plan

Branch: `provider-server-app`

Goal: keep the portable web wrapper and turn this branch into a provider-focused server app for serving local and cloud models to other apps. `main` remains the current wrapped llama.cpp WebUI.

## Product Direction

This branch should stop treating the bundled UI as a chat application. The default screen should become an operations console for:

- local model inventory and load/unload state
- OpenAI-compatible endpoint status
- API keys and allowed clients
- routing rules for multiple loaded models
- local and cloud provider registration
- sub-agent definitions that can call local models or cloud APIs
- logs, health, and resource usage

Chat/inference pages should be removed from navigation or disabled behind a developer-only flag. The API server should continue to expose inference endpoints for external apps.

## Existing Capabilities To Keep

The repo already has most of the provider base:

- `web-wrapper/src/main.ts` launches `llama-server` in router mode with `--models-dir portable-data/models`.
- `Setup-Llama-WebUI.ps1` installs the wrapper and downloads a portable Windows CPU release into `portable-data/bin`.
- `llama-server` router mode supports dynamic model management:
  - `GET /models`
  - `POST /models/load`
  - `POST /models/unload`
  - `GET /models/sse`
- OpenAI-compatible endpoints already exist:
  - `/v1/models`
  - `/v1/chat/completions`
  - `/v1/completions`
  - `/v1/responses`
  - `/v1/embeddings`
- The Svelte UI already has router-mode stores and services:
  - `tools/ui/src/lib/services/models.service.ts`
  - `tools/ui/src/lib/stores/models/index.svelte.ts`
  - `tools/ui/src/lib/stores/models/status.svelte.ts`
  - `tools/ui/src/lib/stores/server.svelte.ts`

Use these instead of rewriting the server.

## Phase 1: Branch Safety And Provider Defaults

1. Keep branch `provider-server-app` separate from `main`.
2. Add a visible branch README section describing this as the provider-only variant.
3. Change wrapper defaults to provider mode:
   - keep `--models-dir portable-data/models`
   - consider `--no-ui` only after the provider console can be served elsewhere
   - keep localhost binding by default
   - support opt-in LAN binding through config
4. Add a provider config file under `portable-data/config/provider.json`.
5. Keep secrets out of Git and out of normal logs.

Suggested config shape:

```json
{
  "server": {
    "host": "127.0.0.1",
    "port": 8080,
    "corsOrigins": ["localhost"],
    "apiKeyFile": "portable-data/config/api-keys.txt"
  },
  "localModels": {
    "modelsDir": "portable-data/models",
    "autoload": [],
    "maxLoadedModels": 2,
    "defaultExtraArgs": ["--ctx-size", "8192"]
  },
  "cloudProviders": [],
  "agents": []
}
```

## Phase 2: Replace Chat UI With Provider Console

Primary UI files to replace or stop routing through:

- `tools/ui/src/routes/(chat)/+layout.svelte`
- `tools/ui/src/routes/(chat)/+page.svelte`
- `tools/ui/src/routes/(chat)/chat/[id]/+page.svelte`
- `tools/ui/src/routes/+layout.svelte`
- `tools/ui/src/lib/components/app/chat/`
- `tools/ui/src/lib/stores/chat/`
- `tools/ui/src/lib/stores/conversations/`

Do not delete everything immediately. Start by redirecting the default route to a new provider page and remove chat navigation from the shell. Then delete unused chat code once build/test coverage confirms it is no longer referenced.

Important: `tools/ui/src/routes/+layout.svelte` currently initializes chat/model/MCP/server/PWA behavior globally. Provider-only work must simplify that shell carefully or stale background calls to `/models`, `/models/sse`, `/tools`, `/cors-proxy`, and conversation stores will continue even after the visible chat page is gone.

New provider UI areas:

- Overview: server health, active endpoint, auth status, loaded model count.
- Models: local GGUF inventory, load/unload controls, status stream, memory hints.
- API: endpoint list, API key status, CORS/LAN access, copyable base URL.
- Routes: default model, aliases, per-client routing rules.
- Agents: sub-agent definitions, tool policy, local/cloud provider assignment.
- Logs: server log tail, model load events, failed requests.

Reuse existing model components where useful:

- `tools/ui/src/lib/components/app/models/`
- `tools/ui/src/lib/components/app/server/`
- `tools/ui/src/lib/components/app/settings/`

## Phase 3: Multi-Model Provider Behavior

Use llama.cpp router mode as the first implementation. It already launches child server instances for loaded models and proxies inference requests to the correct model.

Implementation tasks:

1. Make wrapper args config-driven instead of hard-coded in `web-wrapper/src/main.ts`.
2. Keep `portable-data/models` as the model folder.
3. Add `portable-data/config/models.ini` and launch with `--models-preset` once provider config is introduced.
4. Add UI controls around existing endpoints:
   - list local models with `GET /models`
   - load with `POST /models/load`
   - unload with `POST /models/unload`
   - subscribe to `GET /models/sse`
5. Add a model alias/routing layer only if llama.cpp aliases are not enough.
6. Add “autoload on startup” through `models.ini` / router startup behavior first, then wrapper calls to `/models/load` only when needed.
7. Add basic resource guardrails:
   - max loaded models
   - per-model extra args
   - visible warning when many large models are loaded

Suggested `portable-data/config/models.ini`:

```ini
version = 1

[*]
c = 8192
n-gpu-layers = auto

[chat-balanced]
model = portable-data/models/chat-balanced.gguf
alias = chat-balanced
load-on-startup = true

[embedding]
model = portable-data/models/embedding.gguf
alias = embedding
embedding = true
pooling = mean

[reranker]
model = portable-data/models/reranker.gguf
alias = reranker
embedding = true
pooling = rank
reranking = true
```

Verification:

- Start wrapper.
- Confirm `GET /health` returns `200`.
- Confirm `GET /models` lists models from `portable-data/models`.
- Load one model and watch `/models/sse`.
- Send an OpenAI-compatible request with `model` set.
- Unload the model and confirm it leaves loaded state.

## Phase 4: External App Provider Surface

Treat the app as a local provider that other apps can point to.

Required external contract:

- Base URL: `http://127.0.0.1:8080/v1`
- Auth: optional local API key by default, required for LAN mode
- Model list: `/v1/models`
- Chat/completions/responses passthrough: existing llama.cpp routes
- Embeddings: only when an embedding model is loaded

Add UI copy buttons for:

- OpenAI-compatible base URL
- API key location, not the secret value
- sample environment variables
- sample curl request

Do not expose to LAN by default. Add a clear “local only” vs “network provider” mode.

Admin endpoints such as `/models`, `/models/load`, `/models/unload`, `/models/sse`, model download, and model delete should be presented as local admin/provider-management endpoints, not public provider endpoints. If LAN mode is enabled, require API keys before exposing model mutation endpoints.

## Phase 5: Sub-Agent Orchestration

Sub-agents should be provider-level objects, not chat conversations. Each agent should define:

- id
- display name
- provider type: `local` or `cloud`
- model id
- instructions
- tool policy
- allowed tools
- handoff targets
- timeout and concurrency limits

Suggested schema:

```json
{
  "id": "code-reviewer",
  "name": "Code Reviewer",
  "provider": {
    "type": "local",
    "model": "Qwen3-Coder-30B-A3B-Instruct-Q4_K_M.gguf"
  },
  "instructions": "Review code for correctness, safety, and missing tests.",
  "tools": {
    "mode": "deny_by_default",
    "allowed": ["read_file", "grep_search"]
  },
  "handoffs": ["planner", "fixer"],
  "limits": {
    "timeoutSeconds": 120,
    "maxParallelRuns": 1
  }
}
```

Local agents:

- Use local loaded models through the existing OpenAI-compatible llama.cpp endpoints.
- Keep local agent state in `portable-data/agents`.
- Start with stateless runs, then add session persistence later.

Cloud agents:

- Store provider metadata in config.
- Store API keys in env vars or `portable-data/config/secrets.local.json`, ignored by Git.
- Support OpenAI first, then add other OpenAI-compatible providers.
- Align with OpenAI Agents concepts, but do not require OpenAI by default.

OpenAI Agents API alignment:

- Use hosted Agents API only when a cloud provider is enabled and API access is configured.
- Keep local agents as provider-managed runs with a similar shape: agent, run, events, artifacts.
- Use explicit tool policies and confirmation gates before adding write or shell tools.

Keep orchestration out of `web-wrapper/src/main.ts`. The launcher should remain responsible for starting `llama-server`, waiting for health, opening the app window, and shutting down processes. Add a separate runtime layer under a path such as `web-wrapper/src/agents/` or a provider UI backend package when orchestration begins.

Provider interface sketch:

```ts
interface ModelProvider {
  id: string;
  kind: "local" | "cloud";
  capabilities: ProviderCapabilities;
  invoke(request: AgentInvocation): Promise<AgentResult>;
  stream?(request: AgentInvocation): AsyncIterable<AgentEvent>;
}
```

Runner concepts:

- `AgentRunner`: loads definitions, selects providers, enforces limits, emits events.
- `Run`: a single orchestration execution with step state and logs.
- `Tool`: schema-defined local callable with permissions.
- `Handoff`: explicit transition from one configured agent to another.
- `Trace`: local JSONL event log under `portable-data/logs/agents/`.

Initial orchestration modes:

- single agent
- sequential handoff
- planner plus workers
- bounded critic/reviewer loop

## Phase 6: Remove Or Disable Chat Code

Only after provider console is functional:

1. Remove chat routes or replace them with redirects to provider pages.
2. Remove conversation tabs and chat sidebar.
3. Remove chat form, message rendering, and attachment features if not used by agents.
4. Keep markdown/content components only if logs, docs, or agent run details still need them.
5. Run UI build after each removal.

Deletion candidates:

- `tools/ui/src/lib/components/app/chat/`
- `tools/ui/src/lib/stores/chat/`
- `tools/ui/src/lib/stores/conversations/`
- chat-specific dialogs in `tools/ui/src/lib/components/app/dialogs/`
- chat-specific tests under `tools/ui/tests/`

Risk: the current UI has deep imports into chat and conversation stores from model selection, settings, tool permissions, and agentic stores. Remove gradually.

Backend enforcement options:

- UI-only provider mode: stop exposing chat in the frontend but leave llama.cpp endpoints callable by external apps. This is the recommended first step because the goal is provider behavior.
- Strict provider mode: add a backend flag that disables or 403s selected interactive endpoints. This is more invasive and should wait until the provider console exists.

Do not disable `/v1/chat/completions`, `/v1/responses`, or `/v1/embeddings` if external apps need OpenAI-compatible provider access. The “chat part of the app” should mean the bundled chat UI, not necessarily the provider API routes.

## Phase 7: Security And Resource Controls

Provider mode increases risk because other apps can call it.

Add:

- API key generation and rotation
- optional API key file support via llama.cpp `--api-key-file`
- localhost-only default
- explicit LAN mode with warning
- CORS allowlist config
- redacted logs
- per-client or per-key rate limits if implemented in wrapper proxy
- model load limits
- cloud key validation without printing keys

Do not enable built-in server tools or MCP tools by default. The llama.cpp server flags `--tools`, `--mcp-servers-config`, and `--agent` are marked experimental and should remain opt-in.

Cloud safety rules:

- Cloud providers disabled by default.
- No automatic local-to-cloud fallback.
- API keys come from environment variables or an ignored local secrets file.
- Visible “local only” vs “cloud enabled” status in the UI.
- Explicit approval before sending local files, document text, or tool output to a cloud provider.
- Imported agent/provider configs are untrusted and must be schema-validated before use.

## Phase 8: Verification Plan

Minimum checks for every milestone:

- `npm run build` in `web-wrapper`
- `Setup-Llama-WebUI.ps1`
- `Run-Llama-WebUI.ps1`
- `GET /health`
- `GET /v1/health`
- `GET /models`
- `GET /v1/models`
- load/unload one small model if present
- OpenAI SDK compatibility with `base_url = http://127.0.0.1:8080/v1`
- UI opens to provider console, not chat
- no secrets in Git

Router-specific checks:

- Start with `--models-max 1`.
- Request model A, then model B.
- Confirm idle model eviction works and busy requests are not killed.
- Start with `--api-key-file portable-data/config/api-keys.txt`.
- Confirm unauthenticated inference returns `401`, authenticated inference works, and health remains available.

When UI changes begin:

- build `tools/ui`
- verify desktop and narrow viewport screenshots
- confirm no chat route is reachable from primary navigation
- confirm OpenAI-compatible endpoint examples work

## Suggested Milestones

1. Provider branch scaffold and plan.
2. Config-driven wrapper.
3. Provider dashboard shell.
4. Model inventory/load/unload UI.
5. API/auth/CORS settings UI.
6. Local agent registry and run API.
7. Cloud provider registry and OpenAI-compatible adapter.
8. Remove unused chat pages and stores.
9. Full verification and documentation.

## Open Questions

- Should this branch still serve a browser-based UI from `llama-server`, or should the wrapper eventually host a separate provider console?
- Do you want LAN access, or strictly local-only provider use?
- Which cloud providers should be first: OpenAI only, or any OpenAI-compatible base URL?
- Should sub-agents be exposed as API endpoints for other apps, or only configured inside this provider console?
- Should we keep any manual chat test surface for debugging provider responses?
