use super::{
    events::RunRequestId,
    state::{finish_run, run_cancellation, Active, EngineState},
    validation::{validate_capabilities, validate_devices, validate_metrics, MAX_METRICS},
};
use crate::{
    platform::files::{read_bounded, MAX_BLOB, MAX_JSON, MAX_LOG},
    project::validation::validate_project,
    verification::trace_verification,
};
use serde_json::{json, Value};
use std::{
    fs::{self, File},
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::{Emitter, Manager};
pub(crate) fn engine_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let filename = if cfg!(windows) {
        "phyra-engine.exe"
    } else {
        "phyra-engine"
    };
    let packaged = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("engine")
        .join(filename);
    if packaged.is_file() {
        return Ok(packaged);
    }
    #[cfg(debug_assertions)]
    {
        let development = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources/engine")
            .join(filename);
        if development.is_file() {
            return Ok(development);
        }
    }
    Err("The bundled analysis engine is missing. Run npm run package:engine for development, or reinstall Phyra.".into())
}

pub(crate) fn remember_failure(app: &tauri::AppHandle, directory: &Path, error: &str) {
    let Ok(cache) = app.path().app_cache_dir() else {
        return;
    };
    let mut message = format!("{error}\n").into_bytes();
    message.truncate(MAX_LOG as usize);
    if let Ok(log) = File::open(directory.join("engine.log")) {
        let mut reader = log.take(MAX_LOG - message.len() as u64);
        let _ = reader.read_to_end(&mut message);
    }
    let _ = fs::create_dir_all(&cache);
    let _ = fs::write(cache.join("last-engine-error.log"), message);
}

pub(crate) fn worker(
    app: &tauri::AppHandle,
    state: &EngineState,
    operation: &str,
    project: &Value,
    directory: &Path,
    job_id: &str,
    request_id: Option<&RunRequestId>,
) -> Result<Value, String> {
    worker_with_publication(
        app,
        state,
        WorkerInput {
            operation,
            project,
            directory,
            job_id,
            request_id,
        },
        Ok,
    )
}

pub(crate) struct WorkerInput<'a> {
    pub(crate) operation: &'a str,
    pub(crate) project: &'a Value,
    pub(crate) directory: &'a Path,
    pub(crate) job_id: &'a str,
    pub(crate) request_id: Option<&'a RunRequestId>,
}

