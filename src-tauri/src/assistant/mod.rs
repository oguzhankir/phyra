//! Optional BYOK assistance and explicitly enabled read-only local MCP.
pub mod commands;
pub mod mcp;
mod providers;
pub mod references;
mod sse;
mod storage;
pub mod types;
use providers::Cancellation;
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{Arc, Mutex},
};
use types::{Scope, Snapshot};

pub struct AssistantState {
    streams: Mutex<Streams>,
    storage_lock: Mutex<()>,
    snapshots: Mutex<HashMap<String, Published>>,
    network: tokio::sync::Semaphore,
}
impl Default for AssistantState {
    fn default() -> Self {
        Self {
            streams: Mutex::new(Streams::default()),
            storage_lock: Mutex::new(()),
            snapshots: Mutex::new(HashMap::new()),
            network: tokio::sync::Semaphore::new(2),
        }
    }
}
#[derive(Default)]
struct Streams {
    active: HashMap<String, OwnedRequest>,
    retired: HashSet<String>,
    closed_sessions: HashSet<String>,
    pending_cancel: HashMap<String, String>,
}
struct OwnedRequest {
    session: String,
    cancel: Arc<Cancellation>,
}
struct Published {
    snapshot: Snapshot,
    scopes: Vec<Scope>,
    token: String,
    directory: PathBuf,
}
impl Streams {
    fn begin(&mut self, request: &str, session: &str) -> Result<Arc<Cancellation>, String> {
        if self.closed_sessions.contains(session) {
            return Err("This assistant session has closed".into());
        }
        if self.retired.contains(request) || self.active.contains_key(request) {
            return Err("Assistant request identity was already used".into());
        }
        if self.active.len() >= 2 || self.active.values().any(|r| r.session == session) {
            return Err(
                "This assistant already has an active request; cancel it before sending another"
                    .into(),
            );
        }
        if self.retired.len() >= 4096 {
            return Err("Assistant request limit reached; restart Phyra".into());
        }
        let cancel = Arc::new(Cancellation::default());
        if let Some(owner) = self.pending_cancel.remove(request) {
            if owner != session {
                return Err("Assistant cancellation belongs to another session".into());
            }
            cancel.cancel();
        }
        self.active.insert(
            request.into(),
            OwnedRequest {
                session: session.into(),
                cancel: cancel.clone(),
            },
        );
        Ok(cancel)
    }
    fn cancel(&mut self, request: &str, session: &str) -> Result<(), String> {
        if let Some(owned) = self.active.get(request) {
            if owned.session != session {
                return Err("Assistant request belongs to another session".into());
            }
            owned.cancel.cancel();
        } else if !self.retired.contains(request) {
            if self.pending_cancel.len() >= 128 {
                return Err("Too many queued assistant cancellations".into());
            }
            if self
                .pending_cancel
                .get(request)
                .is_some_and(|owner| owner != session)
            {
                return Err("Assistant request belongs to another session".into());
            }
            self.pending_cancel.insert(request.into(), session.into());
        }
        Ok(())
    }
    fn finish(&mut self, request: &str) {
        self.active.remove(request);
        self.retired.insert(request.into());
    }
    fn close(&mut self, session: &str) -> Result<(), String> {
        if !self.closed_sessions.contains(session) && self.closed_sessions.len() >= 256 {
            return Err("Assistant session limit reached; restart Phyra".into());
        }
        for owned in self.active.values().filter(|r| r.session == session) {
            owned.cancel.cancel();
        }
        self.closed_sessions.insert(session.into());
        self.pending_cancel.retain(|_, s| s != session);
        Ok(())
    }
}
pub fn stop_owned(state: &AssistantState) {
    if let Ok(streams) = state.streams.lock() {
        for owned in streams.active.values() {
            owned.cancel.cancel();
        }
    }
    if let Ok(mut snapshots) = state.snapshots.lock() {
        for (session, published) in snapshots.drain() {
            let _ = mcp::revoke(&published.directory, &session);
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn event_cancellation_and_request_ids_have_session_ownership() {
        let mut streams = Streams::default();
        let cancel = streams.begin("request-a", "session-a").unwrap();
        assert!(streams.cancel("request-a", "session-b").is_err());
        assert!(!cancel.is_cancelled());
        assert!(streams.begin("request-b", "session-a").is_err());
        streams.cancel("request-a", "session-a").unwrap();
        assert!(cancel.is_cancelled());
        streams.finish("request-a");
        assert!(streams.begin("request-a", "session-a").is_err());
        streams.close("session-a").unwrap();
        assert!(streams.begin("request-c", "session-a").is_err());
    }
    #[test]
    fn cancellation_before_start_and_concurrency_are_bounded() {
        let mut streams = Streams::default();
        streams.cancel("request-a", "session-a").unwrap();
        assert!(streams
            .begin("request-a", "session-a")
            .unwrap()
            .is_cancelled());
        streams.begin("request-b", "session-b").unwrap();
        assert!(streams.begin("request-c", "session-c").is_err());
    }
}
