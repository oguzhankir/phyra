use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const MAX_TEXT: usize = 64 * 1024;
pub const MAX_CONTEXT: usize = 128 * 1024;
pub const MAX_REQUEST: usize = 256 * 1024;
pub const MAX_RESPONSE: usize = 512 * 1024;
pub const MAX_HISTORY: usize = 2 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Gemini,
    Openai,
    Anthropic,
    Compatible,
    Ollama,
}
impl Provider {
    pub fn name(self) -> &'static str {
        match self {
            Self::Gemini => "gemini",
            Self::Openai => "openai",
            Self::Anthropic => "anthropic",
            Self::Compatible => "compatible",
            Self::Ollama => "ollama",
        }
    }
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub provider: Provider,
    pub model: String,
    pub endpoint: String,
    pub local: bool,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            provider: Provider::Gemini,
            model: String::new(),
            endpoint: "https://generativelanguage.googleapis.com/v1beta".into(),
            local: false,
        }
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Configuration {
    pub settings: Settings,
    pub credential_present: bool,
    pub connections: Vec<Connection>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub settings: Settings,
    pub credential_present: bool,
    pub models: Vec<Model>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Model {
    pub id: String,
    pub name: String,
    pub streaming: String,
    pub context_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
}
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Usage {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub total_tokens: Option<u64>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Context {
    pub kind: ContextKind,
    pub project_id: Option<String>,
    pub study_id: Option<String>,
    pub revision: Option<u64>,
    pub source_ids: Vec<String>,
    pub text: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ContextKind {
    Help,
    Project,
    Study,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    User,
    Assistant,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChatMessage {
    pub role: Role,
    pub content: String,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub request_id: String,
    pub session_id: String,
    pub conversation_id: String,
    pub project_id: Option<String>,
    pub settings: Settings,
    pub messages: Vec<ChatMessage>,
    pub system: String,
    pub context: Context,
    pub allow_remote: bool,
    pub max_output_tokens: u32,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Message {
    pub id: String,
    pub role: Role,
    pub content: String,
    pub created_at: u64,
    pub status: MessageStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<Provider>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub endpoint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_allowed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<Context>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<Usage>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageStatus {
    Complete,
    Cancelled,
    Error,
    Interrupted,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Conversation {
    pub format_version: u32,
    pub id: String,
    pub project_id: Option<String>,
    pub title: String,
    pub updated_at: u64,
    pub messages: Vec<Message>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSummary {
    pub id: String,
    pub project_id: Option<String>,
    pub title: String,
    pub updated_at: u64,
    pub message_count: usize,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub request_id: String,
    pub session_id: String,
    pub sequence: u64,
    pub r#type: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<Usage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Completion {
    pub request_id: String,
    pub session_id: String,
    pub status: &'static str,
    pub text: String,
    pub usage: Usage,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Snapshot {
    pub session_id: String,
    pub project_id: Option<String>,
    pub revision: Option<u64>,
    pub project: Option<Value>,
    pub run: Option<RunSnapshot>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cad: Option<CadSnapshot>,
    pub help: Vec<Help>,
    pub capabilities: Vec<Capability>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunSnapshot {
    pub job_id: String,
    pub study_id: String,
    pub input_fingerprint: Option<String>,
    pub state: RunStatus,
    pub summary: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CadSnapshot {
    pub state: CadStatus,
    pub dimension: CadDimension,
    pub output_feature_id: Option<String>,
    pub feature_count: usize,
    pub sketch_count: usize,
    pub asset_count: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sketch_solve: Option<CadSketchSolve>,
    pub evaluation: Option<CadEvaluation>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CadSketchSolve {
    pub feature_id: String,
    pub status: String,
    pub degrees_of_freedom: Option<u32>,
    pub failed_constraint_ids: Vec<String>,
    pub failed_constraint_count: usize,
    pub kernel: String,
    pub source_commit: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CadStatus {
    Unevaluated,
    Busy,
    Current,
}
#[derive(Clone, Deserialize, Serialize)]
pub enum CadDimension {
    #[serde(rename = "2d")]
    Plane,
    #[serde(rename = "3d")]
    Solid,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CadEvaluation {
    pub job_id: String,
    pub revision: u64,
    pub geometry_fingerprint: String,
    pub output_feature_id: String,
    pub summary: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RunStatus {
    Current,
    Stale,
    Running,
    Cancelled,
    Failed,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Help {
    pub id: String,
    pub title: String,
    pub content: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Capability {
    pub id: String,
    pub description: String,
    pub available: bool,
}
#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
pub enum McpTool {
    #[serde(rename = "phyra_capabilities")]
    Capabilities,
    #[serde(rename = "phyra_help")]
    Help,
    #[serde(rename = "phyra_project")]
    Project,
    #[serde(rename = "phyra_run")]
    Run,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConfiguration {
    pub enabled: bool,
    pub protocol_version: &'static str,
    pub tools: Vec<McpTool>,
    pub command: Option<String>,
    pub args: Vec<String>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Audit {
    pub time: u64,
    pub tool: String,
    pub scope: String,
    pub project_id: Option<String>,
    pub revision: Option<u64>,
    pub allowed: bool,
}

pub fn uuid(value: &str) -> Result<(), String> {
    if uuid::Uuid::parse_str(value)
        .map_err(|_| "Invalid assistant identity")?
        .to_string()
        != value
    {
        return Err("Invalid assistant identity".into());
    }
    Ok(())
}
pub fn identity(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.:".contains(&b))
    {
        return Err("Invalid assistant context identity".into());
    }
    Ok(())
}
pub fn text(value: &str, maximum: usize) -> Result<(), String> {
    if value.len() > maximum || value.contains('\0') {
        return Err("Assistant text exceeds its supported limits".into());
    }
    Ok(())
}
pub fn context(value: &Context) -> Result<(), String> {
    text(&value.text, MAX_CONTEXT)?;
    if value.source_ids.len() > 64 {
        return Err("Too many assistant context sources".into());
    }
    for id in &value.source_ids {
        identity(id)?;
    }
    if let Some(id) = &value.project_id {
        identity(id)?;
    }
    if let Some(id) = &value.study_id {
        identity(id)?;
    }
    if value.revision.is_some_and(|r| r > 9_007_199_254_740_991) {
        return Err("Invalid assistant revision".into());
    }
    match value.kind {
        ContextKind::Project if value.project_id.is_none() || value.revision.is_none() => {
            return Err("Project context requires project and revision provenance".into())
        }
        ContextKind::Study
            if value.project_id.is_none()
                || value.study_id.is_none()
                || value.revision.is_none() =>
        {
            return Err("Study context requires project, study and revision provenance".into())
        }
        ContextKind::Help
            if value.project_id.is_some()
                || value.study_id.is_some()
                || value.revision.is_some() =>
        {
            return Err("Documentation context cannot attach undisclosed project provenance".into())
        }
        _ => {}
    }
    Ok(())
}
impl Request {
    pub fn validate(&self) -> Result<(), String> {
        uuid(&self.request_id)?;
        uuid(&self.session_id)?;
        uuid(&self.conversation_id)?;
        if let Some(id) = &self.project_id {
            identity(id)?;
        }
        context(&self.context)?;
        if self.context.project_id.is_some() && self.context.project_id != self.project_id {
            return Err("Assistant context does not belong to this project".into());
        }
        text(&self.system, 16 * 1024)?;
        if self.messages.is_empty()
            || self.messages.len() > 80
            || !matches!(self.messages.last().map(|m| &m.role), Some(Role::User))
        {
            return Err("Assistant needs a bounded conversation ending with a user message".into());
        }
        let mut size = self.system.len() + self.context.text.len();
        for message in &self.messages {
            text(&message.content, MAX_TEXT)?;
            size += message.content.len();
        }
        if size > MAX_REQUEST || self.max_output_tokens == 0 || self.max_output_tokens > 8192 {
            return Err("Assistant request exceeds its supported limits".into());
        }
        Ok(())
    }
}
impl Conversation {
    pub fn validate(&self) -> Result<(), String> {
        uuid(&self.id)?;
        if let Some(id) = &self.project_id {
            identity(id)?;
        }
        text(&self.title, 160)?;
        if self.format_version != 1
            || self.messages.len() > 160
            || self.updated_at > 9_007_199_254_740_991
        {
            return Err("Unsupported assistant history".into());
        }
        let mut ids = std::collections::HashSet::new();
        for m in &self.messages {
            uuid(&m.id)?;
            if !ids.insert(&m.id) {
                return Err("Duplicate assistant message identity".into());
            }
            text(&m.content, MAX_RESPONSE)?;
            if m.created_at > 9_007_199_254_740_991 {
                return Err("Invalid assistant message time".into());
            }
            if let Some(c) = &m.context {
                context(c)?;
                if c.project_id.is_some() && c.project_id != self.project_id {
                    return Err("History context belongs to another project".into());
                }
            }
            if let Some(model) = &m.model {
                text(model, 200)?;
            }
            if let Some(endpoint) = &m.endpoint {
                super::providers::validate_settings(
                    &Settings {
                        provider: m
                            .provider
                            .ok_or("Message endpoint requires provider provenance")?,
                        model: m.model.clone().unwrap_or_default(),
                        endpoint: endpoint.clone(),
                        local: m
                            .local
                            .ok_or("Message endpoint requires local/remote provenance")?,
                    },
                    false,
                )?;
            }
        }
        if serde_json::to_vec(self)
            .map_err(|_| "Invalid assistant history")?
            .len()
            > MAX_HISTORY
        {
            return Err("Assistant history exceeds its storage limit".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cad_only_context_has_project_provenance_without_inventing_a_study() {
        let mut value = Context {
            kind: ContextKind::Project,
            project_id: Some("cad-project".into()),
            study_id: None,
            revision: Some(2),
            source_ids: vec!["cad".into()],
            text: "Authored geometry; no study or evaluation yet".into(),
        };
        context(&value).unwrap();
        let encoded = serde_json::to_value(&value).unwrap();
        assert_eq!(encoded["kind"], "project");
        let decoded: Context = serde_json::from_value(encoded).unwrap();
        context(&decoded).unwrap();
        value.kind = ContextKind::Study;
        assert!(context(&value).is_err());
        value.kind = ContextKind::Project;
        value.project_id = None;
        assert!(context(&value).is_err());
        value.project_id = Some("cad-project".into());
        value.revision = None;
        assert!(context(&value).is_err());
        value.revision = Some(2);
        value.kind = ContextKind::Help;
        assert!(context(&value).is_err());
    }
    #[test]
    fn documentation_history_can_belong_to_a_project_without_sending_that_project() {
        let context = Context {
            kind: ContextKind::Help,
            project_id: None,
            study_id: None,
            revision: None,
            source_ids: vec!["overview".into()],
            text: "Offline help".into(),
        };
        let message = Message {
            id: uuid::Uuid::new_v4().to_string(),
            role: Role::Assistant,
            content: String::new(),
            created_at: 1,
            status: MessageStatus::Interrupted,
            provider: Some(Provider::Gemini),
            model: Some("fixture-model".into()),
            endpoint: Some(Settings::default().endpoint),
            local: Some(false),
            remote_allowed: Some(true),
            context: Some(context),
            usage: None,
        };
        let mut conversation = Conversation {
            format_version: 1,
            id: uuid::Uuid::new_v4().to_string(),
            project_id: Some("example-project".into()),
            title: "Docs".into(),
            updated_at: 1,
            messages: vec![message],
        };
        conversation.validate().unwrap();
        conversation.messages[0].endpoint = Some("https://evil.example/v1".into());
        assert!(conversation.validate().is_err());
        conversation.messages[0].endpoint = Some(Settings::default().endpoint);
        conversation.messages[0].context.as_mut().unwrap().kind = ContextKind::Study;
        assert!(conversation.validate().is_err());
    }
}
