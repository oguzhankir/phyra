use std::{fs::OpenOptions, io::Read, path::Path};
pub(crate) const MAX_BLOB: u64 = 64 * 1024 * 1024;
pub(crate) const MAX_JSON: u64 = 1024 * 1024;
pub(crate) const MAX_LOG: u64 = 256 * 1024;
pub(crate) fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NONBLOCK);
    }
    let file = options.open(path).map_err(|e| e.to_string())?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err("Select a regular file".into());
    }
    if metadata.len() > limit {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounded_reads_require_a_regular_file() {
        let directory = tempfile::tempdir().unwrap();
        assert!(read_bounded(directory.path(), MAX_JSON).is_err());
        let path = directory.path().join("source.step");
        std::fs::write(&path, b"bounded source").unwrap();
        assert_eq!(read_bounded(&path, 32).unwrap(), b"bounded source");
        assert!(read_bounded(&path, 2).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn fifo_imports_fail_without_waiting_for_a_writer() {
        use std::{ffi::CString, os::unix::ffi::OsStrExt};
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("source.step");
        let name = CString::new(path.as_os_str().as_bytes()).unwrap();
        // The fixture is a named pipe in this test's owned temporary directory.
        assert_eq!(unsafe { libc::mkfifo(name.as_ptr(), 0o600) }, 0);
        assert!(read_bounded(&path, MAX_JSON).is_err());
    }
}
