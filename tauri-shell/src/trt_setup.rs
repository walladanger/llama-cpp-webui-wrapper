//! Optional TensorRT setup jobs. All subprocesses are hidden; probes are bounded.
use serde::Serialize;
use serde_json::Value;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const LAUNCHER: &str = "/opt/llama-router/trtllm/bin/trtllm-serve";
const UNIT: &str = "llama-router-trt-install.service";
const TIMEOUT: Duration = Duration::from_secs(7200);
const CHECK_SCRIPT: &str = include_str!("trt-check.sh");
const INSTALL_SCRIPT: &str = include_str!("trt-install.sh");
static JOB: Mutex<Option<Job>> = Mutex::new(None);

struct Job {
    child: Child,
    distro: String,
    root: PathBuf,
    original: Vec<u8>,
    log: PathBuf,
    started: Instant,
    state: String,
    message: String,
    kind: &'static str,
}
#[derive(Debug, Serialize)]
struct Check {
    key: String,
    state: String,
    detail: String,
}
#[derive(Clone, Debug, Serialize)]
struct Distribution {
    name: String,
    version: Option<u8>,
}
#[derive(Serialize)]
struct Checks {
    ready: bool,
    checks: Vec<Check>,
    distributions: Vec<Distribution>,
}
fn distributions(names: &str, verbose: &str) -> Vec<Distribution> {
    let mut result = Vec::new();
    for name in names
        .lines()
        .map(|n| n.trim().trim_start_matches('\u{feff}'))
        .filter(|n| !n.is_empty())
    {
        if name.starts_with('-')
            || name.contains('\0')
            || result.iter().any(|d: &Distribution| d.name == name)
        {
            continue;
        }
        let version = verbose.lines().find_map(|line| {
            let row = line.trim().trim_start_matches('*').trim_start();
            let rest = row.strip_prefix(name)?;
            if !rest.starts_with(char::is_whitespace) {
                return None;
            }
            if names.lines().map(str::trim).any(|other| {
                other.len() > name.len()
                    && row
                        .strip_prefix(other)
                        .is_some_and(|tail| tail.starts_with(char::is_whitespace))
            }) {
                return None;
            }
            rest.split_whitespace()
                .last()?
                .parse::<u8>()
                .ok()
                .filter(|v| [1, 2].contains(v))
        });
        result.push(Distribution {
            name: name.into(),
            version,
        });
    }
    result
}
fn discover() -> Result<Vec<Distribution>, String> {
    let mut list = Command::new("wsl.exe");
    list.args(["--list", "--quiet"]);
    let names = probe(list)?;
    let mut verbose = Command::new("wsl.exe");
    verbose.args(["--list", "--verbose"]);
    Ok(distributions(&names, &probe(verbose).unwrap_or_default()))
}
fn blocked(key: &str, detail: String, distributions: Vec<Distribution>) -> Checks {
    Checks {
        ready: false,
        checks: vec![Check {
            key: key.into(),
            state: "blocked".into(),
            detail,
        }],
        distributions,
    }
}
#[derive(Serialize)]
struct Progress {
    state: String,
    step: usize,
    message: String,
    log: String,
    kind: String,
}

