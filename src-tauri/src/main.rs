#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs::{self, File},
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::{Emitter, Manager, State};
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

const MAX_BLOB: u64 = 64 * 1024 * 1024;
const MAX_JSON: u64 = 1024 * 1024;
const MAX_LOG: u64 = 256 * 1024;
const MAX_METRICS: usize = 1024;
static VERIFICATION_DONE: AtomicBool = AtomicBool::new(false);
static VERIFICATION_FINISHING: AtomicBool = AtomicBool::new(false);
static VERIFICATION_TRACE: Mutex<Vec<String>> = Mutex::new(Vec::new());

struct Active {
    child: Arc<Mutex<Child>>,
    cancelled: Arc<AtomicBool>,
    training_started: Arc<AtomicBool>,
}
#[derive(Default)]
struct EngineState {
    active: Mutex<Option<Active>>,
    jobs: Mutex<HashMap<String, PathBuf>>,
    current_path: Mutex<Option<(String, PathBuf)>>,
    shutting_down: AtomicBool,
}

fn validate_project(project: &Value) -> Result<(), String> {
    let schema: Value = serde_json::from_str(include_str!("../../contracts/project.schema.json"))
        .map_err(|e| e.to_string())?;
    let validator = jsonschema::validator_for(&schema).map_err(|e| e.to_string())?;
    validator
        .validate(project)
        .map_err(|e| format!("Invalid project: {e}"))
}

fn migrate_project(mut project: Value) -> Result<(Value, bool), String> {
    match project["schemaVersion"].as_u64() {
        Some(2) => {
            validate_project(&project)?;
            Ok((project, false))
        }
        Some(1) => {
            let legacy: Value =
                serde_json::from_str(include_str!("../../contracts/project-v1.schema.json"))
                    .map_err(|e| e.to_string())?;
            jsonschema::validator_for(&legacy)
                .map_err(|e| e.to_string())?
                .validate(&project)
                .map_err(|e| format!("Invalid version 1 project: {e}"))?;
            project["schemaVersion"] = json!(2);
            project["study"]["dimension"] = json!("3d");
            project["study"]["formulation"] = json!("solid");
            project["study"]["thickness"] = project["geometry"]["height"].clone();
            project["study"]["solver"] = json!({"kind":"fem","pinn":{
                "layers":3,"width":32,"activation":"tanh","optimizer":"adam",
                "learningRate":0.001,"steps":1000,"interiorPoints":128,
                "boundaryPoints":32,"seed":42,"device":"auto"}});
            validate_project(&project)?;
            Ok((project, true))
        }
        _ => Err("Unsupported project schema version".into()),
    }
}

fn validate_metrics(
    event: &Value,
    job_id: &str,
    maximum_step: u64,
    previous: Option<(u64, f64)>,
) -> Result<(u64, f64), String> {
    let step = event["step"].as_u64().ok_or("Invalid training step")?;
    let elapsed = event["elapsed"]
        .as_f64()
        .filter(|value| value.is_finite() && (0.0..=1e9).contains(value))
        .ok_or("Invalid training elapsed time")?;
    if event["type"] != "metrics"
        || event["jobId"] != job_id
        || event.as_object().is_none_or(|object| object.len() != 8)
        || step > maximum_step
        || previous.is_some_and(|(old_step, old_elapsed)| step <= old_step || elapsed < old_elapsed)
        || !matches!(event["device"].as_str(), Some("cpu" | "mps" | "cuda"))
        || ["total", "pde", "boundary"].iter().any(|key| {
            event[*key]
                .as_f64()
                .is_none_or(|value| !value.is_finite() || value < 0.0)
        })
    {
        return Err("Invalid training metric identity, sequence, or value".into());
    }
    Ok((step, elapsed))
}

fn validate_devices(manifest: &Value) -> Result<(), String> {
    let devices = manifest["devices"]
        .as_array()
        .ok_or("Missing compute devices")?;
    if devices.is_empty() || devices.len() > 3 || manifest["defaultDevice"] != "cpu" {
        return Err("Invalid compute device inventory".into());
    }
    let mut seen = std::collections::HashSet::new();
    for device in devices {
        let id = device["id"]
            .as_str()
            .ok_or("Missing compute device identity")?;
        if !matches!(id, "cpu" | "mps" | "cuda")
            || !seen.insert(id)
            || device["label"]
                .as_str()
                .is_none_or(|value| value.is_empty() || value.len() > 100)
            || device["available"].as_bool().is_none()
            || !matches!(device["precision"].as_str(), Some("float64" | "float32"))
            || device["reason"]
                .as_str()
                .is_none_or(|value| value.len() > 500)
        {
            return Err("Invalid compute device metadata".into());
        }
    }
    if !devices
        .iter()
        .any(|device| device["id"] == "cpu" && device["available"] == true)
        || manifest["framework"]
            .as_str()
            .is_none_or(|value| value.is_empty() || value.len() > 100)
    {
        return Err("Missing usable CPU or framework identity".into());
    }
    Ok(())
}

