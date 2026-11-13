#[path = "../cuda_inventory.rs"]
mod cuda_inventory;
use serde::Deserialize;
use std::env;
use std::fs;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::thread;
use std::time::{Duration, Instant};

const UNIT: &str = "llama-webui-vllm.service";
const TRT_UNIT: &str = "llama-webui-trtllm.service";
const START_TIMEOUT: Duration = Duration::from_secs(600);

#[derive(Deserialize)]
#[serde(default)]
struct VllmConfig {
    distro: String,
    executable: String,
    model: String,
    port: u16,
    cuda_visible_devices: String,
    cuda_home: String,
    flashinfer_sampler: bool,
    gpu_memory_utilization: f32,
    max_model_len: u32,
}

#[derive(Deserialize)]
#[serde(default)]
struct TrtllmConfig {
    distro: String,
    executable: String,
    model: String,
    port: u16,
    cuda_visible_devices: String,
}

impl Default for TrtllmConfig {
    fn default() -> Self {
        Self {
            distro: "Ubuntu".into(),
            executable: "trtllm-serve".into(),
            model: "TinyLlama/TinyLlama-1.1B-Chat-v1.0".into(),
            port: 8001,
            cuda_visible_devices: "".into(),
        }
    }
}

impl Default for VllmConfig {
    fn default() -> Self {
        Self {
            distro: "Ubuntu".into(),
            executable: "vllm".into(),
            model: "Qwen/Qwen2.5-0.5B-Instruct".into(),
            port: 8000,
            cuda_visible_devices: "".into(),
            cuda_home: "".into(),
            flashinfer_sampler: false,
            gpu_memory_utilization: 0.8,
            max_model_len: 32768,
        }
    }
}

fn root_dir() -> PathBuf {
    if let Some(root) = env::var_os("LLAMA_WEBUI_ROOT") {
        return PathBuf::from(root);
    }
    let exe = env::current_exe().unwrap_or_default();
    let start = exe.parent().map(Path::to_path_buf).unwrap_or_default();
    start
        .ancestors()
        .find(|dir| dir.join("portable-data").is_dir() || dir.join("web-wrapper").is_dir())
        .map(Path::to_path_buf)
        .unwrap_or(start)
}

fn config(root: &Path) -> Result<VllmConfig, String> {
    let path = root.join("portable-data/config/vllm.json");
    if !path.is_file() {
        return Err(format!(
            "Missing {}. Copy tauri-shell/vllm.default.json there and set the WSL vLLM executable.",
            path.display()
        ));
    }
    let bytes = fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    let cfg: VllmConfig =
        serde_json::from_slice(&bytes).map_err(|e| format!("{}: {e}", path.display()))?;
    if cfg.distro.trim().is_empty()
        || cfg.executable.trim().is_empty()
        || cfg.model.trim().is_empty()
        || cfg.port == 0
        || cfg.max_model_len == 0
        || !(0.0 < cfg.gpu_memory_utilization && cfg.gpu_memory_utilization <= 1.0)
    {
        return Err(format!("Invalid required value in {}", path.display()));
    }
    if !cfg
        .cuda_visible_devices
        .chars()
        .all(|c| c.is_ascii_digit() || c == ',')
    {
        return Err("cuda_visible_devices must be GPU numbers separated by commas".into());
    }
    if !cfg.cuda_home.is_empty() && !cfg.cuda_home.starts_with('/') {
        return Err("cuda_home must be an absolute WSL path".into());
    }
    Ok(cfg)
}

fn wsl(cfg: &VllmConfig, args: &[&str]) -> Result<Output, String> {
    Command::new("wsl.exe")
        .arg("-d")
        .arg(&cfg.distro)
        .arg("--exec")
        .args(args)
        .output()
        .map_err(|e| format!("Cannot run wsl.exe: {e}"))
}

fn wsl_distro(distro: &str, args: &[&str]) -> Result<Output, String> {
    Command::new("wsl.exe")
        .args(["-d", distro, "--exec"])
        .args(args)
        .output()
        .map_err(|e| format!("Cannot run WSL distro {distro}: {e}"))
}

