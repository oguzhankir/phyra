use serde_json::{json, Value};
use std::collections::HashSet;

fn selection_trim(value: &str) -> &str {
    value.trim_matches(|character| {
        matches!(character,
            '\u{0009}'..='\u{000D}' | '\u{001C}'..='\u{001F}' | '\u{0020}' | '\u{0085}' |
            '\u{00A0}' | '\u{1680}' | '\u{2000}'..='\u{200A}' | '\u{2028}' | '\u{2029}' |
            '\u{202F}' | '\u{205F}' | '\u{3000}' | '\u{FEFF}')
    })
}

fn validate_version(project: &Value, version: u64) -> Result<(), String> {
    if project["schemaVersion"].as_u64() != Some(version) {
        return Err("Unsupported project schema version".into());
    }
    let source = match version {
        1 => include_str!("../../../contracts/project-v1.schema.json"),
        2 => include_str!("../../../contracts/project-v2.schema.json"),
        3 => include_str!("../../../contracts/project.schema.json"),
        _ => return Err("Unsupported project schema version".into()),
    };
    let schema: Value = serde_json::from_str(source).map_err(|e| e.to_string())?;
    jsonschema::validator_for(&schema)
        .map_err(|e| e.to_string())?
        .validate(project)
        .map_err(|e| format!("Invalid version {version} project: {e}"))?;
    if version == 3 {
        validate_named_selections(project)?;
    }
    Ok(())
}

fn validate_named_selections(project: &Value) -> Result<(), String> {
    let mut ids = HashSet::new();
    let mut names = HashSet::new();
    // The JSON Schema above has already checked collection, stamp and item types.
    for selection in project["namedSelections"].as_array().unwrap() {
        let id = selection["id"].as_str().unwrap();
        let name = selection_trim(selection["name"].as_str().unwrap()).to_ascii_lowercase();
        if selection_trim(id).is_empty() || name.is_empty() {
            return Err("Boundary set identifiers and names must not be blank".into());
        }
        if !ids.insert(id) || !names.insert(name) {
            return Err("Boundary set identifiers and names must be unique".into());
        }
        let kind = selection["geometryKind"].as_str().unwrap();
        let dimension = selection["dimension"].as_str().unwrap();
        let allowed: &[&str] = match (dimension, kind) {
            ("2d", "box") => &["x0", "x1", "y0", "y1"],
            ("3d", "box") => &["x0", "x1", "y0", "y1", "z0", "z1"],
            ("3d", "cylinder") => &["x0", "x1", "outer"],
            ("3d", "bracket") => &["x0", "x1", "y0", "y1", "z0", "z1", "inner-x", "inner-y"],
            _ => return Err("2D boundary sets require rectangular geometry".into()),
        };
        if selection["regions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|region| !allowed.contains(&region.as_str().unwrap()))
        {
            return Err("A boundary set refers to an unavailable stamped boundary".into());
        }
        // Compare to the set's stamped topology, never the active project:
        // orphaned preparation metadata remains recoverable after a kind edit.
    }
    Ok(())
}

pub(crate) fn validate_project(project: &Value) -> Result<(), String> {
    validate_version(project, 3)
}

pub(crate) fn migrate_project(mut project: Value) -> Result<(Value, bool), String> {
    let version = project["schemaVersion"]
        .as_u64()
        .ok_or("Unsupported project schema version")?;
    validate_version(&project, version)?;
    if version == 3 {
        return Ok((project, false));
    }
    if version == 1 {
        project["study"]["dimension"] = json!("3d");
        project["study"]["formulation"] = json!("solid");
        project["study"]["thickness"] = project["geometry"]["height"].clone();
        project["study"]["solver"] = json!({"kind":"fem","pinn":{
            "layers":3,"width":32,"activation":"tanh","optimizer":"adam",
            "learningRate":0.001,"steps":1000,"interiorPoints":128,
            "boundaryPoints":32,"seed":42,"device":"auto"}});
    }
    project["schemaVersion"] = json!(3);
    project["namedSelections"] = json!([]);
    validate_project(&project)?;
    Ok((project, true))
}
