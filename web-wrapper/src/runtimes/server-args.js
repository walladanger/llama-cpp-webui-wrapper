// Turn launch settings into llama-server arguments. Follows Radium args.rs: only non-default values are passed.
"use strict";

const { DEFAULTS, CACHE_TYPES } = require("./server-settings.js");

// Split like a shell: spaces separate, quotes group, no expansion.
function splitArgs(text) {
  const out = [];
  let current = '', quote = null, started = false;
  for (const c of String(text || '')) {
    if (quote) {
      if (c === quote) quote = null;
      else current += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      started = true;
    } else if (/\s/u.test(c)) {
      if (started) { out.push(current); current = ''; started = false; }
    } else { current += c; started = true; }
  }
  if (quote) throw new Error('Unclosed quote in extra arguments');
  if (started) out.push(current);
  return out;
}

// "KEY=VALUE;KEY2=VALUE2"
function parseEnv(text) {
  const env = {}, seen = new Set();
  for (const pair of String(text || '').split(';')) {
    if (!pair.trim()) continue;
    const i = pair.indexOf('=');
    const key = pair.slice(0, i).trim(), upper = key.toUpperCase();
    if (i < 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || /[\0\r\n]/.test(pair)) throw new Error('Invalid environment assignment');
    if (upper.startsWith('LLAMA_ARG_') || ['LLAMA_CACHE', 'GGML_CUDA_P2P'].includes(upper)) throw new Error('Environment cannot override managed setting: ' + key);
    if (seen.has(upper)) throw new Error('Duplicate environment assignment: ' + key);
    seen.add(upper);
    env[key] = pair.slice(i + 1).trim();
  }
  return env;
}

function childEnvironment(s, inherited = process.env) {
  const env = {};
  for (const [key, value] of Object.entries(inherited)) {
    const upper = key.toUpperCase();
    if (!upper.startsWith('LLAMA_ARG_') && !['GGML_CUDA_P2P','LLAMA_CACHE'].includes(upper)) env[key] = value;
  }
  for (const [key, value] of Object.entries(parseEnv(s.llamacpp_env))) {
    for (const old of Object.keys(env)) if (old.toUpperCase() === key.toUpperCase()) delete env[old];
    env[key] = value;
  }
  if (s.p2p === true) env.GGML_CUDA_P2P = '1';
  return env;
}

function validateFields(s) {
  const contract = require('./settings-contract.json');
  for (const [kind, fields] of [['integers', contract.integers], ['numbers', contract.numbers]]) {
    for (const [key, [min, max]] of Object.entries(fields)) {
      if (s[key] === undefined) continue;
      const value = s[key];
      const n = typeof value === 'number' ? value : typeof value === 'string' && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim()) ? Number(value) : NaN;
      if (!Number.isFinite(n) || n < min || n > max || (kind === 'integers' && !Number.isInteger(n))) throw new Error('Invalid ' + key + ': expected ' + kind + ' in range ' + min + '..' + max);
    }
  }
  for (const key of contract.booleans) if (s[key] !== undefined && typeof s[key] !== 'boolean') throw new Error('Invalid ' + key + ': expected boolean');
  for (const [key, values] of Object.entries(contract.enums)) if (s[key] !== undefined && !values.includes(s[key])) throw new Error('Invalid ' + key);
  for (const key of ['device', 'tensor_split', 'extra_args', 'llamacpp_env']) if (s[key] !== undefined && typeof s[key] !== 'string') throw new Error('Invalid ' + key + ': expected text');
  if (s.fit_target !== undefined && !String(s.fit_target).split(',').every(v => /^\d+$/.test(v.trim()) && Number.isSafeInteger(Number(v)) && Number(v) <= 2147483647)) throw new Error('Invalid fit_target');
  if ((Number(s.ubatch_size) || 512) > (Number(s.batch_size) || 2048)) throw new Error('Microbatch must not exceed batch size');
  if (s.selected_gpu_uuids !== undefined && (!Array.isArray(s.selected_gpu_uuids) || s.selected_gpu_uuids.some(id => typeof id !== 'string' || !/^GPU-[A-Za-z0-9-]+$/.test(id)) || new Set(s.selected_gpu_uuids).size !== s.selected_gpu_uuids.length)) throw new Error('Invalid selected GPU UUIDs');
  if (s.device && s.device !== 'none' && !/^[A-Za-z]+\d+(,[A-Za-z]+\d+)*$/.test(s.device)) throw new Error('Invalid device list');
  if (s.device && s.device !== 'none' && String(s.tensor_split).trim() && String(s.tensor_split).split(',').length !== s.device.split(',').length) throw new Error('Tensor split must have one weight per selected device');
  parseEnv(s.llamacpp_env);
}

function redactArgs(args) {
  let hideNext=false;
  return args.map(arg=>{
    if(hideNext){hideNext=false;return '[redacted]';}
    if(/^--[^=]*(?:api-key|token|secret|password)[^=]*(?:=|$)/i.test(arg)||arg==='-hft'){
      const eq=arg.indexOf('=');if(eq>=0)return arg.slice(0,eq+1)+'[redacted]';hideNext=true;
    }
    return arg;
  });
}
function redactSettings(settings) {
  const redacted=structuredClone(settings);redacted.llamacpp_env='[redacted]';
  redacted.extra_args=redactArgs(splitArgs(settings.extra_args)).join(' ');
  return redacted;
}

const num = (value) => Number(value) || 0;
const differs = (value, base) => Math.abs(Number(value) - base) > 1e-6;
const safeCache = (type) => (CACHE_TYPES.includes(type) ? type : "f16");

