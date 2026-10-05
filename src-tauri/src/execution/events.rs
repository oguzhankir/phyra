use serde::Serialize;
use serde_json::Value;

/// Caller identity for one UI run request, separate from the native worker job.
/// This identity is never sent to Python or stored in numerical artifacts.
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct RunRequestId(String);

impl RunRequestId {
    pub(crate) fn parse(value: String) -> Result<Self, String> {
        if value.len() != 36 || uuid::Uuid::parse_str(&value).is_err() {
            return Err("Analysis request identity must be a UUID".into());
        }
        // Preserve the caller's exact spelling so event correlation does not
        // depend on UUID formatting or normalization by another layer.
        Ok(Self(value))
    }

    pub(crate) fn event<'a>(&'a self, payload: &'a Value) -> ExecutionEvent<'a> {
        ExecutionEvent {
            request_id: &self.0,
            payload,
        }
    }
}

/// Native-owned envelope around a frame whose job identity and values have
/// already passed worker validation. A delayed event retains its own request.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExecutionEvent<'a> {
    request_id: &'a str,
    payload: &'a Value,
}
