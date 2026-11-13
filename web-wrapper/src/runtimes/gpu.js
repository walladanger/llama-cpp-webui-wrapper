// Graphics cards as llama-server reports them, and the GPU placement profiles ported from Radium gpuPlacement.ts.
"use strict";

const childProcess = require("node:child_process");

// "CUDA0: NVIDIA GeForce RTX 3090 (24576 MiB, 23000 MiB free)"
function parseDevices(output) {
  const devices = [];
  for (const line of String(output).split(/\r?\n/)) {
    const m = line.trim().match(/^([A-Za-z]+\d+):\s*(.*?)\s*\((\d+)\s*MiB,\s*(\d+)\s*MiB free\)\s*$/);
    if (m) devices.push({ id: m[1], name: m[2], mem: Number(m[3]), free: Number(m[4]) });
  }
  return devices;
}

function listDevices(executable, timeoutMs = 15000, env = process.env) {
  return new Promise((resolve) => {
    childProcess.execFile(executable, ["--list-devices"], { timeout: timeoutMs, windowsHide: true, env, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      resolve(error?.killed || error?.signal ? [] : parseDevices(`${stdout || ""}\n${stderr || ""}`));
    });
  });
}

function parseNvidiaInventory(output) {
  const numeric = v => /^\d+(\.\d+)?$/.test(v) && Number.isFinite(Number(v)) ? Number(v) : null;
  return String(output).split(/\r?\n/).filter(line => line.trim()).map(line => {
    const [uuid, name, total, free, driver, bus] = line.split(',').map(v => v.trim());
    if (!uuid?.startsWith('GPU-') || !bus) return null;
    return { uuid, name, total: numeric(total), free: numeric(free), driver, bus };
  }).filter(Boolean);
}
function nvidiaInventory(timeoutMs = 5000, helperExecutable = null) {
  return new Promise(resolve => childProcess.execFile('nvidia-smi', ['--query-gpu=uuid,name,memory.total,memory.free,driver_version,pci.bus_id', '--format=csv,noheader,nounits'], { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout) => {
    if (!error) { const cards=parseNvidiaInventory(stdout);if(cards.length)return resolve(cards); }
    if (!helperExecutable) return resolve([]);
    childProcess.execFile(helperExecutable,['cuda-inventory'],{timeout:timeoutMs,windowsHide:true,maxBuffer:1024*1024},(error,stdout)=>{
      if(error)return resolve([]);try{const cards=JSON.parse(stdout);resolve(Array.isArray(cards)?cards.filter(card=>typeof card.uuid==='string'&&typeof card.name==='string'):[]);}catch{resolve([]);}
    });
  }));
}
function resolveUuidSelection(uuids, cards, env) {
  if (!Array.isArray(uuids) || !uuids.length || uuids.some(id => typeof id !== 'string' || !/^GPU-[A-Za-z0-9-]+$/.test(id))) throw new Error('Invalid selected GPU UUIDs');
  if (new Set(uuids).size !== uuids.length) throw new Error('Duplicate selected GPU UUID');
  for (const id of uuids) if (!cards.some(card => card.uuid === id)) throw new Error('Selected GPU unavailable: ' + id);
  const visibility = Object.entries(env).find(([key]) => key.toUpperCase() === 'CUDA_VISIBLE_DEVICES')?.[1];
  if (visibility !== undefined && visibility !== uuids.join(',')) throw new Error('Selected GPUs conflict with inherited/custom CUDA visibility; use the same ordered UUIDs or clear the override');
  return { CUDA_VISIBLE_DEVICES: uuids.join(','), CUDA_DEVICE_ORDER: 'PCI_BUS_ID' };
}

const isGpu = (device) => !/^cpu/i.test(device.id);

// One server serves every model in router mode, so only the whole-server profiles apply here.
// Returns null when the manual settings stay as written.
function planPlacement(mode, devices, tensorSplit = "") {
  const gpus = devices.filter(isGpu);
  if (gpus.length === 0) return null;

  if (mode === "single") {
    const best = [...gpus].sort((a, b) => b.free - a.free)[0];
    return { device: best.id, split_mode: "none", main_gpu: 0, tensor_split: "" };
  }
  if (mode === "spread") {
    if (gpus.length === 1) return { device: gpus[0].id, split_mode: "none", main_gpu: 0, tensor_split: "" };
    const split = tensorSplit.trim() || gpus.map((gpu) => Math.max(1, Math.round(gpu.free / 256))).join(",");
    return { device: gpus.map((gpu) => gpu.id).join(","), split_mode: "layer", main_gpu: 0, tensor_split: split };
  }
  return null;
}

module.exports = { parseDevices, listDevices, planPlacement, parseNvidiaInventory, nvidiaInventory, resolveUuidSelection };