// Validate intent before emitting arguments; never silently replace a requested cache.
function validateSettings(s) {
  validateFields(s);
  const k = s.cache_type_k, v = s.cache_type_v;
  if (!CACHE_TYPES.includes(k)) throw new Error('Invalid K cache type');
  if (!CACHE_TYPES.includes(v)) throw new Error('Invalid V cache type');
  if (!['auto', 'on', 'off'].includes(s.flash_attn)) throw new Error('Invalid Flash Attention setting');
  if (!['none', 'layer', 'row', 'tensor'].includes(s.split_mode)) throw new Error('Invalid split mode');
  if (s.split_mode === 'tensor') {
    if (s.fit !== false) throw new Error('Tensor mode requires fit off');
    if (s.flash_attn !== 'on') throw new Error('Tensor mode requires Flash Attention on');
    if (!Number.isInteger(Number(s.ctx_size)) || Number(s.ctx_size) <= 0) throw new Error('Tensor mode requires an explicit positive context');
    if (![k, v].every(type => ['f32', 'f16', 'bf16'].includes(type))) throw new Error('Tensor mode requires f32, f16 or bf16 K/V caches');
  }
  if (s.flash_attn === 'off' && !['f32', 'f16', 'bf16'].includes(v)) throw new Error('Quantized V cache requires Flash Attention');
  if (String(s.tensor_split).trim()) {
    const weights = String(s.tensor_split).split(',').map(value => value.trim() ? Number(value) : NaN);
    const sum = weights.reduce((total, value) => total + value, 0);
    if (!weights.every(value => Number.isFinite(value) && value >= 0) || !Number.isFinite(sum) || sum <= 0) throw new Error('Tensor split requires finite nonnegative weights with a positive sum');
  }
  const extra = splitArgs(s.extra_args);
  const managed = require('./managed-flags.json');
  for (const arg of extra) {
    const flag = arg.split('=')[0];
    if (managed.includes(flag)) throw new Error('Extra arguments cannot override managed flag: ' + flag);
  }
  return extra;
}

function buildArgs(s, { port, modelsDir }) {
  s = { ...DEFAULTS, ...s };
  const extra = validateSettings(s);
  const contract = require("./settings-contract.json");
  for (const key of [...Object.keys(contract.integers), ...Object.keys(contract.numbers)]) if (s[key] !== undefined) s[key] = Number(s[key]);
  const args = ["--host", "127.0.0.1", "--port", String(port)];
  if (modelsDir) args.push("--models-dir", modelsDir);
  const add = (flag, value) => args.push(flag, String(value));

  let parallel = num(s.parallel);
  let contBatching = s.cont_batching === true;
  let metrics = s.expose_metrics === true;
  if (s.concurrent_mode === true) {
    parallel = Math.max(2, num(s.concurrent_slots));
    contBatching = true;
    metrics = true;
  }

  if (s.n_gpu_layers !== "" && Number(s.n_gpu_layers) >= 0) add("--n-gpu-layers", s.n_gpu_layers);
  if (num(s.threads) > 0) add("--threads", s.threads);
  if (num(s.threads_batch) > 0) add("--threads-batch", s.threads_batch);
  if (num(s.batch_size) > 0 && num(s.batch_size) !== 2048) add("--batch-size", s.batch_size);
  if (num(s.ubatch_size) > 0 && num(s.ubatch_size) !== 512) add("--ubatch-size", s.ubatch_size);

  if (s.device) add("--device", s.device);
  if (s.split_mode && s.split_mode !== "layer") add("--split-mode", s.split_mode);
  if (num(s.main_gpu) !== 0) add("--main-gpu", s.main_gpu);
  if (String(s.tensor_split || "").trim()) add("--tensor-split", String(s.tensor_split).trim());
  if (s.no_kv_offload === true) args.push("--no-kv-offload");

  if (["auto", "on", "off"].includes(s.flash_attn)) add("--flash-attn", s.flash_attn);

  if (s.ctx_shift === true) args.push("--context-shift");
  if (contBatching) args.push("--cont-batching");
  if (s.no_mmap === true) args.push("--no-mmap");
  if (s.mlock === true) args.push("--mlock");
  if (parallel > 0) add("--parallel", parallel);
  if (metrics) args.push("--metrics");

  if (num(s.ctx_size) > 0) add("--ctx-size", s.ctx_size);
  if (num(s.n_predict) !== -1) add("--n-predict", s.n_predict);
  const k = safeCache(s.cache_type_k);
  if (k !== "f16") add("--cache-type-k", k);
  // Validation above rejects unsupported V-cache combinations.
  const v = safeCache(s.cache_type_v);
  if (v !== "f16") add("--cache-type-v", v);
  if (differs(s.defrag_thold, 0.1)) add("--defrag-thold", s.defrag_thold);

  if (s.rope_scaling && s.rope_scaling !== "none") add("--rope-scaling", s.rope_scaling);
  if (differs(s.rope_scale, 1)) add("--rope-scale", s.rope_scale);
  if (num(s.rope_freq_base) !== 0) add("--rope-freq-base", s.rope_freq_base);
  if (differs(s.rope_freq_scale, 1)) add("--rope-freq-scale", s.rope_freq_scale);

  add("--fit", s.fit === true ? "on" : "off");
  if (s.fit === true) {
    if (s.fit_ctx && String(s.fit_ctx) !== "4096") add("--fit-ctx", s.fit_ctx);
    if (s.fit_target !== undefined && String(s.fit_target) !== "1024") add("--fit-target", s.fit_target);
  }

  args.push(...extra);
  return args;
}

module.exports = { buildArgs, splitArgs, parseEnv, redactArgs, redactSettings, childEnvironment, validateFields, validateSettings };
