use std::{fs::File, io::Read, path::Path};
pub(crate) const MAX_BLOB: u64 = 64 * 1024 * 1024;
pub(crate) const MAX_JSON: u64 = 1024 * 1024;
pub(crate) const MAX_LOG: u64 = 256 * 1024;
pub(crate) fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() > limit {
        return Err("File exceeds its resource limit".into());
    }
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > limit {
        return Err("File changed beyond its resource limit".into());
    }
    Ok(bytes)
}
