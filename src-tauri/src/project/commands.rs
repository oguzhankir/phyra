use super::{
    archive::{read_archive_details, write_archive},
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
use std::{fs, path::PathBuf};
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
        let project_state = app.state::<ProjectState>();
        let mut documents = project_state.documents.lock().map_err(|e| e.to_string())?;
        documents.require_owner(owner_id.as_deref())?;
        documents.require_open(document)?;
        if let Some(existing) = documents.owner(&path)? {
            if existing != document {
                return Ok(Some(json!({"existingDocumentId":existing,
                    "path":path.to_string_lossy()})));
            }
        }
        let directory = job_directory(&app)?;
        let result: Result<Option<Value>, String> = (|| {
            let opened = read_archive_details(&path, &directory)?;
            let project = opened.project;
            let migration_notice = if opened.migrated {
                Some(if opened.dropped_cache {
                    "Version 1 project upgraded to version 4. Its legacy cache was discarded; run the study again."
                } else {
                    "Legacy project upgraded to version 4 with its physical study and validated cache preserved."
                })
            } else {
                None
            };
            let manifest = if directory.join("manifest.json").is_file() {
                Some(worker(
                    &app,
                    &state,
                    "validate",
                    &project,
                    &directory,
                    &uuid::Uuid::new_v4().to_string(),
                    None,
                )?)
            } else {
                None
            };
            if let Some(ref manifest) = manifest {
                let id = manifest["jobId"]
                    .as_str()
                    .ok_or("Missing cached job identity")?
                    .to_string();
                retain_document_job(&state, document, id, directory.clone())?;
            } else {
                let _ = fs::remove_dir_all(&directory);
            }
            let opened_path = path.to_string_lossy().into_owned();
            documents.associate(document, project["id"].as_str().unwrap(), path)?;
            Ok(Some(
                json!({"project":project,"manifest":manifest,"path":opened_path,
                    "notice":migration_notice}),
            ))
        })();
        if let Err(ref error) = result {
            remember_failure(&app, &directory, error);
            let _ = fs::remove_dir_all(directory);
        }
        result
    })
    .await
    .map_err(|e| e.to_string())?
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
        write_archive(&path, &project, cache.as_deref())?;
        documents.associate(document, project["id"].as_str().unwrap(), path.clone())?;
        Ok(Some(path.to_string_lossy().into_owned()))
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
    retire_document_result(&app.state::<EngineState>(), &document_id)
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
    use super::save_destination;
    use std::path::PathBuf;

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
