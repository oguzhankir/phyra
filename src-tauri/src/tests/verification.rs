use super::*;

#[test]
fn explicit_verification_flags_include_energy_and_leave_normal_launch_untouched() {
    use crate::verification::configuration_from_arguments;
    for (flag, expected) in [
        ("--verify-workflow", Some("3d")),
        ("--verify-physicsml", Some("2d-compare")),
        ("--verify-profile", Some("2d-profile")),
        ("--verify-energy", Some("2d-energy")),
        ("--verify-cad", Some("cad")),
        ("--energy-only", None),
        ("--unknown", None),
    ] {
        assert_eq!(
            configuration_from_arguments(&["phyra".into(), flag.into()]),
            expected
        );
    }
    assert_eq!(configuration_from_arguments(&["phyra".into()]), None);
}

#[test]
fn persistence_compares_native_metadata_without_javascript_number_reencoding() {
    let original: Value =
        serde_json::from_str(r#"{"summary":{"totalForce":[0.0,0.0,-100.0]}}"#).unwrap();
    let frontend = json!({"summary":{"totalForce":[0,0,-100]}});
    assert_ne!(original, frontend);
    assert_eq!(
        original["summary"]["totalForce"][0].as_f64(),
        frontend["summary"]["totalForce"][0].as_f64()
    );
    let reopened: Value = serde_json::from_slice(&serde_json::to_vec(&original).unwrap()).unwrap();
    assert_eq!(reopened, original);
}

#[test]
fn metadata_float_parsing_preserves_ieee_values_through_json_round_trips() {
    // These decimals exposed a one-ULP change in the native persistence path.
    // The standard float parser is an independent correctly rounded reference.
    for decimal in [
        "-99.99999999999999",
        "-1.779687508474126e-13",
        "2.5714541607158026e-11",
        "2.836811001324955e-14",
    ] {
        let reference = decimal.parse::<f64>().unwrap();
        let mut value: Value = serde_json::from_str(decimal).unwrap();
        for _ in 0..10 {
            assert_eq!(value.as_f64().unwrap().to_bits(), reference.to_bits());
            value = serde_json::from_str(&serde_json::to_string(&value).unwrap()).unwrap();
        }
    }
}

#[test]
fn verification_trace_is_bounded_and_removes_control_characters() {
    let message = "a\n\u{1b}\r".repeat(600);
    let trace = bounded_trace(&message);
    assert_eq!(trace, "a".repeat(500));
    assert!(!trace.chars().any(char::is_control));
}

#[test]
fn invalid_or_oversized_reports_become_explicit_bounded_failures() {
    for report in [
        json!("invalid"),
        json!({"payload":"x".repeat(MAX_JSON as usize)}),
    ] {
        let bytes = verification_bytes(report).unwrap();
        assert!(bytes.len() as u64 <= MAX_JSON);
        let parsed: Value = serde_json::from_slice(&bytes).unwrap();
        assert!(parsed["error"].is_string());
    }
}

fn advanced_definitions() -> Value {
    let base: Value =
        serde_json::from_str(include_str!("../../../examples/cantilever.json")).unwrap();
    json!((0..4).map(|index| {
        let mut definition = base.clone();
        definition["study"] = Value::Null;
        definition["namedSelections"] = json!([]);
        let mut output = json!({"id":"output", "name":"Output", "kind":match index {0|1=>"loft", 2=>"sweep", _=>"assembly"}});
        match index {
            0 | 1 => {
                output["sectionIds"] = json!(["first", "second"]);
                output["solid"] = json!(index == 0);
                output["ruled"] = json!(false);
            }
            2 => {
                output["profileId"] = json!("first");
                output["spineId"] = json!("second");
                output["solid"] = json!(true);
            }
            _ => output["components"] = json!([{ "id":"instance", "name":"Instance", "featureId":"first" }]),
        }
        // Intent-only fixtures: exact kernel execution is covered by the owned
        // desktop workflow, while this test isolates authoritative archive IO.
        definition["geometry"] = json!({"kind":"cad","dimension":"3d","assets":[],"outputFeatureId":"output","features":[
            {"id":"first","name":"First sketch","kind":"sketch","plane":"xy","sketch":{"points":[],"entities":[],"constraints":[],"loops":[]}},
            {"id":"second","name":"Second sketch","kind":"sketch","plane":"xz","sketch":{"points":[],"entities":[],"constraints":[],"loops":[]}},
            output]});
        definition
    }).collect::<Vec<_>>())
}

#[test]
fn advanced_cad_verification_saves_and_reopens_canonical_intent_without_result_caches() {
    use crate::verification::verify_advanced_cad_persistence;
    let definitions = advanced_definitions();
    verify_advanced_cad_persistence(&definitions).unwrap();
    for defect in [
        "missing",
        "count",
        "wrong-order",
        "study",
        "future-reference",
        "frozen-version",
    ] {
        let mut bad = definitions.clone();
        match defect {
            "missing" => bad = Value::Null,
            "count" => {
                bad.as_array_mut().unwrap().pop();
            }
            "wrong-order" => bad.as_array_mut().unwrap().swap(0, 1),
            "study" => {
                bad[0]["study"] =
                    serde_json::from_str::<Value>(include_str!("../../../examples/cantilever.json"))
                        .unwrap()["study"]
                        .clone()
            }
            "future-reference" => bad[2]["geometry"]["features"][2]["spineId"] = json!("absent"),
            "frozen-version" => bad[0]["schemaVersion"] = json!(6),
            _ => unreachable!(),
        }
        assert!(verify_advanced_cad_persistence(&bad).is_err(), "{defect}");
    }
}
