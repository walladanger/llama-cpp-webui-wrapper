// Finds inference runtimes already running on this computer. Port of Radium src-tauri/src/core/runtimes/probe.rs.
// Read only: every request is a GET, nothing is loaded, started or changed.
"use strict";

const net = require("node:net");
const { RUNTIMES, find } = require("./catalog.js");

const CONNECT_TIMEOUT_MS = 250;
const REQUEST_TIMEOUT_MS = 1500;
// Radium starts its managed runtimes here; a scan does not ask them.
const MANAGED_PORT_MIN = 39000;
const MANAGED_PORT_MAX = 39999;

async function getText(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

async function getJson(url) {
  const text = await getText(url);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const str = (value) => (typeof value === "string" ? value : null);
const stringsFrom = (list, key) => (Array.isArray(list) ? list.map((item) => str(item && item[key])).filter((s) => s !== null) : []);
const mib = (bytes) => (Number.isInteger(bytes) && bytes >= 0 ? Math.floor(bytes / (1024 * 1024)) : null);

function openaiModelIds(list) {
  if (!isObject(list) || !Array.isArray(list.data)) return null;
  return list.data.map((model) => str(model && model.id)).filter((s) => s !== null);
}

function confirmed(baseUrl, runtimeId) {
  return {
    baseUrl,
    runtimeId,
    confidence: "confirmed",
    alternatives: [],
    version: null,
    models: [],
    loadedModels: [],
    devices: [],
  };
}

function portOf(baseUrl) {
  try {
    const url = new URL(baseUrl);
    if (url.port) return Number(url.port);
  } catch {
    // not a URL
  }
  return null;
}

// Runtimes with an OpenAI-compatible API whose default port is `port`.
function openaiRuntimesOn(port) {
  return RUNTIMES.filter((r) => r.defaultPort === port && r.apis.includes("open_ai_compatible") && r.mode !== "out_of_scope").map((r) => r.id);
}

// Asks one server who it is. null when nothing there answers like an inference runtime.
async function identify(baseUrl) {
  const base = baseUrl.replace(/\/+$/, "");
  const url = (path) => base + path;

  // KoboldCpp first: it also emulates the OpenAI, Ollama and A1111 APIs.
  const kobold = await getJson(url("/api/extra/version"));
  if (isObject(kobold) && kobold.result === "KoboldCpp") {
    const found = confirmed(base, "koboldcpp");
    found.version = str(kobold.version);
    found.models = openaiModelIds(await getJson(url("/v1/models"))) ?? [];
    return found;
  }

  const ollama = await getJson(url("/api/version"));
  if (isObject(ollama) && str(ollama.version) !== null) {
    const tags = await getJson(url("/api/tags"));
    if (isObject(tags) && Array.isArray(tags.models)) {
      const found = confirmed(base, "ollama");
      found.version = ollama.version;
      found.models = stringsFrom(tags.models, "name");
      const running = await getJson(url("/api/ps"));
      if (isObject(running)) found.loadedModels = stringsFrom(running.models, "name");
      return found;
    }
  }

  const stats = await getJson(url("/system_stats"));
  if (isObject(stats) && isObject(stats.system) && Array.isArray(stats.devices)) {
    const found = confirmed(base, "comfyui");
    found.version = str(stats.system.comfyui_version);
    found.devices = stats.devices.map((device) => ({
      name: str(device && device.name) ?? "unknown",
      vramTotalMib: mib(device && device.vram_total),
      vramFreeMib: mib(device && device.vram_free),
    }));
    return found;
  }

  const invoke = await getJson(url("/api/v1/app/version"));
  if (isObject(invoke) && str(invoke.version) !== null) {
    const found = confirmed(base, "invokeai");
    found.version = invoke.version;
    return found;
  }

  const props = await getJson(url("/props"));
  if (isObject(props) && props.default_generation_settings !== undefined) {
    const found = confirmed(base, "llama-cpp");
    found.version = str(props.build_info);
    if (str(props.model_path) !== null) found.loadedModels.push(props.model_path);
    found.models = openaiModelIds(await getJson(url("/v1/models"))) ?? [];
    // llama-cpp-python serves the same API from the same engine.
    found.alternatives = ["llama-cpp-python"];
    return found;
  }

  const sglang = await getJson(url("/get_model_info"));
  if (isObject(sglang) && str(sglang.model_path) !== null) {
    const found = confirmed(base, "sglang");
    found.loadedModels.push(sglang.model_path);
    found.models.push(sglang.model_path);
    return found;
  }

  const tgi = await getJson(url("/info"));
  if (isObject(tgi) && str(tgi.model_id) !== null && str(tgi.version) !== null) {
    const found = confirmed(base, "hf-tgi");
    found.version = tgi.version;
    found.loadedModels.push(tgi.model_id);
    found.models.push(tgi.model_id);
    return found;
  }

  // Forge serves the same API and cannot be told apart this way.
  const sd = await getJson(url("/sdapi/v1/sd-models"));
  if (Array.isArray(sd)) {
    const found = confirmed(base, "automatic1111");
    found.alternatives = ["sd-webui-forge"];
    found.models = stringsFrom(sd, "model_name");
    return found;
  }

  const metrics = await getText(url("/metrics"));
  if (metrics !== null) {
    let runtime = null;
    if (metrics.includes("\naphrodite:") || metrics.startsWith("aphrodite:")) runtime = "aphrodite";
    else if (metrics.includes("vllm:")) runtime = "vllm";
    if (runtime) {
      const found = confirmed(base, runtime);
      const info = await getJson(url("/version"));
      found.version = isObject(info) ? str(info.version) : null;
      const ids = openaiModelIds(await getJson(url("/v1/models")));
      if (ids) {
        found.models = ids;
        found.loadedModels = [...ids];
      }
      return found;
    }
  }

  // Anything else that answers /v1/models like OpenAI is only a port guess.
  const models = openaiModelIds(await getJson(url("/v1/models")));
  if (!models) return null;
  const port = portOf(base);
  const candidates = port === null ? [] : openaiRuntimesOn(port);
  return {
    baseUrl: base,
    runtimeId: candidates.length === 1 ? candidates[0] : null,
    confidence: "port_guess",
    alternatives: candidates.length === 1 ? [] : candidates,
    version: null,
    models,
    loadedModels: [],
    devices: [],
  };
}

// Every catalog default port except Radium's managed range and the ports in `skip`.
function defaultPorts(skip = []) {
  const ports = new Set();
  for (const runtime of RUNTIMES) {
    const port = runtime.defaultPort;
    if (runtime.mode === "out_of_scope" || port === null) continue;
    if (port >= MANAGED_PORT_MIN && port <= MANAGED_PORT_MAX) continue;
    if (skip.includes(port)) continue;
    ports.add(port);
  }
  return [...ports].sort((a, b) => a - b);
}

function normalizeBaseUrl(input) {
  const trimmed = String(input).trim().replace(/\/+$/, "");
  const match = trimmed.match(/^https?:\/\/(.*)$/);
  if (!match) throw new Error(`"${input}" must start with http:// or https://`);
  if (!match[1] || match[1].startsWith("/") || /\s/.test(match[1])) throw new Error(`"${input}" has no host`);
  return trimmed;
}

function portIsOpen(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(CONNECT_TIMEOUT_MS, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

// Asks every port on `host` plus the extra base URLs, in parallel.
async function scanPorts(host, ports, extra = []) {
  const bases = [];
  const open = await Promise.all(ports.map(async (port) => ((await portIsOpen(host, port)) ? port : null)));
  for (const port of open) if (port !== null) bases.push(`http://${host}:${port}`);
  for (const endpoint of extra) {
    const base = normalizeBaseUrl(endpoint);
    if (!bases.includes(base)) bases.push(base);
  }
  const found = await Promise.all(bases.map((base) => identify(base)));
  return found.filter((detection) => detection !== null);
}

function scan({ extra = [], skipPorts = [] } = {}) {
  return scanPorts("127.0.0.1", defaultPorts(skipPorts), extra);
}

module.exports = { identify, scan, scanPorts, defaultPorts, normalizeBaseUrl, openaiRuntimesOn, find };
