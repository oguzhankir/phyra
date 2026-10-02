use super::{
    events::RunRequestId,
    state::{cancel_child, owned_directory, retain_job, EngineState},
    worker::{job_directory, remember_failure, worker},
};
use crate::{
    platform::files::{read_bounded, MAX_BLOB},
    verification::trace_verification,
};
use serde_json::Value;
use std::{fs, sync::atomic::Ordering};
use tauri::{Manager, State};
#[tauri::command]
pub(crate) async fn run_job(
    app: tauri::AppHandle,
    operation: String,
    project: Value,
    request_id: String,
) -> Result<Value, String> {
    if !matches!(operation.as_str(), "mesh" | "solve" | "train" | "compare") {
        return Err("Unsupported analysis operation".into());
    }
    let request_id = RunRequestId::parse(request_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<EngineState>();
        let directory = job_directory(&app)?;
        let id = uuid::Uuid::new_v4().to_string();
        let result = worker(
            &app,
            &state,
            &operation,
            &project,
            &directory,
            &id,
            Some(&request_id),
        );
        match result {
            Ok(manifest) => {
                trace_verification("run-job-retaining-result");
                retain_job(&state, id, directory)?;
                trace_verification("run-job-returned");
                Ok(manifest)
            }
            Err(error) => {
                remember_failure(&app, &directory, &error);
                let _ = fs::remove_dir_all(directory);
                Err(error)
            }
        }
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
pub(crate) fn cancel_job(state: State<EngineState>) -> Result<(), String> {
    if let Some(active) = state.active.lock().map_err(|e| e.to_string())?.as_ref() {
        active.cancelled.store(true, Ordering::SeqCst);
        let mut child = active.child.lock().map_err(|e| e.to_string())?;
        cancel_child(&mut child)?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn read_buffer(
    app: tauri::AppHandle,
    job_id: String,
) -> Result<tauri::ipc::Response, String> {
    trace_verification("read-buffer-requested");
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<EngineState>();
        let path = owned_directory(&state, &job_id)?.join("buffer.bin");
        trace_verification("read-buffer-reading");
        let bytes = read_bounded(&path, MAX_BLOB)?;
        trace_verification(&format!("read-buffer-returned:{}", bytes.len()));
        Ok(tauri::ipc::Response::new(bytes))
    })
    .await
    .map_err(|e| e.to_string())?
}
