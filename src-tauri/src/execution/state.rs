use crate::project::state::document_identity;
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
const MAX_RESULT_DOCUMENTS: usize = 32;
const MAX_RESULT_BYTES: u64 = 128 * 1024 * 1024;
const MAX_RETAINED_BYTES: u64 = 512 * 1024 * 1024;

pub(crate) struct RetainedJob {
    id: String,
    directory: PathBuf,
    bytes: u64,
}
pub(crate) struct Active {
    pub(crate) child: Arc<Mutex<Child>>,
    pub(crate) cancelled: Arc<AtomicBool>,
    pub(crate) training_started: Arc<AtomicBool>,
}
#[derive(Default)]
pub(crate) struct EngineState {
    pub(crate) active: Mutex<Option<Active>>,
    pub(crate) jobs: Mutex<HashMap<String, RetainedJob>>,
    result_owner: Mutex<Option<String>>,
    pub(crate) shutting_down: AtomicBool,
}

#[cfg(test)]
pub(crate) fn retain_job(
    state: &EngineState,
    id: String,
    directory: PathBuf,
) -> Result<(), String> {
    retain_document_job(
        state,
        crate::project::state::LEGACY_DOCUMENT_ID,
        id,
        directory,
    )
}

// The caller holds the native project-owner lock while changing generations or
// publishing results. Late old requests cannot acquire a new page's ownership.
pub(crate) fn activate_result_owner(
    state: &EngineState,
    owner: Option<&str>,
) -> Result<(), String> {
    let Some(owner) = owner else {
        return Ok(());
    };
    document_identity(Some(owner))?;
    let mut current = state.result_owner.lock().map_err(|e| e.to_string())?;
    if current.as_deref() == Some(owner) {
        return Ok(());
    }
    let previous = std::mem::take(&mut *state.jobs.lock().map_err(|e| e.to_string())?);
    *current = Some(owner.into());
    for job in previous.into_values() {
        let _ = fs::remove_dir_all(job.directory);
    }
    Ok(())
}

fn directory_bytes(directory: &std::path::Path) -> Result<u64, String> {
    let mut pending = vec![directory.to_path_buf()];
    let mut entries = 0usize;
    let mut bytes = 0u64;
    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            entries += 1;
            if entries > 4096 {
                return Err("Result directory exceeds its entry limit".into());
            }
            let kind = entry.file_type().map_err(|e| e.to_string())?;
            if kind.is_symlink() {
                return Err("Result directories cannot contain links".into());
            }
            if kind.is_dir() {
                pending.push(entry.path());
            } else if kind.is_file() {
                bytes = bytes
                    .checked_add(entry.metadata().map_err(|e| e.to_string())?.len())
                    .ok_or("Result directory exceeds its size limit")?;
                if bytes > MAX_RESULT_BYTES {
                    return Err("Result directory exceeds 128 MiB".into());
                }
            } else {
                return Err("Unsupported result directory entry".into());
            }
        }
    }
    Ok(bytes)
}

pub(crate) fn retain_document_job(
    state: &EngineState,
    document: &str,
    id: String,
    directory: PathBuf,
) -> Result<(), String> {
    document_identity(Some(document))?;
    let mut jobs = state.jobs.lock().map_err(|e| e.to_string())?;
    let accepted = (|| {
        if state.shutting_down.load(Ordering::SeqCst) {
            return Err("Application is closing".into());
        }
        let bytes = directory_bytes(&directory)?;
        if !jobs.contains_key(document) && jobs.len() >= MAX_RESULT_DOCUMENTS {
            return Err("Close a project before retaining more than 32 results".into());
        }
        let retained = jobs
            .iter()
            .filter(|(owner, _)| owner.as_str() != document)
            .try_fold(bytes, |sum, (_, job)| sum.checked_add(job.bytes))
            .ok_or("Retained result resource limit exceeded")?;
        if retained > MAX_RETAINED_BYTES {
            return Err(
                "Open project results exceed 512 MiB. Close another project and retry.".into(),
            );
        }
        Ok(bytes)
    })();
    let bytes = match accepted {
        Ok(bytes) => bytes,
        Err(error) => {
            if !jobs.values().any(|job| job.directory == directory) {
                let _ = fs::remove_dir_all(directory);
            }
            return Err(error);
        }
    };
    // Each mounted document owns one result; replacing A cannot evict B's
    // validated buffer. Failed/cancelled/oversized candidates leave A intact.
    let previous = jobs.insert(
        document.into(),
        RetainedJob {
            id,
            directory: directory.clone(),
            bytes,
        },
    );
    drop(jobs);
    if let Some(old) = previous {
        if old.directory != directory {
            let _ = fs::remove_dir_all(old.directory);
        }
    }
    Ok(())
}

