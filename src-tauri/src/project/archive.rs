use super::{
    assets::{
        metadata_sources, read_source, source_name, store_source, verify_source, MAX_CAD_ASSETS,
        MAX_CAD_SOURCE,
    },
    validation::migrate_project,
};
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
    read_archive_details_with_assets(path, directory, None)
}

pub(crate) fn read_archive_details_with_assets(
    path: &Path,
    directory: &Path,
    sources: Option<&Path>,
) -> Result<OpenedArchive, String> {
    let maximum = MAX_BLOB + MAX_CAD_ASSETS + 2 * MAX_JSON;
    if fs::metadata(path).map_err(|e| e.to_string())?.len() > maximum {
        return Err("Project file exceeds resource limit".into());
    }
    let mut archive = ZipArchive::new(File::open(path).map_err(|e| e.to_string())?)
        .map_err(|_| "This is not a Phyra project archive".to_string())?;
    if archive.is_empty() || archive.len() > 35 {
        return Err("Unexpected project archive contents".into());
    }
    let mut seen = std::collections::HashSet::new();
    let mut total = 0u64;
    let mut project: Option<Value> = None;
    let mut cache = Vec::new();
    let mut assets = std::collections::HashMap::new();
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        let asset = name
            .strip_prefix("assets/")
            .and_then(|name| name.strip_suffix(".step"));
        if asset.is_some_and(|hash| source_name(hash).is_err())
            || (asset.is_none()
                && !["project.json", "manifest.json", "buffer.bin"].contains(&name.as_str()))
            || !seen.insert(name.clone())
        {
            return Err("Unexpected or duplicate project entry".into());
        }
        let limit = if asset.is_some() {
            MAX_CAD_SOURCE
        } else if name == "buffer.bin" {
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
        if bytes.len() as u64 > limit || total > maximum {
            return Err("Decompressed project exceeds resource limit".into());
        }
        if let Some(hash) = asset {
            assets.insert(hash.to_string(), bytes);
        } else if name == "project.json" {
            project = Some(
                serde_json::from_slice(&bytes)
                    .map_err(|e| format!("Invalid project metadata: {e}"))?,
            );
        } else {
            cache.push((name, bytes));
        }
    }
    let project = project.ok_or("Project metadata is missing")?;
    let source_version = project["schemaVersion"]
        .as_u64()
        .ok_or("Unsupported project schema version")?;
    let (project, migrated) = migrate_project(project)?;
    let references = metadata_sources(&project)?;
    let expected: std::collections::HashSet<_> = references
        .iter()
        .map(|source| source["sha256"].as_str().unwrap())
        .collect();
    if expected.len() != assets.len() || assets.keys().any(|hash| !expected.contains(hash.as_str()))
    {
        return Err("CAD archive source inventory differs from its definition".into());
    }
    for source in &references {
        let bytes = assets
            .get(source["sha256"].as_str().unwrap())
            .ok_or("CAD archive source is missing")?;
        verify_source(source, bytes)?;
    }
    if !references.is_empty() {
        let root = sources.ok_or("CAD archive requires native definition-source storage")?;
        for source in references {
            store_source(root, source, &assets[source["sha256"].as_str().unwrap()])?;
        }
    }
    if !cache.is_empty() && cache.len() != 2 {
        return Err("Incomplete result cache in project archive".into());
    }
    if !cache.is_empty() && (project["study"].is_null() || project["geometry"]["kind"] == "empty") {
        return Err("A definition-only CAD project cannot contain numerical result caches".into());
    }
    // v1 has a different study contract. v2/v3/v4 -> v6 preserve the default
    // strong-form algorithm; retained fields still pass the worker's
    // normal ownership, physical fingerprint and scientific validation.
    let dropped_cache = source_version == 1 && !cache.is_empty();
    if !dropped_cache && !cache.is_empty() {
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
    write_archive_with_assets(path, project, cache, None)
}

pub(crate) fn write_archive_with_assets(
    path: &Path,
    project: &Value,
    cache: Option<&Path>,
    sources: Option<&Path>,
) -> Result<(), String> {
    let definition = serde_json::to_vec(project).map_err(|e| e.to_string())?;
    if definition.len() as u64 > MAX_JSON {
        return Err("Project definition exceeds the cumulative 1 MiB limit".into());
    }
    let references = metadata_sources(project)?;
    let mut assets = std::collections::BTreeMap::new();
    if !references.is_empty() {
        let root = sources.ok_or("CAD project sources are not available")?;
        for source in references {
            let hash = source["sha256"]
                .as_str()
                .ok_or("Missing CAD source digest")?;
            assets.insert(hash.to_string(), read_source(root, source)?);
        }
    }
    let parent = path.parent().ok_or("Invalid destination")?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    {
        let mut archive = ZipWriter::new(temporary.as_file_mut());
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        archive
            .start_file("project.json", options)
            .map_err(|e| e.to_string())?;
        archive.write_all(&definition).map_err(|e| e.to_string())?;
        for (hash, bytes) in assets {
            archive
                .start_file(format!("assets/{}", source_name(&hash)?), options)
                .map_err(|e| e.to_string())?;
            archive.write_all(&bytes).map_err(|e| e.to_string())?;
        }
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
