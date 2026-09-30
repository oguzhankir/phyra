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
