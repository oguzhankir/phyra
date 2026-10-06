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

fn profile_region_id(value: &str) -> bool {
    let mut characters = value.chars();
    characters
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic())
        && characters.all(|character| {
            character.is_ascii_alphanumeric() || character == '_' || character == '-'
        })
}

fn validate_version(project: &Value, version: u64) -> Result<(), String> {
    if serde_json::to_vec(project)
        .map_err(|e| e.to_string())?
        .len() as u64
        > crate::platform::files::MAX_JSON
    {
        return Err("Project definition exceeds the cumulative 1 MiB limit".into());
    }
    if project["schemaVersion"].as_u64() != Some(version) {
        return Err("Unsupported project schema version".into());
    }
    let source = match version {
        1 => include_str!("../../../contracts/project-v1.schema.json"),
        2 => include_str!("../../../contracts/project-v2.schema.json"),
        3 => include_str!("../../../contracts/project-v3.schema.json"),
        4 => include_str!("../../../contracts/project-v4.schema.json"),
        5 => include_str!("../../../contracts/project-v5.schema.json"),
        6 => include_str!("../../../contracts/project.schema.json"),
        _ => return Err("Unsupported project schema version".into()),
    };
    let schema: Value = serde_json::from_str(source).map_err(|e| e.to_string())?;
    jsonschema::validator_for(&schema)
        .map_err(|e| e.to_string())?
        .validate(project)
        .map_err(|e| format!("Invalid version {version} project: {e}"))?;
    if version >= 3 {
        validate_named_selections(project)?;
    }
    if version == 6 && project["geometry"]["kind"] == "cad" {
        validate_cad_references(&project["geometry"])?;
    }
    Ok(())
}

fn validate_named_selections(project: &Value) -> Result<(), String> {
    let mut ids = HashSet::new();
    let mut names = HashSet::new();
    // The JSON Schema above checks collection, stamp and item types. Validate
    // against the set's stamped topology, so orphaned sets remain recoverable.
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
        if dimension == "2d" && kind == "profile" {
            if selection["regions"]
                .as_array()
                .unwrap()
                .iter()
                .any(|region| !profile_region_id(region.as_str().unwrap()))
            {
                return Err("A profile boundary set has an invalid boundary identifier".into());
            }
            continue;
        }
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
    }
    Ok(())
}

pub(crate) fn validate_project(project: &Value) -> Result<(), String> {
    validate_version(project, 6)
}

// An archive validates design intent, not a promise that a selected solver can
// execute it. Numerical requests have a separate enforced admission boundary.
pub(crate) fn validate_numerical_project(project: &Value) -> Result<(), String> {
    validate_project(project)?;
    if project["study"].is_null()
        || !matches!(
            project["geometry"]["kind"].as_str(),
            Some("box" | "cylinder" | "bracket" | "profile" | "cad")
        )
    {
        return Err("This geometry is definition-only. Create a supported analysis before meshing or solving.".into());
    }
    Ok(())
}

fn validate_cad_references(geometry: &Value) -> Result<(), String> {
    let mut assets = HashSet::new();
    let mut total = 0u64;
    for asset in geometry["assets"].as_array().ok_or("Missing CAD assets")? {
        if !assets.insert(asset["id"].as_str().ok_or("Missing CAD asset identity")?) {
            return Err("CAD asset identities must be unique".into());
        }
        total = total
            .checked_add(
                asset["byteLength"]
                    .as_u64()
                    .ok_or("Invalid CAD asset size")?,
            )
            .ok_or("CAD asset size exceeds its limit")?;
        if total > super::assets::MAX_CAD_ASSETS {
            return Err("CAD source assets exceed 64 MiB".into());
        }
    }
    let mut features = HashSet::new();
    for feature in geometry["features"]
        .as_array()
        .ok_or("Missing CAD features")?
    {
        let id = feature["id"]
            .as_str()
            .ok_or("Missing CAD feature identity")?;
        if features.contains(id) {
            return Err("CAD feature identities must be unique".into());
        }
        for key in [
            "sketchId", "inputId", "targetId", "toolId", "leftId", "rightId",
        ] {
            if let Some(reference) = feature[key].as_str() {
                if !features.contains(reference) {
                    return Err(format!(
                        "CAD feature {id} refers to a missing or later feature"
                    ));
                }
            }
        }
        if let Some(asset) = feature["assetId"].as_str() {
            if !assets.contains(asset) {
                return Err("CAD import refers to a missing source asset".into());
            }
        }
        features.insert(id);
    }
    if !features.contains(
        geometry["outputFeatureId"]
            .as_str()
            .ok_or("Missing CAD output identity")?,
    ) {
        return Err("CAD output refers to a missing feature".into());
    }
    Ok(())
}

pub(crate) fn migrate_project(mut project: Value) -> Result<(Value, bool), String> {
    let version = project["schemaVersion"]
        .as_u64()
        .ok_or("Unsupported project schema version")?;
    validate_version(&project, version)?;
    if version == 6 {
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
    if version < 3 {
        project["namedSelections"] = json!([]);
    }
    if version < 5 {
        project["study"]["solver"]["pinn"]["formulation"] = json!("strong-form");
    }
    project["schemaVersion"] = json!(6);
    validate_project(&project)?;
    Ok((project, true))
}

#[cfg(test)]
mod rigid_transform_tests {
    use super::validate_project;
    use serde_json::json;

    #[test]
    fn bounded_rigid_placement_validates_axis_and_dependency() {
        let mut project = json!({
            "schemaVersion":6,"id":"project","name":"Placement","revision":0,
            "displayUnits":"mm","study":null,"namedSelections":[],
            "geometry":{"kind":"cad","dimension":"3d","assets":[],
                "outputFeatureId":"placed","features":[
                    {"id":"box","name":"Box","kind":"box","length":0.1,"width":0.05,"height":0.02},
                    {"id":"placed","name":"Placed box","kind":"transform","inputId":"box",
                        "translation":[0.02,-0.03,0.04],"axisOrigin":[0.01,0.02,0],
                        "axisDirection":[0,0,4],"angle":0.0}
                ]}
        });
        validate_project(&project).unwrap();
        project["geometry"]["features"][1]["axisDirection"] = json!([0, 0, 0]);
        assert!(validate_project(&project).is_err());
        project["geometry"]["features"][1]["axisDirection"] = json!([0, 0, 1]);
        project["geometry"]["features"][1]["translation"] = json!([1001, 0, 0]);
        assert!(validate_project(&project).is_err());
        project["geometry"]["features"][1]["translation"] = json!([0, 0, 0]);
        project["geometry"]["features"][1]["inputId"] = json!("future");
        assert!(validate_project(&project)
            .unwrap_err()
            .contains("later feature"));
    }
}
