//! portable-data/config/llama-server.json -> llama-server arguments.
//! Port of web-wrapper/src/runtimes/server-args.js; keep the two in step.

use serde_json::{Map, Value};
use std::collections::HashMap;
use std::path::Path;

const CACHE_TYPES: [&str; 9] = [
    "f32", "f16", "bf16", "q8_0", "q4_0", "q4_1", "iq4_nl", "q5_0", "q5_1",
];

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchProfile {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub revision: u64,
    pub settings: Map<String, Value>,
    #[serde(flatten)]
    pub extensions: Map<String, Value>,
}

pub fn migrate_profile(raw: Value) -> Result<LaunchProfile, String> {
    let map = raw
        .as_object()
        .ok_or("Launch profile must be a JSON object")?;
    let mut profile = if map.contains_key("schemaVersion") {
        if map["schemaVersion"] != 1 {
            return Err("Unsupported profile schema version".into());
        }
        serde_json::from_value::<LaunchProfile>(raw)
            .map_err(|e| format!("Invalid launch profile: {e}"))?
    } else {
        LaunchProfile {
            schema_version: 1,
            id: "default".into(),
            name: "Default".into(),
            revision: 0,
            settings: map.clone(),
            extensions: Map::new(),
        }
    };
    if profile.id.trim().is_empty() || profile.revision > 9007199254740991 {
        return Err("Invalid launch profile".into());
    }
    let defaults: Value = serde_json::from_str(include_str!("../llama-server.default.json"))
        .map_err(|e| e.to_string())?;
    let mut values = defaults.as_object().unwrap().clone();
    values.entry("p2p").or_insert(Value::Bool(false));
    values.extend(profile.settings);
    profile.settings = values;
    Ok(profile)
}

pub fn load_profile(file: &Path) -> Result<LaunchProfile, String> {
    match std::fs::read_to_string(file) {
        Ok(text) => migrate_profile(
            serde_json::from_str(text.trim_start_matches('\u{feff}'))
                .map_err(|e| format!("{}: {e}", file.display()))?,
        ),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            migrate_profile(Value::Object(Map::new()))
        }
        Err(e) => Err(format!("{}: {e}", file.display())),
    }
}

pub fn save_profile(
    file: &Path,
    profile: LaunchProfile,
    expected_revision: u64,
) -> Result<LaunchProfile, String> {
    use std::io::Write;
    let mut next = migrate_profile(serde_json::to_value(profile).map_err(|e| e.to_string())?)?;
    build_args(&Settings(next.settings.clone()), 8080, Path::new("models"))?;
    let parent = file.parent().ok_or("Profile needs a parent directory")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let lock = file.with_extension("json.lock");
    let _lock_file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&lock)
        .map_err(|e| format!("Profile is being saved or lock unavailable: {e}"))?;
    let temp = file.with_extension(format!(
        "{}.{}.tmp",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos()
    ));
    let result = (|| {
        if load_profile(file)?.revision != expected_revision {
            return Err("Profile changed; reload before saving".into());
        }
        if expected_revision >= 9007199254740991 {
            return Err("Profile revision exhausted".into());
        }
        next.revision = expected_revision + 1;
        let bytes = serde_json::to_vec_pretty(&next).map_err(|e| e.to_string())?;
        let mut output = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|e| e.to_string())?;
        output
            .write_all(&bytes)
            .and_then(|_| output.sync_all())
            .map_err(|e| e.to_string())?;
        drop(output);
        std::fs::rename(&temp, file).map_err(|e| e.to_string())?;
        Ok(next)
    })();
    let _ = std::fs::remove_file(&temp);
    drop(_lock_file);
    let _ = std::fs::remove_file(lock);
    result
}

pub struct Settings(Map<String, Value>);

