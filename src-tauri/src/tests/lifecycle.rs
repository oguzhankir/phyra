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
