//! Resolve a saved profile without mutating its durable intent.
use crate::{gpu, settings};
use std::{collections::HashMap, path::Path};
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchPlan {
    #[serde(serialize_with = "serialize_args")]
    pub args: Vec<String>,
    #[serde(skip)]
    pub env: HashMap<String, String>,
    pub requested: serde_json::Value,
    pub effective: serde_json::Value,
    pub notes: Vec<String>,
    pub profile_revision: u64,
    pub restart_required: bool,
}
fn serialize_args<S: serde::Serializer>(args: &[String], serializer: S) -> Result<S::Ok, S::Error> {
    serde::Serialize::serialize(&settings::redact_args(args), serializer)
}
fn redacted(mut value: serde_json::Value) -> serde_json::Value {
    if let Some(map) = value.as_object_mut() {
        map.insert(
            "llamacpp_env".into(),
            serde_json::Value::String("[redacted]".into()),
        );
        if let Some(extra) = map.get("extra_args").and_then(|v| v.as_str()) {
            if let Ok(args) = settings::split_args(extra) {
                map.insert(
                    "extra_args".into(),
                    serde_json::Value::String(settings::redact_args(&args).join(" ")),
                );
            }
        }
    }
    value
}
pub fn prepare(
    executable: &Path,
    profile: settings::LaunchProfile,
    port: u16,
    models: &Path,
    cache: &Path,
) -> Result<LaunchPlan, String> {
    let revision = profile.revision;
    let mut s = settings::Settings::from_map(profile.settings);
    settings::build_args(&s, port, models)?;
    let requested = redacted(s.value());
    let mut env = settings::child_environment(&s)?;
    env.insert("LLAMA_CACHE".into(), cache.to_string_lossy().into_owned());
    let mut notes = Vec::new();
    let selected = s.selected_uuids()?;
    if !selected.is_empty() {
        let selection = gpu::resolve_uuid_selection(&selected, &gpu::inventory()?, &env)?;
        env.retain(|key, _| {
            !["CUDA_VISIBLE_DEVICES", "CUDA_DEVICE_ORDER"]
                .iter()
                .any(|reserved| key.eq_ignore_ascii_case(reserved))
        });
        env.extend(selection);
        let devices = gpu::list_devices(executable, &env);
        let cuda: Vec<_> = devices
            .iter()
            .filter(|d| d.id.starts_with("CUDA"))
            .collect();
        if cuda.len() != selected.len() {
            return Err("Runtime could not resolve every selected GPU UUID".into());
        }
        if s.str("main_gpu").parse::<f64>().unwrap_or(0.0) as usize >= cuda.len() {
            return Err("Main GPU index is outside selected GPUs".into());
        }
        s.set(
            "device",
            &cuda
                .iter()
                .map(|d| d.id.as_str())
                .collect::<Vec<_>>()
                .join(","),
        );
        if s.str("tensor_split").is_empty() && cuda.len() > 1 {
            s.set("tensor_split", &vec!["1"; cuda.len()].join(","));
        }
        notes.push(format!("Selected GPU UUID order: {}", selected.join(", ")));
    }
    match s.str("gpu_placement").as_str() {
        "single" | "spread" => {
            let mode = s.str("gpu_placement");
            let plan=gpu::plan(&mode,&gpu::list_devices(executable,&env),&s.str("tensor_split")).ok_or("Requested GPU placement found no graphics card; select manual CPU settings explicitly")?;
            notes.push(format!("GPU placement {mode} -> {}", plan.device));
            s.set("device", &plan.device);
            s.set("split_mode", &plan.split_mode);
            s.set("main_gpu", "0");
            s.set("tensor_split", &plan.tensor_split);
        }
        _ => (),
    }
    let args = settings::build_args(&s, port, models)?;
    Ok(LaunchPlan {
        args,
        env,
        requested,
        effective: redacted(s.value()),
        notes,
        profile_revision: revision,
        restart_required: true,
    })
}
