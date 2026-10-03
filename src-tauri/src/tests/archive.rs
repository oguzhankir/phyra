use super::*;
fn project() -> Value {
    json!({"schemaVersion":5,"namedSelections":[],"id":"test","name":"Test","revision":0,"displayUnits":"mm","geometry":{"kind":"box","length":1.,"width":0.1,"height":0.1,"radius":0.05,"thickness":0.02},"study":{"id":"study","type":"linear-static","dimension":"3d","formulation":"solid","thickness":0.1,"solver":{"kind":"fem","pinn":{"formulation":"strong-form","layers":3,"width":32,"activation":"tanh","optimizer":"adam","learningRate":0.001,"steps":1000,"interiorPoints":128,"boundaryPoints":32,"seed":42,"device":"auto"}},"material":{"name":"Generic","young":2e11,"poisson":0.3},"mesh":{"size":0.1},"constraints":[],"loads":[]}})
}
fn legacy_project() -> Value {
    let mut project = project();
    project["schemaVersion"] = json!(1);
    project.as_object_mut().unwrap().remove("namedSelections");
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
    value["schemaVersion"] = json!(6);
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
    unknown["schemaVersion"] = json!(6);
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

fn version_two_project() -> Value {
    let mut value = project();
    value["schemaVersion"] = json!(2);
    value["study"]["solver"]["pinn"]
        .as_object_mut()
        .unwrap()
        .remove("formulation");
    value.as_object_mut().unwrap().remove("namedSelections");
    value
}

#[test]
fn version_two_migration_keeps_cache_for_normal_worker_validation() {
    let temporary = tempfile::tempdir().unwrap();
    let source = temporary.path().join("v2 cache");
    fs::create_dir(&source).unwrap();
    fs::write(source.join("manifest.json"), b"{}").unwrap();
    fs::write(source.join("buffer.bin"), b"original bounded bytes").unwrap();
    let path = temporary.path().join("version 2.phyra");
    write_archive(&path, &version_two_project(), Some(&source)).unwrap();
    let restored = temporary.path().join("new cache");
    let opened = read_archive_details(&path, &restored).unwrap();
    assert_eq!(opened.project, project());
    assert!(opened.migrated);
    assert_eq!(opened.project["schemaVersion"], 5);
    assert!(!opened.dropped_cache);
    assert_eq!(
        fs::read(restored.join("buffer.bin")).unwrap(),
        b"original bounded bytes"
    );
    assert!(restored.join("manifest.json").exists());
    // Archive reading only stages the bounded bytes. The open command runs the
    // isolated worker's full fingerprint/field validator before publishing them.
}

#[test]
fn version_two_schema_is_checked_before_adding_boundary_sets() {
    let mut value = version_two_project();
    value["namedSelections"] = json!([]);
    assert!(migrate_project(value).is_err());
    let mut value = version_two_project();
    value["study"]["solver"]["pinn"]["steps"] = json!(0);
    assert!(migrate_project(value).is_err());
}

#[test]
fn version_three_migration_preserves_named_selections_and_cache() {
    let temporary = tempfile::tempdir().unwrap();
    let source = temporary.path().join("v3 cache");
    fs::create_dir(&source).unwrap();
    fs::write(source.join("manifest.json"), b"{}").unwrap();
    fs::write(source.join("buffer.bin"), b"version three result bytes").unwrap();
    let path = temporary.path().join("version 3.phyra");
    let mut previous = project();
    previous["schemaVersion"] = json!(3);
    previous["study"]["solver"]["pinn"]
        .as_object_mut()
        .unwrap()
        .remove("formulation");
    previous["namedSelections"] = json!([boundary_set()]);
    write_archive(&path, &previous, Some(&source)).unwrap();

    let restored = temporary.path().join("new cache");
    let opened = read_archive_details(&path, &restored).unwrap();
    let mut expected = previous;
    expected["schemaVersion"] = json!(5);
    expected["study"]["solver"]["pinn"]["formulation"] = json!("strong-form");
    assert_eq!(opened.project, expected);
    assert!(opened.migrated);
    assert_eq!(opened.project["schemaVersion"], 5);
    assert!(!opened.dropped_cache);
    assert_eq!(
        fs::read(restored.join("buffer.bin")).unwrap(),
        b"version three result bytes"
    );
    assert!(restored.join("manifest.json").exists());
}

fn boundary_set() -> Value {
    json!({"id":"root","name":"Root boundaries","geometryKind":"box","dimension":"3d","regions":["x0","z0"]})
}

fn version_four_project() -> Value {
    // Frozen, pre-v5 editable Kirsch definition: exact arcs and physical traction
    // must survive migration together, without being reconstructed from v5.
    serde_json::from_str(include_str!("fixtures/project-v4.json")).unwrap()
}

#[test]
fn version_four_archive_preserves_definition_source_and_staged_cache_bytes() {
    let temporary = tempfile::tempdir().unwrap();
    let source = temporary.path().join("v4 cache");
    fs::create_dir(&source).unwrap();
    let manifest = b"{\"protocolVersion\":1,\"source\":\"original-v4\"}";
    let buffer = b"original bounded version four bytes";
    fs::write(source.join("manifest.json"), manifest).unwrap();
    fs::write(source.join("buffer.bin"), buffer).unwrap();
    let path = temporary.path().join("version 4.phyra");
    let previous = version_four_project();
    write_archive(&path, &previous, Some(&source)).unwrap();
    let original_archive = fs::read(&path).unwrap();

    let restored = temporary.path().join("restored cache");
    let opened = read_archive_details(&path, &restored).unwrap();
    let mut expected = previous;
    expected["schemaVersion"] = json!(5);
    expected["study"]["solver"]["pinn"]["formulation"] = json!("strong-form");
    assert_eq!(opened.project, expected);
    assert!(opened.migrated);
    assert!(!opened.dropped_cache);
    assert_eq!(fs::read(&path).unwrap(), original_archive);
    assert_eq!(fs::read(restored.join("manifest.json")).unwrap(), manifest);
    assert_eq!(fs::read(restored.join("buffer.bin")).unwrap(), buffer);
    // This only verifies bounded staging; reuse still requires worker validation.
}

#[test]
fn version_four_schema_rejects_future_fields_before_applying_defaults() {
    let mut previous = version_four_project();
    previous["study"]["solver"]["pinn"]["formulation"] = json!("deep-energy");
    assert!(migrate_project(previous).is_err());
}

#[test]
fn unknown_version_archive_is_preserved_and_never_stages_cache() {
    let temporary = tempfile::tempdir().unwrap();
    let source = temporary.path().join("unknown cache");
    fs::create_dir(&source).unwrap();
    fs::write(source.join("manifest.json"), b"{}").unwrap();
    fs::write(source.join("buffer.bin"), b"unknown fields").unwrap();
    let path = temporary.path().join("version 6.phyra");
    let mut previous = version_four_project();
    previous["schemaVersion"] = json!(6);
    write_archive(&path, &previous, Some(&source)).unwrap();
    let original_archive = fs::read(&path).unwrap();
    let restored = temporary.path().join("restored cache");
    assert!(read_archive_details(&path, &restored).is_err());
    assert_eq!(fs::read(&path).unwrap(), original_archive);
    assert!(!restored.exists());
}

#[test]
fn orphaned_boundary_sets_persist_without_changing_conditions() {
    let temporary = tempfile::tempdir().unwrap();
    let path = temporary.path().join("orphan.phyra");
    let mut value = project();
    value["geometry"]["kind"] = json!("cylinder");
    value["namedSelections"] = json!([boundary_set()]);
    validate_project(&value).unwrap();
    write_archive(&path, &value, None).unwrap();
    assert_eq!(read_archive(&path, temporary.path()).unwrap(), value);
    assert_eq!(value["study"]["constraints"], json!([]));
}

#[test]
fn boundary_set_names_ids_stamps_and_resource_limits_are_checked() {
    for defect in [
        "blank-name",
        "blank-feff",
        "blank-control",
        "blank-id",
        "duplicate-id",
        "duplicate-name",
        "duplicate-control-name",
        "empty",
        "duplicate-region",
        "wrong-region",
        "wrong-dimension",
        "unsupported-plane",
        "oversized",
    ] {
        let mut set = boundary_set();
        let mut value = project();
        let mut sets = vec![set.clone()];
        match defect {
            "blank-name" => sets[0]["name"] = json!("   "),
            "blank-feff" => sets[0]["name"] = json!("\u{FEFF}"),
            "blank-control" => sets[0]["name"] = json!("\u{001C}"),
            "blank-id" => sets[0]["id"] = json!("   "),
            "duplicate-id" => {
                set["name"] = json!("Other");
                sets.push(set);
            }
            "duplicate-name" => {
                set["id"] = json!("other");
                set["name"] = json!("  ROOT boundaries  ");
                sets.push(set);
            }
            "duplicate-control-name" => {
                set["id"] = json!("other");
                set["name"] = json!("\u{001C}ROOT boundaries\u{FEFF}");
                sets.push(set);
            }
            "empty" => sets[0]["regions"] = json!([]),
            "duplicate-region" => sets[0]["regions"] = json!(["x0", "x0"]),
            "wrong-region" => sets[0]["regions"] = json!(["outer"]),
            "wrong-dimension" => sets[0]["dimension"] = json!("2d"),
            "unsupported-plane" => {
                sets[0]["dimension"] = json!("2d");
                sets[0]["geometryKind"] = json!("cylinder");
            }
            "oversized" => {
                sets = (0..101)
                    .map(|index| {
                        let mut item = boundary_set();
                        item["id"] = json!(format!("id-{index}"));
                        item["name"] = json!(format!("Name {index}"));
                        item
                    })
                    .collect()
            }
            _ => unreachable!(),
        }
        value["namedSelections"] = json!(sets);
        assert!(validate_project(&value).is_err(), "{defect}");
    }
}

#[test]
fn boundary_set_name_folding_preserves_non_ascii_identity() {
    let mut value = project();
    let names = ["Straße", "STRASSE", "İ", "i"];
    value["namedSelections"] = json!(names
        .iter()
        .enumerate()
        .map(|(index, name)| {
            let mut item = boundary_set();
            item["id"] = json!(format!("set-{index}"));
            item["name"] = json!(name);
            item
        })
        .collect::<Vec<_>>());
    validate_project(&value).unwrap();
}
