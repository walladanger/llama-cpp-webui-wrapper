//! Graphics cards as llama-server reports them, and the GPU placement profiles (port of web-wrapper/src/runtimes/gpu.js).

use std::process::Command;

#[derive(Debug, Clone, PartialEq)]
pub struct Device {
    pub id: String,
    pub free: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Plan {
    pub device: String,
    pub split_mode: String,
    pub tensor_split: String,
}

// "CUDA0: NVIDIA GeForce RTX 3090 (24576 MiB, 23000 MiB free)"
pub fn parse_devices(output: &str) -> Vec<Device> {
    output
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            let (id, rest) = line.split_once(':')?;
            if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric()) || !id.ends_with(|c: char| c.is_ascii_digit()) {
                return None;
            }
            let inner = rest.trim().strip_suffix(')')?;
            let (_, mem) = inner.rsplit_once('(')?;
            let (_, free) = mem.split_once(',')?;
            let free = free.trim().strip_suffix("MiB free")?.trim().parse().ok()?;
            Some(Device { id: id.to_string(), free })
        })
        .collect()
}

pub fn list_devices(executable: &std::path::Path) -> Vec<Device> {
    let mut cmd = Command::new(executable);
    cmd.arg("--list-devices");
    crate::no_console(&mut cmd);
    match cmd.output() {
        Ok(out) => parse_devices(&format!("{}\n{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr))),
        Err(_) => Vec::new(),
    }
}

// One server serves every model, so only whole-server profiles apply. None keeps the manual settings.
pub fn plan(mode: &str, devices: &[Device], tensor_split: &str) -> Option<Plan> {
    let gpus: Vec<&Device> = devices.iter().filter(|d| !d.id.to_ascii_lowercase().starts_with("cpu")).collect();
    let one = |d: &Device| Plan { device: d.id.clone(), split_mode: "none".into(), tensor_split: String::new() };
    match mode {
        // Ties keep the order llama-server listed them in.
        "single" => gpus.iter().copied().reduce(|a, b| if b.free > a.free { b } else { a }).map(one),
        "spread" if gpus.len() == 1 => Some(one(gpus[0])),
        "spread" if gpus.len() > 1 => {
            let split = if tensor_split.trim().is_empty() {
                gpus.iter().map(|g| ((g.free as f64 / 256.0).round() as u64).max(1).to_string()).collect::<Vec<_>>().join(",")
            } else {
                tensor_split.trim().to_string()
            };
            Some(Plan {
                device: gpus.iter().map(|g| g.id.as_str()).collect::<Vec<_>>().join(","),
                split_mode: "layer".into(),
                tensor_split: split,
            })
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const OUT: &str = "Available devices:\n  CUDA0: NVIDIA GeForce RTX 3090 (24576 MiB, 23000 MiB free)\n  CUDA1: NVIDIA GeForce RTX 3090 (24576 MiB, 12000 MiB free)\n";

    #[test]
    fn parses_and_places() {
        let devices = parse_devices(OUT);
        assert_eq!(devices.len(), 2);
        assert_eq!(plan("single", &devices, "").unwrap().device, "CUDA0");
        let spread = plan("spread", &devices, "").unwrap();
        assert_eq!(spread.device, "CUDA0,CUDA1");
        assert_eq!(spread.tensor_split, "90,47");
        assert_eq!(plan("spread", &devices, "3,1").unwrap().tensor_split, "3,1");
        assert!(plan("manual", &devices, "").is_none());
        assert!(plan("single", &[], "").is_none());
    }
}
