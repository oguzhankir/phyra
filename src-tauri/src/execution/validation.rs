use serde_json::Value;
pub(crate) const MAX_METRICS: usize = 1024;
pub(crate) fn validate_metrics(
    event: &Value,
    job_id: &str,
    maximum_step: u64,
    previous: Option<(u64, f64)>,
) -> Result<(u64, f64), String> {
    let step = event["step"].as_u64().ok_or("Invalid training step")?;
    let elapsed = event["elapsed"]
        .as_f64()
        .filter(|value| value.is_finite() && (0.0..=1e9).contains(value))
        .ok_or("Invalid training elapsed time")?;
    if event["type"] != "metrics"
        || event["jobId"] != job_id
        || event.as_object().is_none_or(|object| object.len() != 8)
        || step > maximum_step
        || previous.is_some_and(|(old_step, old_elapsed)| step <= old_step || elapsed < old_elapsed)
        || !matches!(event["device"].as_str(), Some("cpu" | "mps" | "cuda"))
        || ["total", "pde", "boundary"].iter().any(|key| {
            event[*key]
                .as_f64()
                .is_none_or(|value| !value.is_finite() || value < 0.0)
        })
    {
        return Err("Invalid training metric identity, sequence, or value".into());
    }
    Ok((step, elapsed))
}

pub(crate) fn validate_devices(manifest: &Value) -> Result<(), String> {
    let devices = manifest["devices"]
        .as_array()
        .ok_or("Missing compute devices")?;
    if devices.is_empty() || devices.len() > 3 || manifest["defaultDevice"] != "cpu" {
        return Err("Invalid compute device inventory".into());
    }
    let mut seen = std::collections::HashSet::new();
    for device in devices {
        let id = device["id"]
            .as_str()
            .ok_or("Missing compute device identity")?;
        if !matches!(id, "cpu" | "mps" | "cuda")
            || !seen.insert(id)
            || device["label"]
                .as_str()
                .is_none_or(|value| value.is_empty() || value.len() > 100)
            || device["available"].as_bool().is_none()
            || !matches!(device["precision"].as_str(), Some("float64" | "float32"))
            || device["reason"]
                .as_str()
                .is_none_or(|value| value.len() > 500)
        {
            return Err("Invalid compute device metadata".into());
        }
    }
    if !devices
        .iter()
        .any(|device| device["id"] == "cpu" && device["available"] == true)
        || manifest["framework"]
            .as_str()
            .is_none_or(|value| value.is_empty() || value.len() > 100)
    {
        return Err("Missing usable CPU or framework identity".into());
    }
    Ok(())
}

pub(crate) fn validate_capabilities(manifest: &Value) -> Result<(), String> {
    let schema: Value = serde_json::from_str(include_str!(
        "../../../contracts/engine-capabilities.schema.json"
    ))
    .map_err(|e| e.to_string())?;
    jsonschema::validator_for(&schema)
        .map_err(|e| e.to_string())?
        .validate(&manifest["capabilities"])
        .map_err(|e| format!("Invalid engine capability contract: {e}"))?;
    if manifest["capabilities"]["methods"][2]["devices"] != manifest["devices"] {
        return Err("Method capabilities differ from the actual compute probe".into());
    }
    Ok(())
}
