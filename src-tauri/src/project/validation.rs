use serde_json::{json, Value};
pub(crate) fn validate_project(project: &Value) -> Result<(), String> {
    let schema: Value =
        serde_json::from_str(include_str!("../../../contracts/project.schema.json"))
            .map_err(|e| e.to_string())?;
    let validator = jsonschema::validator_for(&schema).map_err(|e| e.to_string())?;
    validator
        .validate(project)
        .map_err(|e| format!("Invalid project: {e}"))
}

pub(crate) fn migrate_project(mut project: Value) -> Result<(Value, bool), String> {
    match project["schemaVersion"].as_u64() {
        Some(2) => {
            validate_project(&project)?;
            Ok((project, false))
        }
        Some(1) => {
            let legacy: Value =
                serde_json::from_str(include_str!("../../../contracts/project-v1.schema.json"))
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