fn keep_wsl_alive(distro: &str, unit: &str) -> Result<(), String> {
    // A foreground WSL client keeps the distro alive until its unit stops.
    let script = include_str!("../wsl-keepalive.sh");
    let mut command = Command::new("wsl.exe");
    command
        .args([
            "-d",
            distro,
            "--exec",
            "bash",
            "-c",
            script,
            "llama-router-keepalive",
            unit,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("Could not keep WSL distro {distro} alive: {e}"))?;
    thread::sleep(Duration::from_millis(100));
    if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
        if !status.success() {
            return Err(format!("WSL keepalive for {unit} exited: {status}"));
        }
    }
    Ok(())
}

fn trt_model_matches(configured: &str, served: &str) -> bool {
    served == configured
        || (configured.starts_with('/')
            && served
                == configured
                    .trim_end_matches('/')
                    .rsplit('/')
                    .next()
                    .filter(|name| !name.is_empty())
                    .unwrap_or(configured))
}

fn trt_config(root: &Path) -> Result<TrtllmConfig, String> {
    let path = root.join("portable-data/config/trtllm.json");
    let data = fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    let cfg: TrtllmConfig =
        serde_json::from_slice(&data).map_err(|e| format!("{}: {e}", path.display()))?;
    if cfg.distro.trim().is_empty()
        || cfg.executable.trim().is_empty()
        || cfg.model.trim().is_empty()
        || cfg.port == 0
    {
        return Err(format!("Invalid required value in {}", path.display()));
    }
    if !cfg
        .cuda_visible_devices
        .chars()
        .all(|c| c.is_ascii_digit() || c == ',')
    {
        return Err("cuda_visible_devices must be GPU numbers separated by commas".into());
    }
    Ok(cfg)
}

fn trt_installed(cfg: &TrtllmConfig) -> Result<bool, String> {
    let result = if cfg.executable.starts_with('/') {
        wsl_distro(&cfg.distro, &["test", "-x", &cfg.executable])?
    } else {
        if !cfg
            .executable
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return Err(
                "Use an absolute WSL path or a simple executable name for TensorRT-LLM".into(),
            );
        }
        wsl_distro(
            &cfg.distro,
            &[
                "/usr/bin/env",
                "bash",
                "-lc",
                &format!("command -v {} >/dev/null", cfg.executable),
            ],
        )?
    };
    if result.status.success() {
        return Ok(true);
    }
    if !output_text(&result).is_empty() {
        return Err(output_text(&result));
    }
    Ok(false)
}

fn unit_is_active(result: &Output) -> Result<bool, String> {
    let state = String::from_utf8_lossy(&result.stdout);
    let state = state.trim();
    let inactive = matches!(result.status.code(), Some(3) | Some(4))
        && matches!(state, "inactive" | "failed" | "unknown");
    if !result.status.success() && !inactive {
        return Err(output_text(result));
    }
    Ok(result.status.success() && state == "active")
}

fn trt_active(cfg: &TrtllmConfig) -> Result<bool, String> {
    let result = wsl_distro(&cfg.distro, &["systemctl", "--user", "is-active", TRT_UNIT])?;
    unit_is_active(&result)
}

