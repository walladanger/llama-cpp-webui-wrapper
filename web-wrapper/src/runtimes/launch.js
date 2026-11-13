// Settings file + graphics cards -> the llama-server command line and environment.
"use strict";

const settings = require("./server-settings.js");
const { listDevices, planPlacement, nvidiaInventory, resolveUuidSelection } = require("./gpu.js");
const { buildArgs, childEnvironment, redactSettings } = require("./server-args.js");

async function prepareLaunch({ executable, settingsFile, port, modelsDir, verifyCapabilities = false, helperExecutable = null, cacheDir = null }) {
  const s = settings.load(settingsFile);
  const requested = redactSettings(s);
  buildArgs(s, { port, modelsDir });
  const notes = [];
  const env = childEnvironment(s);
  if (cacheDir) env.LLAMA_CACHE = cacheDir;

  if (s.selected_gpu_uuids?.length) {
    const path=require('node:path'), fs=require('node:fs');
    const helper=helperExecutable||[path.join(path.dirname(executable),'llama-engine-manager.exe'),path.resolve(path.dirname(executable),'../..','llama-engine-manager.exe')].find(candidate=>fs.existsSync(candidate));
    const cards = await nvidiaInventory(5000,helper);
    const selection = resolveUuidSelection(s.selected_gpu_uuids, cards, env);
    for (const key of Object.keys(env)) if (['CUDA_VISIBLE_DEVICES','CUDA_DEVICE_ORDER'].includes(key.toUpperCase())) delete env[key];
    Object.assign(env, selection);
    const devices = await listDevices(executable, 15000, env);
    const cuda = devices.filter(d => /^CUDA\d+$/.test(d.id));
    if (cuda.length !== s.selected_gpu_uuids.length) throw new Error('Runtime could not resolve every selected GPU UUID');
    s.device = cuda.map(d => d.id).join(',');
    s.main_gpu = Number(s.main_gpu);
    if (s.main_gpu >= cuda.length) throw new Error('Main GPU index is outside selected GPUs');
    if (!s.tensor_split && cuda.length > 1) s.tensor_split = cuda.map(() => 1).join(',');
    notes.push('Selected GPU UUID order: ' + s.selected_gpu_uuids.join(', '));
  }
  if (s.gpu_placement !== "manual") {
    if (!settings.PLACEMENTS.includes(s.gpu_placement)) {
      notes.push(`GPU placement "${s.gpu_placement}" is not supported here; using manual settings.`);
    } else {
      const devices = executable ? await listDevices(executable, 15000, env) : [];
      const plan = planPlacement(s.gpu_placement, devices, s.tensor_split);
      if (plan) {
        Object.assign(s, plan);
        notes.push(`GPU placement "${s.gpu_placement}" -> ${plan.device}${plan.tensor_split ? ` (split ${plan.tensor_split})` : ""}`);
      } else {
        throw new Error(`GPU placement "${s.gpu_placement}" found no graphics card; select manual CPU settings explicitly.`);
      }
    }
  }

  const args=buildArgs(s,{port,modelsDir});
  let capabilities=null;
  if (verifyCapabilities) {
    const {inspectRuntime,assertArguments}=require('./runtime-capabilities.js');
    capabilities=await inspectRuntime(executable,{env});
    assertArguments(capabilities,args);
    notes.push('Runtime package SHA-256: '+capabilities.packageHash);
  }
  return { args, capabilities, env, notes, requested, effective: redactSettings(s), diagnostics: { restartRequired: true, notes, profileRevision: settings.loadProfile(settingsFile).revision } };
}

module.exports = { prepareLaunch };
