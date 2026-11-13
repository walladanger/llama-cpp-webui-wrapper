//! Reproducible, local-only benchmarks. These never edit the serving profile.
use crate::{gpu, local_files, process_probe, settings};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Default)]
pub struct Control {
    pub running: AtomicBool,
    pub cancel: AtomicBool,
    pub stage: Mutex<String>,
}
pub type Shared = Arc<Control>;

fn executable(root: &Path) -> Result<PathBuf, String> {
    [
        "portable-data/bin/llama-bench.exe",
        "portable-data/bench/bin/llama-bench.exe",
    ]
    .iter()
    .map(|p| root.join(p))
    .find(|p| p.is_file())
    .ok_or_else(|| "llama-bench is missing. Download it first.".into())
}
fn environment(root: &Path) -> Result<std::collections::HashMap<String, String>, String> {
    let s = settings::Settings::load(&root.join("portable-data/config/llama-server.json"))?;
    settings::child_environment(&s)
}
fn command(exe: &Path, root: &Path) -> Result<Command, String> {
    let mut cmd = Command::new(exe);
    cmd.current_dir(exe.parent().unwrap_or(root))
        .env_clear()
        .envs(environment(root)?);
    Ok(cmd)
}

pub fn scan(root: &Path) -> Result<Value, String> {
    let mut issues = Vec::<String>::new();
    let cards = match gpu::inventory() {
        Ok(cards) => serde_json::to_value(cards).unwrap_or(json!([])),
        Err(e) => {
            issues.push(e);
            json!([])
        }
    };
    let mut devices = Vec::new();
    let mut help = String::new();
    if let Ok(exe) = executable(root) {
        for flag in ["--list-devices", "--help"] {
            let mut probe = command(&exe, root)?;
            probe.arg(flag);
            match process_probe::capture(probe, Duration::from_secs(20), 512 * 1024) {
                Ok(out) if out.success => {
                    let text = format!("{}\n{}", out.stdout, out.stderr);
                    if flag == "--help" {
                        help = text;
                    } else {
                        for line in text.lines() {
                            if let Some((id, rest)) = line.trim().split_once(':') {
                                if id.chars().all(|c| c.is_ascii_alphanumeric())
                                    && id.ends_with(|c: char| c.is_ascii_digit())
                                    && rest.contains("MiB")
                                {
                                    devices.push(json!({"id": id, "description": rest.trim()}));
                                }
                            }
                        }
                    }
                }
                Ok(_) => issues.push(format!("Runtime inspection {flag} failed")),
                Err(e) => issues.push(e),
            }
        }
    } else {
        issues.push("llama-bench is not installed".into());
    }
    let mut sys = Command::new("powershell.exe");
    sys.args(["-NoProfile", "-NonInteractive", "-Command", "$computerInfo=Get-CimInstance Win32_ComputerSystem; $cpuInfo=Get-CimInstance Win32_Processor | Select-Object -First 1; $osInfo=Get-CimInstance Win32_OperatingSystem; @{cpu=$cpuInfo.Name; logicalProcessors=$computerInfo.NumberOfLogicalProcessors; ramBytes=$computerInfo.TotalPhysicalMemory; freeRamKiB=$osInfo.FreePhysicalMemory; os=$osInfo.Caption} | ConvertTo-Json -Compress"]);
    let system = match process_probe::capture(sys, Duration::from_secs(15), 64 * 1024) {
        Ok(out) if out.success => {
            serde_json::from_str::<Value>(out.stdout.trim()).unwrap_or(Value::Null)
        }
        _ => {
            issues.push("CPU / RAM inventory unavailable".into());
            Value::Null
        }
    };
    Ok(
        json!({"system": system, "cards": cards, "devices": devices, "telemetry": telemetry(),
        "supportsDeep": (["--n-depth", "--split-mode", "--device"].iter().all(|f| help.contains(f))),
        "issues": issues, "capturedAt": now(),
        "scope": "Read-only snapshots. Not peak readings, a PSU/UPS test, or a thermal stress test."}),
    )
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn numeric(value: &str) -> Value {
    value
        .trim()
        .parse::<f64>()
        .ok()
        .filter(|v| v.is_finite() && *v >= 0.0)
        .map_or(Value::Null, |v| json!(v))
}
fn telemetry() -> Value {
    let mut cmd = Command::new("nvidia-smi");
    cmd.args(["--query-gpu=uuid,name,memory.total,memory.free,utilization.gpu,temperature.gpu,power.draw,power.limit,clocks.sm,pcie.link.gen.current,pcie.link.width.current", "--format=csv,noheader,nounits"]);
    match process_probe::capture(cmd, Duration::from_secs(5), 64 * 1024) {
        Ok(out) if out.success => json!(out.stdout.lines().filter_map(|l| {
            let f: Vec<_> = l.split(',').map(str::trim).collect();
            if f.len() != 11 || !f[0].starts_with("GPU-") { return None; }
            Some(json!({"uuid": f[0], "name": f[1], "totalMiB": numeric(f[2]), "freeMiB": numeric(f[3]),
                "utilization": numeric(f[4]), "temperature": numeric(f[5]), "powerW": numeric(f[6]),
                "powerLimitW": numeric(f[7]), "clockMHz": numeric(f[8]), "pcieGen": numeric(f[9]), "pcieWidth": numeric(f[10])}))
        }).collect::<Vec<_>>()),
        _ => Value::Null,
    }
}
fn digest(file: &Path, control: &Control) -> Result<String, String> {
    let mut input = File::open(file).map_err(|e| e.to_string())?;
    let before = input.metadata().map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut bytes = vec![0; 1024 * 1024];
    loop {
        if control.cancel.load(Ordering::SeqCst) {
            return Err("Benchmark cancelled".into());
        }
        let len = input.read(&mut bytes).map_err(|e| e.to_string())?;
        if len == 0 {
            break;
        }
        hasher.update(&bytes[..len]);
    }
    let after = fs::metadata(file).map_err(|e| e.to_string())?;
    if before.len() != after.len() || before.modified().ok() != after.modified().ok() {
        return Err(
            "A benchmark input changed while being fingerprinted; rerun when downloads finish"
                .into(),
        );
    }
    Ok(format!("{:x}", hasher.finalize()))
}
fn model_parts(model: &Path) -> Result<Vec<PathBuf>, String> {
    let name = model
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Invalid model filename")?;
    if let Some((prefix, suffix)) = name.rsplit_once("-00001-of-") {
        let count: usize = suffix
            .strip_suffix(".gguf")
            .ok_or("Invalid GGUF shard")?
            .parse()
            .map_err(|_| "Invalid GGUF shard count")?;
        if !(1..=999).contains(&count) {
            return Err("Invalid GGUF shard count".into());
        }
        return Ok((1..=count)
            .map(|i| model.with_file_name(format!("{prefix}-{i:05}-of-{count:05}.gguf")))
            .collect());
    }
    if name.contains("-of-") {
        return Err("Select the first GGUF shard (-00001-of-...)".into());
    }
    Ok(vec![model.to_path_buf()])
}
fn fingerprints(files: &[PathBuf], control: &Control) -> Result<Value, String> {
    files.iter().map(|p| Ok(json!({"file": p.file_name().unwrap_or_default().to_string_lossy(), "sha256": digest(p, control)?}))).collect::<Result<Vec<_>, String>>().map(|v| json!(v))
}

#[derive(Clone, Debug)]
struct Test {
    label: String,
    device: String,
    split: &'static str,
    prompt: u32,
    generation: u32,
    depth: u32,
}
fn plan(mode: &str, device: &str, compare: bool, scan: &Value) -> Result<Vec<Test>, String> {
    if !["quick", "deep"].contains(&mode) {
        return Err("Choose quick or deep benchmark".into());
    }
    let devices = scan["devices"]
        .as_array()
        .ok_or("Device inventory unavailable")?;
    if !devices.iter().any(|d| d["id"] == device) {
        return Err("Choose a detected runtime device".into());
    }
    let make = |label: &str, dev: String, split, prompt, generation, depth| Test {
        label: label.into(),
        device: dev,
        split,
        prompt,
        generation,
        depth,
    };
    let mut tests = vec![make(
        "One device · short prompt",
        device.into(),
        "none",
        512,
        128,
        0,
    )];
    if mode == "deep" {
        if scan["supportsDeep"] != true {
            return Err("This runtime does not advertise the deeper benchmark options".into());
        }
        tests.push(make(
            "One device · 4K input",
            device.into(),
            "none",
            4096,
            0,
            0,
        ));
        tests.push(make(
            "One device · generation after 4K context",
            device.into(),
            "none",
            0,
            128,
            4096,
        ));
        if compare {
            let ids: Vec<_> = devices
                .iter()
                .filter_map(|d| d["id"].as_str())
                .filter(|id| id.starts_with("CUDA"))
                .collect();
            if !device.starts_with("CUDA") || ids.len() < 2 {
                return Err("GPU comparison requires at least two detected CUDA devices".into());
            }
            let joined = ids.join("/");
            tests.push(make(
                "All visible CUDA GPUs · short prompt",
                joined.clone(),
                "layer",
                512,
                128,
                0,
            ));
            tests.push(make(
                "All visible CUDA GPUs · generation after 4K context",
                joined,
                "layer",
                0,
                128,
                4096,
            ));
        }
    }
    Ok(tests)
}
fn args(test: &Test, model: &Path) -> Vec<String> {
    [
        "-m".into(),
        model.to_string_lossy().into_owned(),
        "-p".into(),
        test.prompt.to_string(),
        "-n".into(),
        test.generation.to_string(),
        "-d".into(),
        test.depth.to_string(),
        "-r".into(),
        "5".into(),
        "-o".into(),
        "json".into(),
        "-ngl".into(),
        "-1".into(),
        "-b".into(),
        "2048".into(),
        "-ub".into(),
        "512".into(),
        "-ctk".into(),
        "f16".into(),
        "-ctv".into(),
        "f16".into(),
        "-fa".into(),
        "auto".into(),
        "-sm".into(),
        test.split.into(),
        "-dev".into(),
        test.device.clone(),
    ]
    .into()
}

pub fn run(
    root: &Path,
    model: &str,
    device: &str,
    mode: &str,
    compare: bool,
    control: &Control,
) -> Result<Value, String> {
    let model = fs::canonicalize(model).map_err(|e| e.to_string())?;
    if !local_files::model_files(root)?
        .iter()
        .any(|p| fs::canonicalize(p).ok().as_ref() == Some(&model))
    {
        return Err("Choose a listed GGUF model".into());
    }
    *control.stage.lock().unwrap() = "Inspecting hardware and runtime".into();
    let snapshot = scan(root)?;
    let tests = plan(mode, device, compare, &snapshot)?;
    let exe = executable(root)?;
    let child_env = environment(root)?;
    let mut env_pairs: Vec<_> = child_env.iter().collect();
    env_pairs.sort_by(|a, b| a.0.cmp(b.0));
    let env_fingerprint = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&env_pairs).map_err(|e| e.to_string())?)
    );
    *control.stage.lock().unwrap() =
        "Fingerprinting model and runtime (large files can take a minute)".into();
    let model_files = model_parts(&model)?;
    let model_hashes = fingerprints(&model_files, control)?;
    let mut runtime_files: Vec<_> = fs::read_dir(exe.parent().unwrap())
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|s| s.eq_ignore_ascii_case("dll")))
        .collect();
    runtime_files.push(exe.clone());
    runtime_files.sort();
    let runtime_hashes = fingerprints(&runtime_files, control)?;
    let id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
        .to_string();
    let mut report = json!({"schemaVersion": 1, "id": id, "createdAt": now(), "mode": mode, "model": model.file_name().unwrap().to_string_lossy(),
        "modelFiles": model_hashes, "runtimeFiles": runtime_hashes, "hardware": snapshot, "repetitions": 5,
        "environment": {"fingerprint": env_fingerprint, "p2p": child_env.get("GGML_CUDA_P2P"), "cudaVisibility": child_env.get("CUDA_VISIBLE_DEVICES")},
        "results": [], "status": "complete", "error": Value::Null,
        "limitations": "Synthetic inference throughput; excludes model loading, tokenization, sampling and server queueing. No measured TTFT, answer-quality score, global percentile, or power/thermal diagnosis."});
    for (index, test) in tests.iter().enumerate() {
        *control.stage.lock().unwrap() = format!(
            "Test {} / {}: {} (5 repeats)",
            index + 1,
            tests.len(),
            test.label
        );
        let arguments = args(test, &model);
        let mut cmd = Command::new(&exe);
        cmd.current_dir(exe.parent().unwrap_or(root))
            .env_clear()
            .envs(&child_env)
            .args(&arguments);
        let result = process_probe::capture_cancellable(
            cmd,
            Duration::from_secs(600),
            512 * 1024,
            &control.cancel,
        );
        let entry = match result {
            Ok(out) => {
                let parsed = serde_json::from_str::<Value>(out.stdout.trim());
                match parsed {
                    Ok(rows)
                        if out.success
                            && rows.as_array().is_some_and(|a| {
                                !a.is_empty()
                                    && a.iter().all(|r| {
                                        r["avg_ts"]
                                            .as_f64()
                                            .is_some_and(|x| x.is_finite() && x > 0.0)
                                    })
                            }) =>
                    {
                        json!({"label": test.label, "rows": rows, "stderr": out.stderr, "args": &arguments[2..], "telemetryAfter": telemetry()})
                    }
                    _ => {
                        report["status"] = json!("failed");
                        report["error"] = json!("Test failed or returned invalid JSON. See raw evidence; reduce the workload or free memory before retrying.");
                        json!({"label": test.label, "rows": [], "stdout": out.stdout, "stderr": out.stderr, "args": &arguments[2..]})
                    }
                }
            }
            Err(e) => {
                report["status"] = json!(if control.cancel.load(Ordering::SeqCst) {
                    "cancelled"
                } else {
                    "failed"
                });
                report["error"] = json!(e);
                json!({"label": test.label, "rows": [], "args": &arguments[2..]})
            }
        };
        report["results"].as_array_mut().unwrap().push(entry);
        if report["status"] != "complete" {
            break;
        }
    }
    let logs = local_files::logs_dir(root)?.join("benchmarks");
    fs::create_dir_all(&logs).map_err(|e| e.to_string())?;
    let bytes = serde_json::to_vec_pretty(&report).map_err(|e| e.to_string())?;
    let mut output = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(logs.join(format!("{id}.json")))
        .map_err(|e| e.to_string())?;
    output
        .write_all(&bytes)
        .and_then(|_| output.sync_all())
        .map_err(|e| e.to_string())?;
    Ok(report)
}
pub fn history(root: &Path) -> Result<Value, String> {
    let dir = local_files::logs_dir(root)?.join("benchmarks");
    if !dir.exists() {
        return Ok(json!([]));
    }
    let mut files: Vec<_> = fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|s| s == "json"))
        .collect();
    files.sort();
    files.reverse();
    Ok(json!(files
        .iter()
        .take(20)
        .filter_map(|p| {
            if fs::metadata(p).ok()?.len() > 8 * 1024 * 1024 {
                return None;
            }
            let report = serde_json::from_slice::<Value>(&fs::read(p).ok()?).ok()?;
            if report["schemaVersion"] != 1
                || report["id"].as_str().is_none()
                || report["model"].as_str().is_none()
                || report["createdAt"].as_u64().is_none()
                || !report["results"].as_array().is_some_and(|results| {
                    results
                        .iter()
                        .all(|r| r["label"].as_str().is_some() && r["rows"].is_array())
                })
            {
                return None;
            }
            Some(report)
        })
        .collect::<Vec<_>>()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "Opt-in live CUDA smoke test; requires ROUTER_BENCH_SMOKE_ROOT"]
    fn live_cuda_smoke() {
        let root = PathBuf::from(std::env::var("ROUTER_BENCH_SMOKE_ROOT").unwrap());
        let model = root.join("portable-data/models/qwen2.5-0.5b-instruct-q4_k_m.gguf");
        let report = run(
            &root,
            model.to_str().unwrap(),
            "CUDA0",
            "deep",
            true,
            &Control::default(),
        )
        .unwrap();
        assert_eq!(report["status"], "complete", "{report}");
        assert_eq!(report["results"].as_array().unwrap().len(), 5);
        assert!(history(&root)
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r["id"] == report["id"]));
        println!("smoke report {}", report["id"]);
    }
    #[test]
    fn plans_have_controlled_placement_and_matched_contexts() {
        let snapshot = json!({"devices": [{"id":"CUDA0"},{"id":"CUDA1"}],"supportsDeep":true});
        let tests = plan("deep", "CUDA1", true, &snapshot).unwrap();
        assert_eq!(tests.len(), 5);
        assert_eq!(tests[0].device, "CUDA1");
        assert_eq!(tests[0].split, "none");
        assert_eq!(tests[3].device, "CUDA0/CUDA1");
        assert_eq!(tests[3].split, "layer");
        assert_eq!(tests[2].depth, tests[4].depth);
        assert!(plan("deep", "CUDA9", false, &snapshot).is_err());
        assert!(plan(
            "deep",
            "CUDA0",
            true,
            &json!({"devices":[{"id":"CUDA0"}],"supportsDeep":true})
        )
        .is_err());
    }
    #[test]
    fn missing_telemetry_stays_unknown_and_shards_are_complete() {
        assert_eq!(numeric("[N/A]"), Value::Null);
        assert_eq!(numeric("NaN"), Value::Null);
        assert_eq!(numeric("0"), json!(0.0));
        assert_eq!(
            model_parts(Path::new("m-00001-of-00002.gguf"))
                .unwrap()
                .len(),
            2
        );
        assert!(model_parts(Path::new("m-00002-of-00002.gguf")).is_err());
    }
}
