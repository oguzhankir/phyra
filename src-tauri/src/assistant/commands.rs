use super::{mcp, providers, storage, types::*, AssistantState, Published};
use tauri::{ipc::Channel, State};
use zeroize::Zeroizing;
#[tauri::command]
pub fn assistant_get_settings(
    app: tauri::AppHandle,
    state: State<'_, AssistantState>,
) -> Result<Configuration, String> {
    let _lock = state
        .storage_lock
        .lock()
        .map_err(|_| "Assistant storage lock is unavailable")?;
    let settings = storage::read_settings(&storage::directory(&app)?)?;
    let credential_present = storage::credential(&settings)?.is_some();
    Ok(Configuration {
        settings,
        credential_present,
    })
}
#[tauri::command]
pub fn assistant_save_settings(
    app: tauri::AppHandle,
    state: State<'_, AssistantState>,
    settings: Settings,
) -> Result<Configuration, String> {
    let _lock = state
        .storage_lock
        .lock()
        .map_err(|_| "Assistant storage lock is unavailable")?;
    providers::validate_settings(&settings, false)?;
    let credential_present = storage::credential(&settings)?.is_some();
    storage::write_settings(&storage::directory(&app)?, settings.clone())?;
    Ok(Configuration {
        settings,
        credential_present,
    })
}
#[tauri::command]
pub fn assistant_store_credential(settings: Settings, credential: String) -> Result<(), String> {
    storage::store_credential(&settings, Zeroizing::new(credential))
}
#[tauri::command]
pub fn assistant_delete_credential(settings: Settings) -> Result<(), String> {
    providers::validate_settings(&settings, false)?;
    storage::delete_credential(&settings)
}
#[tauri::command]
pub async fn assistant_list_models(
    state: State<'_, AssistantState>,
    settings: Settings,
) -> Result<Vec<Model>, String> {
    let _permit = state
        .network
        .try_acquire()
        .map_err(|_| "Assistant connections are busy; cancel a request before connecting again")?;
    tokio::time::timeout(
        std::time::Duration::from_secs(60),
        providers::list_models(&settings),
    )
    .await
    .map_err(|_| "Provider model discovery timed out")?
}
#[tauri::command]
pub async fn assistant_stream(
    state: State<'_, AssistantState>,
    request: Request,
    channel: Channel<Event>,
) -> Result<Completion, String> {
    let _permit = state
        .network
        .try_acquire()
        .map_err(|_| "Assistant connections are busy; cancel a request before sending again")?;
    request.validate()?;
    providers::validate_settings(&request.settings, true)?;
    let cancel = state
        .streams
        .lock()
        .map_err(|_| "Assistant ownership is unavailable")?
        .begin(&request.request_id, &request.session_id)?;
    let mut sequence = 0u64;
    let mut send = |kind: &'static str,
                    text: Option<String>,
                    usage: Option<Usage>,
                    message: Option<String>|
     -> Result<(), String> {
        sequence += 1;
        channel
            .send(Event {
                request_id: request.request_id.clone(),
                session_id: request.session_id.clone(),
                sequence,
                r#type: kind,
                text,
                usage,
                message,
            })
            .map_err(|_| "Assistant view is no longer available".into())
    };
    let outcome = match send("started", None, None, None) {
        Ok(()) => {
            providers::stream(&request, cancel, |text, usage| {
                if !text.is_empty() {
                    send("text", Some(text.into()), None, None)?;
                }
                if let Some(usage) = usage {
                    send("usage", None, Some(usage.clone()), None)?;
                }
                Ok(())
            })
            .await
        }
        Err(error) => Err(error),
    };
    state
        .streams
        .lock()
        .map_err(|_| "Assistant ownership is unavailable")?
        .finish(&request.request_id);
    match outcome {
        Ok((text, usage, cancelled)) => {
            let status = if cancelled { "cancelled" } else { "complete" };
            let _ = send(status, None, Some(usage.clone()), None);
            Ok(Completion {
                request_id: request.request_id,
                session_id: request.session_id,
                status,
                text,
                usage,
            })
        }
        Err(error) => {
            let _ = send("error", None, None, Some(error.clone()));
            Err(error)
        }
    }
}
#[tauri::command]
pub fn assistant_cancel(
    state: State<'_, AssistantState>,
    request_id: String,
    session_id: String,
) -> Result<(), String> {
    uuid(&request_id)?;
    uuid(&session_id)?;
    state
        .streams
        .lock()
        .map_err(|_| "Assistant ownership is unavailable")?
        .cancel(&request_id, &session_id)
}
#[tauri::command]
pub fn assistant_list_conversations(
    app: tauri::AppHandle,
    state: State<'_, AssistantState>,
    project_id: Option<String>,
) -> Result<Vec<ConversationSummary>, String> {
    let _lock = state
        .storage_lock
        .lock()
        .map_err(|_| "Assistant storage lock is unavailable")?;
    storage::list_conversations(&storage::directory(&app)?, project_id.as_deref())
}
#[tauri::command]
pub fn assistant_read_conversation(
    app: tauri::AppHandle,
    state: State<'_, AssistantState>,
    id: String,
) -> Result<Conversation, String> {
    let _lock = state
        .storage_lock
        .lock()
        .map_err(|_| "Assistant storage lock is unavailable")?;
    storage::read_conversation(&storage::directory(&app)?, &id)
}
#[tauri::command]
pub fn assistant_write_conversation(
    app: tauri::AppHandle,
    state: State<'_, AssistantState>,
    conversation: Conversation,
) -> Result<(), String> {
    let _lock = state
        .storage_lock
        .lock()
        .map_err(|_| "Assistant storage lock is unavailable")?;
    let directory = storage::directory(&app)?;
    let settings = storage::read_settings(&directory)?;
    let secret = storage::credential(&settings)?;
    storage::reject_credentials(
        &serde_json::to_string(&conversation).map_err(|_| "Invalid assistant history")?,
        secret.as_deref().map(|s| s.as_str()),
    )?;
    storage::write_conversation(&directory, &conversation)
}
#[tauri::command]
pub fn assistant_delete_conversation(
    app: tauri::AppHandle,
    state: State<'_, AssistantState>,
    id: String,
) -> Result<(), String> {
    let _lock = state
        .storage_lock
        .lock()
        .map_err(|_| "Assistant storage lock is unavailable")?;
    storage::delete_conversation(&storage::directory(&app)?, &id)
}
#[tauri::command]
pub fn assistant_publish_snapshot(
    app: tauri::AppHandle,
    state: State<'_, AssistantState>,
    snapshot: Snapshot,
) -> Result<(), String> {
    mcp::validate_snapshot(&snapshot)?;
    if state
        .streams
        .lock()
        .map_err(|_| "Assistant ownership is unavailable")?
        .closed_sessions
        .contains(&snapshot.session_id)
    {
        return Err("This assistant session has closed".into());
    }
    let directory = storage::directory(&app)?;
    let settings = storage::read_settings(&directory)?;
    let secret = storage::credential(&settings)?;
    storage::reject_credentials(
        &serde_json::to_string(&snapshot).map_err(|_| "Invalid MCP snapshot")?,
        secret.as_deref().map(|s| s.as_str()),
    )?;
    let mut snapshots = state
        .snapshots
        .lock()
        .map_err(|_| "MCP snapshot state is unavailable")?;
    if state
        .streams
        .lock()
        .map_err(|_| "Assistant ownership is unavailable")?
        .closed_sessions
        .contains(&snapshot.session_id)
    {
        return Err("This assistant session has closed".into());
    }
    if !snapshots.contains_key(&snapshot.session_id) && snapshots.len() >= 64 {
        return Err("Too many assistant document snapshots".into());
    }
    if let Some(published) = snapshots.get_mut(&snapshot.session_id) {
        if !published.scopes.is_empty() {
            mcp::write_consent(&directory, &snapshot, &published.token, &published.scopes)?;
        }
        published.snapshot = snapshot;
    } else {
        snapshots.insert(
            snapshot.session_id.clone(),
            Published {
                snapshot,
                scopes: vec![],
                token: uuid::Uuid::new_v4().to_string(),
                directory,
            },
        );
    }
    Ok(())
}
#[tauri::command]
pub fn assistant_configure_mcp(
    state: State<'_, AssistantState>,
    session_id: String,
    scopes: Vec<Scope>,
) -> Result<McpConfiguration, String> {
    uuid(&session_id)?;
    let mut snapshots = state
        .snapshots
        .lock()
        .map_err(|_| "MCP snapshot state is unavailable")?;
    if state
        .streams
        .lock()
        .map_err(|_| "Assistant ownership is unavailable")?
        .closed_sessions
        .contains(&session_id)
    {
        return Err("This assistant session has closed".into());
    }
    let published = snapshots
        .get_mut(&session_id)
        .ok_or("Publish the current document/help snapshot before enabling MCP")?;
    if scopes.is_empty() {
        mcp::revoke(&published.directory, &session_id)?;
        published.scopes.clear();
        published.token = uuid::Uuid::new_v4().to_string();
        return Ok(McpConfiguration {
            enabled: false,
            protocol_version: mcp::PROTOCOL,
            scopes,
            command: None,
            args: vec![],
        });
    }
    if published.scopes.is_empty() {
        let audit = storage::owned_path(&mcp::mcp_directory(&published.directory)?, &session_id)?
            .with_extension("audit");
        if audit.exists() {
            if !std::fs::symlink_metadata(&audit)
                .map_err(|_| "Could not inspect MCP audit")?
                .is_file()
            {
                return Err("MCP audit is not an owned regular file".into());
            }
            std::fs::remove_file(audit).map_err(|_| "Could not restart MCP audit")?;
        }
    }
    mcp::write_consent(
        &published.directory,
        &published.snapshot,
        &published.token,
        &scopes,
    )?;
    published.scopes = scopes.clone();
    let command =
        std::env::current_exe().map_err(|_| "The installed Phyra executable is unavailable")?;
    Ok(McpConfiguration {
        enabled: true,
        protocol_version: mcp::PROTOCOL,
        scopes,
        command: Some(command.to_string_lossy().into_owned()),
        args: vec![
            "--mcp-read-only".into(),
            session_id,
            published.token.clone(),
        ],
    })
}
#[tauri::command]
pub fn assistant_mcp_audit(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<Vec<Audit>, String> {
    uuid(&session_id)?;
    mcp::audits(&storage::directory(&app)?, &session_id)
}
#[tauri::command]
pub fn assistant_release_session(
    state: State<'_, AssistantState>,
    session_id: String,
) -> Result<(), String> {
    uuid(&session_id)?;
    state
        .streams
        .lock()
        .map_err(|_| "Assistant ownership is unavailable")?
        .close(&session_id)?;
    let mut snapshots = state
        .snapshots
        .lock()
        .map_err(|_| "MCP snapshot state is unavailable")?;
    if let Some(published) = snapshots.get(&session_id) {
        mcp::revoke(&published.directory, &session_id)?;
    }
    snapshots.remove(&session_id);
    Ok(())
}
