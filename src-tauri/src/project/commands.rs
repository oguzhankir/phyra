use super::{
    archive::{read_archive_details, write_archive},
    state::ProjectState,
    validation::validate_project,
};
use crate::execution::{
    state::{owned_directory, retain_job, EngineState},
    worker::{job_directory, remember_failure, worker},
};
use serde_json::{json, Value};
use std::fs;
use tauri::Manager;
#[tauri::command]
pub(crate) async fn open_project(app: tauri::AppHandle) -> Result<Option<Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<EngineState>();
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
        let result: Result<Option<Value>, String> = (|| {
            let opened = read_archive_details(&path, &directory)?;
            let project = opened.project;
            let migration_notice = if opened.migrated {
                Some(if opened.dropped_cache {
                    "Version 1 project upgraded to version 2. Legacy cached results were discarded; run the study again."
                } else {
                    "Version 1 project upgraded to version 2 with its original 3D FEM study."
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
                )?)
            } else {
                None
            };
            if let Some(ref manifest) = manifest {
                let id = manifest["jobId"]
                    .as_str()
                    .ok_or("Missing cached job identity")?
                    .to_string();
                retain_job(&state, id, directory.clone())?;
            } else {
                let _ = fs::remove_dir_all(&directory);
            }
            let opened_path = path.to_string_lossy().into_owned();
            *app.state::<ProjectState>().current_path.lock().map_err(|e| e.to_string())? =
                Some((project["id"].as_str().unwrap().to_string(), path));
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
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate_project(&project)?;
        let state = app.state::<EngineState>();
        if state.active.lock().map_err(|e| e.to_string())?.is_some() {
            return Err("Wait for or cancel the analysis before saving".into());
        }
        let cache = if let Some(id) = job_id {
            let directory = owned_directory(&state, &id)?;
            worker(
                &app,
                &state,
                "validate",
                &project,
                &directory,
                &uuid::Uuid::new_v4().to_string(),
            )?;
            Some(directory)
        } else {
            None
        };
        let current = app
            .state::<ProjectState>()
            .current_path
            .lock()
            .map_err(|e| e.to_string())?
            .clone()
            .filter(|(id, _)| Some(id.as_str()) == project["id"].as_str())
            .map(|(_, path)| path);
        let path = if !save_as && current.is_some() {
            current
        } else {
            rfd::FileDialog::new()
                .add_filter("Phyra project", &["phyra"])
                .set_file_name("project.phyra")
                .save_file()
        };
        let Some(mut path) = path else {
            return Ok(None);
        };
        if path.extension().is_none() {
            path.set_extension("phyra");
        }
        write_archive(&path, &project, cache.as_deref())?;
        *app.state::<ProjectState>()
            .current_path
            .lock()
            .map_err(|e| e.to_string())? =
            Some((project["id"].as_str().unwrap().to_string(), path.clone()));
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())?
}
