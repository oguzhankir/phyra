use super::events::RunRequestId;
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
#[derive(Default)]
pub(crate) struct DocumentResults {
    current: Option<RetainedJob>,
    pending: Option<RetainedJob>,
}
impl DocumentResults {
    fn results(&self) -> impl Iterator<Item = &RetainedJob> {
        self.current.iter().chain(self.pending.iter())
    }
    fn remove_files(self) {
        for job in self.current.into_iter().chain(self.pending) {
            let _ = fs::remove_dir_all(job.directory);
        }
    }
}
pub(crate) struct Active {
    pub(crate) child: Arc<Mutex<Child>>,
    pub(crate) cancelled: Arc<AtomicBool>,
    pub(crate) training_started: Arc<AtomicBool>,
    pub(crate) request_id: Option<RunRequestId>,
}
struct RequestedRun {
    request_id: RunRequestId,
    cancelled: Arc<AtomicBool>,
}
#[derive(Default)]
pub(crate) struct EngineState {
    pub(crate) active: Mutex<Option<Active>>,
    requested: Mutex<Option<RequestedRun>>,
    pub(crate) jobs: Mutex<HashMap<String, DocumentResults>>,
    result_owner: Mutex<Option<String>>,
    pub(crate) shutting_down: AtomicBool,
}

pub(crate) fn register_run(state: &EngineState, request: &RunRequestId) -> Result<(), String> {
    let mut requested = state.requested.lock().map_err(|e| e.to_string())?;
    if state.shutting_down.load(Ordering::SeqCst) {
        return Err("Application is closing".into());
    }
    if requested.is_some() {
        return Err("An analysis request is already running".into());
    }
    *requested = Some(RequestedRun {
        request_id: request.clone(),
        cancelled: Arc::new(AtomicBool::new(false)),
    });
    Ok(())
}

pub(crate) fn run_cancellation(
    state: &EngineState,
    request: Option<&RunRequestId>,
) -> Result<Arc<AtomicBool>, String> {
    let Some(request) = request else {
        return Ok(Arc::new(AtomicBool::new(false)));
    };
    state
        .requested
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .filter(|run| &run.request_id == request)
        .map(|run| run.cancelled.clone())
        .ok_or_else(|| "Analysis request no longer owns its cancellation lease".into())
}

pub(crate) fn finish_run(state: &EngineState, request: &RunRequestId) -> Result<(), String> {
    let mut requested = state.requested.lock().map_err(|e| e.to_string())?;
    if requested
        .as_ref()
        .is_some_and(|run| &run.request_id == request)
    {
        requested.take();
    }
    Ok(())
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
        job.remove_files();
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
    store_document_job(state, document, id, directory, false)
}

pub(crate) fn stage_document_job(
    state: &EngineState,
    document: &str,
    id: String,
    directory: PathBuf,
) -> Result<(), String> {
    store_document_job(state, document, id, directory, true)
}

fn store_document_job(
    state: &EngineState,
    document: &str,
    id: String,
    directory: PathBuf,
    pending: bool,
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
            .flat_map(|(owner, results)| {
                results
                    .current
                    .iter()
                    .filter(move |_| owner.as_str() != document || pending)
                    .chain(
                        results
                            .pending
                            .iter()
                            .filter(move |_| owner.as_str() != document),
                    )
            })
            .try_fold(bytes, |sum, job| sum.checked_add(job.bytes))
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
            if !jobs
                .values()
                .flat_map(DocumentResults::results)
                .any(|job| job.directory == directory)
            {
                let _ = fs::remove_dir_all(directory);
            }
            return Err(error);
        }
    };
    let candidate = RetainedJob {
        id,
        directory: directory.clone(),
        bytes,
    };
    // A completed worker is pending until the frontend validates its buffer
    // and acknowledges publication. Failure/cancellation preserves current.
    let previous = if pending {
        let results = jobs.entry(document.into()).or_default();
        DocumentResults {
            current: None,
            pending: results.pending.replace(candidate),
        }
    } else {
        jobs.insert(
            document.into(),
            DocumentResults {
                current: Some(candidate),
                pending: None,
            },
        )
        .unwrap_or_default()
    };
    drop(jobs);
    for old in previous.current.into_iter().chain(previous.pending) {
        if old.directory != directory {
            let _ = fs::remove_dir_all(old.directory);
        }
    }
    Ok(())
}

