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

pub fn capture(
    mut command: Command,
    timeout: Duration,
    limit: usize,
) -> Result<ProbeOutput, String> {
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
                stdout: String::from_utf8_lossy(out).into(),
                stderr: String::from_utf8_lossy(err).into(),
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
}
