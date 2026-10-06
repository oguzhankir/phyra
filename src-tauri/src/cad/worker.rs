use crate::{
    execution::{
        events::RunRequestId,
        state::{run_cancellation, Active, EngineState},
        worker::engine_path,
    },
    platform::files::{read_bounded, MAX_BLOB, MAX_JSON, MAX_LOG},
    project::assets::source_hash,
};
use serde_json::{json, Value};
use std::{
    fs::{self, File},
    io::{BufRead, BufReader, Read, Write},
    path::Path,
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

#[allow(clippy::too_many_arguments)]
pub(crate) fn evaluate(
    app: &tauri::AppHandle,
    state: &EngineState,
    project: &Value,
    directory: &Path,
    sources: &Path,
    job: &str,
    request: &RunRequestId,
    publish: impl FnOnce(Value) -> Result<Value, String>,
) -> Result<Value, String> {
    execute(
        app, state, project, directory, sources, job, request, None, publish,
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn solve_sketch(
    app: &tauri::AppHandle,
    state: &EngineState,
    project: &Value,
    directory: &Path,
    sources: &Path,
    job: &str,
    request: &RunRequestId,
    feature_id: &str,
    publish: impl FnOnce(Value) -> Result<Value, String>,
) -> Result<Value, String> {
    execute(
        app,
        state,
        project,
        directory,
        sources,
        job,
        request,
        Some(feature_id),
        publish,
    )
}

#[allow(clippy::too_many_arguments)]
fn execute(
    app: &tauri::AppHandle,
    state: &EngineState,
    project: &Value,
    directory: &Path,
    sources: &Path,
    job: &str,
    request: &RunRequestId,
    sketch_id: Option<&str>,
    publish: impl FnOnce(Value) -> Result<Value, String>,
) -> Result<Value, String> {
    let cancelled = run_cancellation(state, Some(request))?;
    if cancelled.load(Ordering::SeqCst) || state.shutting_down.load(Ordering::SeqCst) {
        return Err("CAD operation cancelled".into());
    }
    let mut envelope = json!({"protocolVersion":1,"jobId":job,
        "projectId":project["id"],"revision":project["revision"],"geometry":project["geometry"],"assetRoot":sources});
    if let Some(feature_id) = sketch_id {
        envelope["operation"] = json!("solve-sketch");
        envelope["featureId"] = json!(feature_id);
    }
    let payload = serde_json::to_vec(&envelope).map_err(|e| e.to_string())?;
    if payload.len() as u64 > MAX_JSON {
        return Err("CAD request exceeds 1 MiB".into());
    }
    fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    let mut active = state.active.lock().map_err(|e| e.to_string())?;
    if active.is_some() {
        return Err("A CAD operation is already running".into());
    }
    let mut command = Command::new(engine_path(app)?);
    command
        .arg("--cad")
        .arg("--output")
        .arg(directory)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("OMP_NUM_THREADS", "1")
        .env("OPENBLAS_NUM_THREADS", "1");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let log = File::create(directory.join("cad.log")).map_err(|e| e.to_string())?;
    let mut process = command
        .spawn()
        .map_err(|e| format!("CAD worker failed to start: {e}"))?;
    crate::verification::trace_verification("CAD worker started");
    let stdout = process.stdout.take().ok_or("Missing CAD output")?;
    let mut stdin = process.stdin.take().ok_or("Missing CAD input")?;
    let stderr = process.stderr.take().ok_or("Missing CAD diagnostics")?;
    let diagnostics = std::thread::spawn(move || drain_diagnostics(stderr, log));
    let child = Arc::new(Mutex::new(process));
    *active = Some(Active {
        child: child.clone(),
        cancelled: cancelled.clone(),
        training_started: Arc::new(AtomicBool::new(false)),
        request_id: Some(request.clone()),
    });
    drop(active);
    let result = (|| {
        stdin.write_all(&payload).map_err(|e| e.to_string())?;
        stdin.write_all(b"\n").map_err(|e| e.to_string())?;
        drop(stdin);
        let mut reader = BufReader::new(stdout);
        let mut receipt = None;
        let mut total = 0u64;
        let mut frames = 0usize;
        loop {
            let mut line = Vec::new();
            if reader
                .by_ref()
                .take(MAX_JSON + 1)
                .read_until(b'\n', &mut line)
                .map_err(|e| e.to_string())?
                == 0
            {
                break;
            }
            total += line.len() as u64;
            frames += 1;
            if line.len() as u64 > MAX_JSON || total > 2 * MAX_JSON || frames > 128 {
                return Err("CAD response exceeds its resource limit".into());
            }
            let event: Value =
                serde_json::from_slice(&line).map_err(|_| "Malformed CAD worker response")?;
            if receipt.is_some() {
                return Err("Unexpected CAD response after completion".into());
            }
            match event["type"].as_str() {
                Some("complete") => receipt = Some(event["manifest"].clone()),
                Some("error") if event["jobId"] == job => {
                    return Err(format!(
                        "{}: {}",
                        event["code"].as_str().unwrap_or("cad-failed"),
                        event["message"].as_str().unwrap_or("CAD operation failed")
                    ))
                }
                Some("progress") if event["jobId"] == job => (),
                _ => return Err("Unknown CAD worker response".into()),
            }
        }
        let status = loop {
            if let Some(status) = child
                .lock()
                .map_err(|e| e.to_string())?
                .try_wait()
                .map_err(|e| e.to_string())?
            {
                break status;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        };
        if cancelled.load(Ordering::SeqCst) {
            return Err("CAD operation cancelled".into());
        }
        if !status.success() {
            crate::verification::trace_verification(&format!("CAD worker exit: {status}"));
            return Err("The isolated CAD worker stopped; the previous model was preserved".into());
        }
        let receipt = receipt.ok_or("CAD worker returned no geometry")?;
        crate::verification::trace_verification("CAD worker completed");
        if receipt["protocolVersion"] != 1
            || receipt["status"] != "succeeded"
            || receipt["operation"]
                != if sketch_id.is_some() {
                    "solve-sketch"
                } else {
                    "cad"
                }
            || receipt["projectId"] != project["id"]
            || receipt["revision"] != project["revision"]
            || receipt["jobId"] != job
        {
            return Err("CAD geometry ownership mismatch".into());
        }
        if let Some(feature_id) = sketch_id {
            validate_sketch_solution(project, feature_id, &receipt)?;
            return Ok(receipt);
        }
        if receipt["outputFeatureId"] != project["geometry"]["outputFeatureId"]
            || receipt["coordinateFrame"] != "cartesian-global-SI"
        {
            return Err("CAD shape ownership mismatch".into());
        }
        let receipt_bytes = read_bounded(&directory.join("receipt.json"), MAX_JSON)?;
        let stored: Value =
            serde_json::from_slice(&receipt_bytes).map_err(|_| "Invalid CAD artifact metadata")?;
        if stored != receipt {
            return Err("CAD geometry metadata differs from its artifact".into());
        }
        let preview = read_bounded(&directory.join("buffer.bin"), MAX_BLOB)?;
        validate_preview(&receipt, &preview)?;
        let mut total_artifacts = receipt_bytes.len() as u64 + preview.len() as u64;
        for (key, filename) in [
            ("brep", "output.brep"),
            ("step", "output.step"),
            ("stepMm", "output-mm.step"),
        ] {
            let bytes = read_bounded(&directory.join(filename), MAX_BLOB)?;
            total_artifacts = total_artifacts
                .checked_add(bytes.len() as u64)
                .ok_or("CAD artifact size overflow")?;
            if total_artifacts > 2 * MAX_BLOB {
                return Err("CAD artifacts exceed the cumulative 128 MiB limit".into());
            }
            let asset = &receipt["assets"][key];
            let units = if key == "stepMm" { "mm" } else { "m" };
            if asset["filename"] != filename
                || asset["units"] != units
                || asset["byteLength"].as_u64() != Some(bytes.len() as u64)
                || asset["sha256"].as_str() != Some(source_hash(&bytes).as_str())
            {
                return Err("CAD exact geometry artifact failed its integrity check".into());
            }
        }
        Ok(receipt)
    })();
    if result.is_err() {
        if let Ok(mut child) = child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    // Reaped process EOF ends the diagnostic drainer. Retain only a bounded
    // prefix while continuing to drain so verbose kernels cannot deadlock.
    let log_result = diagnostics
        .join()
        .unwrap_or_else(|_| Err("CAD diagnostic reader failed".into()));
    let result = result.and_then(|receipt| log_result.map(|_| receipt));
    // Only a fully validated/drained candidate may enter retained state. Hold
    // cancellation's terminal lock through staging and always release Active.
    let mut active = state.active.lock().map_err(|e| e.to_string())?;
    let result = result.and_then(|receipt| {
        if cancelled.load(Ordering::SeqCst) {
            Err("CAD operation cancelled".into())
        } else {
            publish(receipt)
        }
    });
    active.take();
    crate::verification::trace_verification("CAD worker publication finished");
    result
}

fn validate_sketch_solution(
    project: &Value,
    feature_id: &str,
    receipt: &Value,
) -> Result<(), String> {
    let source = project["geometry"]["features"]
        .as_array()
        .and_then(|features| {
            features
                .iter()
                .find(|feature| feature["id"] == feature_id && feature["kind"] == "sketch")
        })
        .ok_or("Unknown sketch solution input")?;
    if receipt["featureId"] != feature_id
        || receipt["geometryFingerprint"]
            .as_str()
            .is_none_or(|digest| {
                digest.len() != 64 || !digest.bytes().all(|c| c.is_ascii_hexdigit())
            })
    {
        return Err("Sketch solution identity mismatch".into());
    }
    let solved = &receipt["sketch"];
    let source_graph = &source["sketch"];
    for key in ["constraints", "loops"] {
        if solved[key] != source_graph[key] {
            return Err("Sketch solver changed authored relationships".into());
        }
    }
    for key in ["points", "entities"] {
        let before = source_graph[key]
            .as_array()
            .ok_or("Missing authored sketch graph")?;
        let after = solved[key]
            .as_array()
            .ok_or("Missing solved sketch graph")?;
        if before.len() != after.len() {
            return Err("Sketch solver changed graph identity".into());
        }
        for (original, candidate) in before.iter().zip(after) {
            let mut permitted = original.clone();
            if key == "points" {
                permitted["position"] = candidate["position"].clone();
            } else if original["kind"] == "circle" {
                permitted["radius"] = candidate["radius"].clone();
            }
            if permitted != *candidate {
                return Err("Sketch solver changed graph topology".into());
            }
        }
    }
    let mut candidate = project.clone();
    let feature = candidate["geometry"]["features"]
        .as_array_mut()
        .ok_or("Missing CAD graph")?
        .iter_mut()
        .find(|feature| feature["id"] == feature_id)
        .ok_or("Missing sketch input")?;
    feature["sketch"] = solved.clone();
    crate::project::validation::validate_project(&candidate)?;
    let report = &receipt["report"];
    let status = report["status"]
        .as_str()
        .ok_or("Missing sketch solver status")?;
    if !matches!(
        status,
        "solved" | "redundant" | "conflicting" | "nonConverged" | "tooManyUnknowns"
    ) {
        return Err("Unknown sketch solver status".into());
    }
    if matches!(status, "solved" | "redundant") == report["degreesOfFreedom"].is_null() {
        return Err("Sketch status and degrees of freedom disagree".into());
    }
    let dof_limit = source_graph["points"]
        .as_array()
        .map_or(0, |points| points.len() * 2)
        + source_graph["entities"]
            .as_array()
            .map_or(0, |entities| entities.len());
    if !report["degreesOfFreedom"].is_null()
        && report["degreesOfFreedom"]
            .as_u64()
            .is_none_or(|dof| dof > dof_limit as u64)
    {
        return Err("Invalid sketch degrees of freedom".into());
    }
    let constraint_ids: std::collections::HashSet<_> = source_graph["constraints"]
        .as_array()
        .ok_or("Missing sketch constraints")?
        .iter()
        .filter_map(|constraint| constraint["id"].as_str())
        .collect();
    let failed = report["failedConstraintIds"]
        .as_array()
        .ok_or("Missing sketch conflict identities")?;
    let mut unique = std::collections::HashSet::new();
    if failed.iter().any(|id| {
        id.as_str()
            .is_none_or(|id| !constraint_ids.contains(id) || !unique.insert(id))
    }) {
        return Err("Unknown or repeated sketch conflict identity".into());
    }
    if !matches!(status, "solved" | "redundant") && solved != source_graph {
        return Err("Failed sketch solve changed authored geometry".into());
    }
    if report["kernel"]
        .as_str()
        .is_none_or(|name| name.is_empty() || name.len() > 100)
        || report["sourceCommit"].as_str().is_none_or(|commit| {
            commit.len() != 40 || !commit.bytes().all(|c| c.is_ascii_hexdigit())
        })
    {
        return Err("Invalid sketch solver provenance".into());
    }
    Ok(())
}

fn drain_diagnostics(mut input: impl Read, mut log: impl Write) -> Result<(), String> {
    let mut retained = 0usize;
    let mut chunk = [0_u8; 8192];
    loop {
        let count = input.read(&mut chunk).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        let accepted = count.min((MAX_LOG as usize).saturating_sub(retained));
        if accepted > 0 {
            log.write_all(&chunk[..accepted])
                .map_err(|e| e.to_string())?;
            retained += accepted;
        }
    }
    Ok(())
}

fn validate_preview(receipt: &Value, bytes: &[u8]) -> Result<(), String> {
    for collection in ["faces", "edges", "bodies"] {
        let entities = receipt[collection]
            .as_array()
            .ok_or("Missing CAD topology metadata")?;
        if entities.len() > 2048 {
            return Err("CAD topology exceeds its resource limit".into());
        }
        let mut ids = std::collections::HashSet::new();
        for entity in entities {
            let id = entity["id"].as_str().ok_or("Missing CAD entity identity")?;
            if id.len() > 200
                || !ids.insert(id)
                || !matches!(
                    entity["identity"].as_str(),
                    Some("content-reference" | "ambiguous")
                )
            {
                return Err("Invalid CAD entity identity".into());
            }
            let centroid = entity["centroid"]
                .as_array()
                .ok_or("Invalid CAD entity centroid")?;
            let bounds = entity["bounds"]
                .as_array()
                .ok_or("Invalid CAD entity bounds")?;
            if centroid.len() != 3
                || bounds.len() != 2
                || centroid
                    .iter()
                    .any(|v| v.as_f64().is_none_or(|v| !v.is_finite()))
                || bounds.iter().any(|bound| {
                    bound.as_array().is_none_or(|v| {
                        v.len() != 3 || v.iter().any(|v| v.as_f64().is_none_or(|v| !v.is_finite()))
                    })
                })
            {
                return Err("Invalid CAD entity coordinates".into());
            }
        }
    }
    if receipt["byteLength"].as_u64() != Some(bytes.len() as u64)
        || receipt["bufferHash"].as_str() != Some(source_hash(bytes).as_str())
    {
        return Err("CAD preview buffer size or digest mismatch".into());
    }
    let definitions = [
        ("positions", "float64", 3),
        ("triangles", "uint32", 3),
        ("triangleFaces", "uint32", 1),
        ("edgePositions", "float64", 3),
        ("edgeSegments", "uint32", 2),
        ("segmentEdges", "uint32", 1),
    ];
    let mut spans = Vec::new();
    let mut rows = std::collections::HashMap::new();
    for (name, dtype, columns) in definitions {
        let descriptor = &receipt["arrays"][name];
        let shape = descriptor["shape"]
            .as_array()
            .ok_or("Missing CAD array shape")?;
        let count = shape
            .first()
            .and_then(Value::as_u64)
            .ok_or("Invalid CAD array shape")?;
        if (columns == 1 && shape.len() != 1)
            || (columns != 1 && (shape.len() != 2 || shape[1] != columns))
            || count > 300_000
        {
            return Err("CAD preview array shape exceeds its limit".into());
        }
        let element = if dtype == "float64" { 8 } else { 4 };
        let offset = descriptor["offset"]
            .as_u64()
            .ok_or("Missing CAD array offset")?;
        let length = descriptor["byteLength"]
            .as_u64()
            .ok_or("Missing CAD array size")?;
        let end = offset.checked_add(length).ok_or("CAD array overflow")?;
        if descriptor["dtype"] != dtype
            || length != count * columns * element
            || offset % element != 0
            || end > bytes.len() as u64
        {
            return Err("Invalid CAD array layout".into());
        }
        if dtype == "float64"
            && bytes[offset as usize..end as usize]
                .chunks_exact(8)
                .any(|value| !f64::from_le_bytes(value.try_into().unwrap()).is_finite())
        {
            return Err("Nonfinite CAD preview coordinates".into());
        }
        spans.push((offset, end));
        rows.insert(name, count);
    }
    spans.sort();
    if spans.windows(2).any(|pair| pair[0].1 > pair[1].0) {
        return Err("Overlapping CAD preview arrays".into());
    }
    if rows["triangleFaces"] != rows["triangles"] || rows["segmentEdges"] != rows["edgeSegments"] {
        return Err("CAD entity mapping size mismatch".into());
    }
    for (name, entities, limit) in [
        ("triangles", "positions", rows["positions"]),
        ("edgeSegments", "edgePositions", rows["edgePositions"]),
        (
            "triangleFaces",
            "faces",
            receipt["faces"]
                .as_array()
                .ok_or("Missing CAD faces")?
                .len() as u64,
        ),
        (
            "segmentEdges",
            "edges",
            receipt["edges"]
                .as_array()
                .ok_or("Missing CAD edges")?
                .len() as u64,
        ),
    ] {
        let descriptor = &receipt["arrays"][name];
        let offset = descriptor["offset"].as_u64().unwrap() as usize;
        let length = descriptor["byteLength"].as_u64().unwrap() as usize;
        if bytes[offset..offset + length]
            .chunks_exact(4)
            .any(|value| u32::from_le_bytes(value.try_into().unwrap()) as u64 >= limit)
        {
            return Err(format!("CAD preview refers to unavailable {entities}"));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn diagnostics_are_bounded_and_fully_drained() {
        let bytes = vec![b'x'; MAX_LOG as usize * 2];
        let mut input = std::io::Cursor::new(&bytes);
        let mut output = Vec::new();
        drain_diagnostics(&mut input, &mut output).unwrap();
        assert_eq!(output.len() as u64, MAX_LOG);
        assert_eq!(input.position(), bytes.len() as u64);
    }
    fn preview() -> (Value, Vec<u8>) {
        let mut bytes = Vec::new();
        for value in [0_f64, 0., 0., 1., 0., 0., 0., 1., 0.] {
            bytes.extend(value.to_le_bytes());
        }
        for index in [0_u32, 1, 2, 0] {
            bytes.extend(index.to_le_bytes());
        }
        let entity = json!({"id":"face-0","identity":"content-reference","centroid":[0.,0.,0.],"bounds":[[0.,0.,0.],[1.,1.,0.]]});
        (
            json!({"byteLength":bytes.len(),"bufferHash":source_hash(&bytes),"faces":[entity],"edges":[],"bodies":[],"arrays":{
                "positions":{"offset":0,"byteLength":72,"dtype":"float64","shape":[3,3]},
                "triangles":{"offset":72,"byteLength":12,"dtype":"uint32","shape":[1,3]},
                "triangleFaces":{"offset":84,"byteLength":4,"dtype":"uint32","shape":[1]},
                "edgePositions":{"offset":88,"byteLength":0,"dtype":"float64","shape":[0,3]},
                "edgeSegments":{"offset":88,"byteLength":0,"dtype":"uint32","shape":[0,2]},
                "segmentEdges":{"offset":88,"byteLength":0,"dtype":"uint32","shape":[0]}
            }}),
            bytes,
        )
    }
    #[test]
    fn sketch_solutions_preserve_graph_identity_and_validate_actual_diagnostics() {
        let mut project: Value =
            serde_json::from_str(include_str!("../../../examples/cantilever.json")).unwrap();
        project["study"] = Value::Null;
        project["geometry"] = json!({"kind":"cad","dimension":"3d","assets":[],"outputFeatureId":"sketch","features":[{"id":"sketch","name":"Open sketch","kind":"sketch","plane":"xy","sketch":{"points":[{"id":"a","position":[0,0]},{"id":"b","position":[0.1,0.02]}],"entities":[{"id":"line","name":"Line","kind":"line","startId":"a","endId":"b"}],"constraints":[{"id":"h","kind":"horizontal","lineId":"line"}],"loops":[]}}]});
        project["namedSelections"] = json!([]);
        let mut receipt = json!({"featureId":"sketch","geometryFingerprint":"a".repeat(64),"sketch":project["geometry"]["features"][0]["sketch"],"report":{"status":"solved","degreesOfFreedom":3,"failedConstraintIds":[],"kernel":"SolveSpace 3.2","sourceCommit":"b".repeat(40)}});
        receipt["sketch"]["points"][1]["position"] = json!([0.1, 0]);
        validate_sketch_solution(&project, "sketch", &receipt).unwrap();
        for defect in [
            "target",
            "point",
            "reference",
            "constraint",
            "bound",
            "dof",
            "failed",
            "status",
            "provenance",
            "failed-edit",
            "solved-null",
            "conflict-dof",
        ] {
            let mut bad = receipt.clone();
            match defect {
                "target" => bad["featureId"] = json!("another"),
                "point" => bad["sketch"]["points"][0]["id"] = json!("changed"),
                "reference" => bad["sketch"]["entities"][0]["endId"] = json!("a"),
                "constraint" => bad["sketch"]["constraints"] = json!([]),
                "bound" => bad["sketch"]["points"][0]["position"][0] = json!(1001),
                "dof" => bad["report"]["degreesOfFreedom"] = json!(100),
                "failed" => bad["report"]["failedConstraintIds"] = json!(["unknown"]),
                "status" => bad["report"]["status"] = json!("fake"),
                "provenance" => bad["report"]["sourceCommit"] = json!("invented"),
                "solved-null" => bad["report"]["degreesOfFreedom"] = Value::Null,
                "conflict-dof" => {
                    bad["report"]["status"] = json!("conflicting");
                    bad["sketch"] = project["geometry"]["features"][0]["sketch"].clone();
                }
                "failed-edit" => bad["report"]["status"] = json!("conflicting"),
                _ => unreachable!(),
            }
            assert!(
                validate_sketch_solution(&project, "sketch", &bad).is_err(),
                "{defect}"
            );
        }
        receipt["report"]["status"] = json!("conflicting");
        receipt["report"]["degreesOfFreedom"] = Value::Null;
        receipt["report"]["failedConstraintIds"] = json!(["h"]);
        receipt["sketch"] = project["geometry"]["features"][0]["sketch"].clone();
        validate_sketch_solution(&project, "sketch", &receipt).unwrap();
    }
    #[test]
    fn display_integrity_layout_finite_values_and_topology_are_independently_checked() {
        let (receipt, bytes) = preview();
        validate_preview(&receipt, &bytes).unwrap();
        for defect in [
            "digest",
            "overlap",
            "absent-node",
            "absent-face",
            "nan",
            "resource-limit",
            "duplicate-identity",
        ] {
            let mut receipt = receipt.clone();
            let mut bytes = bytes.clone();
            match defect {
                "digest" => {
                    bytes[0] = 1;
                }
                "overlap" => receipt["arrays"]["triangles"]["offset"] = json!(0),
                "absent-node" => {
                    bytes[72..76].copy_from_slice(&3_u32.to_le_bytes());
                }
                "absent-face" => {
                    bytes[84..88].copy_from_slice(&1_u32.to_le_bytes());
                }
                "nan" => {
                    bytes[..8].copy_from_slice(&f64::NAN.to_le_bytes());
                }
                "resource-limit" => receipt["arrays"]["positions"]["shape"][0] = json!(300001),
                "duplicate-identity" => {
                    let entity = receipt["faces"][0].clone();
                    receipt["faces"].as_array_mut().unwrap().push(entity);
                }
                _ => unreachable!(),
            }
            if defect != "digest" {
                receipt["bufferHash"] = json!(source_hash(&bytes));
            }
            assert!(validate_preview(&receipt, &bytes).is_err(), "{defect}");
        }
    }
}