fn engine_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
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

fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() > limit {
        return Err("File exceeds its resource limit".into());
    }
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > limit {
        return Err("File changed beyond its resource limit".into());
    }
    Ok(bytes)
}

fn retain_job(state: &EngineState, id: String, directory: PathBuf) -> Result<(), String> {
    let mut jobs = state.jobs.lock().map_err(|e| e.to_string())?;
    if state.shutting_down.load(Ordering::SeqCst) {
        let _ = fs::remove_dir_all(directory);
        return Err("Application is closing".into());
    }
    // The workbench has one current result. Preserve it until a new job succeeds,
    // then retire all previous disk buffers, including reused imported job IDs.
    let previous = std::mem::take(&mut *jobs);
    jobs.insert(id, directory.clone());
    drop(jobs);
    for old in previous.into_values() {
        if old != directory {
            let _ = fs::remove_dir_all(old);
        }
    }
    Ok(())
}

fn remember_failure(app: &tauri::AppHandle, directory: &Path, error: &str) {
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

fn cancel_child(child: &mut Child) -> Result<(), String> {
    if child.try_wait().map_err(|e| e.to_string())?.is_none() {
        if let Err(error) = child.kill() {
            // Completion can race cancellation between try_wait and kill.
            if child.try_wait().map_err(|e| e.to_string())?.is_none() {
                return Err(error.to_string());
            }
        }
    }
    child.wait().map_err(|e| e.to_string())?;
    Ok(())
}

fn worker(
    app: &tauri::AppHandle,
    state: &EngineState,
    operation: &str,
    project: &Value,
    directory: &Path,
    job_id: &str,
) -> Result<Value, String> {
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
    let cancelled = Arc::new(AtomicBool::new(false));
    let training_started = Arc::new(AtomicBool::new(false));
    *active = Some(Active {
        child: child.clone(),
        cancelled: cancelled.clone(),
        training_started: training_started.clone(),
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
                        let _ = app.emit("engine-progress", &event);
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
                        let _ = app.emit("engine-metrics", &event);
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
    if execution.is_err() {
        if let Ok(mut process) = child.lock() {
            let _ = process.kill();
            let _ = process.wait();
        }
    }
    state.active.lock().map_err(|e| e.to_string())?.take();
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

fn job_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let parent = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("jobs");
    fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
    Ok(parent.join(uuid::Uuid::new_v4().to_string()))
}

#[tauri::command]
async fn run_job(
    app: tauri::AppHandle,
    operation: String,
    project: Value,
) -> Result<Value, String> {
    if !matches!(operation.as_str(), "mesh" | "solve" | "train" | "compare") {
        return Err("Unsupported analysis operation".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<EngineState>();
        let directory = job_directory(&app)?;
        let id = uuid::Uuid::new_v4().to_string();
        let result = worker(&app, &state, &operation, &project, &directory, &id);
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
async fn get_devices(app: tauri::AppHandle, project: Value) -> Result<Value, String> {
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
fn cancel_job(state: State<EngineState>) -> Result<(), String> {
    if let Some(active) = state.active.lock().map_err(|e| e.to_string())?.as_ref() {
        active.cancelled.store(true, Ordering::SeqCst);
        let mut child = active.child.lock().map_err(|e| e.to_string())?;
        cancel_child(&mut child)?;
    }
    Ok(())
}

fn owned_directory(state: &EngineState, id: &str) -> Result<PathBuf, String> {
    state
        .jobs
        .lock()
        .map_err(|e| e.to_string())?
        .get(id)
        .cloned()
        .ok_or("The result no longer belongs to this application session".into())
}

#[tauri::command]
async fn read_buffer(
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

struct OpenedArchive {
    project: Value,
    migrated: bool,
    dropped_cache: bool,
}

fn read_archive_details(path: &Path, directory: &Path) -> Result<OpenedArchive, String> {
    if fs::metadata(path).map_err(|e| e.to_string())?.len() > MAX_BLOB + 2 * MAX_JSON {
        return Err("Project file exceeds resource limit".into());
    }
    let mut archive = ZipArchive::new(File::open(path).map_err(|e| e.to_string())?)
        .map_err(|_| "This is not a Phyra project archive".to_string())?;
    if archive.len() != 1 && archive.len() != 3 {
        return Err("Unexpected project archive contents".into());
    }
    let mut seen = std::collections::HashSet::new();
    let mut total = 0u64;
    let mut project = None;
    let mut cache = Vec::new();
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        if !["project.json", "manifest.json", "buffer.bin"].contains(&name.as_str())
            || !seen.insert(name.clone())
        {
            return Err("Unexpected or duplicate project entry".into());
        }
        let limit = if name == "buffer.bin" {
            MAX_BLOB
        } else {
            MAX_JSON
        };
        if entry.size() > limit {
            return Err("Project payload exceeds resource limit".into());
        }
        let mut bytes = Vec::new();
        entry
            .by_ref()
            .take(limit + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        total += bytes.len() as u64;
        if bytes.len() as u64 > limit || total > MAX_BLOB + 2 * MAX_JSON {
            return Err("Decompressed project exceeds resource limit".into());
        }
        if name == "project.json" {
            project = Some(
                serde_json::from_slice(&bytes)
                    .map_err(|e| format!("Invalid project metadata: {e}"))?,
            );
        } else {
            cache.push((name, bytes));
        }
    }
    let project = project.ok_or("Project metadata is missing")?;
    let (project, migrated) = migrate_project(project)?;
    let dropped_cache = migrated && !cache.is_empty();
    if !migrated && !cache.is_empty() {
        fs::create_dir_all(directory).map_err(|e| e.to_string())?;
        for (name, bytes) in cache {
            fs::write(directory.join(name), bytes).map_err(|e| e.to_string())?;
        }
    }
    Ok(OpenedArchive {
        project,
        migrated,
        dropped_cache,
    })
}

fn read_archive(path: &Path, directory: &Path) -> Result<Value, String> {
    Ok(read_archive_details(path, directory)?.project)
}

#[tauri::command]
async fn open_project(app: tauri::AppHandle) -> Result<Option<Value>, String> {
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
            *state.current_path.lock().map_err(|e| e.to_string())? =
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

fn write_archive(path: &Path, project: &Value, cache: Option<&Path>) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid destination")?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    {
        let mut archive = ZipWriter::new(temporary.as_file_mut());
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        archive
            .start_file("project.json", options)
            .map_err(|e| e.to_string())?;
        archive
            .write_all(&serde_json::to_vec(project).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        if let Some(directory) = cache {
            for name in ["manifest.json", "buffer.bin"] {
                archive
                    .start_file(name, options)
                    .map_err(|e| e.to_string())?;
                let mut source = File::open(directory.join(name)).map_err(|e| e.to_string())?;
                std::io::copy(&mut source, &mut archive).map_err(|e| e.to_string())?;
            }
        }
        archive.finish().map_err(|e| e.to_string())?;
    }
    temporary.as_file().sync_all().map_err(|e| e.to_string())?;
    temporary
        .persist(path)
        .map_err(|e| format!("Could not replace the project safely: {e}"))?;
    Ok(())
}

#[tauri::command]
async fn save_project(
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
        let current = state
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
        *state.current_path.lock().map_err(|e| e.to_string())? =
            Some((project["id"].as_str().unwrap().to_string(), path.clone()));
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn array_values(manifest: &Value, bytes: &[u8], name: &str) -> Result<Vec<f64>, String> {
    let (dtype, association, width, units) = match name {
        "positions" | "displacement" | "pinnDisplacement" => ("float64", "node", 3usize, "m"),
        "reactions" | "pinnReactions" => ("float64", "node", 3, "N"),
        "cells" => (
            "uint32",
            "cell",
            if manifest["dimension"] == "2d" { 3 } else { 4 },
            "1",
        ),
        "stress" | "pinnStress" => ("float64", "cell", 6, "Pa"),
        "vonMises" | "pinnVonMises" => ("float64", "cell", 1, "Pa"),
        _ => return Err("Unsupported exported field".into()),
    };
    let count_key = if association == "node" {
        "nodes"
    } else {
        "cells"
    };
    let count = manifest["statistics"][count_key]
        .as_u64()
        .ok_or("Missing field entity count")?;
    let maximum = if association == "node" {
        12_000
    } else {
        50_000
    };
    if count == 0 || count > maximum {
        return Err("Invalid exported entity count".into());
    }
    let descriptor = &manifest["arrays"][name];
    let shape = if width == 1 {
        json!([count])
    } else {
        json!([count, width])
    };
    if descriptor["dtype"] != dtype
        || descriptor["association"] != association
        || descriptor["units"] != units
        || descriptor["shape"] != shape
    {
        return Err("Exported field dimensions or units are invalid".into());
    }
    let offset = usize::try_from(
        descriptor["offset"]
            .as_u64()
            .ok_or("Missing field offset")?,
    )
    .map_err(|_| "Field offset overflow")?;
    let length = usize::try_from(
        descriptor["byteLength"]
            .as_u64()
            .ok_or("Missing field length")?,
    )
    .map_err(|_| "Field length overflow")?;
    let item_size = if dtype == "float64" { 8usize } else { 4usize };
    let expected = (count as usize)
        .checked_mul(width)
        .and_then(|n| n.checked_mul(item_size))
        .ok_or("Field dimensions overflow")?;
    if offset % 8 != 0 || length != expected {
        return Err("Invalid exported field byte range".into());
    }
    let data = bytes
        .get(offset..offset.checked_add(length).ok_or("Field overflow")?)
        .ok_or("Invalid field bounds")?;
    let values: Vec<f64> = if dtype == "float64" {
        data.chunks_exact(8)
            .map(|b| f64::from_le_bytes(b.try_into().unwrap()))
            .collect()
    } else {
        data.chunks_exact(4)
            .map(|b| u32::from_le_bytes(b.try_into().unwrap()) as f64)
            .collect()
    };
    if values.iter().any(|value| !value.is_finite()) {
        return Err("Exported field contains nonfinite values".into());
    }
    Ok(values)
}

#[tauri::command]
async fn export_results(app: tauri::AppHandle, job_id: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<EngineState>();
        let directory = owned_directory(&state, &job_id)?;
        let manifest: Value = serde_json::from_slice(&read_bounded(
            &directory.join("manifest.json"), MAX_JSON,
        )?).map_err(|e| e.to_string())?;
        let operation = manifest["operation"].as_str().unwrap_or("");
        if !matches!(operation, "solve" | "train" | "compare") || manifest["jobId"] != job_id {
            return Err("Complete the current owned study before exporting results".into());
        }
        let Some(path) = rfd::FileDialog::new()
            .add_filter("CSV result tables", &["csv"])
            .set_file_name("results.csv").save_file()
        else { return Ok(None); };
        let bytes = read_bounded(&directory.join("buffer.bin"), MAX_BLOB)?;
        if manifest["byteLength"].as_u64() != Some(bytes.len() as u64) {
            return Err("Exported binary length does not match metadata".into());
        }
        let positions = array_values(&manifest, &bytes, "positions")?;
        let cells = array_values(&manifest, &bytes, "cells")?;
        let cell_width = if manifest["dimension"] == "2d" { 3 } else { 4 };
        if cells.iter().any(|index| *index >= (positions.len() / 3) as f64) {
            return Err("Exported cell references an absent node".into());
        }
        let parent = path.parent().ok_or("Invalid export destination")?;
        let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
        writeln!(file, "# Phyra; project={}; study={}; fingerprint={}; mesh={}; job={}",
            manifest["projectId"],manifest["studyId"],manifest["fingerprint"],
            manifest["meshId"],manifest["jobId"]).map_err(|e| e.to_string())?;
        if operation == "compare" {
            writeln!(file, "# comparison={}", manifest["comparison"]).map_err(|e| e.to_string())?;
        }
        let mut datasets = vec![(if operation == "train" { "PINN" } else { "FEM" },
            "displacement", "reactions", "stress", "vonMises")];
        if operation == "compare" {
            datasets.push(("PINN", "pinnDisplacement", "pinnReactions", "pinnStress", "pinnVonMises"));
        }
        for (solver, u_name, reaction_name, stress_name, vm_name) in datasets {
            let displacement = array_values(&manifest, &bytes, u_name)?;
            let reactions = array_values(&manifest, &bytes, reaction_name)?;
            let stresses = array_values(&manifest, &bytes, stress_name)?;
            let vm = array_values(&manifest, &bytes, vm_name)?;
            writeln!(file, "solver,association,entity,x_m,y_m,z_m,ux_m,uy_m,uz_m,rx_N,ry_N,rz_N")
                .map_err(|e| e.to_string())?;
            for (node, xyz) in positions.chunks_exact(3).enumerate() {
                let u = &displacement[node * 3..node * 3 + 3];
                let r = &reactions[node * 3..node * 3 + 3];
                writeln!(file,"{solver},node,{node},{},{},{},{},{},{},{},{},{}",
                    xyz[0],xyz[1],xyz[2],u[0],u[1],u[2],r[0],r[1],r[2])
                    .map_err(|e| e.to_string())?;
            }
            writeln!(file, "solver,association,entity,node0,node1,node2,node3,sxx_Pa,syy_Pa,szz_Pa,sxy_Pa,syz_Pa,sxz_Pa,vonMises_Pa")
                .map_err(|e| e.to_string())?;
            for (cell, nodes) in cells.chunks_exact(cell_width).enumerate() {
                let fourth = if cell_width == 4 { nodes[3].to_string() } else { String::new() };
                let s = &stresses[cell * 6..cell * 6 + 6];
                writeln!(file,"{solver},cell,{cell},{},{},{},{fourth},{},{},{},{},{},{},{}",
                    nodes[0],nodes[1],nodes[2],s[0],s[1],s[2],s[3],s[4],s[5],vm[cell])
                    .map_err(|e| e.to_string())?;
            }
        }
        file.as_file().sync_all().map_err(|e| e.to_string())?;
        file.persist(&path).map_err(|e| e.to_string())?;
        Ok(Some(path.to_string_lossy().into_owned()))
    }).await.map_err(|e| e.to_string())?
}

fn stop_owned(state: &EngineState) {
    state.shutting_down.store(true, Ordering::SeqCst);
    if let Ok(active) = state.active.lock() {
        if let Some(active) = active.as_ref() {
            active.cancelled.store(true, Ordering::SeqCst);
            if let Ok(mut child) = active.child.lock() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
    if let Ok(jobs) = state.jobs.lock() {
        for directory in jobs.values() {
            let _ = fs::remove_dir_all(directory);
        }
    }
}

fn verification_enabled() -> bool {
    verification_configuration().is_some()
}

#[tauri::command]
fn verification_configuration() -> Option<&'static str> {
    if std::env::args().any(|argument| argument == "--verify-physicsml") {
        Some("2d-compare")
    } else if std::env::args().any(|argument| argument == "--verify-workflow") {
        Some("3d")
    } else {
        None
    }
}

fn bounded_trace(message: &str) -> String {
    message
        .chars()
        .filter(|character| !character.is_control())
        .take(500)
        .collect()
}

fn trace_verification(message: &str) {
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
fn verification_mode() -> bool {
    trace_verification("verification-mode-requested");
    verification_enabled()
}

#[tauri::command]
fn verification_trace(message: String) -> Result<(), String> {
    if !verification_enabled() {
        return Err("Workflow verification was not requested".into());
    }
    trace_verification(&message);
    Ok(())
}

fn verification_bytes(mut report: Value) -> Result<Vec<u8>, String> {
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

fn finish_verification(app: &tauri::AppHandle, mut report: Value) -> Result<(), String> {
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

fn verify_owned_runs(
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

fn verify_persistence(app: &tauri::AppHandle, report: &mut Value) -> Result<(), String> {
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
    restored.close().map_err(|e| e.to_string())?;
    verify_owned_runs(app, &project, report, &directory)?;
    report["workerStopped"] = json!(state.active.lock().map_err(|e| e.to_string())?.is_none());
    Ok(())
}

#[tauri::command]
async fn verification_complete(app: tauri::AppHandle, mut report: Value) -> Result<(), String> {
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

fn main() {
    trace_verification("native-startup");
    let application = tauri::Builder::default()
        .on_page_load(|webview, payload| {
            trace_verification(&format!(
                "page-load:{:?}:{}:{}",
                payload.event(),
                webview.label(),
                payload.url()
            ));
        })
        .setup(|app| {
            trace_verification("native-setup");
            if verification_enabled() {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(
                        if verification_configuration() == Some("2d-compare") {
                            240
                        } else {
                            75
                        },
                    ));
                    if !VERIFICATION_DONE.load(Ordering::SeqCst) {
                        trace_verification("verification-watchdog-expired");
                        stop_owned(&handle.state::<EngineState>());
                        let _ = finish_verification(
                            &handle,
                            json!({"error":"Native desktop workflow timed out before completion"}),
                        );
                    }
                });
            }
            Ok(())
        })
        .manage(EngineState::default())
        .invoke_handler(tauri::generate_handler![
            run_job,
            get_devices,
            cancel_job,
            read_buffer,
            open_project,
            save_project,
            export_results,
            verification_mode,
            verification_configuration,
            verification_trace,
            verification_complete
        ])
        .build(tauri::generate_context!())
        .expect("Unable to start Phyra");
    trace_verification("native-built");
    application.run(|app, event| {
        if matches!(event, tauri::RunEvent::Ready) {
            trace_verification("native-ready");
        }
        if matches!(event, tauri::RunEvent::Exit) {
            stop_owned(&app.state::<EngineState>());
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    fn project() -> Value {
        json!({"schemaVersion":2,"id":"test","name":"Test","revision":0,"displayUnits":"mm","geometry":{"kind":"box","length":1.,"width":0.1,"height":0.1,"radius":0.05,"thickness":0.02},"study":{"id":"study","type":"linear-static","dimension":"3d","formulation":"solid","thickness":0.1,"solver":{"kind":"fem","pinn":{"layers":3,"width":32,"activation":"tanh","optimizer":"adam","learningRate":0.001,"steps":1000,"interiorPoints":128,"boundaryPoints":32,"seed":42,"device":"auto"}},"material":{"name":"Generic","young":2e11,"poisson":0.3},"mesh":{"size":0.1},"constraints":[],"loads":[]}})
    }
    fn legacy_project() -> Value {
        let mut project = project();
        project["schemaVersion"] = json!(1);
        for field in ["dimension", "formulation", "thickness", "solver"] {
            project["study"].as_object_mut().unwrap().remove(field);
        }
        project
    }
    #[test]
    fn unmeshed_project_round_trip() {
        let temporary = tempfile::tempdir().unwrap();
        let path = temporary.path().join("spaced ü project.phyra");
        write_archive(&path, &project(), None).unwrap();
        assert_eq!(read_archive(&path, temporary.path()).unwrap(), project());
    }
    #[test]
    fn malformed_version_rejected() {
        let mut value = project();
        value["schemaVersion"] = json!(7);
        assert!(validate_project(&value).is_err());
    }
    #[test]
    fn archive_traversal_rejected() {
        let temporary = tempfile::tempdir().unwrap();
        let path = temporary.path().join("bad.phyra");
        let mut archive = ZipWriter::new(File::create(&path).unwrap());
        archive
            .start_file("../project.json", SimpleFileOptions::default())
            .unwrap();
        archive.write_all(b"{}").unwrap();
        archive.finish().unwrap();
        assert!(read_archive(&path, temporary.path()).is_err());
    }

    #[test]
    fn legacy_migration_preserves_problem_and_discards_cached_results_explicitly() {
        let temporary = tempfile::tempdir().unwrap();
        let legacy_cache = temporary.path().join("old-cache");
        fs::create_dir(&legacy_cache).unwrap();
        fs::write(
            legacy_cache.join("manifest.json"),
            b"{\"protocolVersion\":1}",
        )
        .unwrap();
        fs::write(legacy_cache.join("buffer.bin"), b"legacy result").unwrap();
        let path = temporary.path().join("version 1.phyra");
        write_archive(&path, &legacy_project(), Some(&legacy_cache)).unwrap();
        let restored = temporary.path().join("restored");
        let opened = read_archive_details(&path, &restored).unwrap();
        assert_eq!(opened.project, project());
        assert!(opened.migrated);
        assert!(opened.dropped_cache);
        assert!(!restored.join("manifest.json").exists());
        assert!(!restored.join("buffer.bin").exists());
    }

    #[test]
    fn legacy_schema_is_validated_before_defaults_are_added() {
        let mut legacy = legacy_project();
        legacy["study"]["solver"] = json!({"kind":"pinn"});
        assert!(migrate_project(legacy).is_err());
        let mut unknown = legacy_project();
        unknown["schemaVersion"] = json!(3);
        assert!(migrate_project(unknown).is_err());
        let (unchanged, migrated) = migrate_project(project()).unwrap();
        assert_eq!(unchanged, project());
        assert!(!migrated);
    }

    #[test]
    fn current_archive_restores_bounded_cache_into_new_directory() {
        let temporary = tempfile::tempdir().unwrap();
        let source = temporary.path().join("source");
        fs::create_dir(&source).unwrap();
        fs::write(source.join("manifest.json"), b"{}").unwrap();
        fs::write(source.join("buffer.bin"), b"typed binary").unwrap();
        let path = temporary.path().join("current.phyra");
        write_archive(&path, &project(), Some(&source)).unwrap();
        let restored = temporary.path().join("new cache");
        let opened = read_archive_details(&path, &restored).unwrap();
        assert!(!opened.migrated);
        assert!(!opened.dropped_cache);
        assert_eq!(
            fs::read(restored.join("buffer.bin")).unwrap(),
            b"typed binary"
        );
    }
}

#[cfg(test)]
mod training_protocol_tests {
    use super::*;

    fn metric() -> Value {
        json!({"type":"metrics","jobId":"owned","step":2,"elapsed":0.25,
            "total":0.75,"pde":0.25,"boundary":0.5,"device":"cpu"})
    }

    #[test]
    fn training_metrics_enforce_ownership_finiteness_and_monotonic_progress() {
        assert_eq!(
            validate_metrics(&metric(), "owned", 10, Some((1, 0.1))).unwrap(),
            (2, 0.25)
        );
        for (key, value) in [
            ("jobId", json!("other")),
            ("step", json!(11)),
            ("step", json!(1)),
            ("step", json!(2.5)),
            ("elapsed", json!(-1)),
            ("elapsed", json!(0.05)),
            ("total", json!(-1)),
            ("pde", Value::Null),
            ("boundary", json!("0")),
            ("device", json!("invented")),
        ] {
            let mut malformed = metric();
            malformed[key] = value;
            assert!(
                validate_metrics(&malformed, "owned", 10, Some((1, 0.1))).is_err(),
                "{key}"
            );
        }
        let mut repeated = metric();
        repeated["step"] = json!(1);
        assert!(validate_metrics(&repeated, "owned", 10, Some((1, 0.1))).is_err());
    }

    #[test]
    fn devices_require_real_identifiable_cpu_and_bounded_metadata() {
        let inventory = json!({"devices":[{"id":"cpu","label":"CPU","available":true,
            "precision":"float64","reason":""}],"defaultDevice":"cpu","framework":"PyTorch"});
        assert!(validate_devices(&inventory).is_ok());
        for (key, value) in [
            ("id", json!("fake")),
            ("available", json!(false)),
            ("precision", json!("float16")),
            ("reason", json!("x".repeat(501))),
        ] {
            let mut malformed = inventory.clone();
            malformed["devices"][0][key] = value;
            assert!(validate_devices(&malformed).is_err());
        }
        let mut duplicates = inventory.clone();
        duplicates["devices"]
            .as_array_mut()
            .unwrap()
            .push(inventory["devices"][0].clone());
        assert!(validate_devices(&duplicates).is_err());
    }

    #[test]
    fn planar_export_uses_triangles_and_preserves_comparison_units() {
        let manifest = json!({"dimension":"2d","statistics":{"nodes":3,"cells":1},
            "arrays":{"cells":{"dtype":"uint32","association":"cell","units":"1",
                "shape":[1,3],"offset":0,"byteLength":12},
                "pinnVonMises":{"dtype":"float64","association":"cell","units":"Pa",
                    "shape":[1],"offset":16,"byteLength":8}}});
        let mut data: Vec<u8> = [0u32, 1, 2]
            .into_iter()
            .flat_map(u32::to_le_bytes)
            .collect();
        data.extend_from_slice(&[0; 4]);
        data.extend_from_slice(&12.5f64.to_le_bytes());
        assert_eq!(
            array_values(&manifest, &data, "cells").unwrap(),
            [0., 1., 2.]
        );
        assert_eq!(
            array_values(&manifest, &data, "pinnVonMises").unwrap(),
            [12.5]
        );
        let mut malformed = manifest;
        malformed["arrays"]["cells"]["shape"] = json!([1, 4]);
        assert!(array_values(&malformed, &data, "cells").is_err());
    }
}

#[cfg(test)]
mod lifecycle_tests {
    use super::*;

    #[test]
    fn replacement_retires_previous_buffer_even_when_job_id_is_reused() {
        let temporary = tempfile::tempdir().unwrap();
        let original = temporary.path().join("original");
        let replacement = temporary.path().join("replacement");
        fs::create_dir_all(&original).unwrap();
        fs::create_dir_all(&replacement).unwrap();
        fs::write(original.join("buffer.bin"), b"old").unwrap();
        let state = EngineState::default();
        retain_job(&state, "same-job".into(), original.clone()).unwrap();
        retain_job(&state, "same-job".into(), replacement.clone()).unwrap();
        assert!(!original.exists());
        assert_eq!(owned_directory(&state, "same-job").unwrap(), replacement);
        assert_eq!(state.jobs.lock().unwrap().len(), 1);
    }

    #[test]
    fn closing_rejects_and_cleans_late_result() {
        let temporary = tempfile::tempdir().unwrap();
        let result = temporary.path().join("late");
        fs::create_dir(&result).unwrap();
        let state = EngineState::default();
        state.shutting_down.store(true, Ordering::SeqCst);
        assert!(retain_job(&state, "late-job".into(), result.clone()).is_err());
        assert!(!result.exists());
        assert!(state.jobs.lock().unwrap().is_empty());
    }

    #[test]
    fn bounded_reads_reject_oversized_files() {
        let temporary = tempfile::tempdir().unwrap();
        let path = temporary.path().join("buffer");
        fs::write(&path, b"1234").unwrap();
        assert_eq!(read_bounded(&path, 4).unwrap(), b"1234");
        fs::write(&path, b"12345").unwrap();
        assert!(read_bounded(&path, 4).is_err());
    }

    fn position_field() -> (Value, Vec<u8>) {
        let manifest = json!({"statistics":{"nodes":2},"arrays":{"positions":{
            "dtype":"float64","association":"node","units":"m","shape":[2,3],
            "offset":0,"byteLength":48}}});
        let data = (0..6).flat_map(|i| (i as f64).to_le_bytes()).collect();
        (manifest, data)
    }

    #[test]
    fn export_rejects_malformed_dimensions_bounds_and_nonfinite_data() {
        let (manifest, mut data) = position_field();
        assert_eq!(
            array_values(&manifest, &data, "positions").unwrap().len(),
            6
        );
        let mut malformed = manifest.clone();
        malformed["arrays"]["positions"]["shape"] = json!([2, 2]);
        assert!(array_values(&malformed, &data, "positions").is_err());
        malformed = manifest.clone();
        malformed["statistics"]["nodes"] = json!(12_001);
        assert!(array_values(&malformed, &data, "positions").is_err());
        assert!(array_values(&manifest, &data[..40], "positions").is_err());
        data[..8].copy_from_slice(&f64::NAN.to_le_bytes());
        assert!(array_values(&manifest, &data, "positions").is_err());
    }

    #[test]
    fn cancelling_an_already_exited_owned_process_is_successful() {
        let mut child = Command::new(std::env::current_exe().unwrap())
            .arg("--list")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        child.wait().unwrap();
        cancel_child(&mut child).unwrap();
    }
}

#[cfg(test)]
mod verification_tests {
    use super::*;

    #[test]
    fn persistence_compares_native_metadata_without_javascript_number_reencoding() {
        let original: Value =
            serde_json::from_str(r#"{"summary":{"totalForce":[0.0,0.0,-100.0]}}"#).unwrap();
        let frontend = json!({"summary":{"totalForce":[0,0,-100]}});
        assert_ne!(original, frontend);
        assert_eq!(
            original["summary"]["totalForce"][0].as_f64(),
            frontend["summary"]["totalForce"][0].as_f64()
        );
        let reopened: Value =
            serde_json::from_slice(&serde_json::to_vec(&original).unwrap()).unwrap();
        assert_eq!(reopened, original);
    }

    #[test]
    fn metadata_float_parsing_preserves_ieee_values_through_json_round_trips() {
        // These decimals exposed a one-ULP change in the native persistence path.
        // The standard float parser is an independent correctly rounded reference.
        for decimal in [
            "-99.99999999999999",
            "-1.779687508474126e-13",
            "2.5714541607158026e-11",
            "2.836811001324955e-14",
        ] {
            let reference = decimal.parse::<f64>().unwrap();
            let mut value: Value = serde_json::from_str(decimal).unwrap();
            for _ in 0..10 {
                assert_eq!(value.as_f64().unwrap().to_bits(), reference.to_bits());
                value = serde_json::from_str(&serde_json::to_string(&value).unwrap()).unwrap();
            }
        }
    }

    #[test]
    fn verification_trace_is_bounded_and_removes_control_characters() {
        let message = "a\n\u{1b}\r".repeat(600);
        let trace = bounded_trace(&message);
        assert_eq!(trace, "a".repeat(500));
        assert!(!trace.chars().any(char::is_control));
    }

    #[test]
    fn invalid_or_oversized_reports_become_explicit_bounded_failures() {
        for report in [
            json!("invalid"),
            json!({"payload":"x".repeat(MAX_JSON as usize)}),
        ] {
            let bytes = verification_bytes(report).unwrap();
            assert!(bytes.len() as u64 <= MAX_JSON);
            let parsed: Value = serde_json::from_slice(&bytes).unwrap();
            assert!(parsed["error"].is_string());
        }
    }
}
