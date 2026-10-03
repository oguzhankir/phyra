//! Local project-definition journals. Never write an application-selected file.
//! A session owns one atomic checkpoint; results remain explicit project saves.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File, TryLockError},
    io::Write,
    path::{Path, PathBuf},
    sync::{atomic::Ordering, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

use super::{
    state::{document_identity, ProjectState, LEGACY_DOCUMENT_ID},
    validation::{migrate_project, validate_project},
};
use crate::{
    execution::state::{activate_result_owner, EngineState},
    platform::files::{read_bounded, MAX_JSON},
    verification::verification_enabled,
};

const MAX_RECORDS: usize = 64;
const MAX_RECORD_BYTES: u64 = MAX_JSON + 4096;
const MAX_SEQUENCE: u64 = 9_007_199_254_740_991;
const MAX_CLIENT_GENERATIONS: usize = 256;

#[derive(Default)]
pub(crate) struct RecoveryState {
    // Kept for headless/native verification callers without document identity.
    session: Mutex<RecoverySession>,
    documents: Mutex<DocumentRecovery>,
}

#[derive(Default)]
struct DocumentRecovery {
    owner: Option<String>,
    retired_owners: HashSet<String>,
    sessions: HashMap<String, RecoverySession>,
    retired_clients: HashSet<String>,
}

struct DocumentClient<'a> {
    owner: &'a str,
    document: &'a str,
    client: &'a str,
}

struct RecoverySession {
    id: String,
    client: Option<String>,
    sequence: u64,
    lease: Option<File>,
    retired_clients: std::collections::HashSet<String>,
}

impl Default for RecoverySession {
    fn default() -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            client: None,
            sequence: 0,
            lease: None,
            retired_clients: std::collections::HashSet::new(),
        }
    }
}

fn recovery_identity(id: &str) -> Result<(), String> {
    let parsed = uuid::Uuid::parse_str(id).map_err(|_| "Invalid recovery client identity")?;
    if parsed.to_string() != id {
        return Err("Invalid recovery client identity".into());
    }
    Ok(())
}

fn activate_document(
    state: &RecoveryState,
    owner: &str,
    document: &str,
    client: &str,
) -> Result<(), String> {
    recovery_identity(owner)?;
    recovery_identity(client)?;
    document_identity(Some(document))?;
    let mut documents = state.documents.lock().map_err(|e| e.to_string())?;
    if documents.retired_owners.contains(owner) {
        return Err("Recovery request belongs to a superseded workbench session".into());
    }
    if documents.owner.as_deref() != Some(owner) {
        if documents.retired_owners.len() >= MAX_CLIENT_GENERATIONS {
            return Err("Recovery session limit reached. Save projects and restart Phyra.".into());
        }
        if let Some(prior) = documents.owner.replace(owner.into()) {
            documents.retired_owners.insert(prior);
        }
        // A webview reload releases every document lease, making unsaved
        // definitions discoverable without permitting stale renderer writes.
        documents.sessions.clear();
        documents.retired_clients.clear();
    }
    if documents.retired_clients.contains(client) {
        return Err("Recovery request belongs to a superseded project document".into());
    }
    if !documents.sessions.contains_key(document) && documents.sessions.len() >= MAX_RECORDS {
        return Err("Too many open recovery sessions".into());
    }
    if documents
        .sessions
        .get(document)
        .and_then(|session| session.client.as_deref())
        != Some(client)
    {
        if documents.retired_clients.len() >= MAX_CLIENT_GENERATIONS {
            return Err("Recovery session limit reached. Save projects and restart Phyra.".into());
        }
        if let Some(prior) = documents
            .sessions
            .remove(document)
            .and_then(|session| session.client)
        {
            documents.retired_clients.insert(prior);
        }
        let session = RecoverySession {
            client: Some(client.into()),
            ..RecoverySession::default()
        };
        documents.sessions.insert(document.into(), session);
    }
    Ok(())
}

fn with_document<T>(
    state: &RecoveryState,
    owner: &str,
    document: &str,
    client: &str,
    operation: impl FnOnce(&mut RecoverySession) -> Result<T, String>,
) -> Result<T, String> {
    let mut documents = state.documents.lock().map_err(|e| e.to_string())?;
    if documents.owner.as_deref() != Some(owner) {
        return Err("Recovery request belongs to a superseded workbench session".into());
    }
    let session = documents
        .sessions
        .get_mut(document)
        .ok_or("Recovery request belongs to a closed project document")?;
    require_client(session, client)?;
    operation(session)
}

