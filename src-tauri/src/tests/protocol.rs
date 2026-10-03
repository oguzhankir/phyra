use super::*;

fn metric() -> Value {
    json!({"type":"metrics","jobId":"owned","step":2,"elapsed":0.25,
        "total":0.75,"pde":0.25,"boundary":0.5,"device":"cpu"})
}

#[test]
fn training_metrics_enforce_ownership_finiteness_and_monotonic_progress() {
    assert_eq!(
        validate_metrics(&metric(), "owned", 10, Some((1, 0.1))).unwrap(),
        (2, 0.25)
    );
    for (key, value) in [
        ("jobId", json!("other")),
        ("step", json!(11)),
        ("step", json!(1)),
        ("step", json!(2.5)),
        ("elapsed", json!(-1)),
        ("elapsed", json!(0.05)),
        ("total", json!(-1)),
        ("pde", Value::Null),
        ("boundary", json!("0")),
        ("device", json!("invented")),
    ] {
        let mut malformed = metric();
        malformed[key] = value;
        assert!(
            validate_metrics(&malformed, "owned", 10, Some((1, 0.1))).is_err(),
            "{key}"
        );
    }
    let mut repeated = metric();
    repeated["step"] = json!(1);
    assert!(validate_metrics(&repeated, "owned", 10, Some((1, 0.1))).is_err());
}

#[test]
fn ui_run_requests_require_a_bounded_uuid_before_worker_execution() {
    for invalid in [
        "",
        "owned",
        "arbitrary-current-job",
        "9ddcda9e-70aa-4af7-a6cb-9774147238cg",
        "9ddcda9e70aa4af7a6cb9774147238cf",
    ] {
        assert!(RunRequestId::parse(invalid.into()).is_err(), "{invalid}");
    }
    let oversized = "0".repeat(MAX_JSON as usize + 1);
    assert!(RunRequestId::parse(oversized).is_err());
    assert!(RunRequestId::parse("9ddcda9e-70aa-4af7-a6cb-9774147238cf".into()).is_ok());
}

#[test]
fn delayed_run_events_keep_caller_correlation_and_raw_numerical_ownership() {
    let previous = RunRequestId::parse("9ddcda9e-70aa-4af7-a6cb-9774147238cf".into()).unwrap();
    let current = RunRequestId::parse("8eee97cf-1852-4f7c-89d4-cda74a89b6b7".into()).unwrap();
    let raw = metric();
    let original = raw.clone();
    let late_event = serde_json::to_value(previous.event(&raw)).unwrap();
    let current_event = serde_json::to_value(current.event(&raw)).unwrap();

    assert_ne!(late_event["requestId"], current_event["requestId"]);
    assert_eq!(late_event["payload"]["jobId"], "owned");
    assert_eq!(late_event["payload"], original);
    assert_eq!(raw, original);
    assert_eq!(raw.as_object().unwrap().len(), 8);
    assert!(raw.get("requestId").is_none());
    assert_eq!(
        validate_metrics(&late_event["payload"], "owned", 10, Some((1, 0.1))).unwrap(),
        (2, 0.25)
    );
    // UI correlation belongs to its envelope, not the persisted Python frame.
    assert!(validate_metrics(&late_event, "owned", 10, Some((1, 0.1))).is_err());
}

#[test]
fn a_worker_payload_cannot_replace_native_request_correlation() {
    let caller = "9DDCDA9E-70AA-4AF7-A6CB-9774147238CF";
    let request = RunRequestId::parse(caller.into()).unwrap();
    let progress = json!({"type":"progress","jobId":"native-owned",
        "stage":"assembling","progress":0.5,"requestId":"forged-worker-value"});
    let wrapped = serde_json::to_value(request.event(&progress)).unwrap();
    assert_eq!(wrapped["requestId"], caller);
    assert_eq!(wrapped["payload"], progress);
    assert_eq!(wrapped["payload"]["jobId"], "native-owned");
}

#[test]
fn devices_require_real_identifiable_cpu_and_bounded_metadata() {
    let inventory = json!({"devices":[{"id":"cpu","label":"CPU","available":true,
        "precision":"float64","reason":""}],"defaultDevice":"cpu","framework":"PyTorch"});
    assert!(validate_devices(&inventory).is_ok());
    for (key, value) in [
        ("id", json!("fake")),
        ("available", json!(false)),
        ("precision", json!("float16")),
        ("reason", json!("x".repeat(501))),
    ] {
        let mut malformed = inventory.clone();
        malformed["devices"][0][key] = value;
        assert!(validate_devices(&malformed).is_err());
    }
    let mut duplicates = inventory.clone();
    duplicates["devices"]
        .as_array_mut()
        .unwrap()
        .push(inventory["devices"][0].clone());
    assert!(validate_devices(&duplicates).is_err());
}

#[test]
fn every_pinn_capability_must_match_the_actual_device_probe() {
    use crate::execution::validation::validate_capabilities;
    fn fixture(schema: &Value) -> Value {
        if let Some(value) = schema.get("const") {
            return value.clone();
        }
        match schema["type"].as_str().unwrap() {
            "object" => Value::Object(
                schema["properties"]
                    .as_object()
                    .unwrap()
                    .iter()
                    .map(|(key, value)| (key.clone(), fixture(value)))
                    .collect(),
            ),
            "array" => Value::Array(
                schema["items"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(fixture)
                    .collect(),
            ),
            "string" => json!("fixture"),
            "boolean" => json!(true),
            "integer" => json!(1),
            other => panic!("Unsupported capability fixture type: {other}"),
        }
    }
    let schema: Value = serde_json::from_str(include_str!(
        "../../../contracts/engine-capabilities.schema.json"
    ))
    .unwrap();
    let capabilities = fixture(&schema);
    let inventory = json!({"devices":capabilities["methods"][2]["devices"],
        "capabilities":capabilities});
    assert!(validate_capabilities(&inventory).is_ok());
    for method in [2, 3] {
        for (key, value) in [
            ("available", json!(false)),
            ("reason", json!("different probe")),
        ] {
            let mut altered = inventory.clone();
            altered["capabilities"]["methods"][method]["devices"][0][key] = value;
            let error = validate_capabilities(&altered).unwrap_err();
            assert!(
                error.contains("actual compute probe"),
                "{method}: {key}: {error}"
            );
        }
    }
}

#[test]
fn planar_export_uses_triangles_and_preserves_comparison_units() {
    let manifest = json!({"dimension":"2d","statistics":{"nodes":3,"cells":1},
        "arrays":{"cells":{"dtype":"uint32","association":"cell","units":"1",
            "shape":[1,3],"offset":0,"byteLength":12},
            "pinnVonMises":{"dtype":"float64","association":"cell","units":"Pa",
                "shape":[1],"offset":16,"byteLength":8}}});
    let mut data: Vec<u8> = [0u32, 1, 2]
        .into_iter()
        .flat_map(u32::to_le_bytes)
        .collect();
    data.extend_from_slice(&[0; 4]);
    data.extend_from_slice(&12.5f64.to_le_bytes());
    assert_eq!(
        array_values(&manifest, &data, "cells").unwrap(),
        [0., 1., 2.]
    );
    assert_eq!(
        array_values(&manifest, &data, "pinnVonMises").unwrap(),
        [12.5]
    );
    let mut malformed = manifest;
    malformed["arrays"]["cells"]["shape"] = json!([1, 4]);
    assert!(array_values(&malformed, &data, "cells").is_err());
}
