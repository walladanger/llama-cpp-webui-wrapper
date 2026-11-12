//! Bounded, hidden subprocess capture for runtime inspection.
use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
#[derive(Debug)]
pub struct ProbeOutput {
    pub stdout: String,
    pub stderr: String,
    pub success: bool,
}

pub fn capture(command: Command, timeout: Duration, limit: usize) -> Result<ProbeOutput, String> {
    capture_cancellable(
        command,
        timeout,
        limit,
        &std::sync::atomic::AtomicBool::new(false),
    )
}

pub fn capture_cancellable(
    command: Command,
    timeout: Duration,
    limit: usize,
    cancel: &std::sync::atomic::AtomicBool,
) -> Result<ProbeOutput, String> {
    capture_inner(command, timeout, limit, cancel, |bytes| {
        String::from_utf8_lossy(bytes).into_owned()
    })
}

/// WSL's Windows CLI can emit UTF-16 while Linux commands emit UTF-8.
pub fn capture_wsl(
    command: Command,
    timeout: Duration,
    limit: usize,
) -> Result<ProbeOutput, String> {
    capture_inner(
        command,
        timeout,
        limit,
        &std::sync::atomic::AtomicBool::new(false),
        decode_wsl,
    )
}
fn decode_wsl(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xff, 0xfe]) || bytes.contains(&0) {
        let body = bytes.strip_prefix(&[0xff, 0xfe]).unwrap_or(bytes);
        let units: Vec<u16> = body
            .chunks_exact(2)
            .map(|b| u16::from_le_bytes([b[0], b[1]]))
            .collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(bytes)
            .trim_start_matches('\u{feff}')
            .to_owned()
    }
}
fn capture_inner(
    mut command: Command,
    timeout: Duration,
    limit: usize,
    cancel: &std::sync::atomic::AtomicBool,
    decode: fn(&[u8]) -> String,
) -> Result<ProbeOutput, String> {
    if cancel.load(std::sync::atomic::Ordering::SeqCst) {
        return Err("Benchmark cancelled".into());
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::no_console(&mut command);
    let mut child = command
        .spawn()
        .map_err(|e| format!("Probe could not start: {e}"))?;
    let (tx, rx) = std::sync::mpsc::channel();
    let read_pipe =
        |mut pipe: Box<dyn Read + Send>,
         stderr: bool,
         tx: std::sync::mpsc::Sender<(bool, Result<Vec<u8>, String>)>| {
            std::thread::spawn(move || {
                let mut bytes = Vec::new();
                let result = pipe
                    .by_ref()
                    .take(limit as u64 + 1)
                    .read_to_end(&mut bytes)
                    .map_err(|e| e.to_string())
                    .and_then(|_| {
                        if bytes.len() > limit {
                            Err("Probe output limit exceeded".into())
                        } else {
                            Ok(bytes)
                        }
                    });
                let _ = tx.send((stderr, result));
            });
        };
    read_pipe(Box::new(child.stdout.take().unwrap()), false, tx.clone());
    read_pipe(Box::new(child.stderr.take().unwrap()), true, tx);
    let deadline = Instant::now() + timeout;
    let mut stdout = None;
    let mut stderr = None;
    let mut status = None;
    let result = loop {
        if cancel.load(std::sync::atomic::Ordering::SeqCst) {
            break Err("Benchmark cancelled; partial test discarded".into());
        }
        while let Ok((err, bytes)) = rx.try_recv() {
            match bytes {
                Ok(bytes) => {
                    if err {
                        stderr = Some(bytes)
                    } else {
                        stdout = Some(bytes)
                    }
                }
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(error);
                }
            }
        }
        match child.try_wait() {
            Ok(Some(s)) => status = Some(s),
            Ok(None) => (),
            Err(e) => break Err(e.to_string()),
        }
        if let (Some(out), Some(err), Some(status)) = (&stdout, &stderr, status) {
            break Ok(ProbeOutput {
                stdout: decode(out),
                stderr: decode(err),
                success: status.success(),
            });
        }
        if Instant::now() >= deadline {
            break Err("Probe timed out; partial output discarded".into());
        }
        std::thread::sleep(Duration::from_millis(5));
    };
    if result.is_err() {
        let _ = child.kill();
    }
    let _ = child.wait();
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn decodes_wsl_windows_and_linux_output_without_losing_names() {
        let sample = "Ubuntu\r\nUbuntu 日本語\r\n";
        let encoded: Vec<u8> = sample.encode_utf16().flat_map(u16::to_le_bytes).collect();
        assert_eq!(decode_wsl(&encoded), sample);
        assert_eq!(decode_wsl(&[vec![0xff, 0xfe], encoded].concat()), sample);
        assert_eq!(
            decode_wsl("GPU ready — UTF-8".as_bytes()),
            "GPU ready — UTF-8"
        );
    }
    #[test]
    fn probe_fixture() {
        match std::env::var("ROUTER_PROBE_FIXTURE").as_deref() {
            Ok("sleep") => std::thread::sleep(std::time::Duration::from_secs(5)),
            Ok("stderr") => {
                println!("stdout evidence");
                eprintln!("stderr evidence");
            }
            Ok("overflow") => println!("{}", "x".repeat(2048)),
            _ => (),
        }
    }
    fn command(mode: &str) -> std::process::Command {
        let mut cmd = std::process::Command::new(std::env::current_exe().unwrap());
        cmd.args([
            "--exact",
            "process_probe::tests::probe_fixture",
            "--nocapture",
        ])
        .env("ROUTER_PROBE_FIXTURE", mode);
        cmd
    }
    #[test]
    fn timed_out_probe_discards_partial_inventory_and_reaps_process() {
        let start = std::time::Instant::now();
        assert!(capture(
            command("sleep"),
            std::time::Duration::from_millis(100),
            1024
        )
        .unwrap_err()
        .contains("timed out"));
        assert!(start.elapsed() < std::time::Duration::from_secs(2));
    }
    #[test]
    fn captures_both_streams_and_rejects_overflow() {
        let out = capture(command("stderr"), std::time::Duration::from_secs(5), 1024).unwrap();
        assert!(out.stdout.contains("stdout evidence"));
        assert!(out.stderr.contains("stderr evidence"));
        assert!(
            capture(command("overflow"), std::time::Duration::from_secs(5), 1024)
                .unwrap_err()
                .contains("output limit")
        );
    }

    #[test]
    fn cancellation_kills_and_reaps_the_owned_child() {
        let cancel = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let trigger = cancel.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(80));
            trigger.store(true, std::sync::atomic::Ordering::SeqCst);
        });
        let start = Instant::now();
        let error = capture_cancellable(command("sleep"), Duration::from_secs(5), 1024, &cancel)
            .unwrap_err();
        assert!(error.contains("cancelled"));
        assert!(start.elapsed() < Duration::from_secs(2));
    }
}
