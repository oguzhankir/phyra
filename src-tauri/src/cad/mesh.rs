//! Bounded inspection meshes are transient CAD artifacts, never accepted exact outputs.
use crate::{
    platform::files::{read_bounded, MAX_BLOB, MAX_JSON},
    project::assets::source_hash,
};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    path::Path,
};

pub(crate) fn validate_target_size(value: f64) -> Result<(), String> {
    if !value.is_finite() || value <= 0.0 || value > 1000.0 {
        return Err("CAD mesh target size must be positive and at most 1000 m".into());
    }
    Ok(())
}

pub(crate) fn require_exact_output(directory: &Path) -> Result<(), String> {
    let bytes = read_bounded(&directory.join("receipt.json"), MAX_JSON)?;
    let receipt: Value = serde_json::from_slice(&bytes).map_err(|_| "Invalid CAD receipt")?;
    if receipt["operation"] != "cad" || receipt["status"] != "succeeded" {
        return Err("Inspection meshes cannot become accepted or exported CAD geometry".into());
    }
    Ok(())
}

fn positive(value: &Value) -> bool {
    value
        .as_f64()
        .is_some_and(|number| number.is_finite() && number > 0.0)
}

fn digest(value: &Value) -> bool {
    value.as_str().is_some_and(|text| {
        text.len() == 64
            && text
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}

fn close(actual: f64, reported: f64) -> bool {
    actual.is_finite()
        && reported.is_finite()
        && (actual - reported).abs()
            <= 1e-9 * actual.abs().max(reported.abs()).max(f64::MIN_POSITIVE)
}

fn floats(bytes: &[u8]) -> Vec<f64> {
    bytes
        .chunks_exact(8)
        .map(|part| f64::from_le_bytes(part.try_into().unwrap()))
        .collect()
}

fn indices(bytes: &[u8]) -> Vec<usize> {
    bytes
        .chunks_exact(4)
        .map(|part| u32::from_le_bytes(part.try_into().unwrap()) as usize)
        .collect()
}

fn subtract(a: &[f64], b: &[f64]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn cross(a: &[f64], b: &[f64]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn validate_correspondence(receipt: &Value, regions: &[Value]) -> Result<(), String> {
    let correspondence = receipt["correspondence"]
        .as_object()
        .ok_or("Missing CAD mesh correspondence evidence")?;
    let verified = match correspondence.get("status").and_then(Value::as_str) {
        Some("verified") => true,
        Some("unavailable") => false,
        _ => return Err("Invalid CAD mesh correspondence status".into()),
    };
    if correspondence.len() != if verified { 3 } else { 4 }
        || receipt["correspondence"]["scope"] != "unchanged-geometry"
        || receipt["correspondence"]["method"] != "exact-brep-round-trip"
        || (verified && correspondence.contains_key("reason"))
        || (!verified
            && receipt["correspondence"]["reason"]
                .as_str()
                .is_none_or(|reason| reason.trim().is_empty() || reason.len() > 500))
    {
        return Err("Invalid CAD mesh correspondence scope or explanation".into());
    }
    let output = receipt["outputFeatureId"]
        .as_str()
        .filter(|id| !id.is_empty() && id.chars().count() <= 100)
        .ok_or("Invalid CAD mesh source feature")?;
    // Match topology.py's bounded owner token. These remain inspection links
    // to this exact geometry; a valid token cannot establish physical support.
    let owner = if output.len() <= 100 {
        output.to_owned()
    } else {
        format!("feature-{}", &source_hash(output.as_bytes())[..24])
    };
    let prefix = format!("{owner}/face/");
    let mut seen = HashSet::new();
    for region in regions {
        if !verified {
            if region.get("cadFaceId").is_some() {
                return Err("Unverified CAD mesh boundaries cannot reference exact faces".into());
            }
            continue;
        }
        let reference = region["cadFaceId"]
            .as_str()
            .filter(|id| id.len() <= 200)
            .ok_or("Verified CAD mesh boundary is missing its source face")?;
        let signature = reference
            .strip_prefix(&prefix)
            .ok_or("CAD mesh face reference belongs to another source feature")?;
        if signature.len() != 24
            || !signature
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            || !seen.insert(reference)
        {
            return Err("CAD mesh face correspondence is ambiguous or duplicated".into());
        }
    }
    Ok(())
}

pub(crate) fn validate(receipt: &Value, bytes: &[u8], target_size: f64) -> Result<(), String> {
    validate_target_size(target_size)?;
    if receipt["protocolVersion"] != 1
        || receipt["operation"] != "mesh-cad"
        || receipt["status"] != "succeeded"
        || receipt["coordinateFrame"] != "cartesian-global-SI"
        || receipt["purpose"] != "inspection-only"
        || receipt["targetSize"].as_f64() != Some(target_size)
        || receipt["mesher"]["name"] != "Gmsh"
        || receipt["mesher"]["element"] != "tetra4"
        || receipt["mesher"]["version"]
            .as_str()
            .is_none_or(|v| v.is_empty() || v.len() > 100)
        || !digest(&receipt["geometryFingerprint"])
        || !digest(&receipt["meshId"])
        || receipt.get("analysisCompatibility").is_some()
        || receipt.get("assets").is_some()
    {
        return Err("Invalid CAD mesh inspection identity or purpose".into());
    }
    if bytes.len() as u64 > MAX_BLOB
        || receipt["byteLength"].as_u64() != Some(bytes.len() as u64)
        || receipt["bufferHash"].as_str() != Some(source_hash(bytes).as_str())
    {
        return Err("CAD mesh buffer size or digest mismatch".into());
    }
    let definitions = [
        ("positions", "float64", 3, 12_000, "node", "m"),
        ("cells", "uint32", 4, 50_000, "cell", "1"),
        ("surface", "uint32", 3, 100_000, "triangle", "1"),
        ("surfaceRegions", "uint32", 1, 100_000, "triangle", "1"),
        ("surfaceCells", "uint32", 1, 100_000, "triangle", "1"),
        ("quality", "float64", 1, 50_000, "cell", "1"),
    ];
    if receipt["arrays"]
        .as_object()
        .is_none_or(|arrays| arrays.len() != definitions.len())
    {
        return Err("Unexpected CAD mesh arrays".into());
    }
    let mut rows = HashMap::new();
    let mut arrays = HashMap::new();
    let mut previous_end = 0;
    for (name, dtype, columns, limit, association, units) in definitions {
        let descriptor = &receipt["arrays"][name];
        let shape = descriptor["shape"]
            .as_array()
            .ok_or("Missing CAD mesh array shape")?;
        let count = shape
            .first()
            .and_then(Value::as_u64)
            .ok_or("Invalid CAD mesh shape")?;
        let element = if dtype == "float64" { 8 } else { 4 };
        let offset = descriptor["offset"]
            .as_u64()
            .ok_or("Missing CAD mesh array offset")?;
        let length = descriptor["byteLength"]
            .as_u64()
            .ok_or("Missing CAD mesh array size")?;
        let end = offset
            .checked_add(length)
            .ok_or("CAD mesh array overflow")?;
        if count == 0
            || count > limit
            || (columns == 1 && shape.len() != 1)
            || (columns != 1 && (shape.len() != 2 || shape[1] != columns))
            || descriptor["dtype"] != dtype
            || descriptor["association"] != association
            || descriptor["units"] != units
            || length != count * columns * element
            || offset % 8 != 0
            || offset < previous_end
            || offset - previous_end >= 8
            || end > bytes.len() as u64
        {
            return Err("Invalid CAD mesh array layout or resource limit".into());
        }
        let array = &bytes[offset as usize..end as usize];
        if dtype == "float64" && floats(array).iter().any(|value| !value.is_finite()) {
            return Err("Nonfinite CAD mesh array values".into());
        }
        rows.insert(name, count);
        arrays.insert(name, array);
        previous_end = end;
    }
    if previous_end != bytes.len() as u64
        || rows["quality"] != rows["cells"]
        || rows["surfaceRegions"] != rows["surface"]
        || rows["surfaceCells"] != rows["surface"]
    {
        return Err("CAD mesh array sizes disagree".into());
    }
    let mut mesh_bytes = arrays["positions"].to_vec();
    mesh_bytes.extend_from_slice(arrays["cells"]);
    if receipt["meshId"].as_str() != Some(source_hash(&mesh_bytes).as_str()) {
        return Err("CAD mesh identity differs from its discretization".into());
    }
    let regions = receipt["regions"]
        .as_array()
        .ok_or("Missing CAD mesh regions")?;
    if regions.is_empty() || regions.len() > 2048 {
        return Err("CAD mesh boundary region limit exceeded".into());
    }
    validate_correspondence(receipt, regions)?;
    for (index, region) in regions.iter().enumerate() {
        if region["id"] != format!("mesh-face-{}", index + 1)
            || region["identity"] != "mesh-scoped"
            || region["name"]
                .as_str()
                .is_none_or(|name| name.is_empty() || name.len() > 200)
            || !positive(&region["area"])
            || region["triangleCount"]
                .as_u64()
                .is_none_or(|count| count == 0 || count > rows["surface"])
        {
            return Err("Invalid mesh-scoped CAD boundary region".into());
        }
    }
    for (name, limit) in [
        ("cells", rows["positions"]),
        ("surface", rows["positions"]),
        ("surfaceRegions", regions.len() as u64),
        ("surfaceCells", rows["cells"]),
    ] {
        if indices(arrays[name])
            .iter()
            .any(|&index| index as u64 >= limit)
        {
            return Err("CAD mesh connectivity refers to an unavailable entity".into());
        }
    }
    let stats = &receipt["statistics"];
    for (field, count) in [
        ("nodes", rows["positions"]),
        ("cells", rows["cells"]),
        ("surfaceTriangles", rows["surface"]),
        ("boundaryRegions", regions.len() as u64),
    ] {
        if stats[field].as_u64() != Some(count) {
            return Err("CAD mesh statistics disagree with array counts".into());
        }
    }
    for field in [
        "exactVolume",
        "meshVolume",
        "exactSurfaceArea",
        "meshSurfaceArea",
        "minQuality",
        "maxQuality",
        "meanQuality",
    ] {
        if !positive(&stats[field]) {
            return Err("Invalid CAD mesh measurements".into());
        }
    }
    if stats["relativeVolumeError"]
        .as_f64()
        .is_none_or(|value| !value.is_finite() || value < 0.0)
    {
        return Err("Invalid CAD mesh volume error".into());
    }
    let positions = floats(arrays["positions"]);
    let cells = indices(arrays["cells"]);
    let surface = indices(arrays["surface"]);
    let surface_cells = indices(arrays["surfaceCells"]);
    let surface_regions = indices(arrays["surfaceRegions"]);
    let quality = floats(arrays["quality"]);
    if quality.iter().any(|&q| q <= 0.0 || q > 1.0 + 1e-12) {
        return Err("Invalid tetrahedron mean-ratio quality".into());
    }
    let point = |index: usize| &positions[index * 3..index * 3 + 3];
    let mut volume = 0.0;
    let mut faces: HashMap<[usize; 3], (usize, usize)> = HashMap::new();
    for (index, cell) in cells.chunks_exact(4).enumerate() {
        let a = subtract(point(cell[1]), point(cell[0]));
        let b = subtract(point(cell[2]), point(cell[0]));
        let c = subtract(point(cell[3]), point(cell[0]));
        let normal = cross(&a, &b);
        let value = normal.iter().zip(c).map(|(x, y)| x * y).sum::<f64>() / 6.0;
        if !value.is_finite() || value <= 0.0 {
            return Err("CAD inspection mesh contains a nonpositive tetrahedron".into());
        }
        volume += value;
        for omitted in 0..4 {
            let mut face = [0; 3];
            let mut cursor = 0;
            for (local, node) in cell.iter().enumerate() {
                if local != omitted {
                    face[cursor] = *node;
                    cursor += 1;
                }
            }
            face.sort_unstable();
            let entry = faces.entry(face).or_insert((0, index));
            entry.0 += 1;
            if entry.0 > 2 {
                return Err("CAD mesh contains a nonmanifold tetrahedron face".into());
            }
        }
    }
    let mut region_counts = vec![0u64; regions.len()];
    let mut region_areas = vec![0.0; regions.len()];
    let mut seen = HashSet::new();
    for (index, triangle) in surface.chunks_exact(3).enumerate() {
        let cell = &cells[surface_cells[index] * 4..surface_cells[index] * 4 + 4];
        let mut key: [usize; 3] = triangle.try_into().unwrap();
        key.sort_unstable();
        if !seen.insert(key) || faces.get(&key) != Some(&(1, surface_cells[index])) {
            return Err("CAD mesh surface is not a face of its owning tetrahedron".into());
        }
        let normal = cross(
            &subtract(point(triangle[1]), point(triangle[0])),
            &subtract(point(triangle[2]), point(triangle[0])),
        );
        let area = normal.iter().map(|value| value * value).sum::<f64>().sqrt() / 2.0;
        if !area.is_finite() || area <= 0.0 {
            return Err("CAD mesh contains a degenerate surface triangle".into());
        }
        let opposite = *cell
            .iter()
            .find(|node| !triangle.contains(node))
            .ok_or("CAD mesh face has no opposite node")?;
        let interior = subtract(point(opposite), point(triangle[0]));
        if normal.iter().zip(interior).map(|(a, b)| a * b).sum::<f64>() >= 0.0 {
            return Err("CAD mesh surface orientation points into the solid".into());
        }
        region_counts[surface_regions[index]] += 1;
        region_areas[surface_regions[index]] += area;
    }
    if seen.len() != faces.values().filter(|(count, _)| *count == 1).count() {
        return Err("CAD mesh surface omits an exterior tetrahedron face".into());
    }
    for (index, region) in regions.iter().enumerate() {
        if region["triangleCount"].as_u64() != Some(region_counts[index])
            || !close(region_areas[index], region["area"].as_f64().unwrap())
        {
            return Err("CAD mesh region measurements disagree with their triangles".into());
        }
    }
    let exact = stats["exactVolume"].as_f64().unwrap();
    // A dimensionless difference may be near zero; independent determinant
    // arithmetic can differ by float64 roundoff even when volumes agree.
    if ((volume - exact).abs() / exact - stats["relativeVolumeError"].as_f64().unwrap()).abs()
        > 1e-9
    {
        return Err("CAD mesh relative volume error differs from its arrays".into());
    }
    for (field, actual) in [
        ("meshVolume", volume),
        ("meshSurfaceArea", region_areas.iter().sum()),
        (
            "minQuality",
            quality.iter().copied().fold(f64::INFINITY, f64::min),
        ),
        (
            "maxQuality",
            quality.iter().copied().fold(f64::NEG_INFINITY, f64::max),
        ),
        (
            "meanQuality",
            quality.iter().sum::<f64>() / quality.len() as f64,
        ),
    ] {
        if !close(actual, stats[field].as_f64().unwrap()) {
            return Err(format!("CAD mesh {field} differs from its arrays"));
        }
    }
    let bounds = stats["bounds"]
        .as_array()
        .ok_or("Missing CAD mesh bounds")?;
    if bounds.len() != 2
        || bounds.iter().any(|row| {
            row.as_array().is_none_or(|row| {
                row.len() != 3
                    || row
                        .iter()
                        .any(|value| value.as_f64().is_none_or(|value| !value.is_finite()))
            })
        })
    {
        return Err("Invalid CAD mesh bounds".into());
    }
    for (axis, lower) in bounds[0].as_array().unwrap().iter().enumerate() {
        let min = positions
            .iter()
            .skip(axis)
            .step_by(3)
            .copied()
            .fold(f64::INFINITY, f64::min);
        let max = positions
            .iter()
            .skip(axis)
            .step_by(3)
            .copied()
            .fold(f64::NEG_INFINITY, f64::max);
        if !close(min, lower.as_f64().unwrap()) || !close(max, bounds[1][axis].as_f64().unwrap()) {
            return Err("CAD mesh bounds differ from its nodes".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture() -> (Value, Vec<u8>) {
        let mut bytes = Vec::new();
        for value in [0_f64, 0., 0., 1., 0., 0., 0., 1., 0., 0., 0., 1.] {
            bytes.extend(value.to_le_bytes());
        }
        for value in [0_u32, 1, 2, 3] {
            bytes.extend(value.to_le_bytes());
        }
        let mesh_id = source_hash(&bytes);
        for value in [
            1_u32, 2, 3, 0, 3, 2, 0, 1, 3, 0, 2, 1, 0, 1, 2, 3, 0, 0, 0, 0,
        ] {
            bytes.extend(value.to_le_bytes());
        }
        let quality = 12.0 * 0.5_f64.powf(2.0 / 3.0) / 9.0;
        bytes.extend(quality.to_le_bytes());
        let area = 1.5 + 3_f64.sqrt() / 2.0;
        let regions = (0..4).map(|index| json!({"id":format!("mesh-face-{}",index+1),"name":format!("Surface {}",index+1),"identity":"mesh-scoped","cadFaceId":format!("output/face/{index:024x}"),"triangleCount":1,"area":if index == 0 {3_f64.sqrt()/2.0} else {0.5}})).collect::<Vec<_>>();
        (
            json!({"protocolVersion":1,"operation":"mesh-cad","status":"succeeded","purpose":"inspection-only","coordinateFrame":"cartesian-global-SI","geometryFingerprint":"a".repeat(64),"outputFeatureId":"output","correspondence":{"status":"verified","scope":"unchanged-geometry","method":"exact-brep-round-trip"},"meshId":mesh_id,"targetSize":0.1,"mesher":{"name":"Gmsh","version":"4.test-fixture","element":"tetra4"},"byteLength":bytes.len(),"bufferHash":source_hash(&bytes),"regions":regions,
            "arrays":{
                "positions":{"offset":0,"byteLength":96,"dtype":"float64","shape":[4,3],"association":"node","units":"m"},
                "cells":{"offset":96,"byteLength":16,"dtype":"uint32","shape":[1,4],"association":"cell","units":"1"},
                "surface":{"offset":112,"byteLength":48,"dtype":"uint32","shape":[4,3],"association":"triangle","units":"1"},
                "surfaceRegions":{"offset":160,"byteLength":16,"dtype":"uint32","shape":[4],"association":"triangle","units":"1"},
                "surfaceCells":{"offset":176,"byteLength":16,"dtype":"uint32","shape":[4],"association":"triangle","units":"1"},
                "quality":{"offset":192,"byteLength":8,"dtype":"float64","shape":[1],"association":"cell","units":"1"}},
            "statistics":{"nodes":4,"cells":1,"surfaceTriangles":4,"boundaryRegions":4,"exactVolume":1.0/6.0,"meshVolume":1.0/6.0,"relativeVolumeError":0.0,"exactSurfaceArea":area,"meshSurfaceArea":area,"minQuality":quality,"maxQuality":quality,"meanQuality":quality,"bounds":[[0,0,0],[1,1,1]]}}),
            bytes,
        )
    }

    #[test]
    fn inspection_mesh_validates_geometry_and_transport_against_an_independent_tetrahedron() {
        let (receipt, bytes) = fixture();
        validate(&receipt, &bytes, 0.1).unwrap();
        for defect in [
            "purpose",
            "target",
            "units",
            "association",
            "layout",
            "limit",
            "mesh-id",
            "region",
            "region-area",
            "volume",
            "quality-summary",
            "bounds",
            "eligibility",
            "export",
        ] {
            let mut bad = receipt.clone();
            match defect {
                "purpose" => bad["purpose"] = json!("analysis"),
                "target" => bad["targetSize"] = json!(0.2),
                "units" => bad["arrays"]["positions"]["units"] = json!("mm"),
                "association" => bad["arrays"]["surfaceCells"]["association"] = json!("node"),
                "layout" => bad["arrays"]["cells"]["offset"] = json!(0),
                "limit" => bad["arrays"]["positions"]["shape"][0] = json!(12_001),
                "mesh-id" => bad["meshId"] = json!("b".repeat(64)),
                "region" => bad["regions"][0]["identity"] = json!("content-reference"),
                "region-area" => bad["regions"][0]["area"] = json!(1),
                "volume" => bad["statistics"]["meshVolume"] = json!(0.2),
                "quality-summary" => bad["statistics"]["meanQuality"] = json!(1),
                "bounds" => bad["statistics"]["bounds"][1][0] = json!(2),
                "eligibility" => bad["analysisCompatibility"] = json!({"state":"supported"}),
                "export" => bad["assets"] = json!({}),
                _ => unreachable!(),
            }
            assert!(validate(&bad, &bytes, 0.1).is_err(), "{defect}");
        }
    }

    #[test]
    fn integrity_hashes_do_not_hide_invalid_cells_or_surface_ownership() {
        for defect in [
            "nan",
            "missing-node",
            "inverted-cell",
            "inward-face",
            "duplicate-face",
            "missing-region",
            "missing-cell",
            "quality",
        ] {
            let (mut receipt, mut bytes) = fixture();
            match defect {
                "nan" => bytes[0..8].copy_from_slice(&f64::NAN.to_le_bytes()),
                "missing-node" => bytes[96..100].copy_from_slice(&4_u32.to_le_bytes()),
                "inverted-cell" => {
                    bytes[96..100].copy_from_slice(&1_u32.to_le_bytes());
                    bytes[100..104].copy_from_slice(&0_u32.to_le_bytes());
                }
                "inward-face" => {
                    bytes[116..120].copy_from_slice(&3_u32.to_le_bytes());
                    bytes[120..124].copy_from_slice(&2_u32.to_le_bytes());
                }
                "duplicate-face" => bytes.copy_within(112..124, 124),
                "missing-region" => bytes[160..164].copy_from_slice(&4_u32.to_le_bytes()),
                "missing-cell" => bytes[176..180].copy_from_slice(&1_u32.to_le_bytes()),
                "quality" => bytes[192..200].copy_from_slice(&0_f64.to_le_bytes()),
                _ => unreachable!(),
            }
            receipt["meshId"] = json!(source_hash(&bytes[..112]));
            receipt["bufferHash"] = json!(source_hash(&bytes));
            assert!(validate(&receipt, &bytes, 0.1).is_err(), "{defect}");
        }
    }

    #[test]
    fn invalid_sizes_do_not_reach_the_native_mesher() {
        for size in [f64::NAN, f64::INFINITY, 0.0, -0.1, 1000.1] {
            assert!(validate_target_size(size).is_err());
        }
        assert!(validate_target_size(0.001).is_ok());
    }

    #[test]
    fn face_correspondence_requires_complete_unique_source_owned_evidence() {
        let (receipt, bytes) = fixture();
        for defect in [
            "missing-evidence",
            "unknown-status",
            "scope",
            "method",
            "reason-on-success",
            "extra-field",
            "missing-face",
            "duplicate-face",
            "another-feature",
            "ambiguous-face",
            "invalid-signature",
            "invalid-fingerprint",
        ] {
            let mut bad = receipt.clone();
            match defect {
                "missing-evidence" => {
                    bad.as_object_mut().unwrap().remove("correspondence");
                }
                "unknown-status" => bad["correspondence"]["status"] = json!("matched"),
                "scope" => bad["correspondence"]["scope"] = json!("persistent"),
                "method" => bad["correspondence"]["method"] = json!("nearest-face"),
                "reason-on-success" => bad["correspondence"]["reason"] = json!("partial"),
                "extra-field" => bad["correspondence"]["approved"] = json!(true),
                "missing-face" => {
                    bad["regions"][0]
                        .as_object_mut()
                        .unwrap()
                        .remove("cadFaceId");
                }
                "duplicate-face" => {
                    bad["regions"][1]["cadFaceId"] = bad["regions"][0]["cadFaceId"].clone();
                }
                "another-feature" => {
                    bad["regions"][0]["cadFaceId"] =
                        json!(format!("other/face/{}", "a".repeat(24)));
                }
                "ambiguous-face" => {
                    bad["regions"][0]["cadFaceId"] =
                        json!(format!("output/face/{}/ambiguous-1", "a".repeat(24)));
                }
                "invalid-signature" => {
                    bad["regions"][0]["cadFaceId"] =
                        json!(format!("output/face/{}", "G".repeat(24)));
                }
                "invalid-fingerprint" => bad["geometryFingerprint"] = json!("not-a-digest"),
                _ => unreachable!(),
            }
            assert!(validate(&bad, &bytes, 0.1).is_err(), "{defect}");
        }
    }

    #[test]
    fn unavailable_correspondence_preserves_mesh_without_suggesting_exact_face_identity() {
        let (mut receipt, bytes) = fixture();
        receipt["correspondence"] = json!({"status":"unavailable","scope":"unchanged-geometry","method":"exact-brep-round-trip","reason":"The exact face round trip did not preserve a unique correspondence."});
        assert!(validate(&receipt, &bytes, 0.1).is_err());
        for region in receipt["regions"].as_array_mut().unwrap() {
            region.as_object_mut().unwrap().remove("cadFaceId");
        }
        validate(&receipt, &bytes, 0.1).unwrap();
        for reason in [Value::Null, json!("  "), json!("a".repeat(501))] {
            let mut bad = receipt.clone();
            bad["correspondence"]["reason"] = reason;
            assert!(validate(&bad, &bytes, 0.1).is_err());
        }
        receipt["regions"][0]["cadFaceId"] = Value::Null;
        assert!(validate(&receipt, &bytes, 0.1).is_err());
    }

    #[test]
    fn unicode_source_feature_uses_the_same_bounded_content_owner_as_the_kernel() {
        let (mut receipt, bytes) = fixture();
        let output = "部".repeat(60);
        receipt["outputFeatureId"] = json!(output);
        let owner = format!("feature-{}", &source_hash(output.as_bytes())[..24]);
        for (index, region) in receipt["regions"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .enumerate()
        {
            region["cadFaceId"] = json!(format!("{owner}/face/{index:024x}"));
        }
        validate(&receipt, &bytes, 0.1).unwrap();
        receipt["regions"][0]["cadFaceId"] = json!(format!("{output}/face/{}", "a".repeat(24)));
        assert!(validate(&receipt, &bytes, 0.1).is_err());
    }
}
