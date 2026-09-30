use crate::{
    execution::{
        commands::cancel_job,
        state::{owned_directory, EngineState},
        worker::worker,
    },
    platform::files::{read_bounded, MAX_BLOB, MAX_JSON},
    project::{
        archive::{read_archive, write_archive},
        validation::validate_project,
    },
};
use serde_json::{json, Value};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::Manager;
pub(crate) static VERIFICATION_DONE: AtomicBool = AtomicBool::new(false);
static VERIFICATION_FINISHING: AtomicBool = AtomicBool::new(false);
static VERIFICATION_TRACE: Mutex<Vec<String>> = Mutex::new(Vec::new());
pub(crate) fn verification_enabled() -> bool {
    verification_configuration().is_some()
}

#[tauri::command]
pub(crate) fn verification_configuration() -> Option<&'static str> {
    if std::env::args().any(|argument| argument == "--verify-physicsml") {
        Some("2d-compare")
    } else if std::env::args().any(|argument| argument == "--verify-workflow") {
        Some("3d")
    } else {
        None
    }
}

pub(crate) fn bounded_trace(message: &str) -> String {
    message
        .chars()
        .filter(|character| !character.is_control())
        .take(500)
        .collect()
}

pub(crate) fn trace_verification(message: &str) {
    if !verification_enabled() {
        return;
    }
    let message = bounded_trace(message);
    if let Ok(mut history) = VERIFICATION_TRACE.lock() {
        if history.len() == 64 {
            history.remove(0);
        }
        history.push(message.clone());
    }
    println!("PHYRA_TRACE {message}");
    let _ = std::io::stdout().flush();
}

#[tauri::command]
pub(crate) fn verification_mode() -> bool {
    trace_verification("verification-mode-requested");
    verification_enabled()
}

#[tauri::command]
pub(crate) fn verification_trace(message: String) -> Result<(), String> {
    if !verification_enabled() {
        return Err("Workflow verification was not requested".into());
    }
    trace_verification(&message);
    Ok(())
}

pub(crate) fn verification_bytes(mut report: Value) -> Result<Vec<u8>, String> {
    if !report.is_object() {
        report = json!({"error":"Verification report was not an object"});
    }
    let contents = serde_json::to_vec_pretty(&report).map_err(|e| e.to_string())?;
    if contents.len() as u64 > MAX_JSON {
        return serde_json::to_vec_pretty(
            &json!({"error":"Verification report exceeds its resource limit"}),
        )
        .map_err(|e| e.to_string());
    }
    Ok(contents)
}

pub(crate) fn finish_verification(app: &tauri::AppHandle, mut report: Value) -> Result<(), String> {
    if VERIFICATION_DONE.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    trace_verification("writing-verification-report");
    if !report.is_object() {
        report = json!({"error":"Verification report was not an object"});
    }
    if let Ok(history) = VERIFICATION_TRACE.lock() {
        report["nativeTrace"] = json!(*history);
    }
    let contents = verification_bytes(report)?;
    let failed = serde_json::from_slice::<Value>(&contents)
        .map_err(|e| e.to_string())?
        .get("error")
        .is_some();
    let preferred = app.path().app_cache_dir().map_err(|e| e.to_string());
    let fallback = std::env::temp_dir().join("phyra-verification");
    let mut write_error = String::new();
    for directory in preferred.into_iter().chain(std::iter::once(fallback)) {
        let outcome = (|| -> Result<PathBuf, String> {
            fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
            let path = directory.join("verification.json");
            let mut temporary =
                tempfile::NamedTempFile::new_in(&directory).map_err(|e| e.to_string())?;
            temporary.write_all(&contents).map_err(|e| e.to_string())?;
            temporary.as_file().sync_all().map_err(|e| e.to_string())?;
            temporary.persist(&path).map_err(|e| e.to_string())?;
            Ok(path)
        })();
        match outcome {
            Ok(path) => {
                println!("PHYRA_VERIFICATION {}", path.display());
                let _ = std::io::stdout().flush();
                app.exit(if failed { 1 } else { 0 });
                return Ok(());
            }
            Err(error) => {
                write_error = error;
            }
        }
    }
    eprintln!("PHYRA_VERIFICATION_ERROR {write_error}");
    app.exit(1);
    Err(write_error)
}

