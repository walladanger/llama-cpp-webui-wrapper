const { spawn } = require("node:child_process");
const { createWriteStream, existsSync, mkdirSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

const ROOT_DIR = resolve(__dirname, "..", "..");
const DATA_DIR = join(ROOT_DIR, "portable-data");
const LOG_DIR = join(DATA_DIR, "logs");
const MODELS_DIR = join(DATA_DIR, "models");
const SERVER_PORT = Number(process.env.LLAMA_CPP_PORT ?? "8080");
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`;
const SERVER_EXE_RELEASE = join(ROOT_DIR, "build", "bin", "Release", "llama-server.exe");
const SERVER_EXE_DEFAULT = join(ROOT_DIR, "build", "bin", "llama-server.exe");
const LOG_FILE = join(LOG_DIR, "llama-server.log");

let serverProcess;
let shellProcess;

function ensurePortableFolders() {
  for (const folder of [DATA_DIR, LOG_DIR, MODELS_DIR, join(DATA_DIR, "config"), join(DATA_DIR, "cache")]) {
    mkdirSync(folder, { recursive: true });
  }
}

function findServerExecutable() {
  if (existsSync(SERVER_EXE_RELEASE)) {
    return SERVER_EXE_RELEASE;
  }

  if (existsSync(SERVER_EXE_DEFAULT)) {
    return SERVER_EXE_DEFAULT;
  }

  return undefined;
}

function startServer() {
  const executable = findServerExecutable();

  if (!executable) {
    throw new Error(
      "llama-server.exe was not found. Run Setup-Llama-WebUI.ps1 after installing CMake and Visual Studio Build Tools.",
    );
  }

  const logStream = createWriteStream(LOG_FILE, { flags: "a" });
  const args = ["--host", "127.0.0.1", "--port", String(SERVER_PORT), "--models-dir", MODELS_DIR];

  serverProcess = spawn(executable, args, {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      LLAMA_CACHE: join(DATA_DIR, "cache"),
    },
    windowsHide: true,
  });

  logStream.write(`\n\n[${new Date().toISOString()}] Starting ${executable} ${args.join(" ")}\n`);
  serverProcess.stdout.pipe(logStream, { end: false });
  serverProcess.stderr.pipe(logStream, { end: false });
  serverProcess.on("exit", (code, signal) => {
    logStream.write(`[${new Date().toISOString()}] llama-server exited code=${code} signal=${signal}\n`);
    logStream.end();
  });
}

async function waitForServer(timeoutMs = 30000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${SERVER_URL}/health`);
      if (response.ok) {
        return true;
      }
    } catch {
      await delay(750);
    }
  }

  return false;
}

function findAppShell() {
  const candidates = [
    join(process.env.ProgramFiles ?? "", "Microsoft", "Edge", "Application", "msedge.exe"),
    join(process.env["ProgramFiles(x86)"] ?? "", "Microsoft", "Edge", "Application", "msedge.exe"),
    join(process.env.ProgramFiles ?? "", "Google", "Chrome", "Application", "chrome.exe"),
    join(process.env["ProgramFiles(x86)"] ?? "", "Google", "Chrome", "Application", "chrome.exe"),
  ];

  return candidates.find((candidate) => candidate && existsSync(candidate));
}

function openAppWindow() {
  const appShell = findAppShell();

  if (!appShell) {
    throw new Error("Microsoft Edge or Chrome was not found. Install one of them to open the WebUI as an app window.");
  }

  shellProcess = spawn(
    appShell,
    [`--app=${SERVER_URL}`, `--user-data-dir=${join(DATA_DIR, "browser-profile")}`, "--no-first-run", "--new-window"],
    {
      cwd: ROOT_DIR,
      detached: false,
      stdio: "ignore",
      windowsHide: false,
    },
  );

  shellProcess.on("exit", () => {
    shutdown();
  });
}

function shutdown() {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
  }
}

async function main() {
  ensurePortableFolders();
  startServer();

  const ready = await waitForServer();
  if (!ready) {
    throw new Error(`llama-server did not answer on ${SERVER_URL}. Check ${LOG_FILE}.`);
  }

  openAppWindow();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", shutdown);

main().catch((error) => {
  ensurePortableFolders();
  const logStream = createWriteStream(join(LOG_DIR, "desktop-wrapper.log"), { flags: "a" });
  logStream.end(`[${new Date().toISOString()}] ${error.stack ?? error.message}\n`);
  console.error(error.message);
  shutdown();
  process.exit(1);
});
