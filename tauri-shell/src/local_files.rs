use crate::gguf_meta;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

#[derive(Default, Deserialize, Serialize)]
#[serde(default)]
pub struct AppPaths {
    pub model_folders: Vec<String>,
    pub cache_folder: Option<String>,
    pub logs_folder: Option<String>,
}

#[derive(Serialize)]
pub struct LogFile {
    pub name: String,
    pub bytes: u64,
}

#[derive(Serialize)]
pub struct ModelDetail {
    pub id: String,
    pub file_name: String,
    pub path: String,
    pub quantization: Option<String>,
    pub bytes: Option<u64>,
}

fn config_file(root: &Path) -> PathBuf {
    root.join("portable-data/config/app-paths.json")
}

pub fn load(root: &Path) -> Result<AppPaths, String> {
    let path = config_file(root);
    match fs::read(&path) {
        Ok(data) => serde_json::from_slice(&data).map_err(|e| format!("{}: {e}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(AppPaths::default()),
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}

pub fn logs_dir(root: &Path) -> Result<PathBuf, String> {
    Ok(load(root)?
        .logs_folder
        .map(PathBuf::from)
        .unwrap_or_else(|| root.join("portable-data/logs")))
}

pub fn cache_dir(root: &Path) -> Result<PathBuf, String> {
    Ok(load(root)?
        .cache_folder
        .map(PathBuf::from)
        .unwrap_or_else(|| root.join("portable-data/cache")))
}

fn canonical_dir(path: &str) -> Result<String, String> {
    let path = fs::canonicalize(path).map_err(|e| format!("{path}: {e}"))?;
    if !path.is_dir() {
        return Err(format!("{} is not a folder", path.display()));
    }
    Ok(path.to_string_lossy().into_owned())
}

fn gguf_files(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) -> Result<(), String> {
    if depth > 8 {
        return Ok(());
    }
    for entry in fs::read_dir(dir).map_err(|e| format!("{}: {e}", dir.display()))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if kind.is_dir() {
            gguf_files(&entry.path(), depth + 1, out)?;
        } else if kind.is_file()
            && entry
                .path()
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("gguf"))
        {
            let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
            if name.contains("mmproj")
                || name.starts_with("draft-")
                || (name.contains("-of-") && !name.contains("-00001-of-"))
            {
                continue;
            }
            out.push(entry.path());
        }
    }
    Ok(())
}

pub fn model_files(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();
    let built_in = root.join("portable-data/models");
    if built_in.is_dir() {
        gguf_files(&built_in, 0, &mut files)?;
    }
    for folder in load(root)?.model_folders {
        gguf_files(Path::new(&folder), 0, &mut files)?;
    }
    files.sort();
    files.dedup();
    Ok(files)
}

fn preset_path(root: &Path) -> PathBuf {
    root.join("portable-data/config/external-models.ini")
}

fn external_files(paths: &AppPaths) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();
    for folder in &paths.model_folders {
        gguf_files(Path::new(folder), 0, &mut files)?;
    }
    files.sort();
    Ok(files)
}

fn preset_id(index: usize, file: &Path) -> String {
    let name = file.file_stem().unwrap_or_default().to_string_lossy();
    let safe: String = name.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' }).collect();
    format!("external-{}-{}", index + 1, safe)
}

fn detail(id: String, file: &Path) -> ModelDetail {
    ModelDetail {
        id,
        file_name: file.file_name().unwrap_or_default().to_string_lossy().into_owned(),
        path: file.to_string_lossy().into_owned(),
        quantization: gguf_meta::quantization(file).map(str::to_owned),
        bytes: gguf_meta::total_size(file).ok(),
    }
}

pub fn model_details(root: &Path) -> Result<Vec<ModelDetail>, String> {
    let paths = load(root)?;
    let mut details = Vec::new();
    let built_in = root.join("portable-data/models");
    if built_in.is_dir() {
        let mut files = Vec::new();
        gguf_files(&built_in, 0, &mut files)?;
        for file in files {
            let id = file.file_stem().unwrap_or_default().to_string_lossy().into_owned();
            details.push(detail(id, &file));
        }
    }
    for (index, file) in external_files(&paths)?.iter().enumerate() {
        details.push(detail(preset_id(index, file), file));
    }
    Ok(details)
}

pub fn write_presets(root: &Path, paths: &AppPaths) -> Result<PathBuf, String> {
    let files = external_files(paths)?;
    let path = preset_path(root);
    let mut ini = String::from("version = 1\n");
    for (index, file) in files.iter().enumerate() {
        let id = preset_id(index, file);
        let file = file.to_string_lossy();
        if file.contains('\n') || file.contains('\r') {
            return Err("Model path contains a line break".into());
        }
        ini.push_str(&format!("\n[{id}]\nmodel = {}\n", file));
    }
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::write(&path, ini).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(path)
}

pub fn save(root: &Path, mut paths: AppPaths) -> Result<(), String> {
    if paths.model_folders.len() > 32 {
        return Err("Choose at most 32 model folders".into());
    }
    let mut unique = HashSet::new();
    let mut folders = Vec::new();
    for folder in &paths.model_folders {
        let folder = canonical_dir(folder)?;
        if unique.insert(folder.to_ascii_lowercase()) {
            folders.push(folder);
        }
    }
    paths.model_folders = folders;
    paths.cache_folder = match paths.cache_folder.as_deref() {
        Some(folder) if !folder.trim().is_empty() => Some(canonical_dir(folder)?),
        _ => None,
    };
    paths.logs_folder = match paths.logs_folder.as_deref() {
        Some(folder) if !folder.trim().is_empty() => Some(canonical_dir(folder)?),
        _ => None,
    };
    write_presets(root, &paths)?;
    let path = config_file(root);
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::write(
        &path,
        serde_json::to_vec_pretty(&paths).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("{}: {e}", path.display()))
}

pub fn list_logs(root: &Path) -> Result<Vec<LogFile>, String> {
    let dir = logs_dir(root)?;
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        if meta.is_file() {
            files.push(LogFile {
                name: entry.file_name().to_string_lossy().into_owned(),
                bytes: meta.len(),
            });
        }
    }
    files.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(files)
}

pub fn read_log(root: &Path, name: &str) -> Result<String, String> {
    if name.is_empty() || name == "." || name == ".." || name.contains('/') || name.contains('\\') {
        return Err("Invalid log name".into());
    }
    let path = logs_dir(root)?.join(name);
    let mut file = File::open(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    let start = file
        .metadata()
        .map_err(|e| e.to_string())?
        .len()
        .saturating_sub(200_000);
    file.seek(SeekFrom::Start(start))
        .map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}
