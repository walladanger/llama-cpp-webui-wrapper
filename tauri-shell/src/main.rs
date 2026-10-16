// No console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod gpu;
mod settings;

use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{Manager, RunEvent, WebviewWindow};

const SERVER_EXE: &str = if cfg!(windows) { "llama-server.exe" } else { "llama-server" };
const READY_TIMEOUT: Duration = Duration::from_secs(120);

struct Server(Mutex<Option<Child>>);

pub fn no_console(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = cmd;
}

// LLAMA_WEBUI_ROOT, else the nearest folder above the exe that looks like the repo or a portable copy.
fn root_dir() -> PathBuf {
    if let Some(root) = std::env::var_os("LLAMA_WEBUI_ROOT") {
        return PathBuf::from(root);
    }
    let exe = std::env::current_exe().unwrap_or_default();
    let start = exe.parent().map(Path::to_path_buf).unwrap_or_default();
    start
        .ancestors()
        .find(|dir| dir.join("portable-data").is_dir() || dir.join("build").join("bin").is_dir() || dir.join("web-wrapper").is_dir())
        .map(Path::to_path_buf)
        .unwrap_or(start)
}

fn find_server(root: &Path) -> Option<PathBuf> {
    [
        root.join("portable-data").join("bin").join(SERVER_EXE),
        root.join("build").join("bin").join("Release").join(SERVER_EXE),
        root.join("build").join("bin").join(SERVER_EXE),
    ]
    .into_iter()
    .find(|p| p.is_file())
}

fn healthy(port: u16) -> bool {
    let addr = ([127, 0, 0, 1], port).into();
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(500)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    if stream.write_all(b"GET /health HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n").is_err() {
        return false;
    }
    let mut head = [0u8; 16];
    matches!(stream.read(&mut head), Ok(n) if n >= 12 && head[9..12] == *b"200")
}

fn show_status(window: &WebviewWindow, text: &str, error: bool) {
    let text = serde_json::to_string(text).unwrap_or_default();
    let class = if error { "document.body.classList.add('error');" } else { "" };
    let _ = window.eval(format!("{class}document.getElementById('status').textContent = {text};"));
}

fn spawn_server(root: &Path, port: u16) -> Result<Child, String> {
    let data = root.join("portable-data");
    let (logs, models, cache) = (data.join("logs"), data.join("models"), data.join("cache"));
    for dir in [&logs, &models, &cache, &data.join("config")] {
        fs::create_dir_all(dir).map_err(|e| format!("Cannot create {}: {e}", dir.display()))?;
    }

    let exe = find_server(root).ok_or_else(|| {
        format!("llama-server was not found under {}.\nRun Setup-Llama-WebUI.ps1 first.", root.display())
    })?;

    let settings_file = data.join("config").join("llama-server.json");
    let mut s = settings::Settings::load(&settings_file)?;
    let mut notes = Vec::new();
    let mode = s.str("gpu_placement");
    match mode.as_str() {
        "" | "manual" => {}
        "single" | "spread" => match gpu::plan(&mode, &gpu::list_devices(&exe), &s.str("tensor_split")) {
            Some(p) => {
                notes.push(format!("GPU placement \"{mode}\" -> {}", p.device));
                s.set("device", &p.device);
                s.set("split_mode", &p.split_mode);
                s.set("main_gpu", "0");
                s.set("tensor_split", &p.tensor_split);
            }
            None => notes.push(format!("GPU placement \"{mode}\" found no graphics card; using manual settings.")),
        },
        other => notes.push(format!("GPU placement \"{other}\" is not supported here; using manual settings.")),
    }
    let args = settings::build_args(&s, port, &models);

    let log_path = logs.join("llama-server.log");
    let mut log = OpenOptions::new().create(true).append(true).open(&log_path).map_err(|e| format!("{}: {e}", log_path.display()))?;
    let _ = writeln!(log, "\n\n[tauri-shell] Starting {} {}", exe.display(), args.join(" "));
    for note in &notes {
        let _ = writeln!(log, "{note}");
    }
    let err_log = log.try_clone().map_err(|e| e.to_string())?;

    let mut cmd = Command::new(&exe);
    cmd.args(&args)
        .current_dir(root)
        .envs(settings::parse_env(&s.str("llamacpp_env")))
        .env("LLAMA_CACHE", &cache)
        .stdin(Stdio::null())
        .stdout(log)
        .stderr(err_log);
    no_console(&mut cmd);
    cmd.spawn().map_err(|e| format!("Could not start {}: {e}", exe.display()))
}

fn start(window: WebviewWindow) {
    let app = window.app_handle().clone();
    let root = root_dir();
    let port: u16 = std::env::var("LLAMA_CPP_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8080);
    let url = format!("http://127.0.0.1:{port}");

    std::thread::spawn(move || {
        // Reuse a server that is already running on the port.
        if !healthy(port) {
            match spawn_server(&root, port) {
                Ok(child) => *app.state::<Server>().0.lock().unwrap() = Some(child),
                Err(e) => return show_status(&window, &e, true),
            }
            let log = root.join("portable-data").join("logs").join("llama-server.log");
            let started = Instant::now();
            loop {
                if healthy(port) {
                    break;
                }
                let exited = app.state::<Server>().0.lock().unwrap().as_mut().map(|c| matches!(c.try_wait(), Ok(Some(_)))).unwrap_or(true);
                if exited {
                    return show_status(&window, &format!("llama-server stopped during startup.\nSee {}", log.display()), true);
                }
                if started.elapsed() > READY_TIMEOUT {
                    return show_status(&window, &format!("llama-server did not answer on {url}.\nSee {}", log.display()), true);
                }
                std::thread::sleep(Duration::from_millis(500));
            }
        }
        match url.parse() {
            Ok(target) => {
                let _ = window.navigate(target);
            }
            Err(e) => show_status(&window, &format!("Bad URL {url}: {e}"), true),
        }
    });
}

fn stop(app: &tauri::AppHandle) {
    if let Some(mut child) = app.state::<Server>().0.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn main() {
    let app = tauri::Builder::default()
        .manage(Server(Mutex::new(None)))
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                start(window);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build the llama.cpp WebUI shell");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            stop(handle);
        }
    });
}