fn trt_start(cfg: &TrtllmConfig) -> Result<(), String> {
    if !trt_installed(cfg)? {
        return Err("trtllm-serve is missing. Install TensorRT-LLM in WSL2 and set executable in trtllm.json".into());
    }
    if !trt_active(cfg)? {
        if port_open(cfg.port) {
            return Err(format!(
                "Port {} is already occupied; refusing to claim it",
                cfg.port
            ));
        }
        let port = cfg.port.to_string();
        let gpu = format!("--setenv=CUDA_VISIBLE_DEVICES={}", cfg.cuda_visible_devices);
        let path = if cfg.executable.starts_with('/') {
            let bin = cfg
                .executable
                .rsplit_once('/')
                .map(|(dir, _)| dir)
                .unwrap_or("");
            Some(format!(
                "--setenv=PATH={bin}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
            ))
        } else {
            None
        };
        let mut args = vec![
            "systemd-run",
            "--user",
            "--unit=llama-webui-trtllm",
            "--collect",
            "--property=KillMode=control-group",
            "--setenv=TRTLLM_NO_USAGE_STATS=1",
        ];
        if !cfg.cuda_visible_devices.is_empty() {
            args.push(&gpu);
        }
        if let Some(ref value) = path {
            args.push(value);
        }
        args.extend([
            "--",
            &cfg.executable,
            &cfg.model,
            "--host",
            "127.0.0.1",
            "--port",
            &port,
        ]);
        let result = wsl_distro(&cfg.distro, &args)?;
        if !result.status.success() {
            return Err(format!(
                "Could not start {TRT_UNIT}: {}",
                output_text(&result)
            ));
        }
        println!("{}", output_text(&result));
    }
    keep_wsl_alive(&cfg.distro, TRT_UNIT)?;
    let started = Instant::now();
    while started.elapsed() < START_TIMEOUT {
        if healthy(cfg.port) {
            let served = running_model(cfg.port)
                .ok_or("TensorRT-LLM health is ready but /v1/models is unavailable")?;
            if !trt_model_matches(&cfg.model, &served) {
                return Err(format!(
                    "Running model {served} differs from configured model {}",
                    cfg.model
                ));
            }
            println!(
                "TensorRT-LLM ready at http://127.0.0.1:{}/v1 (model {})",
                cfg.port, cfg.model
            );
            return Ok(());
        }
        if !trt_active(cfg)? {
            let logs = wsl_distro(
                &cfg.distro,
                &[
                    "journalctl",
                    "--user",
                    "-u",
                    TRT_UNIT,
                    "-n",
                    "80",
                    "--no-pager",
                ],
            )?;
            return Err(format!(
                "TensorRT-LLM stopped during startup:\n{}",
                output_text(&logs)
            ));
        }
        thread::sleep(Duration::from_secs(3));
    }
    Err(format!("TensorRT-LLM did not become healthy within {} seconds. Run `llama-engine-manager trtllm logs`.", START_TIMEOUT.as_secs()))
}

fn trt_status(cfg: &TrtllmConfig) -> Result<(), String> {
    let result = wsl_distro(
        &cfg.distro,
        &[
            "systemctl",
            "--user",
            "show",
            TRT_UNIT,
            "-p",
            "ActiveState",
            "-p",
            "SubState",
            "-p",
            "ExecMainPID",
            "--no-pager",
        ],
    )?;
    if !result.status.success() {
        return Err(output_text(&result));
    }
    println!(
        "{TRT_UNIT} on WSL distro {}\n{}",
        cfg.distro,
        output_text(&result)
    );
    println!(
        "HTTP health: {}",
        if healthy(cfg.port) {
            "ready"
        } else {
            "unavailable"
        }
    );
    println!(
        "Running model: {}",
        running_model(cfg.port).unwrap_or_else(|| "unavailable".into())
    );
    println!("Endpoint: http://127.0.0.1:{}/v1", cfg.port);
    Ok(())
}

fn trt_stop(cfg: &TrtllmConfig) -> Result<(), String> {
    if !trt_active(cfg)? {
        if cfg.executable == "/opt/llama-router/trtllm/bin/trtllm-serve" {
            let cleanup = wsl_distro(&cfg.distro, &[&cfg.executable, "--router-stop"])?;
            if !cleanup.status.success() {
                return Err(output_text(&cleanup));
            }
        }
        println!("{TRT_UNIT} is not active");
        return Ok(());
    }
    let result = wsl_distro(&cfg.distro, &["systemctl", "--user", "stop", TRT_UNIT])?;
    if !result.status.success() {
        return Err(output_text(&result));
    }
    println!("Stopped {TRT_UNIT}");
    if cfg.executable == "/opt/llama-router/trtllm/bin/trtllm-serve" {
        let cleanup = wsl_distro(&cfg.distro, &[&cfg.executable, "--router-stop"])?;
        if !cleanup.status.success() {
            return Err(output_text(&cleanup));
        }
    }
    Ok(())
}

fn trt_logs(cfg: &TrtllmConfig) -> Result<(), String> {
    let result = wsl_distro(
        &cfg.distro,
        &[
            "journalctl",
            "--user",
            "-u",
            TRT_UNIT,
            "-n",
            "80",
            "--no-pager",
        ],
    )?;
    if !result.status.success() {
        return Err(output_text(&result));
    }
    println!("{}", output_text(&result));
    Ok(())
}

fn bench_exe(root: &Path) -> Option<PathBuf> {
    [
        root.join("portable-data/bench/bin/llama-bench.exe"),
        root.join("portable-data/bin/llama-bench.exe"),
    ]
    .into_iter()
    .find(|path| path.is_file())
}