pub(crate) fn verify_owned_runs(
    app: &tauri::AppHandle,
    project: &Value,
    report: &mut Value,
    directory: &Path,
) -> Result<(), String> {
    let repeated_dir = tempfile::Builder::new()
        .prefix("verification-repeat-")
        .tempdir_in(directory)
        .map_err(|e| e.to_string())?;
    let state = app.state::<EngineState>();
    trace_verification("verification-repeat-mesh");
    let mesh_id = uuid::Uuid::new_v4().to_string();
    worker(app, &state, "mesh", project, repeated_dir.path(), &mesh_id)?;
    trace_verification("verification-repeat-solve");
    let solve_id = uuid::Uuid::new_v4().to_string();
    let repeated = worker(
        app,
        &state,
        "solve",
        project,
        repeated_dir.path(),
        &solve_id,
    )?;
    let repeated_ok = repeated["jobId"] != report["manifest"]["jobId"]
        && repeated["operation"] == "solve"
        && repeated["arrays"]["displacement"]["shape"]
            == report["manifest"]["arrays"]["displacement"]["shape"]
        && repeated["summary"]["relativeResidual"]
            .as_f64()
            .is_some_and(|value| value <= 1e-8)
        && state.active.lock().map_err(|e| e.to_string())?.is_none();
    report["repeatedRun"] = json!(repeated_ok);
    if !repeated_ok {
        return Err(
            "Repeated owned mesh/solve did not preserve valid result dimensions and lifecycle"
                .into(),
        );
    }
    repeated_dir.close().map_err(|e| e.to_string())?;
    let cancellation_dir = tempfile::Builder::new()
        .prefix("verification-cancel-")
        .tempdir_in(directory)
        .map_err(|e| e.to_string())?;
    let output = cancellation_dir.path().to_path_buf();
    let training_cancellation = verification_configuration() == Some("2d-compare");
    let mut snapshot = project.clone();
    if training_cancellation {
        snapshot["study"]["solver"]["pinn"]["steps"] = json!(10_000);
    }
    let handle = app.clone();
    trace_verification("verification-cancel-start");
    let task = std::thread::spawn(move || {
        let state = handle.state::<EngineState>();
        worker(
            &handle,
            &state,
            if training_cancellation {
                "train"
            } else {
                "solve"
            },
            &snapshot,
            &output,
            &uuid::Uuid::new_v4().to_string(),
        )
    });
    let deadline = std::time::Instant::now()
        + std::time::Duration::from_secs(if training_cancellation { 30 } else { 5 });
    let mut observed_active = false;
    while std::time::Instant::now() < deadline && !task.is_finished() {
        if state
            .active
            .lock()
            .map_err(|e| e.to_string())?
            .as_ref()
            .is_some_and(|active| {
                !training_cancellation || active.training_started.load(Ordering::SeqCst)
            })
        {
            observed_active = true;
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(1));
    }
    trace_verification("verification-cancel-request");
    let acknowledgement = cancel_job(app.state::<EngineState>());
    let outcome = task
        .join()
        .map_err(|_| "Cancellation worker thread panicked".to_string())?;
    let cancelled = observed_active
        && acknowledgement.is_ok()
        && outcome
            .as_ref()
            .is_err_and(|error| error.contains("cancelled"))
        && state.active.lock().map_err(|e| e.to_string())?.is_none();
    report["cancellation"] = json!(cancelled);
    if training_cancellation {
        report["trainingCancellation"] = json!(cancelled);
    }
    cancellation_dir.close().map_err(|e| e.to_string())?;
    if !cancelled {
        return Err("Owned worker cancellation was not observed and acknowledged".into());
    }
    trace_verification("verification-cancel-acknowledged");
    Ok(())
}

