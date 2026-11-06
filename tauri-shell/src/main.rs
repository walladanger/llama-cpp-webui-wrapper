// No console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod gpu;
mod launch;
mod local_files;
mod process_probe;
mod runtime_capabilities;
mod settings;

use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const SERVER_EXE: &str = if cfg!(windows) {
    "llama-server.exe"
} else {
    "llama-server"
};
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
        .find(|dir| {
            dir.join("portable-data").is_dir()
                || dir.join("build").join("bin").is_dir()
                || dir.join("web-wrapper").is_dir()
        })
        .map(Path::to_path_buf)
        .unwrap_or(start)
}

fn find_server(root: &Path) -> Option<PathBuf> {
    [
        root.join("portable-data").join("bin").join(SERVER_EXE),
        root.join("build")
            .join("bin")
            .join("Release")
            .join(SERVER_EXE),
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
    if stream
        .write_all(b"GET /health HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n")
        .is_err()
    {
        return false;
    }
    let mut head = [0u8; 16];
    matches!(stream.read(&mut head), Ok(n) if n >= 12 && head[9..12] == *b"200")
}

fn show_status(window: &WebviewWindow, text: &str, error: bool) {
    let text = serde_json::to_string(text).unwrap_or_default();
    let class = if error {
        "document.body.classList.add('error');"
    } else {
        ""
    };
    let _ = window.eval(format!(
        "{class}document.getElementById('status').textContent = {text};"
    ));
}

fn spawn_server(root: &Path, port: u16) -> Result<Child, String> {
    let data = root.join("portable-data");
    let (logs, models, cache) = (
        local_files::logs_dir(root)?,
        data.join("models"),
        local_files::cache_dir(root)?,
    );
    for dir in [&logs, &models, &cache, &data.join("config")] {
        fs::create_dir_all(dir).map_err(|e| format!("Cannot create {}: {e}", dir.display()))?;
    }

    let exe = find_server(root).ok_or_else(|| {
        format!(
            "llama-server was not found under {}.\nRun Setup-Llama-WebUI.ps1 first.",
            root.display()
        )
    })?;

    let settings_file = data.join("config").join("llama-server.json");
    let plan = launch::prepare(
        &exe,
        settings::load_profile(&settings_file)?,
        port,
        &models,
        &cache,
    )?;
    let child_env = plan.env;
    let notes = plan.notes;
    let mut args = plan.args;
    let preset = local_files::write_presets(root, &local_files::load(root)?)?;
    args.extend([
        "--models-preset".to_string(),
        preset.to_string_lossy().into_owned(),
    ]);
    let ui = data.join("ui");
    if ui.join("index.html").is_file() {
        args.extend(["--path".to_string(), ui.to_string_lossy().into_owned()]);
    }

    let evidence = runtime_capabilities::inspect(&exe, &child_env)?;
    runtime_capabilities::assert_arguments(&evidence, &args)?;
    fs::write(
        logs.join("runtime-capabilities.json"),
        serde_json::to_vec_pretty(&evidence).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    let log_path = logs.join("llama-server.log");
    let mut log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("{}: {e}", log_path.display()))?;
    let _ = writeln!(
        log,
        "\n\n[tauri-shell] Starting {} {}",
        exe.display(),
        settings::redact_args(&args).join(" ")
    );
    for note in &notes {
        let _ = writeln!(log, "{note}");
    }
    let err_log = log.try_clone().map_err(|e| e.to_string())?;

    let mut cmd = Command::new(&exe);
    cmd.args(&args)
        .current_dir(root)
        .env_clear()
        .envs(&child_env)
        .stdin(Stdio::null())
        .stdout(log)
        .stderr(err_log);
    no_console(&mut cmd);
    cmd.spawn()
        .map_err(|e| format!("Could not start {}: {e}", exe.display()))
}

fn start(window: WebviewWindow) {
    let app = window.app_handle().clone();
    let root = root_dir();
    let port: u16 = 18080;
    let url = format!("http://127.0.0.1:{port}");

    std::thread::spawn(move || {
        let owned = app
            .state::<Server>()
            .0
            .lock()
            .unwrap()
            .as_mut()
            .is_some_and(|child| matches!(child.try_wait(), Ok(None)));
        if healthy(port) && !owned {
            return show_status(
                &window,
                &format!("Port {port} is in use by another server. Set LLAMA_CPP_PORT to a free port and restart the app."),
                true,
            );
        }
        if !healthy(port) {
            if !owned {
                match spawn_server(&root, port) {
                    Ok(child) => *app.state::<Server>().0.lock().unwrap() = Some(child),
                    Err(e) => return show_status(&window, &e, true),
                }
            }
            let log = root
                .join("portable-data")
                .join("logs")
                .join("llama-server.log");
            let started = Instant::now();
            loop {
                if healthy(port) {
                    break;
                }
                let exited = app
                    .state::<Server>()
                    .0
                    .lock()
                    .unwrap()
                    .as_mut()
                    .map(|c| matches!(c.try_wait(), Ok(Some(_))))
                    .unwrap_or(true);
                if exited {
                    return show_status(
                        &window,
                        &format!(
                            "llama-server stopped during startup.\nSee {}",
                            log.display()
                        ),
                        true,
                    );
                }
                if started.elapsed() > READY_TIMEOUT {
                    return show_status(
                        &window,
                        &format!(
                            "llama-server did not answer on {url}.\nSee {}",
                            log.display()
                        ),
                        true,
                    );
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

fn require_dashboard(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Engine controls are available only in the local dashboard".into());
    }
    Ok(())
}

fn manager_exe() -> Result<PathBuf, String> {
    let path = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .with_file_name("llama-engine-manager.exe");
    if !path.is_file() {
        return Err(format!(
            "Missing {}. Run Setup-Llama-WebUI.ps1.",
            path.display()
        ));
    }
    Ok(path)
}

#[tauri::command]
async fn open_chat(window: WebviewWindow) -> Result<(), String> {
    require_dashboard(&window)?;
    let app = window.app_handle();
    if let Some(chat) = app.get_webview_window("chat") {
        chat.show().map_err(|e| e.to_string())?;
        chat.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let chat = WebviewWindowBuilder::new(app, "chat", WebviewUrl::App("chat.html".into()))
        .title("llama.cpp chat test")
        .inner_size(1280.0, 860.0)
        .build()
        .map_err(|e| e.to_string())?;
    start(chat);
    Ok(())
}

#[tauri::command]
async fn manager_call(
    window: WebviewWindow,
    engine: String,
    action: String,
    model: Option<String>,
    device: Option<String>,
) -> Result<String, String> {
    require_dashboard(&window)?;
    if engine == "llamacpp" && action == "plan" {
        return tauri::async_runtime::spawn_blocking(|| {
            let root = root_dir();
            let exe = find_server(&root).ok_or("llama-server not found")?;
            let profile =
                settings::load_profile(&root.join("portable-data/config/llama-server.json"))?;
            let plan = launch::prepare(
                &exe,
                profile,
                18080,
                &root.join("portable-data/models"),
                &local_files::cache_dir(&root)?,
            )?;
            serde_json::to_string_pretty(&plan).map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?;
    }
    if engine == "llamacpp" && action == "capabilities" {
        return tauri::async_runtime::spawn_blocking(|| {
            let root = root_dir();
            let exe = find_server(&root).ok_or("llama-server not found")?;
            let s = settings::Settings::load(&root.join("portable-data/config/llama-server.json"))?;
            let evidence = runtime_capabilities::inspect(&exe, &settings::child_environment(&s)?)?;
            serde_json::to_string_pretty(&evidence).map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?;
    }
    if engine == "llamacpp" && action == "inventory" {
        return tauri::async_runtime::spawn_blocking(|| {
            serde_json::to_string_pretty(&gpu::inventory()?).map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?;
    }
    let allowed = match engine.as_str() {
        "vllm" => ["start", "status", "stop", "logs"].contains(&action.as_str()),
        "trtllm" => ["installed", "start", "status", "stop", "logs"].contains(&action.as_str()),
        "bench" => ["installed", "install", "run"].contains(&action.as_str()),
        _ => false,
    };
    if !allowed {
        return Err("Unsupported engine action".into());
    }
    let root = root_dir();
    let mut args = vec![engine, action.clone()];
    if action == "run" {
        if args[0] != "bench" {
            return Err("Only llama-bench accepts a model".into());
        }
        let name = model.ok_or("Choose a GGUF model first")?;
        let path = fs::canonicalize(&name).map_err(|e| e.to_string())?;
        if !local_files::model_files(&root)?
            .iter()
            .any(|allowed| fs::canonicalize(allowed).ok().as_ref() == Some(&path))
        {
            return Err("Choose a listed GGUF model".into());
        }
        args.push(path.to_string_lossy().into_owned());
        if let Some(device) = device {
            if !device.is_empty() {
                if !device.chars().all(|c| c.is_ascii_alphanumeric()) {
                    return Err("Invalid device name".into());
                }
                args.push(device);
            }
        }
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut command = Command::new(manager_exe()?);
        command.args(&args).env("LLAMA_WEBUI_ROOT", root);
        no_console(&mut command);
        let output = command.output().map_err(|e| e.to_string())?;
        let text = format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        )
        .trim()
        .to_string();
        if output.status.success() {
            Ok(text)
        } else {
            Err(text)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn list_models(window: WebviewWindow) -> Result<Vec<String>, String> {
    require_dashboard(&window)?;
    Ok(local_files::model_files(&root_dir())?
        .iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect())
}

fn config_path(engine: &str) -> Result<PathBuf, String> {
    match engine {
        "llamacpp" => Ok(root_dir().join("portable-data/config/llama-server.json")),
        "vllm" | "trtllm" => Ok(root_dir()
            .join("portable-data/config")
            .join(format!("{engine}.json"))),
        _ => Err("Unsupported engine config".into()),
    }
}

#[tauri::command]
fn read_engine_config(window: WebviewWindow, engine: String) -> Result<serde_json::Value, String> {
    require_dashboard(&window)?;
    let path = config_path(&engine)?;
    if engine == "llamacpp" {
        return serde_json::to_value(settings::load_profile(&path)?).map_err(|e| e.to_string());
    }
    let data = fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    serde_json::from_slice(&data).map_err(|e| format!("{}: {e}", path.display()))
}

#[tauri::command]
fn save_engine_config(
    window: WebviewWindow,
    engine: String,
    config: serde_json::Value,
) -> Result<(), String> {
    require_dashboard(&window)?;
    let path = config_path(&engine)?;
    if engine == "llamacpp" {
        let profile = settings::migrate_profile(config)?;
        let revision = profile.revision;
        settings::save_profile(&path, profile, revision)?;
        return Ok(());
    }
    let str_field = |key: &str| config.get(key).and_then(|v| v.as_str()).unwrap_or("");
    if ["distro", "executable", "model"]
        .iter()
        .any(|key| str_field(key).trim().is_empty())
    {
        return Err("Distro, executable, and model are required".into());
    }
    let port = config.get("port").and_then(|v| v.as_u64()).unwrap_or(0);
    if !(1..=65535).contains(&port) {
        return Err("Port must be 1 to 65535".into());
    }
    if !str_field("cuda_visible_devices")
        .chars()
        .all(|c| c.is_ascii_digit() || c == ',')
    {
        return Err("GPU IDs must be numbers separated by commas".into());
    }
    if engine == "vllm" {
        let memory = config
            .get("gpu_memory_utilization")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let context = config
            .get("max_model_len")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        if !(0.0 < memory && memory <= 1.0) || context == 0 {
            return Err("Invalid GPU memory fraction or context length".into());
        }
        if !str_field("cuda_home").is_empty() && !str_field("cuda_home").starts_with('/') {
            return Err("CUDA_HOME must be an absolute WSL path".into());
        }
    }
    let bytes = serde_json::to_vec_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(&path, bytes).map_err(|e| format!("{}: {e}", path.display()))
}

#[tauri::command]
fn open_trt_guide(window: WebviewWindow) -> Result<(), String> {
    require_dashboard(&window)?;
    Command::new("explorer.exe")
        .arg("https://nvidia.github.io/TensorRT-LLM/installation/installation-guide.html")
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn window_action(window: WebviewWindow, action: String) -> Result<(), String> {
    require_dashboard(&window)?;
    match action.as_str() {
        "drag" => window.start_dragging(),
        "minimize" => window.minimize(),
        "maximize" => {
            if window.is_maximized().map_err(|e| e.to_string())? {
                window.unmaximize()
            } else {
                window.maximize()
            }
        }
        "close" => window.close(),
        _ => return Err("Unsupported window action".into()),
    }
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_app_paths(window: WebviewWindow) -> Result<local_files::AppPaths, String> {
    require_dashboard(&window)?;
    local_files::load(&root_dir())
}

#[tauri::command]
fn save_app_paths(window: WebviewWindow, paths: local_files::AppPaths) -> Result<(), String> {
    require_dashboard(&window)?;
    local_files::save(&root_dir(), paths)
}

#[tauri::command]
async fn pick_folders(window: WebviewWindow) -> Result<Vec<String>, String> {
    require_dashboard(&window)?;
    tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .pick_folders()
            .unwrap_or_default()
            .into_iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn pick_folder(window: WebviewWindow) -> Result<Option<String>, String> {
    require_dashboard(&window)?;
    tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .pick_folder()
            .map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn list_log_files(window: WebviewWindow) -> Result<Vec<local_files::LogFile>, String> {
    require_dashboard(&window)?;
    local_files::list_logs(&root_dir())
}

#[tauri::command]
fn read_log_file(window: WebviewWindow, name: String) -> Result<String, String> {
    require_dashboard(&window)?;
    local_files::read_log(&root_dir(), &name)
}

#[tauri::command]
fn open_logs_folder(window: WebviewWindow) -> Result<(), String> {
    require_dashboard(&window)?;
    let dir = local_files::logs_dir(&root_dir())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Command::new("explorer.exe")
        .arg(&dir)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
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
        .invoke_handler(tauri::generate_handler![
            open_chat,
            manager_call,
            list_models,
            read_engine_config,
            save_engine_config,
            open_trt_guide,
            window_action,
            get_app_paths,
            save_app_paths,
            pick_folders,
            pick_folder,
            list_log_files,
            read_log_file,
            open_logs_folder
        ])
        .setup(|app| {
            if let Some(main) = app.get_webview_window("main") {
                start(main);
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
