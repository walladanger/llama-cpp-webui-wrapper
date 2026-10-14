// Settings file + graphics cards -> the llama-server command line and environment.
"use strict";

const settings = require("./server-settings.js");
const { listDevices, planPlacement } = require("./gpu.js");
const { buildArgs, parseEnv } = require("./server-args.js");

async function prepareLaunch({ executable, settingsFile, port, modelsDir }) {
  const s = settings.load(settingsFile);
  const notes = [];

  if (s.gpu_placement !== "manual") {
    if (!settings.PLACEMENTS.includes(s.gpu_placement)) {
      notes.push(`GPU placement "${s.gpu_placement}" is not supported here; using manual settings.`);
    } else {
      const devices = executable ? await listDevices(executable) : [];
      const plan = planPlacement(s.gpu_placement, devices, s.tensor_split);
      if (plan) {
        Object.assign(s, plan);
        notes.push(`GPU placement "${s.gpu_placement}" -> ${plan.device}${plan.tensor_split ? ` (split ${plan.tensor_split})` : ""}`);
      } else {
        notes.push(`GPU placement "${s.gpu_placement}" found no graphics card; using manual settings.`);
      }
    }
  }

  return { args: buildArgs(s, { port, modelsDir }), env: parseEnv(s.llamacpp_env), notes };
}

module.exports = { prepareLaunch };