fn clear_document_checkpoint(
    root: &Path,
    state: &RecoveryState,
    identity: DocumentClient<'_>,
    sequence: u64,
    recovery_id: Option<&str>,
    release: bool,
) -> Result<(), String> {
    let DocumentClient {
        owner,
        document,
        client,
    } = identity;
    let mut documents = state.documents.lock().map_err(|e| e.to_string())?;
    if documents.owner.as_deref() != Some(owner) {
        return Err("Recovery request belongs to a superseded workbench session".into());
    }
    if release && recovery_id.is_some() {
        return Err("Closing a document cannot discard another recovery copy".into());
    }
    if release && documents.retired_clients.len() >= MAX_CLIENT_GENERATIONS {
        return Err("Recovery session limit reached. Save projects and restart Phyra.".into());
    }
    let session = documents
        .sessions
        .get_mut(document)
        .ok_or("Recovery request belongs to a closed project document")?;
    require_client(session, client)?;
    if release {
        if sequence == 0 || sequence > MAX_SEQUENCE || sequence <= session.sequence {
            return Err("Invalid recovery release sequence".into());
        }
        session.sequence = sequence;
    } else {
        clear_session_checkpoint(root, session, sequence, recovery_id)?;
    }
    if release {
        documents.sessions.remove(document);
        documents.retired_clients.insert(client.into());
    }
    Ok(())
}

fn commit_document_checkpoint(
    root: &Path,
    state: &RecoveryState,
    identity: DocumentClient<'_>,
    project: &Value,
    sequence: u64,
    restored_project: Option<&ProjectState>,
) -> Result<Value, String> {
    with_document(
        state,
        identity.owner,
        identity.document,
        identity.client,
        |session| {
            let mut association = restored_project
                .map(|state| state.documents.lock().map_err(|e| e.to_string()))
                .transpose()?;
            if let Some(documents) = association.as_ref() {
                documents.require_owner(Some(identity.owner))?;
            }
            let receipt = write_session_checkpoint(root, session, project, sequence)?;
            if receipt["accepted"] == true {
                if let Some(documents) = association.as_mut() {
                    documents.forget(identity.document);
                }
            }
            Ok(receipt)
        },
    )
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
    let mut record: Record = serde_json::from_slice(&read_bounded(path, MAX_RECORD_BYTES)?)
        .map_err(|_| "The recovery copy could not be read")?;
    if record.format_version != 1
        || record.saved_at == 0
        || record.saved_at > MAX_SEQUENCE
        || record.app_version.len() > 40
        || record.app_version.is_empty()
    {
        return Err("Unsupported recovery metadata".into());
    }
    // Legacy definitions are validated before conversion. The old journal is
    // never overwritten during discovery/read; Restore checkpoints a new copy.
    record.project = migrate_project(record.project)?.0;
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
    let mut session = state.session.lock().map_err(|e| e.to_string())?;
    write_session_checkpoint(directory, &mut session, project, sequence)
}

fn write_session_checkpoint(
    directory: &Path,
    session: &mut RecoverySession,
    project: &Value,
    sequence: u64,
) -> Result<Value, String> {
    validate_project(project)?;
    if sequence == 0 || sequence > MAX_SEQUENCE {
        return Err("Invalid recovery sequence".into());
    }
    if sequence <= session.sequence {
        return Ok(json!({"accepted":false,"savedAt":0,"revision":project["revision"]}));
    }
    ensure_directory(directory)?;
    if session.lease.is_none() {
        session.lease =
            Some(lock_record(directory, &session.id)?.ok_or("Recovery session is already owned")?);
    }
    let path = record_path(directory, &session.id)?;
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
    session.sequence = sequence;
    Ok(json!({"accepted":true,"savedAt":saved_at,"revision":project["revision"]}))
}

fn clear_checkpoint(
    directory: &Path,
    state: &RecoveryState,
    sequence: u64,
    recovery_id: Option<&str>,
) -> Result<(), String> {
    let mut session = state.session.lock().map_err(|e| e.to_string())?;
    clear_session_checkpoint(directory, &mut session, sequence, recovery_id)
}