pub(crate) fn retire_document_result(state: &EngineState, document: &str) -> Result<(), String> {
    let previous = state
        .jobs
        .lock()
        .map_err(|e| e.to_string())?
        .remove(document);
    if let Some(job) = previous {
        let _ = fs::remove_dir_all(job.directory);
    }
    Ok(())
}

pub(crate) fn owned_document_directory(
    state: &EngineState,
    document: &str,
    id: &str,
) -> Result<PathBuf, String> {
    document_identity(Some(document))?;
    state
        .jobs
        .lock()
        .map_err(|e| e.to_string())?
        .get(document)
        .filter(|job| job.id == id)
        .map(|job| job.directory.clone())
        .ok_or("The result no longer belongs to this project document".into())
}

pub(crate) fn owned_directory(state: &EngineState, id: &str) -> Result<PathBuf, String> {
    let jobs = state.jobs.lock().map_err(|e| e.to_string())?;
    let mut matching = jobs.values().filter(|job| job.id == id);
    let job = matching
        .next()
        .ok_or("The result no longer belongs to this application session")?;
    if matching.next().is_some() {
        return Err("A project document identity is required for this result".into());
    }
    Ok(job.directory.clone())
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
        for job in jobs.values() {
            let _ = fs::remove_dir_all(&job.directory);
        }
    }
}

#[cfg(test)]
mod document_result_tests {
    use super::*;
    use std::path::Path;

    fn candidate(root: &Path, name: &str, bytes: u64) -> PathBuf {
        let directory = root.join(name);
        fs::create_dir(&directory).unwrap();
        fs::File::create(directory.join("buffer.bin"))
            .unwrap()
            .set_len(bytes)
            .unwrap();
        directory
    }

    #[test]
    fn document_results_survive_other_runs_and_identical_imported_job_ids() {
        let temporary = tempfile::tempdir().unwrap();
        let a = uuid::Uuid::new_v4().to_string();
        let b = uuid::Uuid::new_v4().to_string();
        let first = candidate(temporary.path(), "a", 4);
        let second = candidate(temporary.path(), "b", 4);
        let replacement = candidate(temporary.path(), "a-replacement", 8);
        let state = EngineState::default();
        retain_document_job(&state, &a, "imported-id".into(), first.clone()).unwrap();
        retain_document_job(&state, &b, "imported-id".into(), second.clone()).unwrap();
        assert!(owned_directory(&state, "imported-id").is_err());
        assert_eq!(
            owned_document_directory(&state, &a, "imported-id").unwrap(),
            first
        );
        assert_eq!(
            owned_document_directory(&state, &b, "imported-id").unwrap(),
            second
        );
        retain_document_job(&state, &a, "new-id".into(), replacement.clone()).unwrap();
        assert!(!first.exists());
        assert!(second.exists());
        assert!(owned_document_directory(&state, &a, "imported-id").is_err());
        assert_eq!(
            owned_document_directory(&state, &b, "imported-id").unwrap(),
            second
        );
        retire_document_result(&state, &a).unwrap();
        assert!(!replacement.exists());
        assert!(second.exists());
        assert_eq!(state.jobs.lock().unwrap().len(), 1);
    }

    #[test]
    fn page_owner_reload_retires_all_previous_document_buffers() {
        let temporary = tempfile::tempdir().unwrap();
        let document = uuid::Uuid::new_v4().to_string();
        let before = uuid::Uuid::new_v4().to_string();
        let after = uuid::Uuid::new_v4().to_string();
        let directory = candidate(temporary.path(), "before", 4);
        let state = EngineState::default();
        activate_result_owner(&state, Some(&before)).unwrap();
        retain_document_job(&state, &document, "old".into(), directory.clone()).unwrap();
        activate_result_owner(&state, Some(&before)).unwrap();
        assert!(directory.exists());
        activate_result_owner(&state, Some(&after)).unwrap();
        assert!(!directory.exists());
        assert!(owned_document_directory(&state, &document, "old").is_err());
        assert!(state.jobs.lock().unwrap().is_empty());
    }

