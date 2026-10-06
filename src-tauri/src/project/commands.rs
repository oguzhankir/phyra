use super::{
    archive::{read_archive_details_with_assets, write_archive_with_assets},
    assets::asset_root,
    state::{document_identity, ProjectState},
    validation::validate_project,
};
use crate::execution::{
    state::{
        activate_result_owner, owned_document_directory, retain_document_job,
        retire_document_result, EngineState,
    },
    worker::{job_directory, remember_failure, worker},
};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::Manager;
#[tauri::command]
pub(crate) async fn open_project(
    app: tauri::AppHandle,
    document_id: Option<String>,
    owner_id: Option<String>,
) -> Result<Option<Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let document = document_identity(document_id.as_deref())?;
        let state = app.state::<EngineState>();
        {
            let project_state = app.state::<ProjectState>();
            let mut documents = project_state.documents.lock().map_err(|e| e.to_string())?;
            documents.activate_owner(owner_id.as_deref())?;
            activate_result_owner(&state, owner_id.as_deref())?;
        }
        if state.active.lock().map_err(|e| e.to_string())?.is_some() {
            return Err("Wait for or cancel the current job before opening a project".into());
        }
        let Some(path) = rfd::FileDialog::new()
            .add_filter("Phyra project", &["phyra"])
            .pick_file()
        else {
            return Ok(None);
        };
        let directory = job_directory(&app)?;
        let sources = asset_root(&app)?;
        let result = open_archive_for_document_with_assets(
            &app.state::<ProjectState>(),
            &state,
            owner_id.as_deref(),
            document,
            path,
            &directory,
            Some(&sources),
            |project| {
                worker(
                    &app,
                    &state,
                    "validate",
                    project,
                    &directory,
                    &uuid::Uuid::new_v4().to_string(),
                    None,
                )
            },
        )
        .map(Some);
        if let Err(ref error) = result {
            remember_failure(&app, &directory, error);
            let _ = fs::remove_dir_all(directory);
        }
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

// Reading/validating a cache may acquire the numerical worker. Do not retain
// the document lock across it: recovery restore holds the worker lock while
// clearing its file association. Publication rechecks ownership afterwards.
#[cfg(test)]
fn open_archive_for_document(
    project_state: &ProjectState,
    state: &EngineState,
    owner: Option<&str>,
    document: &str,
    path: PathBuf,
    directory: &Path,
    validate_cache: impl FnOnce(&Value) -> Result<Value, String>,
) -> Result<Value, String> {
    open_archive_for_document_with_assets(
        project_state,
        state,
        owner,
        document,
        path,
        directory,
        None,
        validate_cache,
    )
}

#[allow(clippy::too_many_arguments)]
fn open_archive_for_document_with_assets(
    project_state: &ProjectState,
    state: &EngineState,
    owner: Option<&str>,
    document: &str,
    path: PathBuf,
    directory: &Path,
    sources: Option<&Path>,
    validate_cache: impl FnOnce(&Value) -> Result<Value, String>,
) -> Result<Value, String> {
    let generation = {
        let documents = project_state.documents.lock().map_err(|e| e.to_string())?;
        documents.require_owner(owner)?;
        documents.require_open(document)?;
        if let Some(existing) = documents.owner(&path)? {
            if existing != document {
                return Ok(json!({"existingDocumentId":existing,
                    "path":path.to_string_lossy()}));
            }
        }
        documents.generation(document)
    };
    let opened = read_archive_details_with_assets(&path, directory, sources)?;
    let manifest = if directory.join("manifest.json").is_file() {
        Some(validate_cache(&opened.project)?)
    } else {
        None
    };
    let mut documents = project_state.documents.lock().map_err(|e| e.to_string())?;
    documents.require_owner(owner)?;
    documents.require_open(document)?;
    if documents.generation(document) != generation {
        return Err("Project document changed while opening. Reopen the project file.".into());
    }
    if documents
        .owner(&path)?
        .is_some_and(|existing| existing != document)
    {
        return Err("This project file is already open in another tab".into());
    }
    if let Some(ref manifest) = manifest {
        let id = manifest["jobId"]
            .as_str()
            .ok_or("Missing cached job identity")?
            .to_string();
        retain_document_job(state, document, id, directory.to_path_buf())?;
    } else {
        let _ = fs::remove_dir_all(directory);
    }
    let notice = migration_notice(
        &opened.project,
        opened.migrated,
        opened.dropped_cache,
        manifest.is_some(),
    );
    let opened_path = path.to_string_lossy().into_owned();
    documents.associate(document, opened.project["id"].as_str().unwrap(), path)?;
    Ok(json!({"project":opened.project,"manifest":manifest,"path":opened_path,"notice":notice}))
}

