use crate::{
    execution::{
        self,
        state::{stop_owned, EngineState},
    },
    project::{self, state::ProjectState},
    results,
    verification::{
        self, finish_verification, trace_verification, verification_configuration,
        verification_enabled, VERIFICATION_DONE,
    },
};
use serde_json::json;
use std::sync::atomic::Ordering;
use tauri::Manager;
pub(crate) fn run() {
    trace_verification("native-startup");
    let application = tauri::Builder::default()
        .on_page_load(|webview, payload| {
            trace_verification(&format!(
                "page-load:{:?}:{}:{}",
                payload.event(),
                webview.label(),
                payload.url()
            ));
        })
        .setup(|app| {
            trace_verification("native-setup");
            if verification_enabled() {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(
                        if verification_configuration() == Some("2d-compare") {
                            240
                        } else {
                            75
                        },
                    ));
                    if !VERIFICATION_DONE.load(Ordering::SeqCst) {
                        trace_verification("verification-watchdog-expired");
                        stop_owned(&handle.state::<EngineState>());
                        let _ = finish_verification(
                            &handle,
                            json!({"error":"Native desktop workflow timed out before completion"}),
                        );
                    }
                });
            }
            Ok(())
        })
        .manage(EngineState::default())
        .manage(ProjectState::default())
        .manage(project::recovery::RecoveryState::default())
        .invoke_handler(tauri::generate_handler![
            execution::commands::run_job,
            execution::commands::get_devices,
            execution::commands::cancel_job,
            execution::commands::read_buffer,
            project::commands::open_project,
            project::commands::save_project,
            project::commands::close_project,
            project::recovery::get_recovery,
            project::recovery::write_recovery,
            project::recovery::read_recovery,
            project::recovery::clear_recovery,
            results::export::export_results,
            verification::verification_mode,
            verification::verification_configuration,
            verification::verification_trace,
            verification::verification_complete
        ])
        .build(tauri::generate_context!())
        .expect("Unable to start Phyra");
    trace_verification("native-built");
    application.run(|app, event| {
        if matches!(event, tauri::RunEvent::Ready) {
            trace_verification("native-ready");
        }
        if matches!(event, tauri::RunEvent::Exit) {
            stop_owned(&app.state::<EngineState>());
        }
    });
}