pub(crate) fn commit_document_job(
    state: &EngineState,
    document: &str,
    id: &str,
) -> Result<(), String> {
    document_identity(Some(document))?;
    let mut jobs = state.jobs.lock().map_err(|e| e.to_string())?;
    if state.shutting_down.load(Ordering::SeqCst) {
        return Err("Application is closing".into());
    }
    let results = jobs
        .get_mut(document)
        .ok_or("The pending result no longer belongs to this project document")?;
    if results.pending.as_ref().is_none_or(|job| job.id != id) {
        return Err("The pending result no longer belongs to this project document".into());
    }
    let accepted = results.pending.take().unwrap();
    let previous = results.current.replace(accepted);
    drop(jobs);
    if let Some(job) = previous {
        let _ = fs::remove_dir_all(job.directory);
    }
    Ok(())
}

pub(crate) fn discard_document_job(
    state: &EngineState,
    document: &str,
    id: &str,
) -> Result<(), String> {
    document_identity(Some(document))?;
    let mut jobs = state.jobs.lock().map_err(|e| e.to_string())?;
    let previous = jobs.get_mut(document).and_then(|results| {
        if results.pending.as_ref().is_some_and(|job| job.id == id) {
            results.pending.take()
        } else {
            None
        }
    });
    if jobs
        .get(document)
        .is_some_and(|results| results.current.is_none() && results.pending.is_none())
    {
        jobs.remove(document);
    }
    drop(jobs);
    if let Some(job) = previous {
        let _ = fs::remove_dir_all(job.directory);
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
        job.remove_files();
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
        .and_then(|results| results.results().find(|job| job.id == id))
        .map(|job| job.directory.clone())
        .ok_or("The result no longer belongs to this project document".into())
}

pub(crate) fn owned_directory(state: &EngineState, id: &str) -> Result<PathBuf, String> {
    let jobs = state.jobs.lock().map_err(|e| e.to_string())?;
    let mut matching = jobs
        .values()
        .flat_map(DocumentResults::results)
        .filter(|job| job.id == id);
    let job = matching
        .next()
        .ok_or("The result no longer belongs to this application session")?;
    if matching.next().is_some() {
        return Err("A project document identity is required for this result".into());
    }
    Ok(job.directory.clone())
}

pub(crate) fn cancel_owned_request(
    state: &EngineState,
    request: Option<&RunRequestId>,
) -> Result<bool, String> {
    let active = state.active.lock().map_err(|e| e.to_string())?;
    let registered = if let Some(request) = request {
        let requested = state.requested.lock().map_err(|e| e.to_string())?;
        let run = requested.as_ref().filter(|run| &run.request_id == request);
        if let Some(run) = run {
            run.cancelled.store(true, Ordering::SeqCst);
        }
        run.is_some()
    } else {
        false
    };
    let Some(active) = active.as_ref() else {
        return Ok(registered);
    };
    if request.is_some_and(|request| active.request_id.as_ref() != Some(request)) {
        return Ok(registered);
    }
    active.cancelled.store(true, Ordering::SeqCst);
    let mut child = active.child.lock().map_err(|e| e.to_string())?;
    cancel_child(&mut child)?;
    Ok(true)
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
        for job in jobs.values().flat_map(DocumentResults::results) {
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
    fn failed_frontend_buffer_handoff_preserves_prior_native_result() {
        let temporary = tempfile::tempdir().unwrap();
        let document = uuid::Uuid::new_v4().to_string();
        let original = candidate(temporary.path(), "original-handoff", 4);
        let pending = candidate(temporary.path(), "pending-handoff", 8);
        let state = EngineState::default();
        retain_document_job(&state, &document, "prior".into(), original.clone()).unwrap();
        stage_document_job(&state, &document, "pending".into(), pending.clone()).unwrap();
        // A frontend buffer read can fail after the native run returns. The
        // still-visible prior result must remain saveable and exportable.
        assert_eq!(
            owned_document_directory(&state, &document, "prior").unwrap(),
            original
        );
        discard_document_job(&state, &document, "pending").unwrap();
        assert!(!pending.exists());
        assert_eq!(
            owned_document_directory(&state, &document, "prior").unwrap(),
            original
        );
    }

    #[test]
    fn accepting_only_the_matching_pending_result_retires_the_prior_buffer() {
        let temporary = tempfile::tempdir().unwrap();
        let document = uuid::Uuid::new_v4().to_string();
        let original = candidate(temporary.path(), "original-accept", 4);
        let first = candidate(temporary.path(), "first-pending", 8);
        let latest = candidate(temporary.path(), "latest-pending", 8);
        let state = EngineState::default();
        retain_document_job(&state, &document, "prior".into(), original.clone()).unwrap();
        stage_document_job(&state, &document, "first".into(), first.clone()).unwrap();
        stage_document_job(&state, &document, "latest".into(), latest.clone()).unwrap();
        assert!(!first.exists());
        assert!(commit_document_job(&state, &document, "first").is_err());
        discard_document_job(&state, &document, "first").unwrap();
        assert!(latest.exists());
        assert!(original.exists());
        commit_document_job(&state, &document, "latest").unwrap();
        assert!(!original.exists());
        assert!(latest.exists());
        assert!(owned_document_directory(&state, &document, "prior").is_err());
        assert_eq!(
            owned_document_directory(&state, &document, "latest").unwrap(),
            latest
        );
    }

    #[test]
    fn pending_result_bytes_are_bounded_together_with_every_current_result() {
        let temporary = tempfile::tempdir().unwrap();
        let state = EngineState::default();
        let mut documents = Vec::new();
        for index in 0..4 {
            let document = uuid::Uuid::new_v4().to_string();
            let directory = candidate(
                temporary.path(),
                &format!("current-{index}"),
                MAX_RESULT_BYTES,
            );
            retain_document_job(&state, &document, format!("current-{index}"), directory).unwrap();
            documents.push(document);
        }
        let too_large = candidate(temporary.path(), "pending-overflow", 1);
        assert!(
            stage_document_job(&state, &documents[0], "overflow".into(), too_large.clone())
                .is_err()
        );
        assert!(!too_large.exists());
        assert!(owned_document_directory(&state, &documents[0], "current-0").is_ok());
        retire_document_result(&state, &documents[3]).unwrap();
        let pending = candidate(temporary.path(), "pending-at-budget", MAX_RESULT_BYTES);
        stage_document_job(&state, &documents[0], "pending".into(), pending.clone()).unwrap();
        let overflow = candidate(temporary.path(), "new-document-overflow", 1);
        assert!(stage_document_job(
            &state,
            &uuid::Uuid::new_v4().to_string(),
            "overflow".into(),
            overflow.clone()
        )
        .is_err());
        assert!(!overflow.exists());
        discard_document_job(&state, &documents[0], "pending").unwrap();
        assert!(!pending.exists());
        assert!(owned_document_directory(&state, &documents[0], "current-0").is_ok());
    }

    #[test]
    fn discarding_a_new_document_candidate_releases_its_document_slot() {
        let temporary = tempfile::tempdir().unwrap();
        let state = EngineState::default();
        let mut documents = Vec::new();
        for index in 0..MAX_RESULT_DOCUMENTS {
            let document = uuid::Uuid::new_v4().to_string();
            stage_document_job(
                &state,
                &document,
                format!("pending-{index}"),
                candidate(temporary.path(), &format!("pending-{index}"), 0),
            )
            .unwrap();
            documents.push(document);
        }
        let overflow = candidate(temporary.path(), "extra-pending", 0);
        assert!(stage_document_job(
            &state,
            &uuid::Uuid::new_v4().to_string(),
            "extra".into(),
            overflow
        )
        .is_err());
        discard_document_job(&state, &documents[0], "pending-0").unwrap();
        stage_document_job(
            &state,
            &uuid::Uuid::new_v4().to_string(),
            "replacement".into(),
            candidate(temporary.path(), "replacement-pending", 0),
        )
        .unwrap();
        assert_eq!(state.jobs.lock().unwrap().len(), MAX_RESULT_DOCUMENTS);
        retire_document_result(&state, &documents[1]).unwrap();
        assert!(!temporary.path().join("pending-1").exists());
    }

    #[test]
    fn preparing_cancellation_is_owned_and_late_requests_cannot_cancel_a_new_run() {
        let state = EngineState::default();
        let first = RunRequestId::parse(uuid::Uuid::new_v4().to_string()).unwrap();
        register_run(&state, &first).unwrap();
        let first_flag = run_cancellation(&state, Some(&first)).unwrap();
        assert!(state.active.lock().unwrap().is_none());
        assert!(cancel_owned_request(&state, Some(&first)).unwrap());
        assert!(first_flag.load(Ordering::SeqCst));
        finish_run(&state, &first).unwrap();
        assert!(!cancel_owned_request(&state, Some(&first)).unwrap());
        let next = RunRequestId::parse(uuid::Uuid::new_v4().to_string()).unwrap();
        register_run(&state, &next).unwrap();
        assert!(!cancel_owned_request(&state, Some(&first)).unwrap());
        assert!(!run_cancellation(&state, Some(&next))
            .unwrap()
            .load(Ordering::SeqCst));
        // A late completion from the first request cannot retire the next lease.
        finish_run(&state, &first).unwrap();
        assert!(run_cancellation(&state, Some(&next)).is_ok());
        finish_run(&state, &next).unwrap();
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
