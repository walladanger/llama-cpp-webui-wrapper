// Command line for the runtime layer: `--scan` and `--catalog`. Returns false when argv asks for neither.
"use strict";

const { RUNTIMES, find } = require("./catalog.js");
const { scan } = require("./probe.js");

function valuesOf(argv, flag) {
  const values = [];
  argv.forEach((arg, i) => {
    if (arg === flag && argv[i + 1]) values.push(argv[i + 1]);
    else if (arg.startsWith(flag + "=")) values.push(arg.slice(flag.length + 1));
  });
  return values;
}

function table(rows) {
  const widths = rows[0].map((_, c) => Math.max(...rows.map((row) => String(row[c]).length)));
  return rows.map((row) => row.map((cell, c) => String(cell).padEnd(widths[c])).join("  ").trimEnd()).join("\n");
}

const nameOf = (id) => (id && find(id) ? find(id).name : id ?? "unknown");

async function printScan(argv, ownPort) {
  const detections = await scan({ extra: valuesOf(argv, "--url"), skipPorts: [ownPort] });
  if (argv.includes("--json")) {
    console.log(JSON.stringify(detections, null, 2));
    return;
  }
  if (detections.length === 0) {
    console.log("No running runtimes found on 127.0.0.1.");
    return;
  }
  const rows = [["URL", "RUNTIME", "CONFIDENCE", "VERSION", "MODELS", "LOADED"]];
  for (const d of detections) {
    let runtime = nameOf(d.runtimeId);
    if (d.alternatives.length) runtime += ` (or ${d.alternatives.map(nameOf).join(", ")})`;
    rows.push([d.baseUrl, runtime, d.confidence, d.version ?? "-", d.models.length, d.loadedModels.join(", ") || "-"]);
  }
  console.log(table(rows));
  for (const d of detections) {
    for (const device of d.devices) {
      console.log(`  ${d.baseUrl} device: ${device.name} ${device.vramFreeMib ?? "?"}/${device.vramTotalMib ?? "?"} MiB free`);
    }
  }
}

function printCatalog(argv) {
  const tiers = valuesOf(argv, "--tier").map((t) => t.toLowerCase());
  const list = tiers.length ? RUNTIMES.filter((r) => tiers.includes(r.tier)) : RUNTIMES;
  if (argv.includes("--json")) {
    console.log(JSON.stringify(list, null, 2));
    return;
  }
  const rows = [["ID", "TIER", "MODE", "WINDOWS", "PORT", "FORMATS"]];
  for (const r of list) rows.push([r.id, r.tier, r.mode, r.windows, r.defaultPort ?? "-", r.formats.join(",") || "-"]);
  console.log(table(rows));
  console.log(`\n${list.length} of ${RUNTIMES.length} runtimes.`);
}

async function runCli(argv, ownPort) {
  if (argv.includes("--scan")) {
    await printScan(argv, ownPort);
    return true;
  }
  if (argv.includes("--catalog")) {
    printCatalog(argv);
    return true;
  }
  return false;
}

module.exports = { runCli };
