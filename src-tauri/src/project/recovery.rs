//! Local project-definition journals. Never write an application-selected file.
//! A session owns one atomic checkpoint; results remain explicit project saves.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs::{self, File, TryLockError},
    io::Write,
    path::{Path, PathBuf},
    sync::{atomic::Ordering, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

use super::{state::ProjectState, validation::validate_project};
use crate::{
    execution::state::EngineState,
    platform::files::{read_bounded, MAX_JSON},
    verification::verification_enabled,
};

const MAX_RECORDS: usize = 64;
const MAX_RECORD_BYTES: u64 = MAX_JSON + 4096;
const MAX_SEQUENCE: u64 = 9_007_199_254_740_991;

pub(crate) struct RecoveryState {
    session: String,
    sequence: Mutex<u64>,
    lease: Mutex<Option<File>>,
}

impl Default for RecoveryState {
    fn default() -> Self {
        Self {
            session: uuid::Uuid::new_v4().to_string(),
            sequence: Mutex::new(0),
            lease: Mutex::new(None),
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Record {
    format_version: u64,
    saved_at: u64,
    app_version: String,
    project: Value,
}

fn record_path(directory: &Path, id: &str) -> Result<PathBuf, String> {
    let parsed = uuid::Uuid::parse_str(id).map_err(|_| "Invalid recovery identity")?;
    if parsed.to_string() != id {
        return Err("Invalid recovery identity".into());
    }
    Ok(directory.join(format!("{id}.json")))
}

fn ensure_directory(directory: &Path) -> Result<(), String> {
    fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    if !fs::symlink_metadata(directory)
        .map_err(|e| e.to_string())?
        .is_dir()
    {
        return Err("Recovery storage is not an owned directory".into());
    }
    Ok(())
}

fn read_record(path: &Path) -> Result<Record, String> {
    if !fs::symlink_metadata(path)
        .map_err(|e| e.to_string())?
        .is_file()
    {
        return Err("Recovery copy is not a regular file".into());
    }
    let record: Record = serde_json::from_slice(&read_bounded(path, MAX_RECORD_BYTES)?)
        .map_err(|_| "The recovery copy could not be read")?;
    if record.format_version != 1
        || record.saved_at == 0
        || record.saved_at > MAX_SEQUENCE
        || record.app_version.len() > 40
        || record.app_version.is_empty()
    {
        return Err("Unsupported recovery metadata".into());
    }
    validate_project(&record.project)?;
    Ok(record)
}

// A standard OS file lock lives as long as the session's handle. Recovery from
// another still-open window is never offered, restored or discarded.
fn lock_record(directory: &Path, id: &str) -> Result<Option<File>, String> {
    let path = record_path(directory, id)?.with_extension("lock");
    match fs::symlink_metadata(&path) {
        Ok(metadata) if !metadata.is_file() => {
            return Err("Invalid recovery session lock".into());
        }
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.to_string()),
        _ => {}
    }
    let file = File::options()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)
        .map_err(|e| e.to_string())?;
    match file.try_lock() {
        Ok(()) => Ok(Some(file)),
        Err(TryLockError::WouldBlock) => Ok(None),
        Err(TryLockError::Error(e)) => Err(e.to_string()),
    }
}

fn journal_paths(directory: &Path) -> Result<Vec<(String, PathBuf)>, String> {
    if !directory.exists() {
        return Ok(Vec::new());
    }
    ensure_directory(directory)?;
    let mut paths = Vec::new();
    for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        // Never unlink a lock identity: another process may acquire its handle
        // between unlocking and deletion. Zero-byte leases contain no project
        // data and do not count against the bounded checkpoint inventory.
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let Some(id) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        if record_path(directory, id).is_err() {
            continue;
        }
        if paths.len() == MAX_RECORDS {
            // A concurrently created or externally copied journal must not
            // prevent reviewing/discarding existing work. Offer one bounded
            // batch; subsequent inventories expose the remaining copies.
            break;
        }
        paths.push((id.to_owned(), path));
    }
    Ok(paths)
}

fn write_checkpoint(
    directory: &Path,
    state: &RecoveryState,
    project: &Value,
    sequence: u64,
) -> Result<Value, String> {
    validate_project(project)?;
    if sequence == 0 || sequence > MAX_SEQUENCE {
        return Err("Invalid recovery sequence".into());
    }
    let mut latest = state.sequence.lock().map_err(|e| e.to_string())?;
    if sequence <= *latest {
        return Ok(json!({"accepted":false,"savedAt":0,"revision":project["revision"]}));
    }
    ensure_directory(directory)?;
    let mut lease = state.lease.lock().map_err(|e| e.to_string())?;
    if lease.is_none() {
        *lease = Some(
            lock_record(directory, &state.session)?.ok_or("Recovery session is already owned")?,
        );
    }
    let path = record_path(directory, &state.session)?;
    let paths = journal_paths(directory)?;
    if !path.exists() && paths.len() >= MAX_RECORDS {
        return Err("Recovery storage is full. Review and discard unused recovery copies.".into());
    }
    let saved_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "System clock cannot timestamp recovery")?
        .as_millis();
    let saved_at = u64::try_from(saved_at)
        .ok()
        .filter(|t| *t > 0 && *t <= MAX_SEQUENCE)
        .ok_or("System clock cannot timestamp recovery")?;
    let record = Record {
        format_version: 1,
        saved_at,
        app_version: env!("CARGO_PKG_VERSION").into(),
        project: project.clone(),
    };
    let bytes = serde_json::to_vec(&record).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_RECORD_BYTES {
        return Err("Recovery copy exceeds its resource limit".into());
    }
    let mut temporary = tempfile::NamedTempFile::new_in(directory).map_err(|e| e.to_string())?;
    temporary.write_all(&bytes).map_err(|e| e.to_string())?;
    temporary.as_file().sync_all().map_err(|e| e.to_string())?;
    temporary.persist(&path).map_err(|e| e.to_string())?;
    *latest = sequence;
    Ok(json!({"accepted":true,"savedAt":saved_at,"revision":project["revision"]}))
}

