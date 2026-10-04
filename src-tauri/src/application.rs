use crate::{
    assistant::{self, AssistantState},
    execution::{
        self,
        state::{stop_owned, EngineState},
    },
    project::{self, state::ProjectState},
    results,
    verification::{
        self, finish_verification, trace_verification, verification_enabled,
        verification_uses_training, VERIFICATION_DONE,
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
                        if verification_uses_training() {
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
        .manage(AssistantState::default())
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
            assistant::commands::assistant_get_settings,
            assistant::commands::assistant_save_settings,
            assistant::commands::assistant_save_connection,
            assistant::commands::assistant_refresh_connection,
            assistant::commands::assistant_store_credential,
            assistant::commands::assistant_delete_credential,
            assistant::commands::assistant_disconnect,
            assistant::commands::assistant_credential_present,
            assistant::commands::assistant_list_models,
            assistant::commands::assistant_stream,
            assistant::commands::assistant_cancel,
            assistant::commands::assistant_list_conversations,
            assistant::commands::assistant_read_conversation,
            assistant::commands::assistant_write_conversation,
            assistant::commands::assistant_delete_conversation,
            assistant::commands::assistant_publish_snapshot,
            assistant::commands::assistant_configure_mcp,
            assistant::mcp::assistant_open_mcp_client,
            assistant::commands::assistant_mcp_audit,
            assistant::commands::assistant_release_session,
            assistant::references::assistant_open_reference,
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
            assistant::stop_owned(&app.state::<AssistantState>());
        }
    });
}
