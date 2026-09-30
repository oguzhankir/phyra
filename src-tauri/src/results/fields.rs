use serde_json::{json, Value};
pub(crate) fn array_values(manifest: &Value, bytes: &[u8], name: &str) -> Result<Vec<f64>, String> {
    let (dtype, association, width, units) = match name {
        "positions" | "displacement" | "pinnDisplacement" => ("float64", "node", 3usize, "m"),
        "reactions" | "pinnReactions" => ("float64", "node", 3, "N"),
        "cells" => (
            "uint32",
            "cell",
            if manifest["dimension"] == "2d" { 3 } else { 4 },
            "1",
        ),
        "stress" | "pinnStress" => ("float64", "cell", 6, "Pa"),
        "vonMises" | "pinnVonMises" => ("float64", "cell", 1, "Pa"),
        _ => return Err("Unsupported exported field".into()),
    };
    let count_key = if association == "node" {
        "nodes"
    } else {
        "cells"
    };
    let count = manifest["statistics"][count_key]
        .as_u64()
        .ok_or("Missing field entity count")?;
    let maximum = if association == "node" {
        12_000
    } else {
        50_000
    };
    if count == 0 || count > maximum {
        return Err("Invalid exported entity count".into());
    }
    let descriptor = &manifest["arrays"][name];
    let shape = if width == 1 {
        json!([count])
    } else {
        json!([count, width])
    };
    if descriptor["dtype"] != dtype
        || descriptor["association"] != association
        || descriptor["units"] != units
        || descriptor["shape"] != shape
    {
        return Err("Exported field dimensions or units are invalid".into());
    }
    let offset = usize::try_from(
        descriptor["offset"]
            .as_u64()
            .ok_or("Missing field offset")?,
    )
    .map_err(|_| "Field offset overflow")?;
    let length = usize::try_from(
        descriptor["byteLength"]
            .as_u64()
            .ok_or("Missing field length")?,
    )
    .map_err(|_| "Field length overflow")?;
    let item_size = if dtype == "float64" { 8usize } else { 4usize };
    let expected = (count as usize)
        .checked_mul(width)
        .and_then(|n| n.checked_mul(item_size))
        .ok_or("Field dimensions overflow")?;
    if offset % 8 != 0 || length != expected {
        return Err("Invalid exported field byte range".into());
    }
    let data = bytes
        .get(offset..offset.checked_add(length).ok_or("Field overflow")?)
        .ok_or("Invalid field bounds")?;
    let values: Vec<f64> = if dtype == "float64" {
        data.chunks_exact(8)
            .map(|b| f64::from_le_bytes(b.try_into().unwrap()))
            .collect()
    } else {
        data.chunks_exact(4)
            .map(|b| u32::from_le_bytes(b.try_into().unwrap()) as f64)
            .collect()
    };
    if values.iter().any(|value| !value.is_finite()) {
        return Err("Exported field contains nonfinite values".into());
    }
    Ok(values)
}