fn config_path(root: &Path) -> PathBuf {
    root.join("portable-data/config/trtllm.json")
}
fn config(root: &Path) -> Result<(Value, Vec<u8>, String), String> {
    let bytes =
        fs::read(config_path(root)).map_err(|e| format!("Cannot read TensorRT settings: {e}"))?;
    let value: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    let distro = value["distro"]
        .as_str()
        .filter(|s| !s.trim().is_empty() && !s.starts_with('-') && !s.contains(['\n', '\r', '\0']))
        .ok_or("Choose a valid WSL distribution under Advanced")?
        .to_owned();
    Ok((value, bytes, distro))
}
fn wsl(distro: &str) -> Command {
    let mut cmd = Command::new("wsl.exe");
    cmd.args(["--distribution", distro]);
    crate::no_console(&mut cmd);
    cmd
}
fn probe(cmd: Command) -> Result<String, String> {
    let out = crate::process_probe::capture_wsl(cmd, Duration::from_secs(45), 65536)?;
    if out.success {
        Ok(out.stdout.trim().to_owned())
    } else {
        Err(format!("{}{}", out.stdout, out.stderr).trim().to_owned())
    }
}
fn parse_checks(text: &str) -> Vec<Check> {
    text.lines()
        .filter_map(|line| {
            let rest = line.strip_prefix("ROUTER_CHECK|")?;
            let mut parts = rest.splitn(3, '|');
            Some(Check {
                key: parts.next()?.into(),
                state: parts.next()?.into(),
                detail: parts.next()?.into(),
            })
        })
        .filter(|c| {
            !c.key.is_empty()
                && !c.detail.is_empty()
                && ["pass", "warning", "blocked"].contains(&c.state.as_str())
        })
        .collect()
}
fn check(root: &Path) -> Result<Checks, String> {
    let (_, _, distro) = config(root)?;
    let found = match discover() {
        Ok(found) => found,
        Err(error) => return Ok(blocked("wsl_access", format!("Windows could not inspect WSL. Open WSL or Docker Desktop, resolve any access/update message, then Check again. Existing installations have not been assumed missing. {error}"), vec![])),
    };
    let Some(selected) = found.iter().find(|d| d.name == distro) else {
        return Ok(if found.is_empty() {
            blocked("wsl_install", "No Linux distribution was found. Install WSL + Ubuntu, finish Ubuntu's first launch, then Check again.".into(), found)
        } else {
            blocked("wsl_select", format!("The selected installation {distro} was not found. Choose one of your existing Linux installations below."), found)
        });
    };
    if selected.version == Some(1) {
        return Ok(blocked("wsl_conversion", format!("{distro} uses WSL 1. TensorRT-LLM needs WSL 2. Convert this installation in WSL or use another WSL 2 installation, then Check again."), found));
    }
    let mut cmd = wsl(&distro);
    cmd.args(["--exec", "bash", "-c", CHECK_SCRIPT]);
    match probe(cmd) {
        Ok(text) => {
            let mut checks = parse_checks(&text);
            let required = ["wsl", "linux", "services", "gpu", "disk", "account"];
            if required.iter().any(|key| !checks.iter().any(|c| c.key == *key)) {
                checks.push(Check {key:"wsl_probe".into(),state:"blocked".into(),detail:"The prerequisite check returned incomplete results. Open this Linux installation, resolve any startup messages, then Check again.".into()});
            }
            let ready = required.iter().all(|key| checks.iter().any(|c| c.key == *key && c.state == "pass")) && !checks.iter().any(|c| c.state == "blocked");
            Ok(Checks { ready, checks, distributions:found })
        }
        Err(error) => Ok(blocked("wsl_start", format!("{distro} is installed but could not run the prerequisite check. Open Ubuntu to finish startup or first-launch setup, then Check again. {error}"), found)),
    }
}
fn read_tail(path: &Path) -> String {
    let Ok(mut file) = File::open(path) else {
        return String::new();
    };
    let size = file.metadata().map(|m| m.len()).unwrap_or(0);
    let _ = file.seek(SeekFrom::Start(size.saturating_sub(24576)));
    let mut bytes = Vec::new();
    let _ = file.take(24576).read_to_end(&mut bytes);
    String::from_utf8_lossy(&bytes).replace('\0', "")
}
fn last_step(log: &str) -> (usize, String) {
    log.lines()
        .rev()
        .find_map(|line| {
            let rest = line.strip_prefix("ROUTER_STEP:")?;
            let (n, message) = rest.split_once(':')?;
            Some((n.parse::<usize>().ok()?.min(6), message.to_owned()))
        })
        .unwrap_or((0, "Preparing setup…".into()))
}
fn activate(root: &Path, original: &[u8]) -> Result<(), String> {
    let cfg = config_path(root);
    if fs::read(&cfg).map_err(|e| e.to_string())? != original {
        return Err(format!("Installation succeeded, but settings changed during setup. Set Executable under Advanced to {LAUNCHER}."));
    }
    let mut value: Value = serde_json::from_slice(original).map_err(|e| e.to_string())?;
    value["executable"] = LAUNCHER.into();
    let temp = cfg.with_extension("trt-install.tmp");
    fs::write(
        &temp,
        serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    // Same-directory rename replaces the configuration only after verification.
    fs::rename(temp, cfg)
        .map_err(|e| format!("Runtime installed; could not save launcher path: {e}"))
}
fn stop_unit(distro: &str) -> Result<(), String> {
    let mut cmd = wsl(distro);
    cmd.args(["--user", "root", "--exec", "systemctl", "stop", UNIT]);
    probe(cmd).map(|_| ())
}
fn update(job: &mut Job) -> Result<Progress, String> {
    if job.state == "running" {
        if let Some(exit) = job.child.try_wait().map_err(|e| e.to_string())? {
            if exit.success() && job.kind == "runtime" {
                match activate(&job.root, &job.original) {
                    Ok(()) => {
                        job.state = "complete".into();
                        job.message =
                            "TensorRT-LLM installed. Choose Start to download and load the model."
                                .into();
                    }
                    Err(error) => {
                        job.state = "error".into();
                        job.message = error;
                    }
                }
            } else if exit.success() {
                job.state = "complete".into();
                job.message = "WSL setup finished. Restart Windows if requested, open Ubuntu once to finish setup, then Check again.".into();
            } else {
                job.state = "error".into();
                job.message = "Setup could not finish. Review the details below, resolve the last error, then retry.".into();
            }
        } else if job.started.elapsed() > TIMEOUT {
            if job.kind == "runtime" {
                stop_unit(&job.distro)?;
            }
            let _ = job.child.kill();
            let _ = job.child.wait();
            job.state = "error".into();
            job.message = "Setup exceeded two hours and was stopped. Check your connection and disk space, then retry.".into();
        }
    }
    let log = read_tail(&job.log);
    let (step, detail) = last_step(&log);
    Ok(Progress {
        state: job.state.clone(),
        step,
        message: if job.state == "running" && job.kind == "runtime" {
            detail
        } else {
            job.message.clone()
        },
        log,
        kind: job.kind.into(),
    })
}
pub fn running() -> bool {
    JOB.lock()
        .map(|mut guard| {
            guard
                .as_mut()
                .is_some_and(|j| update(j).map(|p| p.state == "running").unwrap_or(true))
        })
        .unwrap_or(true)
}
pub fn call(root: &Path, action: &str) -> Result<String, String> {
    if action == "setup-check" {
        return serde_json::to_string(&check(root)?).map_err(|e| e.to_string());
    }
    if action == "open-ubuntu" {
        let (_, _, distro) = config(root)?;
        // This console is deliberately interactive: Ubuntu may need first-run account setup.
        let mut cmd = Command::new("wsl.exe");
        cmd.args(["--distribution", &distro]);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x00000010);
        }
        cmd.spawn().map_err(|e| e.to_string())?;
        return Ok("Ubuntu opened. Finish its first launch, then check again.".into());
    }
    let mut guard = JOB.lock().map_err(|e| e.to_string())?;
    if let Some(job) = guard.as_mut() {
        let progress = update(job)?;
        if action == "install-status" {
            return serde_json::to_string(&progress).map_err(|e| e.to_string());
        }
        if action == "install-cancel" && progress.state == "running" {
            if job.kind != "runtime" {
                return Err("Finish or cancel the Windows setup dialog first.".into());
            }
            stop_unit(&job.distro)?;
            let _ = job.child.kill();
            let _ = job.child.wait();
            job.state = "cancelled".into();
            job.message =
                "Installation stopped. Downloaded layers and models are retained; you can retry."
                    .into();
            return serde_json::to_string(&update(job)?).map_err(|e| e.to_string());
        }
        if progress.state == "running" {
            return Err("Setup is already running. Wait for it to finish.".into());
        }
    }
    if action == "install-status" {
        return Ok(r#"{"state":"idle","step":0,"message":"","log":"","kind":"runtime"}"#.into());
    }
    if action == "install-cancel" {
        return Err("No installation is running".into());
    }
    let (_, original, distro) = config(root)?;
    let log = root.join("portable-data/logs/trtllm-install.log");
    fs::create_dir_all(log.parent().unwrap()).map_err(|e| e.to_string())?;
    if action == "install" {
        let checks = check(root)?;
        if !checks.ready {
            return Err("Prerequisites need attention. Choose Check again and follow the highlighted steps.".into());
        }
        let mut user_cmd = wsl(&distro);
        user_cmd.args(["--exec", "id", "-un"]);
        let user = probe(user_cmd)?;
        if !user
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "_-".contains(c))
            || user.is_empty()
        {
            return Err("Cannot identify the Linux account".into());
        }
        let mut cmd = wsl(&distro);
        cmd.args([
            "--user",
            "root",
            "--exec",
            "systemd-run",
            "--unit=llama-router-trt-install",
            "--collect",
            "--wait",
            "--pipe",
            "--property=KillMode=control-group",
            "--property=RuntimeMaxSec=7200",
            "/bin/bash",
            "-s",
            "--",
            &user,
        ]);
        let output = File::create(&log).map_err(|e| e.to_string())?;
        cmd.stdin(Stdio::piped())
            .stdout(output.try_clone().map_err(|e| e.to_string())?)
            .stderr(output);
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Could not start setup: {e}"))?;
        if let Err(error) = child
            .stdin
            .take()
            .ok_or("Missing installer input")?
            .write_all(INSTALL_SCRIPT.as_bytes())
        {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error.to_string());
        }
        *guard = Some(Job {
            child,
            distro,
            root: root.into(),
            original,
            log,
            started: Instant::now(),
            state: "running".into(),
            message: "Preparing setup…".into(),
            kind: "runtime",
        });
    } else if action == "install-wsl" {
        // Fixed arguments only; RunAs lets Windows own its normal elevation/restart flow.
        let mut cmd = Command::new("powershell.exe");
        cmd.args(["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; $p=Start-Process wsl.exe -Verb RunAs -WindowStyle Hidden -ArgumentList '--install','--distribution','Ubuntu-24.04','--no-launch' -Wait -PassThru; if ($p.ExitCode -notin @(0,3010)) { throw ('WSL installer exited with code '+$p.ExitCode) }; Write-Output 'WSL installation finished. Restart Windows if requested. Open Ubuntu to complete first launch.'"]);
        crate::no_console(&mut cmd);
        let output = File::create(&log).map_err(|e| e.to_string())?;
        cmd.stdin(Stdio::null())
            .stdout(output.try_clone().map_err(|e| e.to_string())?)
            .stderr(output);
        let child = cmd.spawn().map_err(|e| e.to_string())?;
        *guard = Some(Job { child, distro, root: root.into(), original, log, started: Instant::now(), state: "running".into(), message: "Installing WSL and Ubuntu 24.04. Accept the Windows administrator prompt if it appears.".into(), kind: "wsl" });
    } else {
        return Err("Unsupported setup action".into());
    }
    serde_json::to_string(&update(guard.as_mut().unwrap())?).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn existing_distributions_keep_spaces_unicode_and_versions() {
        let found = distributions(
            "Ubuntu\r\nUbuntu 日本語\r\nUbuntu\r\n",
            "NAME STATE VERSION\n* Ubuntu Running 2\n  Ubuntu 日本語 Stopped 1\n",
        );
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].version, Some(2));
        assert_eq!(found[1].name, "Ubuntu 日本語");
        assert_eq!(found[1].version, Some(1));
        assert!(parse_checks("ROUTER_CHECK|||\nROUTER_CHECK|gpu|unknown|n/a\n").is_empty());
    }
    #[test]
    #[ignore = "Read-only live WSL prerequisite check; starts the selected distribution"]
    fn live_wsl_prerequisites() {
        let dir = std::env::temp_dir().join(format!("router-wsl-readonly-{}", std::process::id()));
        fs::create_dir_all(dir.join("portable-data/config")).unwrap();
        fs::write(config_path(&dir),br#"{"distro":"Ubuntu","executable":"trtllm-serve","model":"TinyLlama/TinyLlama-1.1B-Chat-v1.0","port":8001}"#).unwrap();
        let literal = "model $HOME $(printf WRONG) with spaces";
        let mut literal_cmd = wsl("Ubuntu");
        literal_cmd.args(["--exec", "/usr/bin/printf", "%s", literal]);
        assert_eq!(probe(literal_cmd).unwrap(), literal);
        let evidence = check(&dir).unwrap();
        println!("{}", serde_json::to_string_pretty(&evidence).unwrap());
        assert!(evidence.distributions.iter().any(|d| d.name == "Ubuntu"));
        assert!(evidence
            .checks
            .iter()
            .any(|c| c.key == "docker" && c.state == "pass"));
        assert!(
            evidence.ready,
            "Prerequisites need attention; inspect the evidence above"
        );
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn progress_uses_last_marker_not_download_percent() {
        assert_eq!(
            last_step("ROUTER_STEP:2:Toolkit\n99%\nROUTER_STEP:3:Downloading\n"),
            (3, "Downloading".into())
        );
        assert_eq!(
            last_step("ROUTER_STEP:bad:no\n"),
            (0, "Preparing setup…".into())
        );
    }
    #[test]
    fn checks_keep_blockers_and_gpu_caveats() {
        let rows = parse_checks("noise\nROUTER_CHECK|gpu|pass|RTX 3090\nROUTER_CHECK|disk|blocked|Free 40 GB\nROUTER_CHECK|compatibility|warning|Model dependent\n");
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[1].state, "blocked");
        assert_eq!(rows[2].state, "warning");
    }
    #[test]
    fn activation_preserves_settings_and_rejects_concurrent_edits() {
        let dir =
            std::env::temp_dir().join(format!("router-trt-activation-{}", std::process::id()));
        fs::create_dir_all(dir.join("portable-data/config")).unwrap();
        let original = br#"{"distro":"Ubuntu","executable":"custom","model":"user/model","port":9010,"cuda_visible_devices":"2,1","extension":true}"#;
        fs::write(config_path(&dir), original).unwrap();
        activate(&dir, original).unwrap();
        let saved: Value = serde_json::from_slice(&fs::read(config_path(&dir)).unwrap()).unwrap();
        assert_eq!(saved["executable"], LAUNCHER);
        assert_eq!(saved["port"], 9010);
        assert_eq!(saved["model"], "user/model");
        assert_eq!(saved["cuda_visible_devices"], "2,1");
        assert_eq!(saved["extension"], true);
        assert!(activate(&dir, original)
            .unwrap_err()
            .contains("settings changed"));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn job_fixture() {
        match std::env::var("ROUTER_TRT_FIXTURE").as_deref() {
            Ok("fail") => std::process::exit(7),
            Ok("success") => (),
            _ => (),
        }
    }
    #[test]
    fn failed_install_never_activates_and_success_waits_for_exit() {
        for mode in ["fail", "success"] {
            let dir =
                std::env::temp_dir().join(format!("router-trt-job-{}-{mode}", std::process::id()));
            fs::create_dir_all(dir.join("portable-data/config")).unwrap();
            let original =
                br#"{"distro":"Ubuntu","executable":"original","model":"user/model","port":8001}"#
                    .to_vec();
            fs::write(config_path(&dir), &original).unwrap();
            let log = dir.join("setup.log");
            fs::write(&log, "ROUTER_STEP:4:Verifying runtime\n").unwrap();
            let child = Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "trt_setup::tests::job_fixture"])
                .env("ROUTER_TRT_FIXTURE", mode)
                .stdout(Stdio::null())
                .spawn()
                .unwrap();
            let mut job = Job {
                child,
                distro: "Ubuntu".into(),
                root: dir.clone(),
                original: original.clone(),
                log,
                started: Instant::now(),
                state: "running".into(),
                message: "".into(),
                kind: "runtime",
            };
            job.child.wait().unwrap();
            let result = update(&mut job).unwrap();
            assert_eq!(
                result.state,
                if mode == "success" {
                    "complete"
                } else {
                    "error"
                }
            );
            assert_eq!(result.step, 4);
            let cfg: Value = serde_json::from_slice(&fs::read(config_path(&dir)).unwrap()).unwrap();
            assert_eq!(
                cfg["executable"],
                if mode == "success" {
                    LAUNCHER
                } else {
                    "original"
                }
            );
            assert_eq!(update(&mut job).unwrap().state, result.state);
            fs::remove_dir_all(dir).unwrap();
        }
    }
}