impl Settings {
    pub fn load(file: &Path) -> Result<Self, String> {
        Ok(Self(load_profile(file)?.settings))
    }
    pub fn value(&self) -> Value {
        Value::Object(self.0.clone())
    }
    pub fn selected_uuids(&self) -> Result<Vec<String>, String> {
        let Some(value) = self.0.get("selected_gpu_uuids") else {
            return Ok(Vec::new());
        };
        let values = value.as_array().ok_or("Invalid selected GPU UUIDs")?;
        let mut out = Vec::new();
        for value in values {
            let id = value
                .as_str()
                .filter(|s| {
                    s.starts_with("GPU-")
                        && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
                })
                .ok_or("Invalid selected GPU UUIDs")?;
            if out.iter().any(|s| s == id) {
                return Err("Invalid selected GPU UUIDs".into());
            }
            out.push(id.to_string());
        }
        Ok(out)
    }
    pub fn from_map(map: Map<String, Value>) -> Self {
        Self(map)
    }
    #[cfg(test)]
    fn from(value: Value) -> Self {
        Settings(value.as_object().cloned().unwrap_or_default())
    }

    pub fn str(&self, key: &str) -> String {
        match self.0.get(key) {
            Some(Value::String(s)) => s.trim().to_string(),
            Some(Value::Number(n)) => n.to_string(),
            _ => String::new(),
        }
    }

    fn num(&self, key: &str) -> Option<f64> {
        match self.0.get(key) {
            Some(Value::Number(n)) => n.as_f64(),
            Some(Value::String(s)) => s.trim().parse().ok(),
            _ => None,
        }
    }

    fn flag(&self, key: &str) -> bool {
        matches!(self.0.get(key), Some(Value::Bool(true)))
    }

    pub fn set(&mut self, key: &str, value: &str) {
        self.0
            .insert(key.to_string(), Value::String(value.to_string()));
    }

    // On unless set to false, as in Radium.
    fn fit_on(&self) -> bool {
        !matches!(self.0.get("fit"), Some(Value::Bool(false)))
    }
}

fn fmt(n: f64) -> String {
    if n.fract() == 0.0 {
        format!("{}", n as i64)
    } else {
        n.to_string()
    }
}

// Spaces separate, quotes group, no expansion.
pub fn split_args(text: &str) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    let mut started = false;
    for c in text.chars() {
        match quote {
            Some(q) if c == q => quote = None,
            Some(_) => cur.push(c),
            None if c == '"' || c == '\'' => {
                quote = Some(c);
                started = true;
            }
            None if c.is_whitespace() => {
                if started {
                    out.push(std::mem::take(&mut cur));
                    started = false;
                }
            }
            None => {
                cur.push(c);
                started = true;
            }
        }
    }
    if quote.is_some() {
        return Err("Unclosed quote in extra arguments".to_string());
    }
    if started {
        out.push(cur);
    }
    Ok(out)
}

// "KEY=VALUE;KEY2=VALUE2"
pub fn parse_env(text: &str) -> Result<HashMap<String, String>, String> {
    let mut env = HashMap::new();
    let mut seen = std::collections::HashSet::new();
    for pair in text.split(';').filter(|s| !s.trim().is_empty()) {
        let (key, value) = pair
            .split_once('=')
            .ok_or("Invalid environment assignment")?;
        let key = key.trim();
        if key.is_empty()
            || !key
                .chars()
                .enumerate()
                .all(|(i, c)| c == '_' || c.is_ascii_alphabetic() || (i > 0 && c.is_ascii_digit()))
            || pair.contains(['\0', '\r', '\n'])
        {
            return Err("Invalid environment assignment".into());
        }
        let upper = key.to_ascii_uppercase();
        if upper.starts_with("LLAMA_ARG_")
            || ["LLAMA_CACHE", "GGML_CUDA_P2P"].contains(&upper.as_str())
        {
            return Err(format!(
                "Environment cannot override managed setting: {key}"
            ));
        }
        if !seen.insert(upper) {
            return Err(format!("Duplicate environment assignment: {key}"));
        }
        env.insert(key.into(), value.trim().into());
    }
    Ok(env)
}

