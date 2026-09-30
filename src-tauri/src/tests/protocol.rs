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
