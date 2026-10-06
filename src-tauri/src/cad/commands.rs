use super::{worker, CadState};
use crate::{
    execution::{
        events::RunRequestId,
        state::{
            activate_result_owner, cancel_owned_request, commit_document_job, discard_document_job,
            finish_run, owned_document_directory, register_run, stage_document_job,
        },
        worker::job_directory,
    },
    platform::files::{read_bounded, MAX_BLOB},
    project::{
        assets::{asset_root, ensure_store, import_source, verify_sources},
        state::{document_identity, ProjectState},
        validation::validate_project,
    },
};
use serde_json::Value;
use std::{fs, io::Write};
use tauri::{Manager, State};

#[tauri::command]
pub(crate) async fn evaluate_cad(
    app: tauri::AppHandle,
    project: Value,
    request_id: String,
    document_id: String,
    owner_id: String,
) -> Result<Value, String> {
    let request = RunRequestId::parse(request_id)?;
    register_run(&app.state::<CadState>().0, &request)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<CadState>();
        let result = (|| {
            validate_project(&project)?;
            if project["geometry"]["kind"] != "cad" {
                return Err("Build a CAD feature before evaluating geometry".into());
            }
            let document = document_identity(Some(&document_id))?;
            let project_state = app.state::<ProjectState>();
            let generation = {
                let mut documents = project_state.documents.lock().map_err(|e| e.to_string())?;
                documents.activate_owner(Some(&owner_id))?;
                documents.require_open(document)?;
                activate_result_owner(&state.0, Some(&owner_id))?;
                documents.generation(document)
            };
            let sources = asset_root(&app)?;
            ensure_store(&sources)?;
            verify_sources(&sources, &project)?;
            let directory = job_directory(&app)?;
            let job_id = uuid::Uuid::new_v4().to_string();
            let result = worker::evaluate(
                &app,
                &state.0,
                &project,
                &directory,
                &sources,
                &job_id,
                &request,
                |receipt| {
                    let documents = project_state.documents.lock().map_err(|e| e.to_string())?;
                    documents.require_owner(Some(&owner_id))?;
                    documents.require_open(document)?;
                    if documents.generation(document) != generation {
                        return Err("CAD build belongs to an earlier document generation".into());
                    }
                    stage_document_job(&state.0, document, job_id.clone(), directory.clone())?;
                    Ok(receipt)
                },
            );
            if result.is_err() {
                let _ = fs::remove_dir_all(&directory);
            }
            result
        })();
        finish_run(&state.0, &request)?;
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn solve_cad_sketch(
    app: tauri::AppHandle,
    project: Value,
    feature_id: String,
    request_id: String,
    document_id: String,
    owner_id: String,
) -> Result<Value, String> {
    let request = RunRequestId::parse(request_id)?;
    register_run(&app.state::<CadState>().0, &request)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<CadState>();
        let result = (|| {
            validate_project(&project)?;
            if feature_id.len() > 200
                || !project["geometry"]["features"]
                    .as_array()
                    .is_some_and(|features| {
                        features.iter().any(|feature| {
                            feature["id"] == feature_id && feature["kind"] == "sketch"
                        })
                    })
            {
                return Err("Select an existing sketch to solve its constraints".into());
            }

            let document = document_identity(Some(&document_id))?;
            let project_state = app.state::<ProjectState>();
            let generation = {
                let mut documents = project_state.documents.lock().map_err(|e| e.to_string())?;
                documents.activate_owner(Some(&owner_id))?;
                documents.require_open(document)?;
                activate_result_owner(&state.0, Some(&owner_id))?;
                documents.generation(document)
            };
            let directory = job_directory(&app)?;
            let job_id = uuid::Uuid::new_v4().to_string();
            let result = worker::solve_sketch(
                &app,
                &state.0,
                &project,
                &directory,
                &asset_root(&app)?,
                &job_id,
                &request,
                &feature_id,
                |receipt| {
                    let documents = project_state.documents.lock().map_err(|e| e.to_string())?;
                    documents.require_owner(Some(&owner_id))?;
                    documents.require_open(document)?;
                    if documents.generation(document) != generation {
                        return Err("Sketch solve belongs to an earlier document generation".into());
                    }
                    Ok(receipt)
                },
            );
            let cleanup = fs::remove_dir_all(&directory);
            if let Err(error) = cleanup {
                if error.kind() != std::io::ErrorKind::NotFound {
                    return Err(format!("Sketch worker cleanup failed: {error}"));
                }
            }
            result
        })();
        finish_run(&state.0, &request)?;
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) fn cancel_cad(state: State<CadState>, request_id: String) -> Result<bool, String> {
    cancel_owned_request(&state.0, Some(&RunRequestId::parse(request_id)?))
}

#[tauri::command]
pub(crate) async fn finish_cad(
    app: tauri::AppHandle,
    job_id: String,
    document_id: String,
    owner_id: String,
    accept: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let document = document_identity(Some(&document_id))?;
        let project_state = app.state::<ProjectState>();
        let documents = project_state.documents.lock().map_err(|e| e.to_string())?;
        documents.require_owner(Some(&owner_id))?;
        documents.require_open(document)?;
        let state = app.state::<CadState>();
        if accept {
            commit_document_job(&state.0, document, &job_id)
        } else {
            discard_document_job(&state.0, document, &job_id)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn read_cad_buffer(
    app: tauri::AppHandle,
    job_id: String,
    document_id: String,
    owner_id: String,
) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let document = document_identity(Some(&document_id))?;
        let project_state = app.state::<ProjectState>();
        let documents = project_state.documents.lock().map_err(|e| e.to_string())?;
        documents.require_owner(Some(&owner_id))?;
        documents.require_open(document)?;
        let directory = owned_document_directory(&app.state::<CadState>().0, document, &job_id)?;
        Ok(tauri::ipc::Response::new(read_bounded(
            &directory.join("buffer.bin"),
            MAX_BLOB,
        )?))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn import_cad_source(
    app: tauri::AppHandle,
    document_id: String,
    owner_id: String,
) -> Result<Option<Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let document = document_identity(Some(&document_id))?;
        let project_state = app.state::<ProjectState>();
        let generation = {
            let mut documents = project_state.documents.lock().map_err(|e| e.to_string())?;
            documents.activate_owner(Some(&owner_id))?;
            documents.require_open(document)?;
            documents.generation(document)
        };
        let Some(path) = rfd::FileDialog::new()
            .add_filter("STEP geometry", &["step", "stp"])
            .pick_file()
        else {
            return Ok(None);
        };
        let documents = project_state.documents.lock().map_err(|e| e.to_string())?;
        documents.require_owner(Some(&owner_id))?;
        documents.require_open(document)?;
        if documents.generation(document) != generation {
            return Err("Import belongs to an earlier document generation".into());
        }
        Ok(Some(import_source(&asset_root(&app)?, &path)?))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn export_cad(
    app: tauri::AppHandle,
    job_id: String,
    document_id: String,
    owner_id: String,
    format: String,
    units: String,
) -> Result<Option<String>, String> {
    let filename = match (format.as_str(), units.as_str()) {
        ("step", "m") => "output.step",
        ("step", "mm") => "output-mm.step",
        ("brep", "m") => "output.brep",
        _ => return Err("CAD export requires STEP in m/mm or BRep in SI metres".into()),
    };
    tauri::async_runtime::spawn_blocking(move || {
        let document = document_identity(Some(&document_id))?;
        let project_state = app.state::<ProjectState>();
        let generation = {
            let documents = project_state.documents.lock().map_err(|e| e.to_string())?;
            documents.require_owner(Some(&owner_id))?;
            documents.require_open(document)?;
            documents.generation(document)
        };
        let directory = owned_document_directory(&app.state::<CadState>().0, document, &job_id)?;
        let bytes = read_bounded(&directory.join(filename), MAX_BLOB)?;
        let Some(path) = rfd::FileDialog::new()
            .add_filter("CAD geometry", &[&format])
            .set_file_name(format!("geometry.{format}"))
            .save_file()
        else {
            return Ok(None);
        };
        let documents = project_state.documents.lock().map_err(|e| e.to_string())?;
        documents.require_owner(Some(&owner_id))?;
        documents.require_open(document)?;
        if documents.generation(document) != generation {
            return Err("Export belongs to an earlier document generation".into());
        }
        // Recheck that an intervening build did not retire this geometry.
        owned_document_directory(&app.state::<CadState>().0, document, &job_id)?;
        let mut file =
            tempfile::NamedTempFile::new_in(path.parent().ok_or("Invalid export destination")?)
                .map_err(|e| e.to_string())?;
        file.write_all(&bytes).map_err(|e| e.to_string())?;
        file.as_file().sync_all().map_err(|e| e.to_string())?;
        file.persist(&path).map_err(|e| e.to_string())?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())?
}
