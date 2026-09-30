use super::validation::migrate_project;
use crate::platform::files::{MAX_BLOB, MAX_JSON};
use serde_json::Value;
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::Path,
};
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};
pub(crate) struct OpenedArchive {
    pub(crate) project: Value,
    pub(crate) migrated: bool,
    pub(crate) dropped_cache: bool,
}

pub(crate) fn read_archive_details(path: &Path, directory: &Path) -> Result<OpenedArchive, String> {
    if fs::metadata(path).map_err(|e| e.to_string())?.len() > MAX_BLOB + 2 * MAX_JSON {
        return Err("Project file exceeds resource limit".into());
    }
    let mut archive = ZipArchive::new(File::open(path).map_err(|e| e.to_string())?)
        .map_err(|_| "This is not a Phyra project archive".to_string())?;
    if archive.len() != 1 && archive.len() != 3 {
        return Err("Unexpected project archive contents".into());
    }
    let mut seen = std::collections::HashSet::new();
    let mut total = 0u64;
    let mut project = None;
    let mut cache = Vec::new();
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        if !["project.json", "manifest.json", "buffer.bin"].contains(&name.as_str())
            || !seen.insert(name.clone())
        {
            return Err("Unexpected or duplicate project entry".into());
        }
        let limit = if name == "buffer.bin" {
            MAX_BLOB
        } else {
            MAX_JSON
        };
        if entry.size() > limit {
            return Err("Project payload exceeds resource limit".into());
        }
        let mut bytes = Vec::new();
        entry
            .by_ref()
            .take(limit + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        total += bytes.len() as u64;
        if bytes.len() as u64 > limit || total > MAX_BLOB + 2 * MAX_JSON {
            return Err("Decompressed project exceeds resource limit".into());
        }
        if name == "project.json" {
            project = Some(
                serde_json::from_slice(&bytes)
                    .map_err(|e| format!("Invalid project metadata: {e}"))?,
            );
        } else {
            cache.push((name, bytes));
        }
    }
    let project = project.ok_or("Project metadata is missing")?;
    let (project, migrated) = migrate_project(project)?;
    let dropped_cache = migrated && !cache.is_empty();
    if !migrated && !cache.is_empty() {
        fs::create_dir_all(directory).map_err(|e| e.to_string())?;
        for (name, bytes) in cache {
            fs::write(directory.join(name), bytes).map_err(|e| e.to_string())?;
        }
    }
    Ok(OpenedArchive {
        project,
        migrated,
        dropped_cache,
    })
}

pub(crate) fn read_archive(path: &Path, directory: &Path) -> Result<Value, String> {
    Ok(read_archive_details(path, directory)?.project)
}

pub(crate) fn write_archive(
    path: &Path,
    project: &Value,
    cache: Option<&Path>,
) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid destination")?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    {
        let mut archive = ZipWriter::new(temporary.as_file_mut());
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        archive
            .start_file("project.json", options)
            .map_err(|e| e.to_string())?;
        archive
            .write_all(&serde_json::to_vec(project).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        if let Some(directory) = cache {
            for name in ["manifest.json", "buffer.bin"] {
                archive
                    .start_file(name, options)
                    .map_err(|e| e.to_string())?;
                let mut source = File::open(directory.join(name)).map_err(|e| e.to_string())?;
                std::io::copy(&mut source, &mut archive).map_err(|e| e.to_string())?;
            }
        }
        archive.finish().map_err(|e| e.to_string())?;
    }
    temporary.as_file().sync_all().map_err(|e| e.to_string())?;
    temporary
        .persist(path)
        .map_err(|e| format!("Could not replace the project safely: {e}"))?;
    Ok(())
}
