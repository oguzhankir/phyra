use super::{mesh, worker, CadState};
use crate::{
    execution::{
        events::RunRequestId,
        state::{
            activate_result_owner, cancel_owned_request, commit_document_job, discard_document_job,
            finish_run, owned_document_directory, register_run, stage_document_job, EngineState,
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
    geometry_job(app, project, None, request_id, document_id, owner_id).await
}

#[tauri::command]
pub(crate) async fn mesh_cad(
    app: tauri::AppHandle,
    project: Value,
    target_size: f64,
    request_id: String,
    document_id: String,
    owner_id: String,
) -> Result<Value, String> {
    mesh::validate_target_size(target_size)?;
    geometry_job(
        app,
        project,
        Some(target_size),
        request_id,
        document_id,
        owner_id,
    )
    .await
}

async fn geometry_job(
    app: tauri::AppHandle,
    project: Value,
    target_size: Option<f64>,
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
                target_size,
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
        crate::verification::trace_verification("CAD geometry command returning");
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
    crate::verification::trace_verification("CAD finish command received");
    tauri::async_runtime::spawn_blocking(move || {
        let document = document_identity(Some(&document_id))?;
        let project_state = app.state::<ProjectState>();
        let documents = project_state.documents.lock().map_err(|e| e.to_string())?;
        documents.require_owner(Some(&owner_id))?;
        documents.require_open(document)?;
        let state = app.state::<CadState>();
        let result = finish_document_cad(&state.0, document, &job_id, accept);
        crate::verification::trace_verification("CAD finish command returning");
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

fn finish_document_cad(
    state: &EngineState,
    document: &str,
    job_id: &str,
    accept: bool,
) -> Result<(), String> {
    if accept {
        let directory = owned_document_directory(state, document, job_id)?;
        mesh::require_exact_output(&directory)?;
        commit_document_job(state, document, job_id)
    } else {
        discard_document_job(state, document, job_id)
    }
}

#[tauri::command]
pub(crate) async fn read_cad_buffer(
    app: tauri::AppHandle,
    job_id: String,
    document_id: String,
    owner_id: String,
) -> Result<tauri::ipc::Response, String> {
    crate::verification::trace_verification("CAD buffer read received");
    tauri::async_runtime::spawn_blocking(move || {
        let document = document_identity(Some(&document_id))?;
        let project_state = app.state::<ProjectState>();
        let documents = project_state.documents.lock().map_err(|e| e.to_string())?;
        documents.require_owner(Some(&owner_id))?;
        documents.require_open(document)?;
        let directory = owned_document_directory(&app.state::<CadState>().0, document, &job_id)?;
        let buffer = read_bounded(&directory.join("buffer.bin"), MAX_BLOB)?;
        crate::verification::trace_verification("CAD buffer read returning");
        Ok(tauri::ipc::Response::new(buffer))
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
        mesh::require_exact_output(&directory)?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::execution::state::retain_document_job;
    use serde_json::json;

    #[test]
    fn mesh_inspection_cannot_replace_the_accepted_exact_shape_and_is_discardable() {
        let root = tempfile::tempdir().unwrap();
        let previous = root.path().join("previous");
        let inspection = root.path().join("inspection");
        for directory in [&previous, &inspection] {
            fs::create_dir(directory).unwrap();
        }
        fs::write(
            previous.join("receipt.json"),
            json!({"operation":"cad","status":"succeeded"}).to_string(),
        )
        .unwrap();
        fs::write(
            inspection.join("receipt.json"),
            json!({"operation":"mesh-cad","status":"succeeded","purpose":"inspection-only"})
                .to_string(),
        )
        .unwrap();
        let state = EngineState::default();
        let document = uuid::Uuid::new_v4().to_string();
        retain_document_job(&state, &document, "exact".into(), previous.clone()).unwrap();
        stage_document_job(&state, &document, "mesh".into(), inspection.clone()).unwrap();
        assert!(finish_document_cad(&state, &document, "mesh", true).is_err());
        assert!(mesh::require_exact_output(&inspection).is_err());
        assert!(mesh::require_exact_output(&previous).is_ok());
        assert_eq!(
            owned_document_directory(&state, &document, "exact").unwrap(),
            previous
        );
        finish_document_cad(&state, &document, "mesh", false).unwrap();
        assert!(!inspection.exists());
        assert!(previous.exists());
        assert!(owned_document_directory(&state, &document, "exact").is_ok());
    }
}
