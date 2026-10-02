use super::fields::array_values;
use crate::{
    execution::state::{owned_document_directory, EngineState},
    platform::files::{read_bounded, MAX_BLOB, MAX_JSON},
    project::state::{document_identity, ProjectState},
};
use serde_json::Value;
use std::io::Write;
use tauri::Manager;
#[tauri::command]
pub(crate) async fn export_results(
    app: tauri::AppHandle,
    job_id: String,
    document_id: Option<String>,
    owner_id: Option<String>,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<EngineState>();
        let document = document_identity(document_id.as_deref())?;
        let project_state = app.state::<ProjectState>();
        let documents = project_state.documents.lock().map_err(|e| e.to_string())?;
        documents.require_owner(owner_id.as_deref())?;
        documents.require_open(document)?;
        let directory = owned_document_directory(&state, document, &job_id)?;
        let manifest: Value =
            serde_json::from_slice(&read_bounded(&directory.join("manifest.json"), MAX_JSON)?)
                .map_err(|e| e.to_string())?;
        let operation = manifest["operation"].as_str().unwrap_or("");
        if !matches!(operation, "solve" | "train" | "compare") || manifest["jobId"] != job_id {
            return Err("Complete the current owned study before exporting results".into());
        }
        let Some(path) = rfd::FileDialog::new()
            .add_filter("CSV result tables", &["csv"])
            .set_file_name("results.csv")
            .save_file()
        else {
            return Ok(None);
        };
        let bytes = read_bounded(&directory.join("buffer.bin"), MAX_BLOB)?;
        if manifest["byteLength"].as_u64() != Some(bytes.len() as u64) {
            return Err("Exported binary length does not match metadata".into());
        }
        write_result_csv(&path, &manifest, &bytes)?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())?
}

// Shared by native export and packaged workflow verification.
pub(crate) fn write_result_csv(
    path: &std::path::Path,
    manifest: &Value,
    bytes: &[u8],
) -> Result<(), String> {
    let operation = manifest["operation"].as_str().unwrap_or("");
    if !matches!(operation, "solve" | "train" | "compare")
        || manifest["byteLength"].as_u64() != Some(bytes.len() as u64)
    {
        return Err("Invalid solved export metadata or binary length".into());
    }
    let positions = array_values(manifest, bytes, "positions")?;
    let cells = array_values(manifest, bytes, "cells")?;
    let cell_width = if manifest["dimension"] == "2d" { 3 } else { 4 };
    if cells
        .iter()
        .any(|index| *index >= (positions.len() / 3) as f64)
    {
        return Err("Exported cell references an absent node".into());
    }
    let parent = path.parent().ok_or("Invalid export destination")?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    writeln!(
        file,
        "# Phyra; project={}; study={}; fingerprint={}; mesh={}; job={}",
        manifest["projectId"],
        manifest["studyId"],
        manifest["fingerprint"],
        manifest["meshId"],
        manifest["jobId"]
    )
    .map_err(|e| e.to_string())?;
    if manifest["reference"].is_object() {
        writeln!(file, "# independentReference={}", manifest["reference"])
            .map_err(|e| e.to_string())?;
    }
    if operation == "compare" {
        writeln!(file, "# comparison={}", manifest["comparison"]).map_err(|e| e.to_string())?;
    }
    let mut datasets = vec![(
        if operation == "train" { "PINN" } else { "FEM" },
        "displacement",
        "reactions",
        "stress",
        "vonMises",
    )];
    if operation == "compare" {
        datasets.push((
            "PINN",
            "pinnDisplacement",
            "pinnReactions",
            "pinnStress",
            "pinnVonMises",
        ));
    }
    for (solver, u_name, reaction_name, stress_name, vm_name) in datasets {
        let displacement = array_values(manifest, bytes, u_name)?;
        let reactions = array_values(manifest, bytes, reaction_name)?;
        let stresses = array_values(manifest, bytes, stress_name)?;
        let vm = array_values(manifest, bytes, vm_name)?;
        writeln!(
            file,
            "solver,association,entity,x_m,y_m,z_m,ux_m,uy_m,uz_m,rx_N,ry_N,rz_N"
        )
        .map_err(|e| e.to_string())?;
        for (node, xyz) in positions.chunks_exact(3).enumerate() {
            let u = &displacement[node * 3..node * 3 + 3];
            let r = &reactions[node * 3..node * 3 + 3];
            writeln!(
                file,
                "{solver},node,{node},{},{},{},{},{},{},{},{},{}",
                xyz[0], xyz[1], xyz[2], u[0], u[1], u[2], r[0], r[1], r[2]
            )
            .map_err(|e| e.to_string())?;
        }
        writeln!(file, "solver,association,entity,node0,node1,node2,node3,sxx_Pa,syy_Pa,szz_Pa,sxy_Pa,syz_Pa,sxz_Pa,vonMises_Pa")
            .map_err(|e| e.to_string())?;
        for (cell, nodes) in cells.chunks_exact(cell_width).enumerate() {
            let fourth = if cell_width == 4 {
                nodes[3].to_string()
            } else {
                String::new()
            };
            let s = &stresses[cell * 6..cell * 6 + 6];
            writeln!(
                file,
                "{solver},cell,{cell},{},{},{},{fourth},{},{},{},{},{},{},{}",
                nodes[0], nodes[1], nodes[2], s[0], s[1], s[2], s[3], s[4], s[5], vm[cell]
            )
            .map_err(|e| e.to_string())?;
        }
    }
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}
