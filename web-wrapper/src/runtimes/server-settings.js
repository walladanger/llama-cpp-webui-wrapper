// llama-server launch settings. Keys match Radium's llama.cpp provider settings so values copy across as-is.
"use strict";

const { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync, fsyncSync, renameSync, unlinkSync } = require("node:fs");
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
  p2p: false,
};

const PLACEMENTS = ["manual", "single", "spread"];
const CACHE_TYPES = ["f32", "f16", "bf16", "q8_0", "q4_0", "q4_1", "iq4_nl", "q5_0", "q5_1"];

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function migrateProfile(raw) {
  if (!object(raw)) throw new Error('Launch profile must be a JSON object');
  if (!Object.hasOwn(raw, 'schemaVersion')) return { schemaVersion: 1, id: 'default', name: 'Default', revision: 0, settings: { ...DEFAULTS, ...raw } };
  if (raw.schemaVersion !== 1) throw new Error('Unsupported profile schema version: ' + raw.schemaVersion);
  if (!object(raw.settings) || typeof raw.id !== 'string' || !raw.id.trim() || typeof raw.name !== 'string' || !Number.isSafeInteger(raw.revision) || raw.revision < 0) throw new Error('Invalid launch profile');
  return { ...raw, settings: { ...DEFAULTS, ...raw.settings } };
}
function loadProfile(file) {
  return migrateProfile(existsSync(file) ? JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) : {});
}
function load(file) { return loadProfile(file).settings; }
function saveProfile(file, profile, expectedRevision) {
  const next = migrateProfile(profile);
  require('./server-args.js').buildArgs(next.settings, { port: 8080 });
  mkdirSync(dirname(file), { recursive: true });
  const lock = file + '.lock';
  let lockFd;
  try { lockFd = openSync(lock, 'wx'); } catch (e) { if (e.code === 'EEXIST') throw new Error('Profile is being saved; retry after the other save finishes'); throw e; }
  const temp = file + '.' + require('node:crypto').randomUUID() + '.tmp';
  try {
    const current = loadProfile(file);
    if (!Number.isSafeInteger(expectedRevision) || current.revision !== expectedRevision) throw new Error('Profile changed; reload before saving');
    if (expectedRevision >= Number.MAX_SAFE_INTEGER) throw new Error('Profile revision exhausted');
    next.revision = expectedRevision + 1;
    const fd = openSync(temp, 'wx');
    try { writeFileSync(fd, JSON.stringify(next, null, 2) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temp, file);
    return next;
  } finally {
    try { unlinkSync(temp); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    closeSync(lockFd); unlinkSync(lock);
  }
}

function writeDefaults(file) {
  if (existsSync(file)) return false;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(DEFAULTS, null, 2) + "\n");
  return true;
}

module.exports = { DEFAULTS, PLACEMENTS, CACHE_TYPES, load, loadProfile, migrateProfile, saveProfile, writeDefaults };
