use super::{
    events::RunRequestId,
    state::{
        activate_result_owner, cancel_owned_request, commit_document_job, discard_document_job,
        finish_run, owned_document_directory, register_run, stage_document_job, EngineState,
    },
    worker::{job_directory, remember_failure, worker, worker_with_publication, WorkerInput},
};
use crate::{
    platform::files::{read_bounded, MAX_BLOB},
    project::state::{document_identity, ProjectState},
    verification::trace_verification,
};
use serde_json::Value;
use std::fs;
use tauri::{Manager, State};
#[tauri::command]
pub(crate) async fn run_job(
    app: tauri::AppHandle,
    operation: String,
    project: Value,
    request_id: String,
    document_id: Option<String>,
    owner_id: Option<String>,
) -> Result<Value, String> {
    if !matches!(operation.as_str(), "mesh" | "solve" | "train" | "compare") {
        return Err("Unsupported analysis operation".into());
    }
    let request_id = RunRequestId::parse(request_id)?;
    register_run(&app.state::<EngineState>(), &request_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<EngineState>();
        let result = (|| {
            let document = document_identity(document_id.as_deref())?;
            let project_state = app.state::<ProjectState>();
            {
                let mut documents = project_state.documents.lock().map_err(|e| e.to_string())?;
                documents.activate_owner(owner_id.as_deref())?;
                documents.require_open(document)?;
                activate_result_owner(&state, owner_id.as_deref())?;
            }
            let directory = job_directory(&app)?;
            let id = uuid::Uuid::new_v4().to_string();
            let result = worker_with_publication(
                &app,
                &state,
                WorkerInput {
                    operation: &operation,
                    project: &project,
                    directory: &directory,
                    job_id: &id,
                    request_id: Some(&request_id),
                },
                |manifest| {
                    trace_verification("run-job-retaining-result");
                    let publication = (|| {
                        let documents =
                            project_state.documents.lock().map_err(|e| e.to_string())?;
                        documents.require_owner(owner_id.as_deref())?;
                        documents.require_open(document)?;
                        stage_document_job(&state, document, id.clone(), directory.clone())
                    })();
                    if let Err(error) = publication {
                        let _ = fs::remove_dir_all(&directory);
                        return Err(error);
                    }
                    trace_verification("run-job-returned");
                    Ok(manifest)
                },
            );
            match result {
                Ok(manifest) => Ok(manifest),
                Err(error) => {
                    remember_failure(&app, &directory, &error);
                    let _ = fs::remove_dir_all(directory);
                    Err(error)
                }
            }
        })();
        finish_run(&state, &request_id)?;
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn get_devices(app: tauri::AppHandle, project: Value) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<EngineState>();
        let directory = job_directory(&app)?;
        let result = worker(
            &app,
            &state,
            "devices",
            &project,
            &directory,
            &uuid::Uuid::new_v4().to_string(),
            None,
        );
        if let Err(ref error) = result {
            remember_failure(&app, &directory, error);
        }
        let _ = fs::remove_dir_all(directory);
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) fn cancel_job(
    state: State<EngineState>,
    request_id: Option<String>,
) -> Result<bool, String> {
    let request = request_id.map(RunRequestId::parse).transpose()?;
    cancel_owned_request(&state, request.as_ref())
}

#[tauri::command]
pub(crate) async fn finish_result(
    app: tauri::AppHandle,
    job_id: String,
    document_id: Option<String>,
    owner_id: String,
    accept: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let project_state = app.state::<ProjectState>();
        let document = document_identity(document_id.as_deref())?;
        let documents = project_state.documents.lock().map_err(|e| e.to_string())?;
        documents.require_owner(Some(&owner_id))?;
        documents.require_open(document)?;
        let state = app.state::<EngineState>();
        if accept {
            commit_document_job(&state, document, &job_id)
        } else {
            discard_document_job(&state, document, &job_id)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn read_buffer(
    app: tauri::AppHandle,
    job_id: String,
    document_id: Option<String>,
    owner_id: Option<String>,
) -> Result<tauri::ipc::Response, String> {
    trace_verification("read-buffer-requested");
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<EngineState>();
        let document = document_identity(document_id.as_deref())?;
        let project_state = app.state::<ProjectState>();
        let documents = project_state.documents.lock().map_err(|e| e.to_string())?;
        documents.require_owner(owner_id.as_deref())?;
        documents.require_open(document)?;
        let path = owned_document_directory(&state, document, &job_id)?.join("buffer.bin");
        trace_verification("read-buffer-reading");
        let bytes = read_bounded(&path, MAX_BLOB)?;
        trace_verification(&format!("read-buffer-returned:{}", bytes.len()));
        Ok(tauri::ipc::Response::new(bytes))
    })
    .await
    .map_err(|e| e.to_string())?
}
