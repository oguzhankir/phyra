//! Immutable CAD definition sources. Renderer metadata never supplies a path.
use crate::platform::files::read_bounded;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::Manager;

pub(crate) const MAX_CAD_SOURCE: u64 = 16 * 1024 * 1024;
pub(crate) const MAX_CAD_ASSETS: u64 = 64 * 1024 * 1024;
const MAX_STORE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_STORE_ENTRIES: usize = 1024;
static SOURCE_WRITES: Mutex<()> = Mutex::new(());

pub(crate) fn asset_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("cad-sources-v1"))
}

pub(crate) fn source_hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub(crate) fn source_name(hash: &str) -> Result<String, String> {
    if hash.len() != 64
        || !hash
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err("Invalid CAD source digest".into());
    }
    Ok(format!("{hash}.step"))
}

pub(crate) fn metadata_sources(project: &Value) -> Result<Vec<&Value>, String> {
    if project["geometry"]["kind"] != "cad" {
        return Ok(Vec::new());
    }
    let sources = project["geometry"]["assets"]
        .as_array()
        .ok_or("Missing CAD source metadata")?;
    if sources.len() > 32 {
        return Err("Too many CAD source files".into());
    }
    let mut total = 0u64;
    for source in sources {
        source_name(
            source["sha256"]
                .as_str()
                .ok_or("Missing CAD source digest")?,
        )?;
        let size = source["byteLength"]
            .as_u64()
            .ok_or("Invalid CAD source size")?;
        if size == 0 || size > MAX_CAD_SOURCE || source["kind"] != "step-source" {
            return Err("Invalid or oversized CAD source".into());
        }
        total = total
            .checked_add(size)
            .ok_or("CAD source size limit exceeded")?;
        if total > MAX_CAD_ASSETS {
            return Err("CAD sources exceed 64 MiB".into());
        }
    }
    Ok(sources.iter().collect())
}

pub(crate) fn verify_source(source: &Value, bytes: &[u8]) -> Result<(), String> {
    if source["kind"] != "step-source"
        || source["byteLength"].as_u64() != Some(bytes.len() as u64)
        || bytes.is_empty()
        || bytes.len() as u64 > MAX_CAD_SOURCE
        || source["sha256"].as_str() != Some(source_hash(bytes).as_str())
    {
        return Err("CAD source size or digest differs from its definition".into());
    }
    Ok(())
}

pub(crate) fn ensure_store(root: &Path) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    if !fs::symlink_metadata(root)
        .map_err(|e| e.to_string())?
        .is_dir()
    {
        return Err("CAD source store is not an owned directory".into());
    }
    Ok(())
}

pub(crate) fn read_source(root: &Path, source: &Value) -> Result<Vec<u8>, String> {
    let path = root.join(source_name(
        source["sha256"].as_str().ok_or("Missing CAD digest")?,
    )?);
    if !fs::symlink_metadata(&path)
        .map_err(|_| "The CAD source is missing; reopen the saved project")?
        .is_file()
    {
        return Err("CAD source is not a regular owned file".into());
    }
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options.open(&path).map_err(|e| e.to_string())?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_CAD_SOURCE {
        return Err("CAD source is not a bounded regular owned file".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_CAD_SOURCE + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    verify_source(source, &bytes)?;
    Ok(bytes)
}

pub(crate) fn verify_sources(root: &Path, project: &Value) -> Result<(), String> {
    for source in metadata_sources(project)? {
        read_source(root, source)?;
    }
    Ok(())
}

pub(crate) fn store_source(root: &Path, source: &Value, bytes: &[u8]) -> Result<(), String> {
    let _write = SOURCE_WRITES.lock().map_err(|e| e.to_string())?;
    verify_source(source, bytes)?;
    ensure_store(root)?;
    let path = root.join(source_name(
        source["sha256"].as_str().ok_or("Missing CAD digest")?,
    )?);
    if path.exists() {
        read_source(root, source)?;
        return Ok(());
    }
    let mut count = 0usize;
    let mut total = bytes.len() as u64;
    for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let metadata = fs::symlink_metadata(entry.path()).map_err(|e| e.to_string())?;
        if !metadata.is_file() {
            return Err("Unexpected CAD source store entry".into());
        }
        count += 1;
        total = total
            .checked_add(metadata.len())
            .ok_or("CAD source store is full")?;
        if count >= MAX_STORE_ENTRIES || total > MAX_STORE_BYTES {
            return Err(
                "CAD definition source storage is full. Existing recovery sources were preserved."
                    .into(),
            );
        }
    }
    let mut temporary = tempfile::NamedTempFile::new_in(root).map_err(|e| e.to_string())?;
    temporary.write_all(bytes).map_err(|e| e.to_string())?;
    temporary.as_file().sync_all().map_err(|e| e.to_string())?;
    match temporary.persist_noclobber(&path) {
        Ok(_) => Ok(()),
        Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists => {
            read_source(root, source).map(|_| ())
        }
        Err(error) => Err(format!("Could not retain CAD definition source: {error}")),
    }
}

pub(crate) fn import_source(root: &Path, selected: &Path) -> Result<Value, String> {
    let extension = selected
        .extension()
        .and_then(|name| name.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "step" | "stp") {
        return Err("Select a STEP (.step or .stp) source file".into());
    }
    let bytes = read_bounded(selected, MAX_CAD_SOURCE)?;
    let hash = source_hash(&bytes);
    let name = selected
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or("Invalid source filename")?;
    if name.chars().count() > 200 {
        return Err("CAD source filename exceeds its limit".into());
    }
    let source = json!({"id":format!("source-{}", &hash[..24]),"kind":"step-source","originalName":name,"sha256":hash,"byteLength":bytes.len()});
    store_source(root, &source, &bytes)?;
    Ok(source)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn source(bytes: &[u8]) -> Value {
        json!({"kind":"step-source","sha256":source_hash(bytes),"byteLength":bytes.len()})
    }
    #[test]
    fn immutable_sources_reject_corruption_and_path_traversal() {
        let root = tempfile::tempdir().unwrap();
        let bytes = b"ISO-10303-21;\nEND-ISO-10303-21;";
        let metadata = source(bytes);
        store_source(root.path(), &metadata, bytes).unwrap();
        assert_eq!(read_source(root.path(), &metadata).unwrap(), bytes);
        assert!(source_name("../anything").is_err());
        fs::write(
            root.path()
                .join(source_name(metadata["sha256"].as_str().unwrap()).unwrap()),
            b"corrupt",
        )
        .unwrap();
        assert!(read_source(root.path(), &metadata).is_err());
        assert!(store_source(root.path(), &metadata, bytes).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn source_links_are_rejected() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::NamedTempFile::new().unwrap();
        fs::write(outside.path(), b"source").unwrap();
        let metadata = source(b"source");
        std::os::unix::fs::symlink(
            outside.path(),
            root.path()
                .join(source_name(metadata["sha256"].as_str().unwrap()).unwrap()),
        )
        .unwrap();
        assert!(read_source(root.path(), &metadata).is_err());
    }
}
