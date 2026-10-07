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
        6 => include_str!("../../../contracts/project-v6.schema.json"),
        7 => include_str!("../../../contracts/project-v7.schema.json"),
        8 => include_str!("../../../contracts/project.schema.json"),
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
    if version >= 6 && project["geometry"]["kind"] == "cad" {
        validate_cad_references(&project["geometry"])?;
    }
    if version >= 8 {
        validate_cad_domain(project)?;
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
        if kind == "cad" && dimension == "3d" {
            // CAD sets retain their original geometry stamp while orphaned.
            // Current-source membership is checked before numerical execution.
            continue;
        }
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
    validate_version(project, 8)
}

fn validate_cad_domain(project: &Value) -> Result<(), String> {
    let Some(domain) = project["study"].get("domain") else {
        return Ok(());
    };
    let mut identifiers = HashSet::new();
    let mut faces = HashSet::new();
    let output = domain["outputFeatureId"].as_str().unwrap();
    if selection_trim(output).is_empty() {
        return Err("CAD analysis output identity must not be blank".into());
    }
    // Exact receipts compact long UTF-8 owner identities before attaching a
    // face digest. Check catalog-internal ownership even when its source is stale.
    let owner = if output.len() > 100 {
        format!(
            "feature-{}",
            &super::assets::source_hash(output.as_bytes())[..24]
        )
    } else {
        output.to_string()
    };
    let prefix = format!("{owner}/face/");
    for boundary in domain["boundaries"].as_array().unwrap() {
        let id = boundary["id"].as_str().unwrap();
        let face = boundary["faceId"].as_str().unwrap();
        if !profile_region_id(id) || !identifiers.insert(id) || !faces.insert(face) {
            return Err("CAD analysis boundary and face identities must be unique".into());
        }
        let owned = face.strip_prefix(&prefix).is_some_and(|digest| {
            digest.len() == 24
                && digest
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        });
        if !owned {
            return Err(
                "CAD analysis face reference differs from its catalog output identity".into(),
            );
        }
        if face.len() > 200 || selection_trim(boundary["name"].as_str().unwrap()).is_empty() {
            return Err(
                "CAD analysis boundaries require bounded face references and nonblank names".into(),
            );
        }
    }
    // Geometry stamps may be stale in an editable definition. The numerical
    // worker must rebuild the immutable source and verify every face before use.
    Ok(())
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
            "sketchId",
            "inputId",
            "targetId",
            "toolId",
            "leftId",
            "rightId",
            "profileId",
            "spineId",
        ] {
            if let Some(reference) = feature[key].as_str() {
                if !features.contains(reference) {
                    return Err(format!(
                        "CAD feature {id} refers to a missing or later feature"
                    ));
                }
            }
        }
        if let Some(sections) = feature["sectionIds"].as_array() {
            if sections.iter().any(|section| {
                section
                    .as_str()
                    .is_none_or(|reference| !features.contains(reference))
            }) {
                return Err(format!(
                    "CAD feature {id} refers to a missing or later section"
                ));
            }
        }
        if matches!(
            feature["kind"].as_str(),
            Some("loft" | "sweep" | "assembly")
        ) && selection_trim(feature["name"].as_str().ok_or("Missing CAD feature name")?)
            .is_empty()
        {
            return Err("CAD feature names must not be blank".into());
        }
        if let Some(components) = feature["components"].as_array() {
            let mut component_ids = HashSet::new();
            for component in components {
                let component_id = component["id"]
                    .as_str()
                    .ok_or("Missing CAD component identity")?;
                if !component_ids.insert(component_id) {
                    return Err("CAD component identities must be unique within an assembly".into());
                }
                if selection_trim(
                    component["name"]
                        .as_str()
                        .ok_or("Missing CAD component name")?,
                )
                .is_empty()
                {
                    return Err("CAD component names must not be blank".into());
                }
                if !features.contains(
                    component["featureId"]
                        .as_str()
                        .ok_or("Missing CAD component feature")?,
                ) {
                    return Err(format!(
                        "CAD component {component_id} refers to a missing or later feature"
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
    if version == 8 {
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
    project["schemaVersion"] = json!(8);
    validate_project(&project)?;
    Ok((project, true))
}

#[cfg(test)]
mod rigid_transform_tests {
    use super::{migrate_project, validate_project};
    use serde_json::{json, Value};

    fn construction(kind: &str) -> Value {
        let mut feature = json!({"id":"operation","name":"Operation","kind":kind});
        match kind {
            "loft" => {
                feature["sectionIds"] = json!(["first", "second"]);
                feature["solid"] = json!(true);
                feature["ruled"] = json!(false);
            }
            "sweep" => {
                feature["profileId"] = json!("first");
                feature["spineId"] = json!("second");
                feature["solid"] = json!(true);
            }
            "assembly" => {
                feature["components"] = json!([
                {"id":"instance-a","name":"First component","featureId":"first"},
                {"id":"instance-b","name":"Second component","featureId":"second"}])
            }
            _ => unreachable!(),
        }
        json!({"schemaVersion":8,"id":"project","name":"Construction","revision":0,
            "displayUnits":"mm","study":null,"namedSelections":[],
            "geometry":{"kind":"cad","dimension":"3d","assets":[],"outputFeatureId":"operation",
                "features":[
                    {"id":"first","name":"First sketch","kind":"sketch","plane":"xy","sketch":{"points":[],"entities":[],"constraints":[],"loops":[]}},
                    {"id":"second","name":"Second sketch","kind":"sketch","plane":"xz","sketch":{"points":[],"entities":[],"constraints":[],"loops":[]}},
                    feature]}})
    }

    #[test]
    fn version_seven_operations_require_ordered_dependencies_and_frozen_version_six_rejects_them() {
        for kind in ["loft", "sweep", "assembly"] {
            let current = construction(kind);
            validate_project(&current).unwrap();
            let mut previous = current.clone();
            previous["schemaVersion"] = json!(6);
            assert!(migrate_project(previous).is_err(), "{kind}");
            for reference in ["absent", "operation"] {
                let mut invalid = current.clone();
                let feature = &mut invalid["geometry"]["features"][2];
                match kind {
                    "loft" => feature["sectionIds"][1] = json!(reference),
                    "sweep" => feature["spineId"] = json!(reference),
                    "assembly" => feature["components"][1]["featureId"] = json!(reference),
                    _ => unreachable!(),
                }
                assert!(
                    validate_project(&invalid).unwrap_err().contains("later"),
                    "{kind}: {reference}"
                );
            }
        }
    }

    #[test]
    fn assembly_component_ids_names_counts_and_loft_sections_are_bounded() {
        for defect in [
            "duplicate-component",
            "blank-component",
            "blank-control",
            "oversized-assembly",
            "duplicate-sections",
            "undersized-sections",
            "oversized-sections",
            "nonboolean",
            "blank-feature",
        ] {
            let mut current =
                construction(if defect.contains("sections") || defect == "nonboolean" {
                    "loft"
                } else {
                    "assembly"
                });
            let feature = &mut current["geometry"]["features"][2];
            match defect {
                "duplicate-component" => feature["components"][1]["id"] = json!("instance-a"),
                "blank-component" => feature["components"][0]["name"] = json!("   "),
                "blank-control" => feature["components"][0]["name"] = json!("\u{001C}\u{FEFF}"),
                "oversized-assembly" => feature["components"] = json!((0..33).map(|index| json!({"id":format!("instance-{index}"),"name":"Instance","featureId":"first"})).collect::<Vec<_>>()),
                "duplicate-sections" => feature["sectionIds"] = json!(["first", "first"]),
                "undersized-sections" => feature["sectionIds"] = json!(["first"]),
                "oversized-sections" => feature["sectionIds"] = json!((0..17).map(|index| format!("section-{index}")).collect::<Vec<_>>()),
                "nonboolean" => feature["solid"] = json!(1),
                "blank-feature" => feature["name"] = json!("\u{FEFF}"),
                _ => unreachable!(),
            }
            assert!(validate_project(&current).is_err(), "{defect}");
        }
    }

    #[test]
    fn bounded_rigid_placement_validates_axis_and_dependency() {
        let mut project = json!({
            "schemaVersion":8,"id":"project","name":"Placement","revision":0,
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

#[cfg(test)]
mod cad_domain_tests {
    use super::*;

    fn definition() -> Value {
        let mut project: Value =
            serde_json::from_str(include_str!("../../../examples/cantilever.json")).unwrap();
        project["geometry"] = json!({"kind":"cad","dimension":"3d","assets":[],"outputFeatureId":"box",
            "features":[{"id":"box","kind":"box","name":"Box","length":0.1,"width":0.05,"height":0.02}]});
        project["study"]["constraints"] = json!([]);
        project["study"]["loads"] = json!([]);
        project["study"]["domain"] = json!({"kind":"cad-solid","geometryFingerprint":"a".repeat(64),
            "outputFeatureId":"box","boundaries":[{"id":"cad-face-a","faceId":format!("box/face/{}", "b".repeat(24)),"name":"Face A"}]});
        project
    }

    #[test]
    fn source_bound_definitions_remain_saveable_while_assignments_need_repair() {
        let mut project = definition();
        validate_project(&project).unwrap();
        project["geometry"]["features"][0]["length"] = json!(0.2);
        project["study"]["domain"]["outputFeatureId"] = json!("previous-output");
        project["study"]["domain"]["boundaries"][0]["faceId"] =
            json!(format!("previous-output/face/{}", "b".repeat(24)));
        project["study"]["constraints"] = json!([{"id":"support","name":"Support","regions":["previous-face"],"components":[0,0,0]}]);
        validate_project(&project).unwrap();
        // Native validation bounds editable intent. Exact face/source admission
        // belongs to the numerical worker, never to a schema-only claim.
        let (migrated, changed) = migrate_project(project.clone()).unwrap();
        assert!(!changed);
        assert_eq!(migrated, project);
    }

    #[test]
    fn domain_rejects_ambiguous_catalogs_and_incompatible_formulations() {
        for defect in [
            "duplicate-id",
            "duplicate-face",
            "blank-name",
            "oversized-face",
            "foreign-owner",
            "alias-newline",
            "primitive",
            "plane",
            "pinn",
            "unknown-field",
        ] {
            let mut project = definition();
            let mut second = project["study"]["domain"]["boundaries"][0].clone();
            match defect {
                "duplicate-id" => {
                    second["faceId"] = json!(format!("box/face/{}", "c".repeat(24)));
                    project["study"]["domain"]["boundaries"]
                        .as_array_mut()
                        .unwrap()
                        .push(second);
                }
                "duplicate-face" => {
                    second["id"] = json!("cad-face-b");
                    project["study"]["domain"]["boundaries"]
                        .as_array_mut()
                        .unwrap()
                        .push(second);
                }
                "blank-name" => {
                    project["study"]["domain"]["boundaries"][0]["name"] = json!("\u{001c}\u{feff}")
                }
                "oversized-face" => {
                    project["study"]["domain"]["boundaries"][0]["faceId"] =
                        json!(format!("{}/face/{}", "界".repeat(70), "b".repeat(24)))
                }
                "foreign-owner" => {
                    project["study"]["domain"]["boundaries"][0]["faceId"] =
                        json!(format!("other-output/face/{}", "b".repeat(24)))
                }
                "alias-newline" => {
                    project["study"]["domain"]["boundaries"][0]["id"] = json!("cad-face-a\n")
                }
                "primitive" => {
                    project["geometry"] = serde_json::from_str::<Value>(include_str!(
                        "../../../examples/cantilever.json"
                    ))
                    .unwrap()["geometry"]
                        .clone()
                }
                "plane" => project["study"]["formulation"] = json!("plane-stress"),
                "pinn" => project["study"]["solver"]["kind"] = json!("pinn"),
                "unknown-field" => project["study"]["domain"]["meshId"] = json!("transient"),
                _ => unreachable!(),
            }
            assert!(validate_project(&project).is_err(), "{defect}");
        }
    }

    #[test]
    fn copied_cad_sets_require_a_source_stamp_and_remain_repairable() {
        let mut project = definition();
        project["namedSelections"] = json!([{"id":"set","name":"Original faces","geometryKind":"cad","dimension":"3d","regions":["old-cad-face"],"geometryFingerprint":"c".repeat(64)}]);
        validate_project(&project).unwrap();
        project["namedSelections"][0]
            .as_object_mut()
            .unwrap()
            .remove("geometryFingerprint");
        assert!(validate_project(&project).is_err());
    }

    #[test]
    fn exact_face_owners_use_utf8_bytes_and_hashed_long_identities() {
        let mut project = definition();
        let short = "界".repeat(33); // 99 UTF-8 bytes, preserved literally.
        project["study"]["domain"]["outputFeatureId"] = json!(short);
        project["study"]["domain"]["boundaries"][0]["faceId"] =
            json!(format!("{short}/face/{}", "b".repeat(24)));
        validate_project(&project).unwrap();
        let long = "界".repeat(34); // 102 bytes; independently computed SHA-256 prefix.
        project["study"]["domain"]["outputFeatureId"] = json!(long);
        project["study"]["domain"]["boundaries"][0]["faceId"] = json!(format!(
            "feature-cdd475159b5f992bbaee364b/face/{}",
            "b".repeat(24)
        ));
        validate_project(&project).unwrap();
        project["study"]["domain"]["boundaries"][0]["faceId"] =
            json!(format!("{long}/face/{}", "b".repeat(24)));
        assert!(validate_project(&project)
            .unwrap_err()
            .contains("catalog output identity"));
        project["study"]["domain"]["boundaries"][0]["faceId"] = json!(format!(
            "feature-000000000000000000000000/face/{}",
            "b".repeat(24)
        ));
        assert!(validate_project(&project)
            .unwrap_err()
            .contains("catalog output identity"));
    }

    #[test]
    fn frozen_version_seven_migrates_without_inventing_a_cad_domain() {
        let mut previous = definition();
        previous["schemaVersion"] = json!(7);
        assert!(migrate_project(previous.clone()).is_err());
        previous["study"].as_object_mut().unwrap().remove("domain");
        let (migrated, changed) = migrate_project(previous.clone()).unwrap();
        assert!(changed);
        previous["schemaVersion"] = json!(8);
        assert_eq!(migrated, previous);
    }
}