fn bench_install(root: &Path) -> Result<(), String> {
    let script = [
        root.join("install-llama-bench.ps1"),
        root.join("tauri-shell/install-llama-bench.ps1"),
    ]
    .into_iter()
    .find(|path| path.is_file())
    .ok_or("Missing install-llama-bench.ps1")?;
    let result = Command::new("powershell.exe")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(&script)
        .arg("-Root")
        .arg(root)
        .output()
        .map_err(|e| format!("Could not run installer: {e}"))?;
    if !result.status.success() {
        return Err(output_text(&result));
    }
    println!("{}", output_text(&result));
    if bench_exe(root).is_none() {
        return Err("Installer finished but llama-bench.exe is missing".into());
    }
    Ok(())
}

fn bench_run(root: &Path, model: &str, device: Option<&str>) -> Result<(), String> {
    let exe = bench_exe(root)
        .ok_or("llama-bench.exe is missing. Run `llama-engine-manager bench install`.")?;
    let model = fs::canonicalize(model).map_err(|e| format!("Model {model}: {e}"))?;
    if !model.is_file() {
        return Err(format!("Model is not a file: {}", model.display()));
    }
    let mut command = Command::new(&exe);
    command.args([
        "-m",
        &model.to_string_lossy(),
        "-p",
        "512",
        "-n",
        "128",
        "-r",
        "3",
        "-o",
        "md",
    ]);
    if let Some(device) = device {
        command.args(["-dev", device]);
    }
    let result = command
        .current_dir(exe.parent().unwrap_or(root))
        .output()
        .map_err(|e| format!("Could not launch {}: {e}", exe.display()))?;
    let output = output_text(&result);
    let logs = root.join("portable-data/logs");
    fs::create_dir_all(&logs).map_err(|e| e.to_string())?;
    fs::write(logs.join("llama-bench.md"), &output).map_err(|e| e.to_string())?;
    if !result.status.success() {
        return Err(output);
    }
    println!(
        "{output}\nSaved to {}",
        logs.join("llama-bench.md").display()
    );
    Ok(())
}

fn output_text(output: &Output) -> String {
    format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    )
    .trim()
    .to_string()
}

fn active(cfg: &VllmConfig) -> Result<bool, String> {
    let result = wsl(cfg, &["systemctl", "--user", "is-active", UNIT])?;
    unit_is_active(&result)
}

fn port_open(port: u16) -> bool {
    TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), Duration::from_millis(500)).is_ok()
}

fn healthy(port: u16) -> bool {
    let Ok(mut stream) =
        TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), Duration::from_millis(500))
    else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    if stream
        .write_all(b"GET /health HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n")
        .is_err()
    {
        return false;
    }
    let mut head = [0; 16];
    matches!(stream.read(&mut head), Ok(n) if n >= 12 && head[9..12] == *b"200")
}

fn running_model(port: u16) -> Option<String> {
    let mut stream =
        TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), Duration::from_secs(1)).ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(3))).ok()?;
    stream
        .write_all(b"GET /v1/models HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .ok()?;
    let mut response = Vec::new();
    stream.read_to_end(&mut response).ok()?;
    let body = response.windows(4).position(|bytes| bytes == b"\r\n\r\n")? + 4;
    let models: serde_json::Value = serde_json::from_slice(&response[body..]).ok()?;
    models
        .get("data")?
        .as_array()?
        .first()?
        .get("id")?
        .as_str()
        .map(str::to_owned)
}