fn clear_session_checkpoint(
    directory: &Path,
    session: &mut RecoverySession,
    sequence: u64,
    recovery_id: Option<&str>,
) -> Result<(), String> {
    if sequence == 0 || sequence > MAX_SEQUENCE {
        return Err("Invalid recovery sequence".into());
    }
    let id = recovery_id.unwrap_or(&session.id);
    if (recovery_id.is_none() || id == session.id) && sequence <= session.sequence {
        return Ok(());
    }
    if directory.exists() {
        ensure_directory(directory)?;
    }
    let path = record_path(directory, id)?;
    let _lease = if id != session.id && directory.exists() {
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
    if recovery_id.is_none() || id == session.id {
        session.sequence = sequence.max(session.sequence);
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
pub(crate) async fn get_recovery(
    app: tauri::AppHandle,
    client_id: String,
    document_id: Option<String>,
    owner_id: Option<String>,
) -> Result<Value, String> {
    if verification_enabled() {
        return Ok(json!({"records":[],"unreadableCount":0}));
    }
    if let Some(document) = document_id.as_deref() {
        activate_document(
            &app.state::<RecoveryState>(),
            owner_id
                .as_deref()
                .ok_or("Missing recovery owner identity")?,
            document,
            &client_id,
        )?;
        let project_state = app.state::<ProjectState>();
        let mut documents = project_state.documents.lock().map_err(|e| e.to_string())?;
        documents.activate_owner(owner_id.as_deref())?;
        activate_result_owner(&app.state::<EngineState>(), owner_id.as_deref())?;
    } else {
        activate_client(&app.state::<RecoveryState>(), &client_id)?;
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<RecoveryState>();
        let root = directory(&app)?;
        if let Some(document) = document_id.as_deref() {
            with_document(
                &state,
                owner_id
                    .as_deref()
                    .ok_or("Missing recovery owner identity")?,
                document,
                &client_id,
                |session| session_inventory(&root, session),
            )
        } else {
            client_inventory(&root, &state, &client_id)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

fn inventory(root: &Path, state: &RecoveryState) -> Result<Value, String> {
    let session = state.session.lock().map_err(|e| e.to_string())?;
    session_inventory(root, &session)
}

fn activate_client(state: &RecoveryState, client: &str) -> Result<(), String> {
    let parsed = uuid::Uuid::parse_str(client).map_err(|_| "Invalid recovery client identity")?;
    if parsed.to_string() != client {
        return Err("Invalid recovery client identity".into());
    }
    let mut session = state.session.lock().map_err(|e| e.to_string())?;
    if session.retired_clients.contains(client) {
        return Err("Recovery request belongs to a superseded workbench session".into());
    }
    if session.client.as_deref() != Some(client) {
        if session.retired_clients.len() >= MAX_CLIENT_GENERATIONS {
            return Err(
                "Recovery session limit reached. Save the project and restart Phyra.".into(),
            );
        }
        // A reloaded webview owns a new sequence and journal. Releasing the
        // previous lease makes its valid work recoverable by this new UI.
        if let Some(previous) = session.client.take() {
            session.retired_clients.insert(previous);
        }
        session.id = uuid::Uuid::new_v4().to_string();
        session.client = Some(client.to_owned());
        session.sequence = 0;
        session.lease = None;
    }
    Ok(())
}

fn client_inventory(root: &Path, state: &RecoveryState, client: &str) -> Result<Value, String> {
    let session = state.session.lock().map_err(|e| e.to_string())?;
    require_client(&session, client)?;
    session_inventory(root, &session)
}

fn require_client(session: &RecoverySession, client: &str) -> Result<(), String> {
    if session.client.as_deref() != Some(client) {
        return Err("Recovery request belongs to a superseded workbench session".into());
    }
    Ok(())
}

fn write_client_checkpoint(
    directory: &Path,
    state: &RecoveryState,
    client: &str,
    project: &Value,
    sequence: u64,
) -> Result<Value, String> {
    commit_client_checkpoint(directory, state, client, project, sequence, None)
}

fn commit_client_checkpoint(
    directory: &Path,
    state: &RecoveryState,
    client: &str,
    project: &Value,
    sequence: u64,
    restored_project: Option<&ProjectState>,
) -> Result<Value, String> {
    let mut session = state.session.lock().map_err(|e| e.to_string())?;
    require_client(&session, client)?;
    let receipt = write_session_checkpoint(directory, &mut session, project, sequence)?;
    if receipt["accepted"] == true {
        if let Some(project_state) = restored_project {
            // Keep generation ownership through association adoption; a reload
            // cannot interleave and let an old restore clear a new file path.
            project_state
                .documents
                .lock()
                .map_err(|e| e.to_string())?
                .forget(LEGACY_DOCUMENT_ID);
        }
    }
    Ok(receipt)
}

fn clear_client_checkpoint(
    directory: &Path,
    state: &RecoveryState,
    client: &str,
    sequence: u64,
    recovery_id: Option<&str>,
) -> Result<(), String> {
    let mut session = state.session.lock().map_err(|e| e.to_string())?;
    require_client(&session, client)?;
    clear_session_checkpoint(directory, &mut session, sequence, recovery_id)
}

fn read_client_record(
    root: &Path,
    state: &RecoveryState,
    client: &str,
    recovery_id: &str,
) -> Result<Record, String> {
    let session = state.session.lock().map_err(|e| e.to_string())?;
    require_client(&session, client)?;
    let _lease = lock_record(root, recovery_id)?
        .ok_or("This recovery copy belongs to an open application")?;
    read_record(&record_path(root, recovery_id)?)
}

fn session_inventory(root: &Path, session: &RecoverySession) -> Result<Value, String> {
    let mut records = Vec::new();
    let mut unreadable = 0;
    for (id, path) in journal_paths(root)? {
        if id == session.id {
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
    let id = state.session.lock().map_err(|e| e.to_string())?.id.clone();
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
    let reload = RecoveryState::default();
    let previous_client = uuid::Uuid::new_v4().to_string();
    let current_client = uuid::Uuid::new_v4().to_string();
    activate_client(&reload, &previous_client)?;
    write_client_checkpoint(temporary.path(), &reload, &previous_client, project, 7)?;
    let prior_id = reload.session.lock().map_err(|e| e.to_string())?.id.clone();
    activate_client(&reload, &current_client)?;
    let reload_offered = client_inventory(temporary.path(), &reload, &current_client)?["records"]
        .as_array()
        .is_some_and(|records| records.len() == 1 && records[0]["id"] == prior_id);
    let superseded = activate_client(&reload, &previous_client).is_err()
        && client_inventory(temporary.path(), &reload, &previous_client).is_err()
        && write_client_checkpoint(temporary.path(), &reload, &previous_client, project, 8)
            .is_err()
        && clear_client_checkpoint(
            temporary.path(),
            &reload,
            &previous_client,
            8,
            Some(&prior_id),
        )
        .is_err()
        && read_client_record(temporary.path(), &reload, &previous_client, &prior_id).is_err();
    let reset_accepted =
        write_client_checkpoint(temporary.path(), &reload, &current_client, project, 1)?
            ["accepted"]
            == true;
    if !reload_offered || !superseded || !reset_accepted {
        return Err("Native recovery webview generation verification failed".into());
    }
    drop(reload);
    temporary.close().map_err(|e| e.to_string())?;
    Ok(
        json!({"projectMatches":matches,"activeSessionProtected":protected,
        "closedSessionOffered":offered,"lateWriteRejected":rejected,"resultsIncluded":false,
        "reloadSessionOffered":reload_offered,"supersededRequestsRejected":superseded,
        "newClientSequenceAccepted":reset_accepted}),
    )
}

#[tauri::command]
pub(crate) async fn write_recovery(
    app: tauri::AppHandle,
    project: Value,
    sequence: u64,
    restored: Option<bool>,
    client_id: String,
    document_id: Option<String>,
    owner_id: Option<String>,
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
        let project_state = app.state::<ProjectState>();
        let root = directory(&app)?;
        let recovery = app.state::<RecoveryState>();
        let receipt = if let Some(document) = document_id.as_deref() {
            commit_document_checkpoint(
                &root,
                &recovery,
                DocumentClient {
                    owner: owner_id
                        .as_deref()
                        .ok_or("Missing recovery owner identity")?,
                    document,
                    client: &client_id,
                },
                &project,
                sequence,
                restored.then_some(&project_state),
            )?
        } else {
            commit_client_checkpoint(
                &root,
                &recovery,
                &client_id,
                &project,
                sequence,
                restored.then_some(&project_state),
            )?
        };
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
    client_id: String,
    document_id: Option<String>,
    owner_id: Option<String>,
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
        let recovery = app.state::<RecoveryState>();
        let record = if let Some(document) = document_id.as_deref() {
            with_document(
                &recovery,
                owner_id
                    .as_deref()
                    .ok_or("Missing recovery owner identity")?,
                document,
                &client_id,
                |_| {
                    let _lease = lock_record(&root, &recovery_id)?
                        .ok_or("This recovery copy belongs to an open application")?;
                    read_record(&record_path(&root, &recovery_id)?)
                },
            )?
        } else {
            read_client_record(&root, &recovery, &client_id, &recovery_id)?
        };
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
    client_id: String,
    document_id: Option<String>,
    owner_id: Option<String>,
    release: Option<bool>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = directory(&app)?;
        let state = app.state::<RecoveryState>();
        if let Some(document) = document_id.as_deref() {
            clear_document_checkpoint(
                &root,
                &state,
                DocumentClient {
                    owner: owner_id
                        .as_deref()
                        .ok_or("Missing recovery owner identity")?,
                    document,
                    client: &client_id,
                },
                sequence,
                recovery_id.as_deref(),
                release.unwrap_or(false),
            )
        } else {
            if release.unwrap_or(false) {
                return Err("Recovery release requires a project document identity".into());
            }
            clear_client_checkpoint(&root, &state, &client_id, sequence, recovery_id.as_deref())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session_id(state: &RecoveryState) -> String {
        state.session.lock().unwrap().id.clone()
    }

    fn project(revision: u64) -> Value {
        let mut value: Value =
            serde_json::from_str(include_str!("../../../examples/cantilever.json")).unwrap();
        value["name"] = json!("Çalışma ü recovery");
        value["revision"] = json!(revision);
        value
    }

    #[test]
    fn legacy_definition_journal_is_migrated_without_overwriting_original_bytes() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("legacy.json");
        let mut previous = project(4);
        previous["schemaVersion"] = json!(2);
        previous.as_object_mut().unwrap().remove("namedSelections");
        let bytes = serde_json::to_vec(&Record {
            format_version: 1,
            saved_at: 1,
            app_version: "0.1.0".into(),
            project: previous.clone(),
        })
        .unwrap();
        fs::write(&path, &bytes).unwrap();
        let restored = read_record(&path).unwrap();
        assert_eq!(restored.project["schemaVersion"], 4);
        assert_eq!(restored.project["namedSelections"], json!([]));
        assert_eq!(restored.project["revision"], previous["revision"]);
        assert_eq!(restored.project["geometry"], previous["geometry"]);
        assert_eq!(fs::read(&path).unwrap(), bytes);
    }

    #[test]
    fn malformed_legacy_journal_is_rejected_and_preserved() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("invalid.json");
        let mut previous = project(4);
        previous["schemaVersion"] = json!(2);
        previous.as_object_mut().unwrap().remove("namedSelections");
        previous["study"]["material"]["young"] = json!(-1);
        let bytes = serde_json::to_vec(&Record {
            format_version: 1,
            saved_at: 1,
            app_version: "0.1.0".into(),
            project: previous,
        })
        .unwrap();
        fs::write(&path, &bytes).unwrap();
        assert!(read_record(&path).is_err());
        assert_eq!(fs::read(&path).unwrap(), bytes);
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
            read_record(&record_path(&root, &session_id(&state)).unwrap())
                .unwrap()
                .project,
            original
        );
        write_checkpoint(&root, &state, &project(5), 2).unwrap();
        assert_eq!(journal_paths(&root).unwrap().len(), 1);
        assert_eq!(
            read_record(&record_path(&root, &session_id(&state)).unwrap())
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
        clear_checkpoint(temp.path(), &state, 3, Some(&session_id(&state))).unwrap();
        assert_eq!(
            read_record(&record_path(temp.path(), &session_id(&state)).unwrap())
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
            read_record(&record_path(temp.path(), &session_id(&state)).unwrap())
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
        let b_path = record_path(temp.path(), &session_id(&b)).unwrap();
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
        let id = session_id(&active);
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
        let id = session_id(&state);
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
        assert_eq!(state.session.lock().unwrap().sequence, 0);
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

    #[test]
    fn webview_reload_offers_previous_journal_and_accepts_a_fresh_sequence() {
        let temp = tempfile::tempdir().unwrap();
        let state = RecoveryState::default();
        let before = uuid::Uuid::new_v4().to_string();
        let after = uuid::Uuid::new_v4().to_string();
        activate_client(&state, &before).unwrap();
        let original = project(7);
        write_client_checkpoint(temp.path(), &state, &before, &original, 100).unwrap();
        let old_id = session_id(&state);
        activate_client(&state, &after).unwrap();
        let offered = client_inventory(temp.path(), &state, &after).unwrap();
        assert_eq!(offered["records"].as_array().unwrap().len(), 1);
        assert_eq!(offered["records"][0]["id"], old_id);
        assert_eq!(
            read_client_record(temp.path(), &state, &after, &old_id)
                .unwrap()
                .project,
            original
        );
        assert_eq!(
            write_client_checkpoint(temp.path(), &state, &after, &project(8), 1).unwrap()
                ["accepted"],
            true
        );
        assert!(write_client_checkpoint(temp.path(), &state, &before, &project(9), 101).is_err());
        assert!(clear_client_checkpoint(temp.path(), &state, &before, 102, Some(&old_id)).is_err());
        assert!(read_client_record(temp.path(), &state, &before, &old_id).is_err());
        assert_eq!(
            read_record(&record_path(temp.path(), &old_id).unwrap())
                .unwrap()
                .project,
            original
        );
    }

    #[test]
    fn late_old_handshake_cannot_retire_current_client_or_reset_its_checkpoint() {
        let temp = tempfile::tempdir().unwrap();
        let state = RecoveryState::default();
        let before = uuid::Uuid::new_v4().to_string();
        let after = uuid::Uuid::new_v4().to_string();
        activate_client(&state, &before).unwrap();
        activate_client(&state, &after).unwrap();
        write_client_checkpoint(temp.path(), &state, &after, &project(4), 5).unwrap();
        let current_id = session_id(&state);
        assert!(activate_client(&state, &before).is_err());
        assert!(client_inventory(temp.path(), &state, &before).is_err());
        activate_client(&state, &after).unwrap();
        assert_eq!(session_id(&state), current_id);
        assert_eq!(state.session.lock().unwrap().sequence, 5);
        assert_eq!(
            write_client_checkpoint(temp.path(), &state, &after, &project(5), 6).unwrap()
                ["accepted"],
            true
        );
    }

    #[test]
    fn client_generation_limit_retains_tombstones_and_preserves_active_work() {
        let temp = tempfile::tempdir().unwrap();
        let state = RecoveryState::default();
        let first = uuid::Uuid::new_v4().to_string();
        activate_client(&state, &first).unwrap();
        let mut current = first.clone();
        for _ in 0..MAX_CLIENT_GENERATIONS {
            current = uuid::Uuid::new_v4().to_string();
            activate_client(&state, &current).unwrap();
        }
        assert_eq!(
            state.session.lock().unwrap().retired_clients.len(),
            MAX_CLIENT_GENERATIONS
        );
        let current_id = session_id(&state);
        assert!(activate_client(&state, &uuid::Uuid::new_v4().to_string())
            .unwrap_err()
            .contains("Save the project and restart"));
        assert!(activate_client(&state, &first).is_err());
        assert_eq!(session_id(&state), current_id);
        assert_eq!(
            write_client_checkpoint(temp.path(), &state, &current, &project(1), 1).unwrap()
                ["accepted"],
            true
        );
    }

    #[test]
    fn restored_association_changes_only_with_an_accepted_current_generation_checkpoint() {
        let temp = tempfile::tempdir().unwrap();
        let state = RecoveryState::default();
        let client = uuid::Uuid::new_v4().to_string();
        activate_client(&state, &client).unwrap();
        let definition = project(1);
        let project_state = ProjectState::default();
        let association = Some((
            definition["id"].as_str().unwrap().to_owned(),
            temp.path().join("original.phyra"),
        ));
        project_state
            .documents
            .lock()
            .unwrap()
            .associate(
                LEGACY_DOCUMENT_ID,
                definition["id"].as_str().unwrap(),
                association.as_ref().unwrap().1.clone(),
            )
            .unwrap();
        write_client_checkpoint(temp.path(), &state, &client, &definition, 2).unwrap();
        assert_eq!(
            project_state
                .documents
                .lock()
                .unwrap()
                .path(LEGACY_DOCUMENT_ID, definition["id"].as_str().unwrap()),
            association.as_ref().map(|(_, path)| path.clone())
        );
        assert_eq!(
            commit_client_checkpoint(
                temp.path(),
                &state,
                &client,
                &definition,
                1,
                Some(&project_state)
            )
            .unwrap()["accepted"],
            false
        );
        assert_eq!(
            project_state
                .documents
                .lock()
                .unwrap()
                .path(LEGACY_DOCUMENT_ID, definition["id"].as_str().unwrap()),
            association.as_ref().map(|(_, path)| path.clone())
        );
        assert_eq!(
            commit_client_checkpoint(
                temp.path(),
                &state,
                &client,
                &definition,
                3,
                Some(&project_state)
            )
            .unwrap()["accepted"],
            true
        );
        assert!(project_state
            .documents
            .lock()
            .unwrap()
            .path(LEGACY_DOCUMENT_ID, definition["id"].as_str().unwrap())
            .is_none());
        project_state
            .documents
            .lock()
            .unwrap()
            .associate(
                LEGACY_DOCUMENT_ID,
                definition["id"].as_str().unwrap(),
                association.as_ref().unwrap().1.clone(),
            )
            .unwrap();
        activate_client(&state, &uuid::Uuid::new_v4().to_string()).unwrap();
        assert!(commit_client_checkpoint(
            temp.path(),
            &state,
            &client,
            &definition,
            4,
            Some(&project_state)
        )
        .is_err());
        assert_eq!(
            project_state
                .documents
                .lock()
                .unwrap()
                .path(LEGACY_DOCUMENT_ID, definition["id"].as_str().unwrap()),
            association.as_ref().map(|(_, path)| path.clone())
        );
    }

    #[test]
    fn legacy_recovery_is_upgraded_in_memory_and_original_copy_is_preserved() {
        let temp = tempfile::tempdir().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let path = record_path(temp.path(), &id).unwrap();
        let mut legacy = project(7);
        legacy["schemaVersion"] = json!(2);
        legacy.as_object_mut().unwrap().remove("namedSelections");
        let bytes = serde_json::to_vec(&Record {
            format_version: 1,
            saved_at: 100,
            app_version: "0.1.0".into(),
            project: legacy,
        })
        .unwrap();
        fs::write(&path, &bytes).unwrap();
        let restored = read_record(&path).unwrap();
        let mut expected = project(7);
        expected["namedSelections"] = json!([]);
        assert_eq!(restored.project, expected);
        assert_eq!(fs::read(&path).unwrap(), bytes);
    }

    #[test]
    fn project_tabs_have_independent_ordered_journals_and_active_leases() {
        let temp = tempfile::tempdir().unwrap();
        let state = RecoveryState::default();
        let owner = uuid::Uuid::new_v4().to_string();
        let a = uuid::Uuid::new_v4().to_string();
        let b = uuid::Uuid::new_v4().to_string();
        let ca = uuid::Uuid::new_v4().to_string();
        let cb = uuid::Uuid::new_v4().to_string();
        activate_document(&state, &owner, &a, &ca).unwrap();
        activate_document(&state, &owner, &b, &cb).unwrap();
        let identity = |document, client| DocumentClient {
            owner: &owner,
            document,
            client,
        };
        commit_document_checkpoint(temp.path(), &state, identity(&a, &ca), &project(1), 9, None)
            .unwrap();
        commit_document_checkpoint(temp.path(), &state, identity(&b, &cb), &project(2), 1, None)
            .unwrap();
        let ids = with_document(&state, &owner, &a, &ca, |s| Ok(s.id.clone())).unwrap();
        let bid = with_document(&state, &owner, &b, &cb, |s| Ok(s.id.clone())).unwrap();
        assert_ne!(ids, bid);
        let inventory = with_document(&state, &owner, &a, &ca, |s| {
            session_inventory(temp.path(), s)
        })
        .unwrap();
        assert!(inventory["records"].as_array().unwrap().is_empty());
        clear_document_checkpoint(temp.path(), &state, identity(&a, &ca), 10, None, false).unwrap();
        assert_eq!(
            commit_document_checkpoint(
                temp.path(),
                &state,
                identity(&a, &ca),
                &project(3),
                9,
                None
            )
            .unwrap()["accepted"],
            false
        );
        assert_eq!(
            read_record(&record_path(temp.path(), &bid).unwrap())
                .unwrap()
                .project,
            project(2)
        );
        assert!(lock_record(temp.path(), &bid).unwrap().is_none());
    }

    #[test]
    fn document_release_preserves_definition_and_rejects_late_client_requests() {
        let temp = tempfile::tempdir().unwrap();
        let state = RecoveryState::default();
        let owner = uuid::Uuid::new_v4().to_string();
        let doc = uuid::Uuid::new_v4().to_string();
        let client = uuid::Uuid::new_v4().to_string();
        let identity = || DocumentClient {
            owner: &owner,
            document: &doc,
            client: &client,
        };
        activate_document(&state, &owner, &doc, &client).unwrap();
        commit_document_checkpoint(temp.path(), &state, identity(), &project(5), 1, None).unwrap();
        let id = with_document(&state, &owner, &doc, &client, |s| Ok(s.id.clone())).unwrap();
        let path = record_path(temp.path(), &id).unwrap();
        let bytes = fs::read(&path).unwrap();
        assert!(clear_document_checkpoint(temp.path(), &state, identity(), 1, None, true).is_err());
        assert!(lock_record(temp.path(), &id).unwrap().is_none());
        clear_document_checkpoint(temp.path(), &state, identity(), 2, None, true).unwrap();
        assert_eq!(fs::read(path).unwrap(), bytes);
        assert!(lock_record(temp.path(), &id).unwrap().is_some());
        assert!(activate_document(&state, &owner, &doc, &client).is_err());
        assert!(
            commit_document_checkpoint(temp.path(), &state, identity(), &project(6), 3, None)
                .is_err()
        );
    }

    #[test]
    fn page_reload_offers_every_prior_tab_without_reactivating_old_owners() {
        let temp = tempfile::tempdir().unwrap();
        let state = RecoveryState::default();
        let before = uuid::Uuid::new_v4().to_string();
        let after = uuid::Uuid::new_v4().to_string();
        let a = uuid::Uuid::new_v4().to_string();
        let b = uuid::Uuid::new_v4().to_string();
        let ca = uuid::Uuid::new_v4().to_string();
        let cb = uuid::Uuid::new_v4().to_string();
        activate_document(&state, &before, &a, &ca).unwrap();
        activate_document(&state, &before, &b, &cb).unwrap();
        for (document, client) in [(&a, &ca), (&b, &cb)] {
            commit_document_checkpoint(
                temp.path(),
                &state,
                DocumentClient {
                    owner: &before,
                    document,
                    client,
                },
                &project(4),
                100,
                None,
            )
            .unwrap();
        }
        activate_document(&state, &after, &a, &ca).unwrap();
        let offered = with_document(&state, &after, &a, &ca, |s| {
            session_inventory(temp.path(), s)
        })
        .unwrap();
        assert_eq!(offered["records"].as_array().unwrap().len(), 2);
        assert_eq!(
            commit_document_checkpoint(
                temp.path(),
                &state,
                DocumentClient {
                    owner: &after,
                    document: &a,
                    client: &ca
                },
                &project(5),
                1,
                None
            )
            .unwrap()["accepted"],
            true
        );
        assert!(activate_document(&state, &before, &b, &cb).is_err());
        assert!(with_document(&state, &before, &b, &cb, |_| Ok(())).is_err());
        assert_eq!(
            with_document(&state, &after, &a, &ca, |s| Ok(s.sequence)).unwrap(),
            1
        );
    }

    #[test]
    fn restored_tab_forgets_only_its_archive_after_accepted_checkpoint() {
        let temp = tempfile::tempdir().unwrap();
        let state = RecoveryState::default();
        let archives = ProjectState::default();
        let owner = uuid::Uuid::new_v4().to_string();
        let a = uuid::Uuid::new_v4().to_string();
        let b = uuid::Uuid::new_v4().to_string();
        let client = uuid::Uuid::new_v4().to_string();
        let definition = project(1);
        let project_id = definition["id"].as_str().unwrap();
        {
            let mut documents = archives.documents.lock().unwrap();
            documents.activate_owner(Some(&owner)).unwrap();
            documents
                .associate(&a, project_id, temp.path().join("a.phyra"))
                .unwrap();
            documents
                .associate(&b, project_id, temp.path().join("b.phyra"))
                .unwrap();
        }
        activate_document(&state, &owner, &a, &client).unwrap();
        let identity = || DocumentClient {
            owner: &owner,
            document: &a,
            client: &client,
        };
        commit_document_checkpoint(temp.path(), &state, identity(), &definition, 2, None).unwrap();
        assert_eq!(
            commit_document_checkpoint(
                temp.path(),
                &state,
                identity(),
                &definition,
                1,
                Some(&archives)
            )
            .unwrap()["accepted"],
            false
        );
        assert!(archives
            .documents
            .lock()
            .unwrap()
            .path(&a, project_id)
            .is_some());
        assert_eq!(
            commit_document_checkpoint(
                temp.path(),
                &state,
                identity(),
                &definition,
                3,
                Some(&archives)
            )
            .unwrap()["accepted"],
            true
        );
        assert!(archives
            .documents
            .lock()
            .unwrap()
            .path(&a, project_id)
            .is_none());
        assert_eq!(
            archives.documents.lock().unwrap().path(&b, project_id),
            Some(temp.path().join("b.phyra"))
        );
    }
}
