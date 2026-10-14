// Turn launch settings into llama-server arguments. Follows Radium args.rs: only non-default values are passed.
"use strict";

const { CACHE_TYPES } = require("./server-settings.js");

// Split like a shell: spaces separate, quotes group, no expansion.
function splitArgs(text) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(String(text || "")))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

// "KEY=VALUE;KEY2=VALUE2"
function parseEnv(text) {
  const env = {};
  for (const pair of String(text || "").split(";")) {
    const i = pair.indexOf("=");
    if (i > 0) env[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  return env;
}

const num = (value) => Number(value) || 0;
const differs = (value, base) => Math.abs(Number(value) - base) > 1e-6;
const safeCache = (type) => (CACHE_TYPES.includes(type) ? type : "f16");

function buildArgs(s, { port, modelsDir }) {
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

  if (num(s.ctx_size) > 0 && s.fit !== true) add("--ctx-size", s.ctx_size);
  if (num(s.n_predict) > 0) add("--n-predict", s.n_predict);
  const k = safeCache(s.cache_type_k);
  if (k !== "f16") add("--cache-type-k", k);
  // A quantized V cache needs flash attention.
  const v = safeCache(s.cache_type_v);
  if (s.flash_attn !== "off" && v !== "f16" && v !== "f32") add("--cache-type-v", v);
  if (differs(s.defrag_thold, 0.1)) add("--defrag-thold", s.defrag_thold);

  if (s.rope_scaling && s.rope_scaling !== "none") add("--rope-scaling", s.rope_scaling);
  if (differs(s.rope_scale, 1)) add("--rope-scale", s.rope_scale);
  if (num(s.rope_freq_base) !== 0) add("--rope-freq-base", s.rope_freq_base);
  if (differs(s.rope_freq_scale, 1)) add("--rope-freq-scale", s.rope_freq_scale);

  add("--fit", s.fit === true ? "on" : "off");
  if (s.fit === true) {
    if (s.fit_ctx && String(s.fit_ctx) !== "4096") add("--fit-ctx", s.fit_ctx);
    if (s.fit_target && String(s.fit_target) !== "1024") add("--fit-target", s.fit_target);
  }

  args.push(...splitArgs(s.extra_args));
  return args;
}

module.exports = { buildArgs, splitArgs, parseEnv };