fn start(cfg: &VllmConfig) -> Result<(), String> {
    if !active(cfg)? {
        if port_open(cfg.port) {
            return Err(format!(
                "Port {} is occupied by a process outside {UNIT}; refusing to claim it",
                cfg.port
            ));
        }
        let port = cfg.port.to_string();
        let max_len = cfg.max_model_len.to_string();
        let gpu_memory = cfg.gpu_memory_utilization.to_string();
        let mut args = vec![
            "systemd-run",
            "--user",
            "--unit=llama-webui-vllm",
            "--collect",
            "--property=KillMode=control-group",
            "--setenv=CUDA_DEVICE_ORDER=PCI_BUS_ID",
        ];
        if !cfg.flashinfer_sampler {
            args.push("--setenv=VLLM_USE_FLASHINFER_SAMPLER=0");
        }
        let gpu_env;
        if !cfg.cuda_visible_devices.is_empty() {
            gpu_env = format!("--setenv=CUDA_VISIBLE_DEVICES={}", cfg.cuda_visible_devices);
            args.push(&gpu_env);
        }
        let cuda_env;
        if !cfg.cuda_home.is_empty() {
            cuda_env = format!("--setenv=CUDA_HOME={}", cfg.cuda_home);
            args.push(&cuda_env);
        }
        let path_env;
        if cfg.executable.starts_with('/') {
            let bin_dir = cfg
                .executable
                .rsplit_once('/')
                .map(|(dir, _)| dir)
                .unwrap_or("");
            let cuda_bin = if cfg.cuda_home.is_empty() {
                String::new()
            } else {
                format!("{}/bin:", cfg.cuda_home)
            };
            path_env = format!(
                "--setenv=PATH={bin_dir}:{cuda_bin}/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
            );
            args.push(&path_env);
        }
        args.extend_from_slice(&[
            "--",
            &cfg.executable,
            "serve",
            &cfg.model,
            "--host",
            "127.0.0.1",
            "--port",
            &port,
            "--max-model-len",
            &max_len,
            "--gpu-memory-utilization",
            &gpu_memory,
        ]);
        let result = wsl(cfg, &args)?;
        if !result.status.success() {
            return Err(format!("Could not start {UNIT}: {}", output_text(&result)));
        }
        println!("{}", output_text(&result));
    } else {
        println!("{UNIT} is already active");
    }

    keep_wsl_alive(&cfg.distro, UNIT)?;
    let started = Instant::now();
    while started.elapsed() < START_TIMEOUT {
        if healthy(cfg.port) {
            let served = running_model(cfg.port)
                .ok_or("vLLM health is ready, but /v1/models could not be read")?;
            if served != cfg.model {
                return Err(format!("Running model {served} does not match configured model {}. Stop the service before changing models.", cfg.model));
            }
            println!(
                "vLLM ready at http://127.0.0.1:{}/v1 (model {})",
                cfg.port, cfg.model
            );
            return Ok(());
        }
        if !active(cfg)? {
            let logs = wsl(
                cfg,
                &["journalctl", "--user", "-u", UNIT, "-n", "80", "--no-pager"],
            )?;
            return Err(format!(
                "vLLM stopped during startup:\n{}",
                output_text(&logs)
            ));
        }
        thread::sleep(Duration::from_secs(3));
    }
    Err(format!(
        "vLLM did not become healthy within {} seconds. Run `llama-engine-manager vllm logs`.",
        START_TIMEOUT.as_secs()
    ))
}

fn status(cfg: &VllmConfig) -> Result<(), String> {
    let result = wsl(
        cfg,
        &[
            "systemctl",
            "--user",
            "show",
            UNIT,
            "-p",
            "ActiveState",
            "-p",
            "SubState",
            "-p",
            "ExecMainPID",
            "--no-pager",
        ],
    )?;
    if !result.status.success() {
        return Err(output_text(&result));
    }
    println!(
        "{UNIT} on WSL distro {}\n{}",
        cfg.distro,
        output_text(&result)
    );
    println!(
        "HTTP health: {}",
        if healthy(cfg.port) {
            "ready"
        } else {
            "unavailable"
        }
    );
    println!(
        "Running model: {}",
        running_model(cfg.port).unwrap_or_else(|| "unavailable".into())
    );
    println!("Endpoint: http://127.0.0.1:{}/v1", cfg.port);
    Ok(())
}

fn stop(cfg: &VllmConfig) -> Result<(), String> {
    if !active(cfg)? {
        println!("{UNIT} is not active");
        return Ok(());
    }
    let result = wsl(cfg, &["systemctl", "--user", "stop", UNIT])?;
    if !result.status.success() {
        return Err(format!("Could not stop {UNIT}: {}", output_text(&result)));
    }
    println!("Stopped {UNIT}");
    Ok(())
}

fn logs(cfg: &VllmConfig) -> Result<(), String> {
    let result = wsl(
        cfg,
        &["journalctl", "--user", "-u", UNIT, "-n", "80", "--no-pager"],
    )?;
    if !result.status.success() {
        return Err(output_text(&result));
    }
    println!("{}", output_text(&result));
    Ok(())
}