pub(crate) fn verify_persistence(app: &tauri::AppHandle, report: &mut Value) -> Result<(), String> {
    if report.get("error").is_some() {
        return Ok(());
    }
    if report.get("project").is_none() || report.get("manifest").is_none() {
        return Err("Verification did not return a project and result".into());
    }
    let project = report["project"].clone();
    validate_project(&project)?;
    let state = app.state::<EngineState>();
    let id = report["manifest"]["jobId"]
        .as_str()
        .ok_or("Verification has no owned result")?;
    let original = owned_directory(&state, id)?;
    // Compare persistence against authoritative native metadata. JSON passed
    // through JavaScript can turn 0.0 into integer 0 without changing its value;
    // serde_json::Value distinguishes those number representations.
    let original_metadata: Value =
        serde_json::from_slice(&read_bounded(&original.join("manifest.json"), MAX_JSON)?)
            .map_err(|e| e.to_string())?;
    let directory = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    trace_verification("verification-save-archive");
    let archive_path = directory.join("verification ü project.phyra");
    write_archive(&archive_path, &project, Some(&original))?;
    let restored = tempfile::Builder::new()
        .prefix("verification-restored-")
        .tempdir_in(&directory)
        .map_err(|e| e.to_string())?;
    trace_verification("verification-reopen-archive");
    let reopened = read_archive(&archive_path, restored.path())?;
    trace_verification("verification-validate-reopened");
    let validated = worker(
        app,
        &state,
        "validate",
        &reopened,
        restored.path(),
        &uuid::Uuid::new_v4().to_string(),
    )?;
    trace_verification("verification-compare-buffer");
    report["persistence"] = json!({"projectMatches":reopened == project,
        "manifestMatches":validated == original_metadata,
        "bufferMatches":read_bounded(&original.join("buffer.bin"),MAX_BLOB)?
            == read_bounded(&restored.path().join("buffer.bin"),MAX_BLOB)?,
        "pathHasSpacesAndUnicode":true});
    report["recovery"] =
        crate::project::recovery::verify_definition_recovery(&project, &directory)?;
    let capabilities_directory = tempfile::Builder::new()
        .prefix("verification-capabilities-")
        .tempdir_in(&directory)
        .map_err(|e| e.to_string())?;
    let capabilities = worker(
        app,
        &state,
        "devices",
        &project,
        capabilities_directory.path(),
        &uuid::Uuid::new_v4().to_string(),
    )?;
    report["engineCapabilities"] = capabilities["capabilities"].clone();
    capabilities_directory.close().map_err(|e| e.to_string())?;
    restored.close().map_err(|e| e.to_string())?;
    verify_owned_runs(app, &project, report, &directory)?;
    report["workerStopped"] = json!(state.active.lock().map_err(|e| e.to_string())?.is_none());
    Ok(())
}

#[tauri::command]
pub(crate) async fn verification_complete(
    app: tauri::AppHandle,
    mut report: Value,
) -> Result<(), String> {
    if !verification_enabled() {
        return Err("Workflow verification was not requested".into());
    }
    if VERIFICATION_FINISHING.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    trace_verification("verification-complete-requested");
    let handle = app.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        if !report.is_object() {
            report = json!({"error":"Verification report was not an object"});
        }
        let persistence = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            verify_persistence(&handle, &mut report)
        }));
        match persistence {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                report["error"] = json!(error);
            }
            Err(_) => {
                report["error"] = json!("Native workflow verification panicked");
            }
        }
        finish_verification(&handle, report)
    })
    .await;
    match outcome {
        Ok(result) => result,
        Err(error) => finish_verification(
            &app,
            json!({"error":format!("Verification task failed: {error}")}),
        ),
    }
}