pub(crate) fn worker_with_publication(
    app: &tauri::AppHandle,
    state: &EngineState,
    input: WorkerInput<'_>,
    publish: impl FnOnce(Value) -> Result<Value, String>,
) -> Result<Value, String> {
    let WorkerInput {
        operation,
        project,
        directory,
        job_id,
        request_id,
    } = input;
    let cancelled = run_cancellation(state, request_id)?;
    if cancelled.load(Ordering::SeqCst) {
        return Err("Analysis cancelled".into());
    }
    trace_verification(&format!("worker-request:{operation}"));
    validate_project(project)?;
    if state.shutting_down.load(Ordering::SeqCst) {
        return Err("Application is closing".into());
    }
    fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    let mut active = state.active.lock().map_err(|e| e.to_string())?;
    if active.is_some() {
        return Err("An analysis job is already running".into());
    }
    if state.shutting_down.load(Ordering::SeqCst) {
        return Err("Application is closing".into());
    }
    if cancelled.load(Ordering::SeqCst) {
        return Err("Analysis cancelled".into());
    }
    let request = serde_json::to_vec(&json!({"protocolVersion":1,"operation":operation,
        "jobId":job_id,"project":project}))
    .map_err(|e| e.to_string())?;
    if request.len() as u64 > MAX_JSON {
        return Err("Engine request exceeds its resource limit".into());
    }
    let mut command = Command::new(engine_path(app)?);
    command
        .arg("--output")
        .arg(directory)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::from(
            File::create(directory.join("engine.log")).map_err(|e| e.to_string())?,
        ))
        .env("OMP_NUM_THREADS", "1")
        .env("OPENBLAS_NUM_THREADS", "1")
        .env("MKL_NUM_THREADS", "1");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut process = command
        .spawn()
        .map_err(|e| format!("Engine failed to start: {e}"))?;
    trace_verification(&format!("worker-started:{operation}"));
    let stdout = process.stdout.take().ok_or("Missing engine output")?;
    let mut stdin = process.stdin.take().ok_or("Missing engine input")?;
    let child = Arc::new(Mutex::new(process));
    let training_started = Arc::new(AtomicBool::new(false));
    *active = Some(Active {
        child: child.clone(),
        cancelled: cancelled.clone(),
        training_started: training_started.clone(),
        request_id: request_id.cloned(),
    });
    drop(active);
    let execution = (|| -> Result<Value, String> {
        stdin.write_all(&request).map_err(|e| e.to_string())?;
        stdin.write_all(b"\n").map_err(|e| e.to_string())?;
        drop(stdin);
        let mut reader = BufReader::new(stdout);
        let mut final_manifest = None;
        let mut previous_metric = None;
        let mut metric_count = 0;
        let mut frame_count = 0;
        let mut total_bytes = 0u64;
        loop {
            let mut line = Vec::new();
            let count = reader
                .by_ref()
                .take(MAX_JSON + 1)
                .read_until(b'\n', &mut line)
                .map_err(|e| e.to_string())?;
            if count == 0 {
                break;
            }
            frame_count += 1;
            total_bytes += line.len() as u64;
            if frame_count > 2048 || total_bytes > 4 * MAX_JSON {
                return Err("Engine progress stream exceeds its resource limit".into());
            }
            if line.len() as u64 > MAX_JSON {
                return Err("Engine protocol frame exceeds the limit".into());
            }
            let event: Value = serde_json::from_slice(&line)
                .map_err(|_| "Malformed engine protocol".to_string())?;
            if !event.is_object() || final_manifest.is_some() {
                return Err("Unexpected engine frame after completion".into());
            }
            match event["type"].as_str() {
                Some("progress") => {
                    let fraction = &event["progress"];
                    if event["jobId"] != job_id
                        || event["stage"]
                            .as_str()
                            .is_none_or(|stage| stage.len() > 100)
                        || (!fraction.is_null()
                            && fraction
                                .as_f64()
                                .is_none_or(|value| !(0.0..=1.0).contains(&value)))
                    {
                        return Err("Invalid engine progress identity or value".into());
                    }
                    if !cancelled.load(Ordering::SeqCst) {
                        if let Some(request_id) = request_id {
                            let _ = app.emit("engine-progress", request_id.event(&event));
                        }
                    }
                }
                Some("complete") => {
                    if !event["manifest"].is_object() || event.as_object().unwrap().len() != 2 {
                        return Err("Invalid engine completion frame".into());
                    }
                    final_manifest = Some(event["manifest"].clone());
                }
                Some("metrics") => {
                    if !matches!(operation, "train" | "compare") {
                        return Err("Training metrics arrived outside a training job".into());
                    }
                    metric_count += 1;
                    if metric_count > MAX_METRICS {
                        return Err("Training metrics exceed their resource limit".into());
                    }
                    let maximum_step = project["study"]["solver"]["pinn"]["steps"]
                        .as_u64()
                        .ok_or("Missing training step limit")?;
                    previous_metric = Some(validate_metrics(
                        &event,
                        job_id,
                        maximum_step,
                        previous_metric,
                    )?);
                    if event["step"].as_u64().is_some_and(|step| step > 0) {
                        training_started.store(true, Ordering::SeqCst);
                    }
                    if !cancelled.load(Ordering::SeqCst) {
                        if let Some(request_id) = request_id {
                            let _ = app.emit("engine-metrics", request_id.event(&event));
                        }
                    }
                }
                Some("error") => {
                    if event["jobId"] != job_id {
                        return Err("Engine error identity mismatch".into());
                    }
                    return Err(format!(
                        "{}: {}",
                        event["code"].as_str().unwrap_or("ENGINE_ERROR"),
                        event["message"].as_str().unwrap_or("Analysis failed")
                    ));
                }
                _ => return Err("Unknown engine protocol event".into()),
            }
        }
        let status = loop {
            let status = child
                .lock()
                .map_err(|e| e.to_string())?
                .try_wait()
                .map_err(|e| e.to_string())?;
            if let Some(status) = status {
                break status;
            }
            // Release the child mutex between checks so cancellation can always
            // terminate an owned process during its exit/finalization phase.
            std::thread::sleep(std::time::Duration::from_millis(10));
        };
        if cancelled.load(Ordering::SeqCst) {
            return Err("Analysis cancelled".into());
        }
        if !status.success() {
            return Err("Engine exited unexpectedly; inspect the local job log".into());
        }
        let manifest = final_manifest.ok_or("Engine stopped without returning a result")?;
        if manifest["protocolVersion"].as_u64() != Some(1)
            || manifest["status"] != "succeeded"
            || manifest["projectId"] != project["id"]
            || manifest["studyId"] != project["study"]["id"]
        {
            return Err("Engine result ownership mismatch".into());
        }
        if operation != "validate"
            && (manifest["jobId"] != job_id
                || manifest["operation"] != operation
                || manifest["revision"] != project["revision"])
        {
            return Err("Engine job identity mismatch".into());
        }
        if operation == "devices" {
            validate_devices(&manifest)?;
            validate_capabilities(&manifest)?;
            return Ok(manifest);
        }
        let size = fs::metadata(directory.join("buffer.bin"))
            .map_err(|e| e.to_string())?
            .len();
        if size > MAX_BLOB || manifest["byteLength"].as_u64() != Some(size) {
            return Err("Invalid or oversized engine result".into());
        }
        let stored: Value =
            serde_json::from_slice(&read_bounded(&directory.join("manifest.json"), MAX_JSON)?)
                .map_err(|_| "Invalid stored engine metadata".to_string())?;
        if stored != manifest {
            return Err("Engine completion metadata differs from its binary artifact".into());
        }
        Ok(manifest)
    })();
    // Cancellation and candidate staging have one terminal transition. A
    // cancel acknowledgment cannot race a successful retained result, and the
    // frontend can distinguish a completed request from a stopped worker.
    let mut active = state.active.lock().map_err(|e| e.to_string())?;
    let execution = execution.and_then(|manifest| {
        if cancelled.load(Ordering::SeqCst) {
            Err("Analysis cancelled".into())
        } else {
            publish(manifest)
        }
    });
    if let Some(request) = request_id {
        finish_run(state, request)?;
    }
    if execution.is_err() {
        if let Ok(mut process) = child.lock() {
            let _ = process.kill();
            let _ = process.wait();
        }
    }
    active.take();
    drop(active);
    trace_verification(&format!(
        "worker-finished:{operation}:{}",
        if execution.is_ok() {
            "success"
        } else {
            "error"
        }
    ));
    execution
}

pub(crate) fn job_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let parent = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("jobs");
    fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
    Ok(parent.join(uuid::Uuid::new_v4().to_string()))
}