fn run() -> Result<(), String> {
    let args: Vec<String> = env::args().skip(1).collect();
    let root = root_dir();
    match args.as_slice() {
        [action] if action=="cuda-inventory" => { println!("{}",cuda_inventory::inventory()?);Ok(()) },
        [engine, action] if engine == "vllm" => {
            let cfg = config(&root)?;
            match action.as_str() {
                "start" => start(&cfg),
                "status" => status(&cfg),
                "stop" => stop(&cfg),
                "logs" => logs(&cfg),
                _ => Err("Usage: llama-engine-manager vllm <start|status|stop|logs>".into()),
            }
        }
        [engine, action] if engine == "trtllm" => {
            let cfg = trt_config(&root)?;
            match action.as_str() {
                "installed" => if trt_installed(&cfg)? { println!("TensorRT-LLM installed"); Ok(()) } else { Err("TensorRT-LLM is not installed in WSL2".into()) },
                "start" => trt_start(&cfg),
                "status" => trt_status(&cfg),
                "stop" => trt_stop(&cfg),
                "logs" => trt_logs(&cfg),
                _ => Err("Usage: llama-engine-manager trtllm <installed|start|status|stop|logs>".into()),
            }
        }
        [engine, action] if engine == "bench" => match action.as_str() {
            "installed" => if let Some(path) = bench_exe(&root) { println!("{}", path.display()); Ok(()) } else { Err("llama-bench.exe is missing".into()) },
            "install" => bench_install(&root),
            _ => Err("Usage: llama-engine-manager bench <installed|install|run MODEL>".into()),
        },
        [engine, action, model] if engine == "bench" && action == "run" => bench_run(&root, model, None),
        [engine, action, model, device] if engine == "bench" && action == "run" => bench_run(&root, model, Some(device)),
        _ => Err("Usage: llama-engine-manager vllm|trtllm <start|status|stop|logs>; bench <installed|install|run MODEL>".into()),
    }
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod review_tests {
    use super::*;
    #[test]
    fn absent_units_are_inactive_and_wsl_errors_are_not_hidden() {
        #[cfg(unix)]
        use std::os::unix::process::ExitStatusExt;
        #[cfg(windows)]
        use std::os::windows::process::ExitStatusExt;
        let code = if cfg!(windows) { 4 } else { 4 << 8 };
        let mut output = Output {
            status: std::process::ExitStatus::from_raw(code),
            stdout: b"inactive\n".to_vec(),
            stderr: vec![],
        };
        assert!(!unit_is_active(&output).unwrap());
        output.stdout.clear();
        output.stderr = b"Cannot access WSL distribution".to_vec();
        assert!(unit_is_active(&output).is_err());
    }
    #[test]
    fn tensor_rt_accepts_local_directory_names_but_not_repo_basenames() {
        assert!(trt_model_matches("/models/tiny/", "tiny"));
        assert!(trt_model_matches("/models/tiny", "/models/tiny"));
        assert!(trt_model_matches("org/tiny", "org/tiny"));
        assert!(!trt_model_matches("org/tiny", "tiny"));
        assert!(!trt_model_matches("/models/tiny", "different"));
    }
    #[test]
    fn isolated_benchmark_takes_precedence() {
        let root = env::temp_dir().join(format!(
            "router-bench-review-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let bundled = root.join("portable-data/bin/llama-bench.exe");
        let isolated = root.join("portable-data/bench/bin/llama-bench.exe");
        fs::create_dir_all(bundled.parent().unwrap()).unwrap();
        fs::create_dir_all(isolated.parent().unwrap()).unwrap();
        fs::write(&bundled, "old").unwrap();
        assert_eq!(bench_exe(&root), Some(bundled.clone()));
        fs::write(&isolated, "new").unwrap();
        assert_eq!(bench_exe(&root), Some(isolated.clone()));
        for file in [&bundled, &isolated] {
            fs::remove_file(file).unwrap();
        }
        for dir in [
            "portable-data/bench/bin",
            "portable-data/bench",
            "portable-data/bin",
            "portable-data",
            "",
        ] {
            fs::remove_dir(root.join(dir)).unwrap();
        }
    }
}
