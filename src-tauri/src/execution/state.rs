use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    process::Child,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
pub(crate) struct Active {
    pub(crate) child: Arc<Mutex<Child>>,
    pub(crate) cancelled: Arc<AtomicBool>,
    pub(crate) training_started: Arc<AtomicBool>,
}
#[derive(Default)]
pub(crate) struct EngineState {
    pub(crate) active: Mutex<Option<Active>>,
    pub(crate) jobs: Mutex<HashMap<String, PathBuf>>,
    pub(crate) shutting_down: AtomicBool,
}

pub(crate) fn retain_job(
    state: &EngineState,
    id: String,
    directory: PathBuf,
) -> Result<(), String> {
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

pub(crate) fn cancel_child(child: &mut Child) -> Result<(), String> {
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

pub(crate) fn owned_directory(state: &EngineState, id: &str) -> Result<PathBuf, String> {
    state
        .jobs
        .lock()
        .map_err(|e| e.to_string())?
        .get(id)
        .cloned()
        .ok_or("The result no longer belongs to this application session".into())
}

pub(crate) fn stop_owned(state: &EngineState) {
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
