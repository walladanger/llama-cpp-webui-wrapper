//! portable-data/config/llama-server.json -> llama-server arguments.
//! Port of web-wrapper/src/runtimes/server-args.js; keep the two in step.

use serde_json::{Map, Value};
use std::collections::HashMap;
use std::path::Path;

const CACHE_TYPES: [&str; 9] = ["f32", "f16", "bf16", "q8_0", "q4_0", "q4_1", "iq4_nl", "q5_0", "q5_1"];

pub struct Settings(Map<String, Value>);

impl Settings {
    pub fn load(file: &Path) -> Result<Self, String> {
        match std::fs::read_to_string(file) {
            Ok(text) => match serde_json::from_str::<Value>(&text) {
                Ok(Value::Object(map)) => Ok(Settings(map)),
                Ok(_) => Err(format!("{} must hold a JSON object", file.display())),
                Err(e) => Err(format!("{}: {e}", file.display())),
            },
            Err(_) => Ok(Settings(Map::new())),
        }
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
        self.0.insert(key.to_string(), Value::String(value.to_string()));
    }

    // On unless set to false, as in Radium.
    fn fit_on(&self) -> bool {
        !matches!(self.0.get("fit"), Some(Value::Bool(false)))
    }
}

fn fmt(n: f64) -> String {
    if n.fract() == 0.0 { format!("{}", n as i64) } else { n.to_string() }
}

// Spaces separate, quotes group, no expansion.
pub fn split_args(text: &str) -> Vec<String> {
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
    if started {
        out.push(cur);
    }
    out
}

// "KEY=VALUE;KEY2=VALUE2"
pub fn parse_env(text: &str) -> HashMap<String, String> {
    text.split(';')
        .filter_map(|pair| {
            let (k, v) = pair.split_once('=')?;
            let k = k.trim();
            (!k.is_empty()).then(|| (k.to_string(), v.trim().to_string()))
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

pub fn build_args(s: &Settings, port: u16, models_dir: &Path) -> Vec<String> {
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

    if let Some(n) = positive("ctx_size").filter(|_| !s.fit_on()) {
        a.pair("--ctx-size", fmt(n));
    }
    if let Some(n) = positive("n_predict") {
        a.pair("--n-predict", fmt(n));
    }
    let cache = |key: &str| {
        let v = s.str(key);
        if CACHE_TYPES.contains(&v.as_str()) { v } else { "f16".to_string() }
    };
    let k = cache("cache_type_k");
    if k != "f16" {
        a.pair("--cache-type-k", k);
    }
    // A quantized V cache needs flash attention.
    let v = cache("cache_type_v");
    if flash_attn != "off" && v != "f16" && v != "f32" {
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
        let fit_ctx = s.str("fit_ctx");
        if !fit_ctx.is_empty() && fit_ctx != "4096" {
            a.pair("--fit-ctx", fit_ctx);
        }
        let fit_target = s.str("fit_target");
        if !fit_target.is_empty() && fit_target != "1024" {
            a.pair("--fit-target", fit_target);
        }
    }

    a.0.extend(split_args(&s.str("extra_args")));
    a.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn line(v: Value) -> String {
        build_args(&Settings::from(v), 8080, Path::new("m")).join(" ")
    }

    #[test]
    fn defaults_match_the_node_wrapper() {
        assert_eq!(line(json!({})), "--host 127.0.0.1 --port 8080 --models-dir m --flash-attn auto --fit on");
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
        assert_eq!(split_args("--alias \"my model\"")[1], "my model");
        assert_eq!(parse_env("A=1; B=x=y")["B"], "x=y");
    }
}
