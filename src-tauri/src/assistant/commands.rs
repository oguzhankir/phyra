use super::{mcp, providers, storage, types::*, AssistantState, Published};
use std::sync::{Arc, Mutex};
use tauri::{ipc::Channel, State};
use zeroize::Zeroizing;
// OS secure-store calls can wait for an interactive OS authorization. Both the
// call and its serialization lock must stay off Tauri's UI and async threads.
async fn blocking_storage<T: Send + 'static>(
    lock: Arc<Mutex<()>>,
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(move || {
        let _lock = lock
            .lock()
            .map_err(|_| "Assistant storage lock is unavailable")?;
        work()
    })
    .await
    .map_err(|_| "Assistant storage operation could not complete")?
}
#[tauri::command]
pub async fn assistant_get_settings(
    app: tauri::AppHandle,
    state: State<'_, AssistantState>,
) -> Result<Configuration, String> {
    blocking_storage(Arc::clone(&state.storage_lock), move || {
        storage::read_configuration(&storage::directory(&app)?)
    })
    .await
}
#[tauri::command]
pub async fn assistant_save_settings(
    app: tauri::AppHandle,
    state: State<'_, AssistantState>,
    settings: Settings,
) -> Result<Configuration, String> {
    blocking_storage(Arc::clone(&state.storage_lock), move || {
        storage::select_settings(&storage::directory(&app)?, settings)
    })
    .await
}
#[tauri::command]
pub async fn assistant_save_connection(
    app: tauri::AppHandle,
    state: State<'_, AssistantState>,
    settings: Settings,
    models: Vec<Model>,
) -> Result<Configuration, String> {
    blocking_storage(Arc::clone(&state.storage_lock), move || {
        storage::save_connection(&storage::directory(&app)?, settings, models)
    })
    .await
}
#[tauri::command]
pub async fn assistant_refresh_connection(
    app: tauri::AppHandle,
    state: State<'_, AssistantState>,
    settings: Settings,
    models: Vec<Model>,
) -> Result<Configuration, String> {
    blocking_storage(Arc::clone(&state.storage_lock), move || {
        storage::refresh_connection(&storage::directory(&app)?, settings, models)
    })
    .await
}
#[tauri::command]
pub async fn assistant_store_credential(
    app: tauri::AppHandle,
    state: State<'_, AssistantState>,
    settings: Settings,
    credential: String,
) -> Result<(), String> {
    let credential = Zeroizing::new(credential);
    blocking_storage(Arc::clone(&state.storage_lock), move || {
        let directory = storage::directory(&app)?;
        storage::preflight_connection(&directory, &settings)?;
        storage::store_credential(&settings, credential)?;
        // Retain an approved connection even when subsequent discovery fails.
        // A failed discovery is repairable without asking the user to re-enter a key.
        storage::remember_connection(&directory, settings).map_err(|_| "Credential saved in the OS store, but the connection could not be recorded. Reopen Connections and retry.".to_string())?;
        Ok(())
    })
    .await
}
#[tauri::command]
pub async fn assistant_delete_credential(
    state: State<'_, AssistantState>,
    settings: Settings,
) -> Result<(), String> {
    blocking_storage(Arc::clone(&state.storage_lock), move || {
        providers::validate_settings(&settings, false)?;
        storage::delete_credential(&settings)
    })
    .await
}
#[tauri::command]
pub async fn assistant_disconnect(
    app: tauri::AppHandle,
    state: State<'_, AssistantState>,
    settings: Settings,
) -> Result<Configuration, String> {
    // Do not remove a credential while discovery or a response owns it.
    let _permit = state
        .network
        .try_acquire_many(2)
        .map_err(|_| "Assistant connections are busy; stop the request before disconnecting")?;
    blocking_storage(Arc::clone(&state.storage_lock), move || {
        let directory = storage::directory(&app)?;
        storage::disconnect(&directory, &settings)
    })
    .await
}
#[tauri::command]
pub async fn assistant_credential_present(
    state: State<'_, AssistantState>,
    settings: Settings,
) -> Result<bool, String> {
    blocking_storage(Arc::clone(&state.storage_lock), move || {
        providers::validate_settings(&settings, false)?;
        storage::credential_present(&settings)
    })
    .await
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
    app: tauri::AppHandle,
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
    let selected = request.settings.clone();
    let content = serde_json::to_value(&request).map_err(|_| "Invalid assistant request")?;
    blocking_storage(Arc::clone(&state.storage_lock), move || {
        let directory = storage::directory(&app)?;
        storage::require_connection(&directory, &selected)?;
        storage::reject_saved_json_credentials(&directory, &content)
    })
    .await?;
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
pub async fn assistant_list_conversations(
    app: tauri::AppHandle,
    state: State<'_, AssistantState>,
    project_id: Option<String>,
) -> Result<Vec<ConversationSummary>, String> {
    blocking_storage(Arc::clone(&state.storage_lock), move || {
        storage::list_conversations(&storage::directory(&app)?, project_id.as_deref())
    })
    .await
}
#[tauri::command]
pub async fn assistant_read_conversation(
    app: tauri::AppHandle,
    state: State<'_, AssistantState>,
    id: String,
) -> Result<Conversation, String> {
    blocking_storage(Arc::clone(&state.storage_lock), move || {
        storage::read_conversation(&storage::directory(&app)?, &id)
    })
    .await
}
#[tauri::command]
pub async fn assistant_write_conversation(
    app: tauri::AppHandle,
    state: State<'_, AssistantState>,
    conversation: Conversation,
) -> Result<(), String> {
    blocking_storage(Arc::clone(&state.storage_lock), move || {
        let directory = storage::directory(&app)?;
        let settings = storage::read_settings(&directory)?;
        storage::write_conversation_checked(&directory, &conversation, &settings)
    })
    .await
}
#[tauri::command]
pub async fn assistant_delete_conversation(
    app: tauri::AppHandle,
    state: State<'_, AssistantState>,
    id: String,
) -> Result<(), String> {
    blocking_storage(Arc::clone(&state.storage_lock), move || {
        storage::delete_conversation(&storage::directory(&app)?, &id)
    })
    .await
}
#[tauri::command]
pub async fn assistant_publish_snapshot(
    app: tauri::AppHandle,
    state: State<'_, AssistantState>,
    snapshot: Snapshot,
    publication_sequence: u64,
) -> Result<(), String> {
    super::publication_sequence(publication_sequence)?;
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
    let content = serde_json::to_value(&snapshot).map_err(|_| "Invalid MCP snapshot")?;
    let directory = blocking_storage(Arc::clone(&state.storage_lock), move || {
        let directory = storage::directory(&app)?;
        storage::reject_saved_json_credentials(&directory, &content)?;
        Ok(directory)
    })
    .await?;
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
        published.adopt(snapshot, publication_sequence)?;
    } else {
        snapshots.insert(
            snapshot.session_id.clone(),
            Published {
                snapshot,
                tools: vec![],
                token: uuid::Uuid::new_v4().to_string(),
                directory,
                last_publication: publication_sequence,
            },
        );
    }
    Ok(())
}
#[tauri::command]
pub fn assistant_configure_mcp(
    state: State<'_, AssistantState>,
    session_id: String,
    tools: Vec<McpTool>,
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
    if tools.is_empty() {
        published.configure_tools(&tools)?;
        return Ok(McpConfiguration {
            enabled: false,
            protocol_version: mcp::PROTOCOL,
            tools,
            command: None,
            args: vec![],
        });
    }
    let command =
        std::env::current_exe().map_err(|_| "The installed Phyra executable is unavailable")?;
    if published.tools.is_empty() {
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
    published.configure_tools(&tools)?;
    Ok(McpConfiguration {
        enabled: true,
        protocol_version: mcp::PROTOCOL,
        tools,
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

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test(flavor = "current_thread")]
    async fn storage_and_serialization_wait_run_outside_the_async_runtime_thread() {
        let runtime_thread = std::thread::current().id();
        let lock = Arc::new(Mutex::new(()));
        let held = Arc::clone(&lock);
        let (locked_tx, locked_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let holder = std::thread::spawn(move || {
            let _guard = held.lock().unwrap();
            locked_tx.send(()).unwrap();
            release_rx
                .recv_timeout(std::time::Duration::from_secs(3))
                .unwrap();
        });
        locked_rx.await.unwrap();
        let operation = tokio::spawn(blocking_storage(lock, move || {
            Ok(std::thread::current().id())
        }));
        // This asynchronous event must progress while the worker waits on the
        // same serialization lock that an OS authorization can hold.
        let event = tokio::task::yield_now();
        event.await;
        release_tx.send(()).unwrap();
        let worker_thread = operation.await.unwrap().unwrap();
        holder.join().unwrap();
        assert_ne!(worker_thread, runtime_thread);
    }
    #[tokio::test(flavor = "current_thread")]
    async fn blocking_storage_serializes_concurrent_mutations() {
        let lock = Arc::new(Mutex::new(()));
        let values = Arc::new(Mutex::new(Vec::new()));
        let first_values = Arc::clone(&values);
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let first = tokio::spawn(blocking_storage(Arc::clone(&lock), move || {
            started_tx.send(()).unwrap();
            release_rx
                .recv_timeout(std::time::Duration::from_secs(3))
                .map_err(|_| "Fixture synchronization failed")?;
            first_values.lock().unwrap().push(1);
            Ok(())
        }));
        started_rx.await.unwrap();
        let second_values = Arc::clone(&values);
        let second = tokio::spawn(blocking_storage(lock, move || {
            second_values.lock().unwrap().push(2);
            Ok(())
        }));
        tokio::task::yield_now().await;
        release_tx.send(()).unwrap();
        first.await.unwrap().unwrap();
        second.await.unwrap().unwrap();
        assert_eq!(*values.lock().unwrap(), vec![1, 2]);
    }
}
