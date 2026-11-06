use std::fs::{self, File};
use std::io::{self, Read, Seek, SeekFrom};
use std::path::Path;

fn u32_le(file: &mut File) -> io::Result<u32> {
    let mut bytes = [0; 4];
    file.read_exact(&mut bytes)?;
    Ok(u32::from_le_bytes(bytes))
}

fn u64_le(file: &mut File) -> io::Result<u64> {
    let mut bytes = [0; 8];
    file.read_exact(&mut bytes)?;
    Ok(u64::from_le_bytes(bytes))
}

fn skip(file: &mut File, bytes: u64) -> io::Result<()> {
    let bytes = i64::try_from(bytes).map_err(|_| io::Error::other("GGUF value is too large"))?;
    file.seek(SeekFrom::Current(bytes))?;
    Ok(())
}

fn skip_value(file: &mut File, kind: u32) -> io::Result<()> {
    match kind {
        0 | 1 | 7 => skip(file, 1),
        2 | 3 => skip(file, 2),
        4 | 5 | 6 => skip(file, 4),
        10..=12 => skip(file, 8),
        8 => { let len = u64_le(file)?; skip(file, len) }
        9 => {
            let item_kind = u32_le(file)?;
            let count = u64_le(file)?;
            if count > 10_000_000 || item_kind == 9 { return Err(io::Error::other("Invalid GGUF array")); }
            for _ in 0..count { skip_value(file, item_kind)?; }
            Ok(())
        }
        _ => Err(io::Error::other("Unknown GGUF metadata type")),
    }
}

fn file_type_name(value: u32) -> Option<&'static str> {
    // Values follow llama_ftype / gguf-py LlamaFileType in the bundled llama.cpp tree.
    Some(match value {
        0 => "F32", 1 => "F16", 2 => "Q4_0", 3 => "Q4_1", 7 => "Q8_0",
        8 => "Q5_0", 9 => "Q5_1", 10 => "Q2_K", 11 => "Q3_K_S",
        12 => "Q3_K_M", 13 => "Q3_K_L", 14 => "Q4_K_S", 15 => "Q4_K_M",
        16 => "Q5_K_S", 17 => "Q5_K_M", 18 => "Q6_K", 19 => "IQ2_XXS",
        20 => "IQ2_XS", 21 => "Q2_K_S", 22 => "IQ3_XS", 23 => "IQ3_XXS",
        24 => "IQ1_S", 25 => "IQ4_NL", 26 => "IQ3_S", 27 => "IQ3_M",
        28 => "IQ2_S", 29 => "IQ2_M", 30 => "IQ4_XS", 31 => "IQ1_M",
        32 => "BF16", 36 => "TQ1_0", 37 => "TQ2_0", 38 => "MXFP4_MOE",
        39 => "NVFP4", 40 => "Q1_0", 41 => "Q2_0",
        _ => return None,
    })
}

pub fn quantization(path: &Path) -> Option<&'static str> {
    let mut file = File::open(path).ok()?;
    let mut magic = [0; 4];
    file.read_exact(&mut magic).ok()?;
    if &magic != b"GGUF" { return None; }
    let version = u32_le(&mut file).ok()?;
    if !(2..=3).contains(&version) { return None; }
    let _tensor_count = u64_le(&mut file).ok()?;
    let kv_count = u64_le(&mut file).ok()?;
    if kv_count > 100_000 { return None; }
    for _ in 0..kv_count {
        let key_len = u64_le(&mut file).ok()?;
        if key_len > 1024 { return None; }
        let mut key = vec![0; key_len as usize];
        file.read_exact(&mut key).ok()?;
        let kind = u32_le(&mut file).ok()?;
        if key == b"general.file_type" {
            return match kind {
                4 => file_type_name(u32_le(&mut file).ok()?),
                10 => file_type_name(u32::try_from(u64_le(&mut file).ok()?).ok()?),
                _ => None,
            };
        }
        skip_value(&mut file, kind).ok()?;
    }
    None
}

pub fn total_size(path: &Path) -> io::Result<u64> {
    let first = fs::metadata(path)?.len();
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else { return Ok(first); };
    let Some(start) = name.find("-00001-of-") else { return Ok(first); };
    let remaining = &name[start + "-00001-of-".len()..];
    let Some(total_text) = remaining.strip_suffix(".gguf") else { return Ok(first); };
    let Ok(total) = total_text.parse::<usize>() else { return Ok(first); };
    if total <= 1 || total > 1000 { return Ok(first); }
    let mut bytes = first;
    for index in 2..=total {
        let shard = path.with_file_name(format!("{}-{index:05}-of-{total_text}.gguf", &name[..start]));
        bytes = bytes.saturating_add(fs::metadata(shard)?.len());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn reads_quant_without_filename_hint() {
        let path = std::env::temp_dir().join(format!("gguf-meta-{}-model.gguf", std::process::id()));
        let mut file = File::create(&path).unwrap();
        file.write_all(b"GGUF").unwrap();
        file.write_all(&3u32.to_le_bytes()).unwrap();
        file.write_all(&0u64.to_le_bytes()).unwrap();
        file.write_all(&1u64.to_le_bytes()).unwrap();
        file.write_all(&17u64.to_le_bytes()).unwrap();
        file.write_all(b"general.file_type").unwrap();
        file.write_all(&4u32.to_le_bytes()).unwrap();
        file.write_all(&15u32.to_le_bytes()).unwrap();
        drop(file);
        assert_eq!(quantization(&path), Some("Q4_K_M"));
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn includes_all_split_shards_in_size() {
        let dir = std::env::temp_dir();
        let prefix = format!("gguf-meta-{}", std::process::id());
        let first = dir.join(format!("{prefix}-00001-of-00002.gguf"));
        let second = dir.join(format!("{prefix}-00002-of-00002.gguf"));
        fs::write(&first, [0u8; 3]).unwrap();
        fs::write(&second, [0u8; 5]).unwrap();
        assert_eq!(total_size(&first).unwrap(), 8);
        fs::remove_file(first).unwrap();
        fs::remove_file(second).unwrap();
    }
}
