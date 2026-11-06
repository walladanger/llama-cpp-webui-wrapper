//! Package evidence is advertised support, separate from exact-model canary validation.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, path::Path, process::Command, time::Duration};
pub fn package_fingerprint(executable: &Path) -> Result<String, String> {
    use std::io::Read;
    let dir = executable
        .parent()
        .ok_or("Executable needs a package directory")?;
    let mut files = std::fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
                && p.extension().is_some_and(|e| {
                    ["dll", "exe"]
                        .iter()
                        .any(|ext| e.to_string_lossy().eq_ignore_ascii_case(ext))
                })
        })
        .collect::<Vec<_>>();
    files.sort();
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 65536];
    for file in files {
        hash.update(file.file_name().unwrap().to_string_lossy().as_bytes());
        hash.update([0]);
        let mut input = std::fs::File::open(file).map_err(|e| e.to_string())?;
        loop {
            let n = input.read(&mut buffer).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            hash.update(&buffer[..n]);
        }
        hash.update([0]);
    }
    Ok(format!("{:x}", hash.finalize()))
}
pub fn parse_capabilities(version: &str, help: &str, package_hash: &str) -> Value {
    let mut flags = help
        .split_whitespace()
        .filter_map(|word| word.trim_start_matches([',', '[']).strip_prefix("--"))
        .map(|tail| {
            format!(
                "--{}",
                tail.chars()
                    .take_while(|c| c.is_ascii_alphanumeric() || *c == '-')
                    .collect::<String>()
            )
        })
        .filter(|s| s.len() > 2)
        .collect::<Vec<_>>();
    flags.sort();
    flags.dedup();
    let tensor = help
        .lines()
        .find(|line| line.contains("--split-mode"))
        .is_some_and(|line| line.contains("tensor"));
    let feature = |advertised: bool| json!({"state":if advertised{"unknown"}else{"unsupported"},"advertised":advertised,"verified":false});
    json!({"adapterVersion":1,"version":version.trim(),"packageHash":package_hash,"flags":flags,"features":{"tensor":feature(tensor),"flashAttention":feature(flags.iter().any(|s|s=="--flash-attn")),"deviceSelection":feature(flags.iter().any(|s|s=="--device"))}})
}
pub fn assert_arguments(evidence: &Value, args: &[String]) -> Result<(), String> {
    let flags = evidence["flags"]
        .as_array()
        .ok_or("No runtime flag evidence")?;
    for arg in args {
        if arg.starts_with("--")
            && !flags
                .iter()
                .any(|flag| flag.as_str() == arg.split('=').next())
        {
            return Err(format!(
                "Runtime package does not advertise required option: {arg}"
            ));
        }
    }
    Ok(())
}
pub fn inspect(executable: &Path, env: &HashMap<String, String>) -> Result<Value, String> {
    let probe = |flag: &str| -> Result<String, String> {
        let mut cmd = Command::new(executable);
        cmd.arg(flag).env_clear().envs(env);
        let out = crate::process_probe::capture(cmd, Duration::from_secs(5), 1024 * 1024)?;
        if !out.success {
            return Err(format!("Runtime {flag} probe failed"));
        }
        Ok(format!("{}\n{}", out.stdout, out.stderr))
    };
    let version = probe("--version")?;
    let help = probe("--help")?;
    let hash = package_fingerprint(executable)?;
    let mut evidence = parse_capabilities(&version, &help, &hash);
    evidence["observedAtUnixMs"] = json!(std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as u64);
    evidence["visibility"] = json!(env
        .iter()
        .filter(|(key, _)| ["CUDA_VISIBLE_DEVICES", "CUDA_DEVICE_ORDER"]
            .iter()
            .any(|v| key.eq_ignore_ascii_case(v)))
        .collect::<std::collections::BTreeMap<_, _>>());
    // NVML may be unavailable while CUDA works. Keep the evidence unknown rather than inventing a driver ID.
    evidence["driverIdentity"] = json!(crate::gpu::inventory().ok().map(|cards| cards
        .iter()
        .map(|card| format!("{}:{}:{}", card.uuid, card.driver, card.bus))
        .collect::<Vec<_>>()));
    Ok(evidence)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn advertised_tensor_is_not_verified_inference() {
        let evidence = parse_capabilities(
            "build 12125",
            "--split-mode {none,layer,tensor}\n--flash-attn [on|off|auto]\n--device",
            "abc",
        );
        assert_eq!(evidence["features"]["tensor"]["state"], "unknown");
        assert_eq!(evidence["features"]["tensor"]["advertised"], true);
        assert_eq!(evidence["features"]["tensor"]["verified"], false);
        assert!(assert_arguments(&evidence, &["--missing".into()]).is_err());
    }
}