pub fn child_environment(s: &Settings) -> Result<HashMap<String, String>, String> {
    let mut env: HashMap<String, String> = std::env::vars()
        .filter(|(key, _)| {
            let key = key.to_ascii_uppercase();
            !key.starts_with("LLAMA_ARG_")
                && !["GGML_CUDA_P2P", "LLAMA_CACHE"].contains(&key.as_str())
        })
        .collect();
    for (key, value) in parse_env(&s.str("llamacpp_env"))? {
        env.retain(|old, _| !old.eq_ignore_ascii_case(&key));
        env.insert(key, value);
    }
    if s.flag("p2p") {
        env.insert("GGML_CUDA_P2P".into(), "1".into());
    }
    Ok(env)
}

fn validate_fields(s: &Settings) -> Result<(), String> {
    let contract: Value = serde_json::from_str(include_str!(
        "../../web-wrapper/src/runtimes/settings-contract.json"
    ))
    .map_err(|e| e.to_string())?;
    for kind in ["integers", "numbers"] {
        for (key, range) in contract[kind].as_object().unwrap() {
            if !s.0.contains_key(key) {
                continue;
            }
            let n = s
                .num(key)
                .ok_or_else(|| format!("Invalid {key}: expected number"))?;
            if !n.is_finite()
                || n < range[0].as_f64().unwrap()
                || n > range[1].as_f64().unwrap()
                || (kind == "integers" && n.fract() != 0.0)
            {
                return Err(format!("Invalid {key}: out of range"));
            }
        }
    }
    for key in contract["booleans"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(Value::as_str)
    {
        if s.0.contains_key(key) && !s.0[key].is_boolean() {
            return Err(format!("Invalid {key}: expected boolean"));
        }
    }
    for (key, choices) in contract["enums"].as_object().unwrap() {
        if s.0.contains_key(key) && !choices.as_array().unwrap().contains(&s.0[key]) {
            return Err(format!("Invalid {key}"));
        }
    }
    for key in ["device", "tensor_split", "extra_args", "llamacpp_env"] {
        if s.0.contains_key(key) && !s.0[key].is_string() {
            return Err(format!("Invalid {key}: expected text"));
        }
    }
    if s.0.contains_key("fit_target")
        && !s.str("fit_target").split(',').all(|v| {
            !v.trim().is_empty()
                && v.trim().chars().all(|c| c.is_ascii_digit())
                && v.trim().parse::<u32>().is_ok_and(|n| n <= 2147483647)
        })
    {
        return Err("Invalid fit_target".into());
    }
    let effective = |key: &str, default: f64| s.num(key).filter(|n| *n > 0.0).unwrap_or(default);
    if effective("ubatch_size", 512.0) > effective("batch_size", 2048.0) {
        return Err("Microbatch must not exceed batch size".into());
    }
    s.selected_uuids()?;
    let device = s.str("device");
    if !device.is_empty() && device != "none" {
        if !device.split(',').all(|id| {
            let prefix = id.trim_end_matches(|c: char| c.is_ascii_digit());
            !prefix.is_empty()
                && prefix.len() < id.len()
                && prefix.chars().all(|c| c.is_ascii_alphabetic())
        }) {
            return Err("Invalid device list".into());
        }
        if !s.str("tensor_split").is_empty()
            && s.str("tensor_split").split(',').count() != device.split(',').count()
        {
            return Err("Tensor split must have one weight per selected device".into());
        }
    }
    parse_env(&s.str("llamacpp_env"))?;
    Ok(())
}

pub fn redact_args(args: &[String]) -> Vec<String> {
    let mut hide_next = false;
    args.iter()
        .map(|arg| {
            if hide_next {
                hide_next = false;
                return "[redacted]".into();
            }
            let lower = arg.to_ascii_lowercase();
            let flag = lower.split('=').next().unwrap_or("");
            if (flag.starts_with("--")
                && ["api-key", "token", "secret", "password"]
                    .iter()
                    .any(|part| flag.contains(part)))
                || flag == "-hft"
            {
                if let Some((key, _)) = arg.split_once('=') {
                    return format!("{key}=[redacted]");
                }
                hide_next = true;
            }
            arg.clone()
        })
        .collect()
}

struct Args(Vec<String>);

impl Args {
    fn flag(&mut self, flag: &str) {
        self.0.push(flag.to_string());
    }
    fn pair(&mut self, flag: &str, value: impl Into<String>) {
        self.0.push(flag.to_string());
        self.0.push(value.into());
    }
}

fn validate_settings(s: &Settings) -> Result<Vec<String>, String> {
    validate_fields(s)?;
    let cache = |key: &str| {
        if s.0.contains_key(key) {
            s.str(key)
        } else {
            "f16".to_string()
        }
    };
    let k = cache("cache_type_k");
    let v = cache("cache_type_v");
    if !CACHE_TYPES.contains(&k.as_str()) {
        return Err("Invalid K cache type".to_string());
    }
    if !CACHE_TYPES.contains(&v.as_str()) {
        return Err("Invalid V cache type".to_string());
    }
    let flash = if s.0.contains_key("flash_attn") {
        s.str("flash_attn")
    } else {
        "auto".to_string()
    };
    if !["auto", "on", "off"].contains(&flash.as_str()) {
        return Err("Invalid Flash Attention setting".to_string());
    }
    let mode = if s.0.contains_key("split_mode") {
        s.str("split_mode")
    } else {
        "layer".to_string()
    };
    if !["none", "layer", "row", "tensor"].contains(&mode.as_str()) {
        return Err("Invalid split mode".to_string());
    }
    let floating = |value: &str| ["f32", "f16", "bf16"].contains(&value);
    if mode == "tensor" {
        if s.fit_on() {
            return Err("Tensor mode requires fit off".to_string());
        }
        if flash != "on" {
            return Err("Tensor mode requires Flash Attention on".to_string());
        }
        if !s
            .num("ctx_size")
            .is_some_and(|n| n.is_finite() && n > 0.0 && n.fract() == 0.0)
        {
            return Err("Tensor mode requires an explicit positive context".to_string());
        }
        if !floating(&k) || !floating(&v) {
            return Err("Tensor mode requires f32, f16 or bf16 K/V caches".to_string());
        }
    }
    if flash == "off" && !floating(&v) {
        return Err("Quantized V cache requires Flash Attention".to_string());
    }
    let split = s.str("tensor_split");
    if !split.is_empty() {
        let weights: Vec<f64> = split
            .split(',')
            .map(|x| x.trim().parse().unwrap_or(f64::NAN))
            .collect();
        let sum: f64 = weights.iter().sum();
        if weights.iter().any(|n| !n.is_finite() || *n < 0.0) || !sum.is_finite() || sum <= 0.0 {
            return Err(
                "Tensor split requires finite nonnegative weights with a positive sum".to_string(),
            );
        }
    }
    let extra = split_args(&s.str("extra_args"))?;
    let managed: Vec<String> = serde_json::from_str(include_str!(
        "../../web-wrapper/src/runtimes/managed-flags.json"
    ))
    .map_err(|e| format!("Invalid managed flag contract: {e}"))?;
    for arg in &extra {
        let flag = arg.split('=').next().unwrap_or_default();
        if managed.iter().any(|managed| managed == flag) {
            return Err(format!(
                "Extra arguments cannot override managed flag: {flag}"
            ));
        }
    }
    Ok(extra)
}

pub fn build_args(s: &Settings, port: u16, models_dir: &Path) -> Result<Vec<String>, String> {
    let extra = validate_settings(s)?;
    let mut a = Args(Vec::new());
    a.pair("--host", "127.0.0.1");
    a.pair("--port", port.to_string());
    a.pair("--models-dir", models_dir.display().to_string());

    let positive = |key: &str| s.num(key).filter(|n| *n > 0.0);
    let differs = |key: &str, base: f64| s.num(key).filter(|n| (n - base).abs() > 1e-6);

    let mut parallel = positive("parallel");
    let mut cont_batching = s.flag("cont_batching");
    let mut metrics = s.flag("expose_metrics");
    if s.flag("concurrent_mode") {
        parallel = Some(s.num("concurrent_slots").unwrap_or(8.0).max(2.0));
        cont_batching = true;
        metrics = true;
    }

    if let Some(n) = s.num("n_gpu_layers").filter(|n| *n >= 0.0) {
        a.pair("--n-gpu-layers", fmt(n));
    }
    if let Some(n) = positive("threads") {
        a.pair("--threads", fmt(n));
    }
    if let Some(n) = positive("threads_batch") {
        a.pair("--threads-batch", fmt(n));
    }
    if let Some(n) = positive("batch_size").filter(|n| *n != 2048.0) {
        a.pair("--batch-size", fmt(n));
    }
    if let Some(n) = positive("ubatch_size").filter(|n| *n != 512.0) {
        a.pair("--ubatch-size", fmt(n));
    }

    let device = s.str("device");
    if !device.is_empty() {
        a.pair("--device", device);
    }
    let split_mode = s.str("split_mode");
    if !split_mode.is_empty() && split_mode != "layer" {
        a.pair("--split-mode", split_mode);
    }
    if let Some(n) = s.num("main_gpu").filter(|n| *n != 0.0) {
        a.pair("--main-gpu", fmt(n));
    }
    let tensor_split = s.str("tensor_split");
    if !tensor_split.is_empty() {
        a.pair("--tensor-split", tensor_split);
    }
    if s.flag("no_kv_offload") {
        a.flag("--no-kv-offload");
    }

    let flash_attn = match s.str("flash_attn") {
        f if f.is_empty() => "auto".to_string(),
        f => f,
    };
    if ["auto", "on", "off"].contains(&flash_attn.as_str()) {
        a.pair("--flash-attn", flash_attn.clone());
    }

    if s.flag("ctx_shift") {
        a.flag("--context-shift");
    }
    if cont_batching {
        a.flag("--cont-batching");
    }
    if s.flag("no_mmap") {
        a.flag("--no-mmap");
    }
    if s.flag("mlock") {
        a.flag("--mlock");
    }
    if let Some(n) = parallel {
        a.pair("--parallel", fmt(n));
    }
    if metrics {
        a.flag("--metrics");
    }

    if let Some(n) = positive("ctx_size") {
        a.pair("--ctx-size", fmt(n));
    }
    if let Some(n) = s.num("n_predict").filter(|n| *n != -1.0) {
        a.pair("--n-predict", fmt(n));
    }
    let cache = |key: &str| {
        let v = s.str(key);
        if CACHE_TYPES.contains(&v.as_str()) {
            v
        } else {
            "f16".to_string()
        }
    };
    let k = cache("cache_type_k");
    if k != "f16" {
        a.pair("--cache-type-k", k);
    }
    // Validation above rejects unsupported V-cache combinations.
    let v = cache("cache_type_v");
    if v != "f16" {
        a.pair("--cache-type-v", v);
    }
    if let Some(n) = differs("defrag_thold", 0.1) {
        a.pair("--defrag-thold", fmt(n));
    }

    let rope_scaling = s.str("rope_scaling");
    if !rope_scaling.is_empty() && rope_scaling != "none" {
        a.pair("--rope-scaling", rope_scaling);
    }
    if let Some(n) = differs("rope_scale", 1.0) {
        a.pair("--rope-scale", fmt(n));
    }
    if let Some(n) = s.num("rope_freq_base").filter(|n| *n != 0.0) {
        a.pair("--rope-freq-base", fmt(n));
    }
    if let Some(n) = differs("rope_freq_scale", 1.0) {
        a.pair("--rope-freq-scale", fmt(n));
    }

    a.pair("--fit", if s.fit_on() { "on" } else { "off" });
    if s.fit_on() {
        let fit_ctx = s.num("fit_ctx").map(fmt).unwrap_or_default();
        if !fit_ctx.is_empty() && fit_ctx != "4096" {
            a.pair("--fit-ctx", fit_ctx);
        }
        let fit_target = s.str("fit_target");
        if !fit_target.is_empty() && fit_target != "1024" {
            a.pair("--fit-target", fit_target);
        }
    }

    a.0.extend(extra);
    Ok(a.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn line(v: Value) -> String {
        build_args(&Settings::from(v), 8080, Path::new("m"))
            .unwrap()
            .join(" ")
    }

    #[test]
    fn defaults_match_the_node_wrapper() {
        assert_eq!(
            line(json!({})),
            "--host 127.0.0.1 --port 8080 --models-dir m --flash-attn auto --fit on"
        );
    }

    #[test]
    fn shipped_defaults_change_nothing() {
        let shipped: Value =
            serde_json::from_str(include_str!("../llama-server.default.json")).unwrap();
        assert_eq!(line(shipped), line(json!({})));
    }

    #[test]
    fn custom_values() {
        let got = line(json!({
            "fit": false, "ctx_size": 8192, "flash_attn": "on", "cache_type_k": "q8_0", "cache_type_v": "q8_0",
            "concurrent_mode": true, "n_gpu_layers": 0, "device": "CUDA0,CUDA1", "tensor_split": "3,1",
            "extra_args": "--jinja --alias \"my model\""
        }));
        assert_eq!(
            got,
            "--host 127.0.0.1 --port 8080 --models-dir m --n-gpu-layers 0 --device CUDA0,CUDA1 --tensor-split 3,1 --flash-attn on --cont-batching --parallel 8 --metrics --ctx-size 8192 --cache-type-k q8_0 --cache-type-v q8_0 --fit off --jinja --alias my model"
        );
        assert_eq!(split_args("--alias \"my model\"").unwrap()[1], "my model");
        assert_eq!(parse_env("A=1; B=x=y").unwrap()["B"], "x=y");
    }
    #[test]
    fn shared_gpu_contract() {
        let fixtures: Value = serde_json::from_str(include_str!(
            "../../web-wrapper/test/fixtures/gpu-contract.json"
        ))
        .unwrap();
        for fixture in fixtures.as_array().unwrap() {
            let result = build_args(
                &Settings::from(fixture["settings"].clone()),
                8080,
                Path::new("m"),
            );
            if let Some(error) = fixture["error"].as_str() {
                assert!(result.unwrap_err().contains(error), "{}", fixture["name"]);
            } else {
                let args = result.unwrap();
                for (flag, value) in fixture["flags"].as_object().unwrap() {
                    let index = args.iter().position(|arg| arg == flag).expect(flag);
                    assert_eq!(
                        args[index + 1],
                        value.as_str().unwrap(),
                        "{}",
                        fixture["name"]
                    );
                }
            }
        }
    }

    #[test]
    fn legacy_profiles_and_schema_validation() {
        let profile =
            migrate_profile(json!({"ctx_size":"8192", "extension":{"custom":true}})).unwrap();
        assert_eq!(profile.schema_version, 1);
        assert_eq!(profile.revision, 0);
        assert_eq!(profile.settings["ctx_size"], "8192");
        assert_eq!(profile.settings["extension"]["custom"], true);
        assert!(migrate_profile(json!({"schemaVersion":2})).is_err());
        assert!(migrate_profile(json!([])).is_err());
    }
    #[test]
    fn durable_save_preserves_valid_profile_and_rejects_stale_writes() {
        let dir = std::env::temp_dir().join(format!("router-profile-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("profile.json");
        let profile = migrate_profile(json!({"ctx_size":4096})).unwrap();
        let saved = save_profile(&file, profile.clone(), 0).unwrap();
        assert_eq!(saved.revision, 1);
        assert_eq!(load_profile(&file).unwrap().settings["ctx_size"], 4096);
        assert!(save_profile(&file, profile, 0)
            .unwrap_err()
            .contains("changed"));
        let mut invalid = saved;
        invalid.settings.insert("ctx_size".into(), json!(1.5));
        assert!(save_profile(&file, invalid, 1).is_err());
        assert_eq!(load_profile(&file).unwrap().revision, 1);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn credential_arguments_are_redacted_only_in_diagnostics() {
        assert_eq!(
            redact_args(&[
                "--api-key".into(),
                "secret".into(),
                "--hf-token=another".into(),
                "--alias".into(),
                "Model".into()
            ]),
            vec![
                "--api-key",
                "[redacted]",
                "--hf-token=[redacted]",
                "--alias",
                "Model"
            ]
        );
    }
}
