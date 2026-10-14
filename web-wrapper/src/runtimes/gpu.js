// Graphics cards as llama-server reports them, and the GPU placement profiles ported from Radium gpuPlacement.ts.
"use strict";

const { execFile } = require("node:child_process");

// "CUDA0: NVIDIA GeForce RTX 3090 (24576 MiB, 23000 MiB free)"
function parseDevices(output) {
  const devices = [];
  for (const line of String(output).split(/\r?\n/)) {
    const m = line.trim().match(/^([A-Za-z]+\d+):\s*(.*?)\s*\((\d+)\s*MiB,\s*(\d+)\s*MiB free\)\s*$/);
    if (m) devices.push({ id: m[1], name: m[2], mem: Number(m[3]), free: Number(m[4]) });
  }
  return devices;
}

function listDevices(executable, timeoutMs = 15000) {
  return new Promise((resolve) => {
    execFile(executable, ["--list-devices"], { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
      resolve(error && !stdout ? [] : parseDevices(`${stdout}\n${stderr}`));
    });
  });
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

module.exports = { parseDevices, listDevices, planPlacement };
