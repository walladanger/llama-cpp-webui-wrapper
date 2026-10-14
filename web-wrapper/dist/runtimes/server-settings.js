// llama-server launch settings. Keys match Radium's llama.cpp provider settings so values copy across as-is.
"use strict";

const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { dirname } = require("node:path");

const DEFAULTS = {
  ctx_size: 0,
  fit: true,
  fit_target: "1024",
  fit_ctx: "4096",
  n_gpu_layers: -1,
  gpu_placement: "manual",
  device: "",
  split_mode: "layer",
  main_gpu: 0,
  tensor_split: "",
  no_kv_offload: false,
  flash_attn: "auto",
  cache_type_k: "f16",
  cache_type_v: "f16",
  threads: 0,
  threads_batch: 0,
  batch_size: 0,
  ubatch_size: 0,
  parallel: 0,
  cont_batching: false,
  concurrent_mode: false,
  concurrent_slots: 8,
  ctx_shift: false,
  n_predict: -1,
  no_mmap: false,
  mlock: false,
  defrag_thold: 0.1,
  rope_scaling: "none",
  rope_scale: 1.0,
  rope_freq_base: 0,
  rope_freq_scale: 1.0,
  expose_metrics: false,
  llamacpp_env: "",
  extra_args: "",
};

const PLACEMENTS = ["manual", "single", "spread"];
const CACHE_TYPES = ["f32", "f16", "bf16", "q8_0", "q4_0", "q4_1", "iq4_nl", "q5_0", "q5_1"];

function load(file) {
  if (!existsSync(file)) return { ...DEFAULTS };
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const unknown = Object.keys(raw).filter((key) => !(key in DEFAULTS));
  if (unknown.length) console.warn(`Ignoring unknown settings in ${file}: ${unknown.join(", ")}`);
  return { ...DEFAULTS, ...raw };
}

function writeDefaults(file) {
  if (existsSync(file)) return false;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(DEFAULTS, null, 2) + "\n");
  return true;
}

module.exports = { DEFAULTS, PLACEMENTS, CACHE_TYPES, load, writeDefaults };