fn migration_notice(
    project: &Value,
    migrated: bool,
    dropped_cache: bool,
    cached: bool,
) -> Option<String> {
    if !migrated {
        return None;
    }
    let version = project["schemaVersion"].as_u64().unwrap();
    Some(if dropped_cache {
        format!("Version 1 project upgraded to version {version}. Its legacy cache was discarded; run the study again.")
    } else if cached {
        format!("Legacy project upgraded to version {version} with its physical study and validated cache preserved.")
    } else {
        format!("Legacy project upgraded to version {version} with its physical study preserved. Run the study to compute results.")
    })
}

#[tauri::command]
pub(crate) async fn save_project(
    app: tauri::AppHandle,
    project: Value,
    job_id: Option<String>,
    save_as: bool,
    automatic: Option<bool>,
    document_id: Option<String>,
    owner_id: Option<String>,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let document = document_identity(document_id.as_deref())?;
        let state = app.state::<EngineState>();
        {
            let project_state = app.state::<ProjectState>();
            let mut documents = project_state.documents.lock().map_err(|e| e.to_string())?;
            documents.activate_owner(owner_id.as_deref())?;
            activate_result_owner(&state, owner_id.as_deref())?;
        }
        validate_project(&project)?;
        if state.active.lock().map_err(|e| e.to_string())?.is_some() {
            return Err("Wait for or cancel the analysis before saving".into());
        }
        let cache = if let Some(id) = job_id {
            let directory = owned_document_directory(&state, document, &id)?;
            worker(
                &app,
                &state,
                "validate",
                &project,
                &directory,
                &uuid::Uuid::new_v4().to_string(),
                None,
            )?;
            Some(directory)
        } else {
            None
        };
        let project_state = app.state::<ProjectState>();
        let current = project_state
            .documents
            .lock()
            .map_err(|e| e.to_string())?
            .path(document, project["id"].as_str().unwrap());
        let path = save_destination(current, save_as, automatic.unwrap_or(false), || {
            rfd::FileDialog::new()
                .add_filter("Phyra project", &["phyra"])
                .set_file_name("project.phyra")
                .save_file()
        })?;
        let Some(mut path) = path else {
            return Ok(None);
        };
        if path.extension().is_none() {
            path.set_extension("phyra");
        }
        // Reserve/check destinations and publish associations under the same
        // lock as atomic writes, so concurrent tabs cannot claim one archive.
        let mut documents = project_state.documents.lock().map_err(|e| e.to_string())?;
        documents.require_owner(owner_id.as_deref())?;
        documents.require_open(document)?;
        if documents
            .owner(&path)?
            .is_some_and(|owner| owner != document)
        {
            return Err("This project file is already open in another tab".into());
        }
        write_archive_with_assets(&path, &project, cache.as_deref(), Some(&asset_root(&app)?))?;
        documents.associate(document, project["id"].as_str().unwrap(), path.clone())?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn preflight_close_project(
    app: tauri::AppHandle,
    document_id: String,
    owner_id: String,
    client_id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        super::recovery::preflight_document_close(
            &app.state::<super::recovery::RecoveryState>(),
            &app.state::<ProjectState>(),
            &owner_id,
            &document_id,
            &client_id,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn close_project(
    app: tauri::AppHandle,
    document_id: String,
    owner_id: Option<String>,
) -> Result<(), String> {
    let state = app.state::<ProjectState>();
    let mut documents = state.documents.lock().map_err(|e| e.to_string())?;
    documents.require_owner(owner_id.as_deref())?;
    documents.close(&document_id)?;
    retire_document_result(&app.state::<EngineState>(), &document_id)?;
    retire_document_result(&app.state::<crate::cad::CadState>().0, &document_id)
}

// Automatic writes may only use the association selected by the application.
// They must never create a file dialog or accept a renderer-supplied path.
fn save_destination(
    current: Option<PathBuf>,
    save_as: bool,
    automatic: bool,
    choose: impl FnOnce() -> Option<PathBuf>,
) -> Result<Option<PathBuf>, String> {
    if automatic {
        if save_as {
            return Err("Autosave cannot choose a new archive destination".into());
        }
        return current
            .map(Some)
            .ok_or_else(|| "Save the project once before archive autosave".into());
    }
    Ok(if !save_as && current.is_some() {
        current
    } else {
        choose()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::archive::write_archive;

    // Opaque transport bytes exercise native archive/ownership transactions;
    // this fixture does not claim to be a numerical field or worker validation.
    fn cached_archive(root: &Path) -> (Value, PathBuf) {
        let project: Value =
            serde_json::from_str(include_str!("../../../examples/cantilever.json")).unwrap();
        let cache = root.join("source-cache");
        fs::create_dir(&cache).unwrap();
        fs::write(cache.join("manifest.json"), b"{}").unwrap();
        fs::write(cache.join("buffer.bin"), b"transport fixture").unwrap();
        let path = root.join("project.phyra");
        write_archive(&path, &project, Some(&cache)).unwrap();
        (project, path)
    }

    #[test]
    fn cache_validation_releases_document_lock_before_acquiring_worker() {
        let temporary = tempfile::tempdir().unwrap();
        let (_, path) = cached_archive(temporary.path());
        let project_state = ProjectState::default();
        let engine = EngineState::default();
        let document = uuid::Uuid::new_v4().to_string();
        let directory = temporary.path().join("staged");
        let opened = open_archive_for_document(
            &project_state,
            &engine,
            None,
            &document,
            path,
            &directory,
            |_| {
                // Recovery restore acquires these in this order. Its ownership
                // check must finish while archive validation is waiting for the worker.
                std::thread::scope(|scope| {
                    scope
                        .spawn(|| {
                            let _worker = engine.active.lock().unwrap();
                            let _documents = project_state
                                .documents
                                .try_lock()
                                .expect("archive cache validation must release the document lock");
                        })
                        .join()
                        .unwrap();
                });
                let _worker = engine.active.lock().unwrap();
                Ok(json!({"jobId":"opaque-cache-fixture"}))
            },
        )
        .unwrap();
        assert_eq!(opened["manifest"]["jobId"], "opaque-cache-fixture");
        assert_eq!(
            owned_document_directory(&engine, &document, "opaque-cache-fixture").unwrap(),
            directory
        );
    }

    #[test]
    fn closing_or_reloading_during_cache_validation_cannot_publish_the_opened_archive() {
        for reload in [false, true] {
            let temporary = tempfile::tempdir().unwrap();
            let (project, path) = cached_archive(temporary.path());
            let project_state = ProjectState::default();
            let engine = EngineState::default();
            let document = uuid::Uuid::new_v4().to_string();
            let owner = uuid::Uuid::new_v4().to_string();
            project_state
                .documents
                .lock()
                .unwrap()
                .activate_owner(Some(&owner))
                .unwrap();
            let result = open_archive_for_document(
                &project_state,
                &engine,
                Some(&owner),
                &document,
                path,
                &temporary.path().join("staged"),
                |_| {
                    let mut documents = project_state.documents.lock().unwrap();
                    if reload {
                        documents
                            .activate_owner(Some(&uuid::Uuid::new_v4().to_string()))
                            .unwrap();
                    } else {
                        documents.close(&document).unwrap();
                    }
                    Ok(json!({"jobId":"late-cache-fixture"}))
                },
            );
            assert!(result.is_err());
            assert!(project_state
                .documents
                .lock()
                .unwrap()
                .path(&document, project["id"].as_str().unwrap())
                .is_none());
            assert!(engine.jobs.lock().unwrap().is_empty());
        }
    }

    #[test]
    fn a_destination_claimed_during_cache_validation_remains_with_its_new_owner() {
        let temporary = tempfile::tempdir().unwrap();
        let (project, path) = cached_archive(temporary.path());
        let project_state = ProjectState::default();
        let engine = EngineState::default();
        let document = uuid::Uuid::new_v4().to_string();
        let other = uuid::Uuid::new_v4().to_string();
        let project_id = project["id"].as_str().unwrap();
        let result = open_archive_for_document(
            &project_state,
            &engine,
            None,
            &document,
            path.clone(),
            &temporary.path().join("staged"),
            |_| {
                project_state
                    .documents
                    .lock()
                    .unwrap()
                    .associate(&other, project_id, path.clone())
                    .unwrap();
                Ok(json!({"jobId":"unclaimed-cache-fixture"}))
            },
        );
        assert!(result.unwrap_err().contains("already open"));
        assert_eq!(
            project_state
                .documents
                .lock()
                .unwrap()
                .path(&other, project_id),
            Some(path)
        );
        assert!(engine.jobs.lock().unwrap().is_empty());
    }

    #[test]
    fn a_new_association_or_recovery_restore_supersedes_pending_archive_open() {
        for restored in [false, true] {
            let temporary = tempfile::tempdir().unwrap();
            let (project, path) = cached_archive(temporary.path());
            let project_state = ProjectState::default();
            let engine = EngineState::default();
            let document = uuid::Uuid::new_v4().to_string();
            let project_id = project["id"].as_str().unwrap();
            let newer_path = temporary.path().join("newer.phyra");
            let prior = temporary.path().join("source-cache");
            retain_document_job(
                &engine,
                &document,
                "prior-cache-fixture".into(),
                prior.clone(),
            )
            .unwrap();
            let result = open_archive_for_document(
                &project_state,
                &engine,
                None,
                &document,
                path,
                &temporary.path().join("staged"),
                |_| {
                    let mut documents = project_state.documents.lock().unwrap();
                    if restored {
                        documents.forget(&document).unwrap();
                    } else {
                        documents
                            .associate(&document, project_id, newer_path.clone())
                            .unwrap();
                    }
                    Ok(json!({"jobId":"superseded-cache-fixture"}))
                },
            );
            assert!(result.unwrap_err().contains("document changed"));
            assert_eq!(
                project_state
                    .documents
                    .lock()
                    .unwrap()
                    .path(&document, project_id),
                if restored { None } else { Some(newer_path) }
            );
            assert_eq!(
                owned_document_directory(&engine, &document, "prior-cache-fixture").unwrap(),
                prior
            );
        }
    }

    #[test]
    fn opening_an_owned_archive_focuses_existing_document_without_staging_bytes() {
        let temporary = tempfile::tempdir().unwrap();
        let (project, path) = cached_archive(temporary.path());
        let project_state = ProjectState::default();
        let engine = EngineState::default();
        let document = uuid::Uuid::new_v4().to_string();
        let existing = uuid::Uuid::new_v4().to_string();
        project_state
            .documents
            .lock()
            .unwrap()
            .associate(&existing, project["id"].as_str().unwrap(), path.clone())
            .unwrap();
        let directory = temporary.path().join("unused-staging-directory");
        let opened = open_archive_for_document(
            &project_state,
            &engine,
            None,
            &document,
            path,
            &directory,
            |_| panic!("focusing an owned archive must not validate another cache"),
        )
        .unwrap();
        assert_eq!(opened["existingDocumentId"], existing);
        assert!(!directory.exists());
    }

    #[test]
    fn migration_notices_report_actual_schema_and_only_validated_cache_reuse() {
        let project = json!({"schemaVersion":5});
        assert!(migration_notice(&project, false, false, false).is_none());
        let discarded = migration_notice(&project, true, true, false).unwrap();
        assert!(discarded.contains("version 5"));
        assert!(discarded.contains("cache was discarded"));
        let reused = migration_notice(&project, true, false, true).unwrap();
        assert!(reused.contains("version 5"));
        assert!(reused.contains("validated cache preserved"));
        let definition = migration_notice(&project, true, false, false).unwrap();
        assert!(definition.contains("version 5"));
        assert!(definition.contains("compute results"));
        assert!(!definition.contains("cache preserved"));
    }

    #[test]
    fn autosave_uses_owned_path_without_a_dialog() {
        let path = PathBuf::from("owned.phyra");
        assert_eq!(
            save_destination(Some(path.clone()), false, true, || panic!(
                "no autosave dialog"
            ))
            .unwrap(),
            Some(path)
        );
    }

    #[test]
    fn unassociated_and_save_as_autosaves_are_rejected_without_a_dialog() {
        assert!(save_destination(None, false, true, || panic!("no autosave dialog")).is_err());
        assert!(
            save_destination(Some(PathBuf::from("old.phyra")), true, true, || panic!(
                "no autosave dialog"
            ))
            .is_err()
        );
    }

    #[test]
    fn first_manual_save_can_cancel_without_reusing_an_old_association() {
        assert_eq!(
            save_destination(Some(PathBuf::from("old.phyra")), true, false, || None).unwrap(),
            None
        );
    }
}