fn clear_checkpoint(
    directory: &Path,
    state: &RecoveryState,
    sequence: u64,
    recovery_id: Option<&str>,
) -> Result<(), String> {
    if sequence == 0 || sequence > MAX_SEQUENCE {
        return Err("Invalid recovery sequence".into());
    }
    let mut latest = state.sequence.lock().map_err(|e| e.to_string())?;
    let id = recovery_id.unwrap_or(&state.session);
    if (recovery_id.is_none() || id == state.session) && sequence <= *latest {
        return Ok(());
    }
    if directory.exists() {
        ensure_directory(directory)?;
    }
    let path = record_path(directory, id)?;
    let _lease = if id != state.session && directory.exists() {
        Some(
            lock_record(directory, id)?
                .ok_or("This recovery copy belongs to an open application")?,
        )
    } else {
        None
    };
    match fs::remove_file(path) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.to_string()),
    }
    if recovery_id.is_none() || id == state.session {
        *latest = sequence.max(*latest);
    }
    Ok(())
}

fn directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if verification_enabled() {
        return Err("Recovery is isolated from workflow verification".into());
    }
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("recovery");
    ensure_directory(&path)?;
    Ok(path)
}

#[tauri::command]
pub(crate) async fn get_recovery(app: tauri::AppHandle) -> Result<Value, String> {
    if verification_enabled() {
        return Ok(json!({"records":[],"unreadableCount":0}));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<RecoveryState>();
        inventory(&directory(&app)?, &state)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn inventory(root: &Path, state: &RecoveryState) -> Result<Value, String> {
    let mut records = Vec::new();
    let mut unreadable = 0;
    for (id, path) in journal_paths(root)? {
        if id == state.session {
            continue;
        }
        let _lease = match lock_record(root, &id) {
            Ok(Some(file)) => file,
            Ok(None) => continue,
            Err(_) => {
                unreadable += 1;
                continue;
            }
        };
        match read_record(&path) {
            Ok(record) => records.push(json!({"id":id,"savedAt":record.saved_at,
                    "projectName":record.project["name"],"revision":record.project["revision"]})),
            Err(_) => unreadable += 1,
        }
    }
    records.sort_by_key(|r| std::cmp::Reverse(r["savedAt"].as_u64().unwrap_or(0)));
    Ok(json!({"records":records,"unreadableCount":unreadable}))
}

pub(crate) fn verify_definition_recovery(project: &Value, parent: &Path) -> Result<Value, String> {
    let temporary = tempfile::Builder::new()
        .prefix("verification-recovery-")
        .tempdir_in(parent)
        .map_err(|e| e.to_string())?;
    let state = RecoveryState::default();
    let id = state.session.clone();
    write_checkpoint(temporary.path(), &state, project, 1)?;
    let another_window = RecoveryState::default();
    let protected = inventory(temporary.path(), &another_window)?["records"]
        .as_array()
        .is_some_and(Vec::is_empty)
        && clear_checkpoint(temporary.path(), &another_window, 1, Some(&id)).is_err();
    drop(state);
    let offered = inventory(temporary.path(), &another_window)?["records"]
        .as_array()
        .is_some_and(|records| records.len() == 1 && records[0]["id"] == id);
    let restored = read_record(&record_path(temporary.path(), &id)?)?;
    let matches = restored.project == *project;
    write_checkpoint(temporary.path(), &another_window, &restored.project, 2)?;
    clear_checkpoint(temporary.path(), &another_window, 3, Some(&id))?;
    clear_checkpoint(temporary.path(), &another_window, 5, None)?;
    let rejected = write_checkpoint(temporary.path(), &another_window, project, 4)?["accepted"]
        == false
        && journal_paths(temporary.path())?.is_empty();
    if !protected || !offered || !matches || !rejected {
        return Err("Native project-definition recovery verification failed".into());
    }
    drop(another_window);
    temporary.close().map_err(|e| e.to_string())?;
    Ok(
        json!({"projectMatches":matches,"activeSessionProtected":protected,
        "closedSessionOffered":offered,"lateWriteRejected":rejected,"resultsIncluded":false}),
    )
}

#[tauri::command]
pub(crate) async fn write_recovery(
    app: tauri::AppHandle,
    project: Value,
    sequence: u64,
    restored: Option<bool>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if app
            .state::<EngineState>()
            .shutting_down
            .load(Ordering::SeqCst)
        {
            return Err("Application is closing".into());
        }
        let restored = restored.unwrap_or(false);
        let active = app.state::<EngineState>();
        let active_guard = if restored {
            let guard = active.active.lock().map_err(|e| e.to_string())?;
            if guard.is_some() {
                return Err(
                    "Wait for or cancel the analysis before restoring a recovery copy".into(),
                );
            }
            Some(guard)
        } else {
            None
        };
        let receipt = write_checkpoint(
            &directory(&app)?,
            &app.state::<RecoveryState>(),
            &project,
            sequence,
        )?;
        if restored && receipt["accepted"] == true {
            *app.state::<ProjectState>()
                .current_path
                .lock()
                .map_err(|e| e.to_string())? = None;
        }
        drop(active_guard);
        Ok(receipt)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn read_recovery(
    app: tauri::AppHandle,
    recovery_id: String,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if app
            .state::<EngineState>()
            .active
            .lock()
            .map_err(|e| e.to_string())?
            .is_some()
        {
            return Err("Wait for or cancel the analysis before restoring a recovery copy".into());
        }
        let root = directory(&app)?;
        let _lease = lock_record(&root, &recovery_id)?
            .ok_or("This recovery copy belongs to an open application")?;
        let record = read_record(&record_path(&root, &recovery_id)?)?;
        Ok(json!({"project":record.project,"savedAt":record.saved_at}))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn clear_recovery(
    app: tauri::AppHandle,
    sequence: u64,
    recovery_id: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        clear_checkpoint(
            &directory(&app)?,
            &app.state::<RecoveryState>(),
            sequence,
            recovery_id.as_deref(),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(revision: u64) -> Value {
        let mut value: Value =
            serde_json::from_str(include_str!("../../../examples/cantilever.json")).unwrap();
        value["name"] = json!("Çalışma ü recovery");
        value["revision"] = json!(revision);
        value
    }

    #[test]
    fn atomic_checkpoint_round_trip_preserves_authoritative_si_definition() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("spaced ü recovery");
        let state = RecoveryState::default();
        let original = project(4);
        let receipt = write_checkpoint(&root, &state, &original, 1).unwrap();
        assert_eq!(receipt["accepted"], true);
        assert_eq!(
            read_record(&record_path(&root, &state.session).unwrap())
                .unwrap()
                .project,
            original
        );
        write_checkpoint(&root, &state, &project(5), 2).unwrap();
        assert_eq!(journal_paths(&root).unwrap().len(), 1);
        assert_eq!(
            read_record(&record_path(&root, &state.session).unwrap())
                .unwrap()
                .project["revision"],
            5
        );
    }

    #[test]
    fn late_checkpoint_cannot_resurrect_an_explicitly_discarded_session() {
        let temp = tempfile::tempdir().unwrap();
        let state = RecoveryState::default();
        write_checkpoint(temp.path(), &state, &project(4), 2).unwrap();
        clear_checkpoint(temp.path(), &state, 4, None).unwrap();
        let late = write_checkpoint(temp.path(), &state, &project(5), 3).unwrap();
        assert_eq!(late["accepted"], false);
        assert!(journal_paths(temp.path()).unwrap().is_empty());
        write_checkpoint(temp.path(), &state, &project(6), 5).unwrap();
        clear_checkpoint(temp.path(), &state, 3, None).unwrap();
        clear_checkpoint(temp.path(), &state, 3, Some(&state.session)).unwrap();
        assert_eq!(
            read_record(&record_path(temp.path(), &state.session).unwrap())
                .unwrap()
                .project["revision"],
            6
        );
    }

    #[test]
    fn invalid_snapshot_or_interrupted_temporary_write_keeps_previous_checkpoint() {
        let temp = tempfile::tempdir().unwrap();
        let state = RecoveryState::default();
        let original = project(4);
        write_checkpoint(temp.path(), &state, &original, 1).unwrap();
        let mut invalid = project(5);
        invalid["study"]["material"]["young"] = json!(-1);
        assert!(write_checkpoint(temp.path(), &state, &invalid, 2).is_err());
        let mut interrupted = tempfile::NamedTempFile::new_in(temp.path()).unwrap();
        interrupted.write_all(b"incomplete new data").unwrap();
        assert_eq!(journal_paths(temp.path()).unwrap().len(), 1);
        assert_eq!(
            read_record(&record_path(temp.path(), &state.session).unwrap())
                .unwrap()
                .project,
            original
        );
    }

    #[test]
    fn sessions_are_isolated_and_malformed_or_oversized_copies_are_rejected() {
        let temp = tempfile::tempdir().unwrap();
        let a = RecoveryState::default();
        let b = RecoveryState::default();
        write_checkpoint(temp.path(), &a, &project(1), 1).unwrap();
        write_checkpoint(temp.path(), &b, &project(2), 1).unwrap();
        clear_checkpoint(temp.path(), &a, 2, None).unwrap();
        let b_path = record_path(temp.path(), &b.session).unwrap();
        assert_eq!(read_record(&b_path).unwrap().project["revision"], 2);
        assert!(record_path(temp.path(), "../project").is_err());
        fs::write(&b_path, b"{broken").unwrap();
        assert!(read_record(&b_path).is_err());
        assert!(b_path.exists());
        fs::write(&b_path, vec![0; MAX_RECORD_BYTES as usize + 1]).unwrap();
        assert!(read_record(&b_path).is_err());
    }

    #[test]
    fn open_session_is_not_recoverable_or_discardable_by_another_window() {
        let temp = tempfile::tempdir().unwrap();
        let active = RecoveryState::default();
        let other = RecoveryState::default();
        let id = active.session.clone();
        write_checkpoint(temp.path(), &active, &project(1), 1).unwrap();
        assert!(lock_record(temp.path(), &id).unwrap().is_none());
        assert!(clear_checkpoint(temp.path(), &other, 1, Some(&id)).is_err());
        drop(active);
        assert!(lock_record(temp.path(), &id).unwrap().is_some());
        assert_eq!(
            read_record(&record_path(temp.path(), &id).unwrap())
                .unwrap()
                .project,
            project(1)
        );
        clear_checkpoint(temp.path(), &other, 2, Some(&id)).unwrap();
        assert!(journal_paths(temp.path()).unwrap().is_empty());
        assert!(record_path(temp.path(), &id)
            .unwrap()
            .with_extension("lock")
            .exists());
    }

    #[test]
    fn inventory_preserves_lock_identity_before_first_checkpoint_and_after_discard() {
        let temp = tempfile::tempdir().unwrap();
        let state = RecoveryState::default();
        let id = state.session.clone();
        let lock_path = record_path(temp.path(), &id)
            .unwrap()
            .with_extension("lock");
        let lease = lock_record(temp.path(), &id).unwrap().unwrap();
        assert_eq!(
            inventory(temp.path(), &state).unwrap()["unreadableCount"],
            0
        );
        assert!(lock_path.exists());
        assert!(lock_record(temp.path(), &id).unwrap().is_none());
        drop(lease);
        assert!(journal_paths(temp.path()).unwrap().is_empty());
        assert!(lock_path.exists());
        assert_eq!(fs::metadata(lock_path).unwrap().len(), 0);
    }

    #[cfg(unix)]
    #[test]
    fn a_dangling_lock_symlink_cannot_create_a_file_outside_recovery_storage() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("recovery");
        fs::create_dir(&root).unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let outside = temp.path().join("outside");
        std::os::unix::fs::symlink(
            &outside,
            record_path(&root, &id).unwrap().with_extension("lock"),
        )
        .unwrap();
        assert!(lock_record(&root, &id).is_err());
        assert!(!outside.exists());
    }

    #[test]
    fn storage_limit_preserves_existing_copies_and_never_evicts_unsaved_work() {
        let temp = tempfile::tempdir().unwrap();
        let state = RecoveryState::default();
        for _ in 0..MAX_RECORDS {
            let id = uuid::Uuid::new_v4().to_string();
            fs::write(
                record_path(temp.path(), &id).unwrap(),
                b"unreadable but retained",
            )
            .unwrap();
        }
        assert!(write_checkpoint(temp.path(), &state, &project(1), 1).is_err());
        assert_eq!(journal_paths(temp.path()).unwrap().len(), MAX_RECORDS);
        assert_eq!(*state.sequence.lock().unwrap(), 0);
    }

    #[test]
    fn overfull_storage_still_offers_bounded_recovery_and_preserves_every_copy() {
        let temp = tempfile::tempdir().unwrap();
        let state = RecoveryState::default();
        let record = Record {
            format_version: 1,
            saved_at: 1,
            app_version: env!("CARGO_PKG_VERSION").into(),
            project: project(1),
        };
        let bytes = serde_json::to_vec(&record).unwrap();
        for _ in 0..MAX_RECORDS + 1 {
            let id = uuid::Uuid::new_v4().to_string();
            fs::write(record_path(temp.path(), &id).unwrap(), &bytes).unwrap();
        }
        let offered = inventory(temp.path(), &state).unwrap();
        assert_eq!(offered["records"].as_array().unwrap().len(), MAX_RECORDS);
        assert_eq!(offered["unreadableCount"], 0);
        assert!(write_checkpoint(temp.path(), &state, &project(2), 1).is_err());
        assert_eq!(
            fs::read_dir(temp.path())
                .unwrap()
                .filter_map(Result::ok)
                .filter(|entry| entry
                    .path()
                    .extension()
                    .is_some_and(|suffix| suffix == "json"))
                .count(),
            MAX_RECORDS + 1
        );
        clear_checkpoint(temp.path(), &state, 2, offered["records"][0]["id"].as_str()).unwrap();
        assert_eq!(
            inventory(temp.path(), &state).unwrap()["records"]
                .as_array()
                .unwrap()
                .len(),
            MAX_RECORDS
        );
    }
}
