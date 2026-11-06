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
            if id.is_empty()
                || !id.chars().all(|c| c.is_ascii_alphanumeric())
                || !id.ends_with(|c: char| c.is_ascii_digit())
            {
                return None;
            }
            let inner = rest.trim().strip_suffix(')')?;
            let (_, mem) = inner.rsplit_once('(')?;
            let (_, free) = mem.split_once(',')?;
            let free = free.trim().strip_suffix("MiB free")?.trim().parse().ok()?;
            Some(Device {
                id: id.to_string(),
                free,
            })
        })
        .collect()
}

pub fn list_devices(
    executable: &std::path::Path,
    env: &std::collections::HashMap<String, String>,
) -> Vec<Device> {
    let mut cmd = Command::new(executable);
    cmd.arg("--list-devices").env_clear().envs(env);
    crate::no_console(&mut cmd);
    match crate::process_probe::capture(cmd, std::time::Duration::from_secs(15), 1024 * 1024) {
        Ok(out) => parse_devices(&format!("{}\n{}", out.stdout, out.stderr)),
        Err(_) => Vec::new(),
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalDevice {
    pub uuid: String,
    pub name: String,
    pub total: Option<u64>,
    pub free: Option<u64>,
    pub driver: String,
    pub bus: String,
    #[serde(default)]
    pub source: String,
}

pub fn parse_nvidia_inventory(output: &str) -> Vec<PhysicalDevice> {
    output
        .lines()
        .filter_map(|line| {
            let fields: Vec<&str> = line.split(',').map(str::trim).collect();
            if fields.len() != 6 || !fields[0].starts_with("GPU-") {
                return None;
            }
            Some(PhysicalDevice {
                uuid: fields[0].into(),
                name: fields[1].into(),
                total: fields[2].parse().ok(),
                free: fields[3].parse().ok(),
                driver: fields[4].into(),
                bus: fields[5].into(),
                source: "nvml".into(),
            })
        })
        .collect()
}
pub fn inventory() -> Result<Vec<PhysicalDevice>, String> {
    let mut cmd = Command::new("nvidia-smi");
    cmd.args([
        "--query-gpu=uuid,name,memory.total,memory.free,driver_version,pci.bus_id",
        "--format=csv,noheader,nounits",
    ]);
    if let Ok(out) =
        crate::process_probe::capture(cmd, std::time::Duration::from_secs(5), 1024 * 1024)
    {
        if out.success {
            let cards = parse_nvidia_inventory(&out.stdout);
            if !cards.is_empty() {
                return Ok(cards);
            }
        }
    }
    let helper = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .with_file_name("llama-engine-manager.exe");
    let mut command = Command::new(helper);
    command.arg("cuda-inventory");
    let out =
        crate::process_probe::capture(command, std::time::Duration::from_secs(5), 1024 * 1024)?;
    if !out.success {
        return Err("Physical GPU identities unavailable from NVML and CUDA driver".into());
    }
    serde_json::from_str(&out.stdout).map_err(|e| format!("Invalid CUDA inventory: {e}"))
}
pub fn resolve_uuid_selection(
    uuids: &[String],
    cards: &[PhysicalDevice],
    env: &std::collections::HashMap<String, String>,
) -> Result<std::collections::HashMap<String, String>, String> {
    if uuids.is_empty()
        || uuids.iter().any(|id| {
            !id.starts_with("GPU-") || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        })
    {
        return Err("Invalid selected GPU UUIDs".into());
    }
    let mut seen = std::collections::HashSet::new();
    for id in uuids {
        if !seen.insert(id) {
            return Err("Duplicate selected GPU UUID".into());
        }
        if !cards.iter().any(|card| &card.uuid == id) {
            return Err(format!("Selected GPU unavailable: {id}"));
        }
    }
    let joined = uuids.join(",");
    if env
        .iter()
        .any(|(key, value)| key.eq_ignore_ascii_case("CUDA_VISIBLE_DEVICES") && value != &joined)
    {
        return Err("Selected GPUs conflict with inherited/custom CUDA visibility; use the same ordered UUIDs or clear the override".into());
    }
    Ok(std::collections::HashMap::from([
        ("CUDA_VISIBLE_DEVICES".into(), joined),
        ("CUDA_DEVICE_ORDER".into(), "PCI_BUS_ID".into()),
    ]))
}

// One server serves every model, so only whole-server profiles apply. None keeps the manual settings.
pub fn plan(mode: &str, devices: &[Device], tensor_split: &str) -> Option<Plan> {
    let gpus: Vec<&Device> = devices
        .iter()
        .filter(|d| !d.id.to_ascii_lowercase().starts_with("cpu"))
        .collect();
    let one = |d: &Device| Plan {
        device: d.id.clone(),
        split_mode: "none".into(),
        tensor_split: String::new(),
    };
    match mode {
        // Ties keep the order llama-server listed them in.
        "single" => gpus
            .iter()
            .copied()
            .reduce(|a, b| if b.free > a.free { b } else { a })
            .map(one),
        "spread" if gpus.len() == 1 => Some(one(gpus[0])),
        "spread" if gpus.len() > 1 => {
            let split = if tensor_split.trim().is_empty() {
                gpus.iter()
                    .map(|g| ((g.free as f64 / 256.0).round() as u64).max(1).to_string())
                    .collect::<Vec<_>>()
                    .join(",")
            } else {
                tensor_split.trim().to_string()
            };
            Some(Plan {
                device: gpus
                    .iter()
                    .map(|g| g.id.as_str())
                    .collect::<Vec<_>>()
                    .join(","),
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
    #[test]
    fn uuid_selection_preserves_order_and_rejects_missing_devices() {
        let cards=parse_nvidia_inventory("GPU-a, RTX 3090, 24576, 20000, 616.92, 01:00.0\nGPU-b, RTX 3090, 24576, N/A, 616.92, 03:00.0");
        assert_eq!(cards[1].free, None);
        let selected = vec!["GPU-b".into(), "GPU-a".into()];
        let env =
            resolve_uuid_selection(&selected, &cards, &std::collections::HashMap::new()).unwrap();
        assert_eq!(env["CUDA_VISIBLE_DEVICES"], "GPU-b,GPU-a");
        assert!(
            resolve_uuid_selection(&["GPU-missing".into()], &cards, &env)
                .unwrap_err()
                .contains("unavailable")
        );
        assert!(
            resolve_uuid_selection(&["GPU-a".into(), "GPU-a".into()], &cards, &env)
                .unwrap_err()
                .contains("Duplicate")
        );
        assert!(resolve_uuid_selection(&["GPU-a".into()], &cards, &env)
            .unwrap_err()
            .contains("visibility"));
    }
}