    #[test]
    fn oversized_candidate_preserves_prior_document_results() {
        let temporary = tempfile::tempdir().unwrap();
        let document = uuid::Uuid::new_v4().to_string();
        let original = candidate(temporary.path(), "original", 4);
        let oversized = candidate(temporary.path(), "oversized", MAX_RESULT_BYTES + 1);
        let state = EngineState::default();
        retain_document_job(&state, &document, "current".into(), original.clone()).unwrap();
        assert!(
            retain_document_job(&state, &document, "oversized".into(), oversized.clone()).is_err()
        );
        assert!(!oversized.exists());
        assert_eq!(
            owned_document_directory(&state, &document, "current").unwrap(),
            original
        );
    }

    #[test]
    fn cumulative_result_budget_rejects_overflow_without_evicting_open_documents() {
        let temporary = tempfile::tempdir().unwrap();
        let state = EngineState::default();
        let mut retained = Vec::new();
        for index in 0..4 {
            let document = uuid::Uuid::new_v4().to_string();
            let directory = candidate(
                temporary.path(),
                &format!("retained-{index}"),
                MAX_RESULT_BYTES,
            );
            retain_document_job(&state, &document, format!("job-{index}"), directory.clone())
                .unwrap();
            retained.push((document, directory));
        }
        let extra = candidate(temporary.path(), "overflow", 1);
        assert!(retain_document_job(
            &state,
            &uuid::Uuid::new_v4().to_string(),
            "overflow".into(),
            extra.clone()
        )
        .is_err());
        assert!(!extra.exists());
        assert!(retained.iter().all(|(_, directory)| directory.exists()));
        let replacement = candidate(temporary.path(), "replacement", MAX_RESULT_BYTES);
        retain_document_job(
            &state,
            &retained[0].0,
            "replacement".into(),
            replacement.clone(),
        )
        .unwrap();
        assert!(!retained[0].1.exists());
        assert!(replacement.exists());
        assert!(retained[1..]
            .iter()
            .all(|(_, directory)| directory.exists()));
    }

    #[test]
    fn retained_document_limit_is_released_only_when_an_owner_closes() {
        let temporary = tempfile::tempdir().unwrap();
        let state = EngineState::default();
        let mut documents = Vec::new();
        for index in 0..MAX_RESULT_DOCUMENTS {
            let document = uuid::Uuid::new_v4().to_string();
            let directory = candidate(temporary.path(), &format!("doc-{index}"), 0);
            retain_document_job(&state, &document, format!("job-{index}"), directory).unwrap();
            documents.push(document);
        }
        let overflow = candidate(temporary.path(), "overflow", 0);
        assert!(retain_document_job(
            &state,
            &uuid::Uuid::new_v4().to_string(),
            "overflow".into(),
            overflow.clone()
        )
        .is_err());
        assert!(!overflow.exists());
        retire_document_result(&state, &documents[0]).unwrap();
        let new = candidate(temporary.path(), "new", 0);
        retain_document_job(&state, &uuid::Uuid::new_v4().to_string(), "new".into(), new).unwrap();
        assert_eq!(state.jobs.lock().unwrap().len(), MAX_RESULT_DOCUMENTS);
    }

    #[cfg(unix)]
    #[test]
    fn result_limits_cannot_be_bypassed_with_a_link() {
        let temporary = tempfile::tempdir().unwrap();
        let outside = temporary.path().join("outside");
        fs::write(&outside, b"field").unwrap();
        let linked = temporary.path().join("linked");
        fs::create_dir(&linked).unwrap();
        std::os::unix::fs::symlink(&outside, linked.join("buffer.bin")).unwrap();
        let state = EngineState::default();
        assert!(retain_document_job(
            &state,
            &uuid::Uuid::new_v4().to_string(),
            "linked".into(),
            linked.clone()
        )
        .is_err());
        assert!(!linked.exists());
        assert!(outside.exists());
    }
}
