//! Secret-free, versioned local state. Provider credentials use native OS stores.
use super::{
    providers::{official_endpoint, validate_settings},
    types::*,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};
use tauri::Manager;
use zeroize::Zeroizing;
const MAX_CONVERSATIONS: usize = 100;
const MAX_TOTAL_HISTORY: u64 = 32 * 1024 * 1024;
// Bound OS authorization work independently of the 160-message history limit.
const MAX_HISTORY_CREDENTIAL_NAMESPACES: usize = 32;
const CREDENTIAL_ACCESS_ERROR: &str = "OS credential access is unavailable. Authorize Phyra in the system credential store or re-enter the credential in Connection, then retry.";

pub fn directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|_| "Assistant storage is unavailable")?
        .join("assistant");
    ensure_directory(&directory)?;
    Ok(directory)
}
// The stdio process derives this same fixed app-owned root. It accepts IDs only.
pub fn stdio_directory() -> Result<PathBuf, String> {
    let path = dirs::data_dir()
        .ok_or("Assistant storage is unavailable")?
        .join("org.phyra.workbench")
        .join("assistant");
    if !fs::symlink_metadata(&path)
        .map_err(|_| "Desktop assistant consent is unavailable")?
        .is_dir()
    {
        return Err("Assistant storage is not an owned directory".into());
    }
    Ok(path)
}
pub fn ensure_directory(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|_| "Could not create assistant storage")?;
    if !fs::symlink_metadata(path)
        .map_err(|_| "Could not inspect assistant storage")?
        .is_dir()
    {
        return Err("Assistant storage is not an owned directory".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|_| "Could not protect assistant storage")?;
    }
    Ok(())
}
pub fn owned_path(directory: &Path, id: &str) -> Result<PathBuf, String> {
    uuid(id)?;
    Ok(directory.join(format!("{id}.json")))
}
pub fn read_json<T: DeserializeOwned>(path: &Path, maximum: u64) -> Result<T, String> {
    let bytes = read_owned_bytes(path, maximum)?;
    serde_json::from_slice(&bytes).map_err(|_| "Unsupported or malformed assistant storage".into())
}
pub fn read_owned_bytes(path: &Path, maximum: u64) -> Result<Vec<u8>, String> {
    let metadata = fs::symlink_metadata(path).map_err(|_| "Could not read assistant storage")?;
    if !metadata.is_file() || metadata.len() > maximum {
        return Err("Assistant storage is invalid or too large".into());
    }
    let mut bytes = Vec::new();
    let mut options = OpenOptions::new();
    options.read(true);
    protect_open(&mut options);
    let file = options
        .open(path)
        .map_err(|_| "Could not read assistant storage")?;
    let opened = file
        .metadata()
        .map_err(|_| "Could not inspect assistant storage")?;
    if !opened.is_file() || opened.len() > maximum {
        return Err("Assistant storage is invalid or too large".into());
    }
    file.take(maximum + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Could not read assistant storage")?;
    if bytes.len() as u64 > maximum {
        return Err("Assistant storage exceeds its limit".into());
    }
    Ok(bytes)
}
fn protect_open(options: &mut OpenOptions) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x0020_0000); /* FILE_FLAG_OPEN_REPARSE_POINT */
    }
}
pub fn atomic_json<T: Serialize>(path: &Path, value: &T, maximum: usize) -> Result<(), String> {
    if path.exists()
        && !fs::symlink_metadata(path)
            .map_err(|_| "Could not inspect assistant storage")?
            .is_file()
    {
        return Err("Assistant storage is not a regular file".into());
    }
    let bytes = serde_json::to_vec(value).map_err(|_| "Could not encode assistant storage")?;
    if bytes.len() > maximum {
        return Err("Assistant storage exceeds its limit".into());
    }
    let parent = path.parent().ok_or("Invalid assistant storage")?;
    let mut temporary =
        tempfile::NamedTempFile::new_in(parent).map_err(|_| "Could not write assistant storage")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        temporary
            .as_file()
            .set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|_| "Could not protect assistant storage")?;
    }
    temporary
        .write_all(&bytes)
        .map_err(|_| "Could not write assistant storage")?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|_| "Could not sync assistant storage")?;
    temporary
        .persist(path)
        .map_err(|_| "Could not atomically save assistant storage")?;
    Ok(())
}
const MAX_CONNECTIONS: usize = 16;
const MAX_SETTINGS: usize = 4 * 1024 * 1024;
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacySettings {
    format_version: u32,
    settings: Settings,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredConnection {
    settings: Settings,
    models: Vec<Model>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredSettings {
    format_version: u32,
    settings: Settings,
    connections: Vec<StoredConnection>,
}
fn same_connection(left: &Settings, right: &Settings) -> Result<bool, String> {
    Ok(left.provider == right.provider
        && left.local == right.local
        && validate_settings(left, false)?
            .as_str()
            .trim_end_matches('/')
            == validate_settings(right, false)?
                .as_str()
                .trim_end_matches('/'))
}
fn validate_models(models: &[Model]) -> Result<(), String> {
    if models.len() > 500 {
        return Err("A provider connection can report at most 500 models".into());
    }
    let mut ids = HashSet::new();
    for model in models {
        if model.id.is_empty()
            || model.id.len() > 200
            || !model
                .id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_.:/".contains(&b))
            || !ids.insert(&model.id)
            || model.name.is_empty()
            || model.name.len() > 200
            || model.name.chars().any(char::is_control)
            || !matches!(model.streaming.as_str(), "supported" | "unknown")
            || model.context_tokens == Some(0)
            || model.output_tokens == Some(0)
        {
            return Err("Invalid provider model metadata".into());
        }
        reject_credentials(&model.id, None)?;
        reject_credentials(&model.name, None)?;
    }
    Ok(())
}
fn validate_stored(stored: &StoredSettings) -> Result<(), String> {
    if stored.format_version != 2 || stored.connections.len() > MAX_CONNECTIONS {
        return Err("Unsupported assistant settings version or connection limit".into());
    }
    validate_settings(&stored.settings, false)?;
    for (index, connection) in stored.connections.iter().enumerate() {
        validate_settings(&connection.settings, false)?;
        validate_models(&connection.models)?;
        for previous in &stored.connections[..index] {
            if same_connection(&previous.settings, &connection.settings)? {
                return Err("Duplicate assistant provider connection".into());
            }
        }
    }
    Ok(())
}
fn read_stored_with(
    directory: &Path,
    present: &mut impl FnMut(&Settings) -> Result<bool, String>,
) -> Result<StoredSettings, String> {
    let path = directory.join("settings.json");
    if !path.exists() {
        return Ok(StoredSettings {
            format_version: 2,
            settings: Settings::default(),
            connections: vec![],
        });
    }
    let bytes = read_owned_bytes(&path, MAX_SETTINGS as u64)?;
    let value: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| "Unsupported or malformed assistant storage")?;
    match value
        .get("formatVersion")
        .and_then(serde_json::Value::as_u64)
    {
        Some(2) => {
            let stored: StoredSettings = serde_json::from_value(value)
                .map_err(|_| "Unsupported or malformed assistant storage")?;
            validate_stored(&stored)?;
            Ok(stored)
        }
        Some(1) => {
            if bytes.len() > 4096 {
                return Err("Legacy assistant settings exceed their limit".into());
            }
            let legacy: LegacySettings = serde_json::from_value(value)
                .map_err(|_| "Unsupported or malformed assistant storage")?;
            validate_settings(&legacy.settings, false)?;
            let mut candidates = vec![legacy.settings.clone()];
            // Earlier releases retained official keys when users switched providers.
            // Recover item presence only: no decryption, provider call or implicit reconnect.
            for provider in [Provider::Gemini, Provider::Openai, Provider::Anthropic] {
                let settings = Settings {
                    provider,
                    endpoint: official_endpoint(provider).unwrap().into(),
                    ..Settings::default()
                };
                if !candidates
                    .iter()
                    .any(|other| same_connection(other, &settings).unwrap_or(false))
                {
                    candidates.push(settings);
                }
            }
            let mut connections = Vec::new();
            for settings in candidates {
                if (settings.local && !settings.model.is_empty())
                    || (!settings.local && present(&settings).unwrap_or(true))
                {
                    connections.push(StoredConnection {
                        settings,
                        models: vec![],
                    });
                }
            }
            Ok(StoredSettings {
                format_version: 2,
                settings: legacy.settings,
                connections,
            })
        }
        _ => Err("Unsupported assistant settings version".into()),
    }
}
fn write_stored(directory: &Path, stored: &StoredSettings) -> Result<(), String> {
    validate_stored(stored)?;
    atomic_json(&directory.join("settings.json"), stored, MAX_SETTINGS)
}
fn configuration_with(
    stored: StoredSettings,
    present: &mut impl FnMut(&Settings) -> Result<bool, String>,
) -> Result<Configuration, String> {
    let mut connections = Vec::new();
    for connection in stored.connections {
        let (credential_present, error) = if connection.settings.local {
            (false, None)
        } else {
            match present(&connection.settings) {
                Ok(present) => (present, None),
                Err(_) => (false, Some(CREDENTIAL_ACCESS_ERROR.into())),
            }
        };
        connections.push(Connection {
            settings: connection.settings,
            credential_present,
            models: connection.models,
            error,
        });
    }
    let credential_present = connections
        .iter()
        .find(|connection| same_connection(&connection.settings, &stored.settings).unwrap_or(false))
        .is_some_and(|connection| connection.credential_present);
    Ok(Configuration {
        settings: stored.settings,
        credential_present,
        connections,
    })
}
pub fn read_configuration(directory: &Path) -> Result<Configuration, String> {
    let mut present = credential_present;
    configuration_with(read_stored_with(directory, &mut present)?, &mut present)
}
pub fn read_settings(directory: &Path) -> Result<Settings, String> {
    // Ordinary history/snapshot reads need active provenance, not a key inventory.
    let path = directory.join("settings.json");
    if !path.exists() {
        return Ok(Settings::default());
    }
    let value: serde_json::Value = read_json(&path, MAX_SETTINGS as u64)?;
    let settings = match value
        .get("formatVersion")
        .and_then(serde_json::Value::as_u64)
    {
        Some(1) => serde_json::from_value::<LegacySettings>(value).map(|stored| stored.settings),
        Some(2) => {
            let stored: StoredSettings = serde_json::from_value(value)
                .map_err(|_| "Unsupported or malformed assistant storage")?;
            validate_stored(&stored)?;
            return Ok(stored.settings);
        }
        _ => return Err("Unsupported assistant settings version".into()),
    }
    .map_err(|_| "Unsupported or malformed assistant storage")?;
    validate_settings(&settings, false)?;
    Ok(settings)
}
fn save_connection_with(
    directory: &Path,
    settings: Settings,
    models: Vec<Model>,
    present: &mut impl FnMut(&Settings) -> Result<bool, String>,
) -> Result<Configuration, String> {
    validate_settings(&settings, false)?;
    validate_models(&models)?;
    if !settings.local && !present(&settings)? {
        return Err("Store a provider credential before connecting".into());
    }
    let mut stored = read_stored_with(directory, present)?;
    if let Some(connection) = stored
        .connections
        .iter_mut()
        .find(|connection| same_connection(&connection.settings, &settings).unwrap_or(false))
    {
        connection.settings = settings.clone();
        connection.models = models;
    } else {
        if stored.connections.len() >= MAX_CONNECTIONS {
            return Err("At most 16 assistant connections can be saved".into());
        }
        stored.connections.push(StoredConnection {
            settings: settings.clone(),
            models,
        });
    }
    let active_ready = !stored.settings.model.is_empty()
        && stored.connections.iter().any(|connection| {
            same_connection(&connection.settings, &stored.settings).unwrap_or(false)
        });
    if !active_ready {
        stored.settings = settings;
    }
    write_stored(directory, &stored)?;
    configuration_with(stored, present)
}
pub fn save_connection(
    directory: &Path,
    settings: Settings,
    models: Vec<Model>,
) -> Result<Configuration, String> {
    save_connection_with(directory, settings, models, &mut credential_present)
}
fn refresh_connection_with(
    directory: &Path,
    settings: Settings,
    models: Vec<Model>,
    present: &mut impl FnMut(&Settings) -> Result<bool, String>,
) -> Result<Configuration, String> {
    validate_settings(&settings, false)?;
    validate_models(&models)?;
    let mut stored = read_stored_with(directory, present)?;
    let connection = stored
        .connections
        .iter_mut()
        .find(|connection| same_connection(&connection.settings, &settings).unwrap_or(false))
        .ok_or("This connection was removed. Reconnect it before refreshing models.")?;
    connection.models = models;
    if connection.settings.model.is_empty() {
        connection.settings.model = settings.model.clone();
    }
    if stored.settings.model.is_empty() && same_connection(&stored.settings, &settings)? {
        stored.settings.model = settings.model;
    }
    write_stored(directory, &stored)?;
    configuration_with(stored, present)
}
pub fn refresh_connection(
    directory: &Path,
    settings: Settings,
    models: Vec<Model>,
) -> Result<Configuration, String> {
    refresh_connection_with(directory, settings, models, &mut credential_present)
}
pub fn preflight_connection(directory: &Path, settings: &Settings) -> Result<(), String> {
    validate_settings(settings, false)?;
    let stored = read_stored_with(directory, &mut credential_present)?;
    if stored.connections.len() >= MAX_CONNECTIONS
        && !stored
            .connections
            .iter()
            .any(|connection| same_connection(&connection.settings, settings).unwrap_or(false))
    {
        return Err("At most 16 assistant connections can be saved".into());
    }
    Ok(())
}
pub fn remember_connection(directory: &Path, mut settings: Settings) -> Result<(), String> {
    let stored = read_stored_with(directory, &mut credential_present)?;
    if stored
        .connections
        .iter()
        .any(|connection| same_connection(&connection.settings, &settings).unwrap_or(false))
    {
        return write_stored(directory, &stored);
    }
    settings.model.clear();
    save_connection(directory, settings, vec![]).map(|_| ())
}
pub fn require_connection(directory: &Path, settings: &Settings) -> Result<(), String> {
    let stored = read_stored_with(directory, &mut credential_present)?;
    if !stored
        .connections
        .iter()
        .any(|connection| same_connection(&connection.settings, settings).unwrap_or(false))
    {
        return Err("Connect this provider before sending a message".into());
    }
    Ok(())
}
fn select_settings_with(
    directory: &Path,
    settings: Settings,
    present: &mut impl FnMut(&Settings) -> Result<bool, String>,
) -> Result<Configuration, String> {
    validate_settings(&settings, true)?;
    let mut stored = read_stored_with(directory, present)?;
    let connection = stored
        .connections
        .iter_mut()
        .find(|connection| same_connection(&connection.settings, &settings).unwrap_or(false))
        .ok_or("Connect this provider before choosing a model")?;
    if !settings.local && !present(&settings)? {
        return Err("Reconnect this provider before choosing a model".into());
    }
    if !connection.models.is_empty()
        && !connection
            .models
            .iter()
            .any(|model| model.id == settings.model)
    {
        return Err("Refresh this connection to choose an available model".into());
    }
    connection.settings.model = settings.model.clone();
    stored.settings = settings;
    write_stored(directory, &stored)?;
    configuration_with(stored, present)
}
pub fn select_settings(directory: &Path, settings: Settings) -> Result<Configuration, String> {
    select_settings_with(directory, settings, &mut credential_present)
}
#[cfg(test)]
fn write_settings(directory: &Path, settings: Settings) -> Result<(), String> {
    // Legacy fixtures exercise in-memory migration rather than pre-populating keys.
    validate_settings(&settings, false)?;
    atomic_json(
        &directory.join("settings.json"),
        &LegacySettings {
            format_version: 1,
            settings,
        },
        4096,
    )
}
fn credential_account(settings: &Settings) -> Result<String, String> {
    let endpoint = validate_settings(settings, false)?;
    Ok(format!(
        "{}:{}",
        settings.provider.name(),
        endpoint.origin().ascii_serialization()
    ))
}
fn entry(settings: &Settings) -> Result<keyring::Entry, String> {
    if !cfg!(any(target_os = "macos", target_os = "windows")) {
        return Err("Secure provider credentials are supported on macOS and Windows".into());
    }
    keyring::Entry::new(
        "org.phyra.workbench.assistant",
        &credential_account(settings)?,
    )
    .map_err(|_| "The OS credential store is unavailable".into())
}
pub fn credential(settings: &Settings) -> Result<Option<Zeroizing<String>>, String> {
    if settings.local {
        return Ok(None);
    }
    match entry(settings)?.get_password() {
        Ok(value) => Ok(Some(Zeroizing::new(value))),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err(CREDENTIAL_ACCESS_ERROR.into()),
    }
}
/// Settings only need item existence, never the decrypted provider secret.
pub fn credential_present(settings: &Settings) -> Result<bool, String> {
    if settings.local {
        return Ok(false);
    }
    #[cfg(target_os = "macos")]
    {
        use security_framework::{
            item::{ItemClass, ItemSearchOptions},
            os::macos::keychain::{SecKeychain, SecPreferencesDomain},
        };
        let account = credential_account(settings)?;
        let keychain = SecKeychain::default_for_domain(SecPreferencesDomain::User)
            .map_err(|_| CREDENTIAL_ACCESS_ERROR)?;
        let mut search = ItemSearchOptions::new();
        search
            .keychains(&[keychain])
            .class(ItemClass::generic_password())
            .service("org.phyra.workbench.assistant")
            .account(&account)
            .load_attributes(true)
            .load_data(false);
        match search.search() {
            Ok(items) => Ok(!items.is_empty()),
            Err(error) if error.code() == -25300 => Ok(false), // errSecItemNotFound
            Err(_) => Err(CREDENTIAL_ACCESS_ERROR.into()),
        }
    }
    #[cfg(target_os = "windows")]
    {
        match entry(settings)?.get_attributes() {
            Ok(_) => Ok(true),
            Err(keyring::Error::NoEntry) => Ok(false),
            Err(_) => Err(CREDENTIAL_ACCESS_ERROR.into()),
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Err("Secure provider credentials are supported on macOS and Windows".into())
    }
}
pub fn store_credential(settings: &Settings, value: Zeroizing<String>) -> Result<(), String> {
    if settings.local {
        return Err("Local endpoints do not need a stored credential".into());
    }
    if value.len() < 8
        || value.len() > 4096
        || value.chars().any(|c| c.is_control() || c.is_whitespace())
    {
        return Err("Invalid provider credential".into());
    }
    entry(settings)?
        .set_password(&value)
        .map_err(|_| "The OS credential store could not save this provider credential".into())
}
pub fn delete_credential(settings: &Settings) -> Result<(), String> {
    match entry(settings)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("The OS credential store could not delete this provider credential".into()),
    }
}
pub fn disconnect(directory: &Path, expected: &Settings) -> Result<Configuration, String> {
    disconnect_with(
        directory,
        expected,
        delete_credential,
        &mut credential_present,
    )
}
fn disconnect_with(
    directory: &Path,
    expected: &Settings,
    remove: impl FnOnce(&Settings) -> Result<(), String>,
    present: &mut impl FnMut(&Settings) -> Result<bool, String>,
) -> Result<Configuration, String> {
    validate_settings(expected, false)?;
    let mut stored = read_stored_with(directory, present)?;
    let index = stored
        .connections
        .iter()
        .position(|connection| same_connection(&connection.settings, expected).unwrap_or(false))
        .ok_or("This connection changed. Reopen Connections before disconnecting.")?;
    let connection = &stored.connections[index].settings;
    // Multiple endpoint paths can share one provider-origin key. Keep the key while
    // another saved connection uses it; disconnect only the chosen endpoint.
    let shared_key = !connection.local
        && stored
            .connections
            .iter()
            .enumerate()
            .any(|(other_index, other)| {
                other_index != index
                    && credential_account(&other.settings).ok()
                        == credential_account(connection).ok()
            });
    if !connection.local && !shared_key {
        remove(connection)?;
    }
    stored.connections.remove(index);
    if same_connection(&stored.settings, expected)? {
        stored.settings = stored
            .connections
            .first()
            .map(|connection| connection.settings.clone())
            .unwrap_or_else(|| {
                let mut settings = expected.clone();
                settings.model.clear();
                settings
            });
    }
    write_stored(directory, &stored).map_err(|_| {
        "Credential removed, but connection settings could not be updated. Retry disconnect."
            .to_string()
    })?;
    configuration_with(stored, present)
}
pub fn reject_credentials(value: &str, secret: Option<&str>) -> Result<(), String> {
    if secret.is_some_and(|s| !s.is_empty() && value.contains(s)) {
        return Err("Provider credentials cannot be included in assistant content".into());
    }
    // Defend history/context even after a credential has been removed. No
    // credential contents are copied to an error or log.
    if value
        .split(|c: char| !(c.is_ascii_alphanumeric() || c == '-' || c == '_'))
        .any(|s| {
            (s.starts_with("sk-") && s.len() >= 20) || (s.starts_with("AIza") && s.len() >= 24)
        })
    {
        return Err("Credential-like text cannot be stored or sent as assistant content".into());
    }
    // The dot is part of this credential prefix, rather than a token separator.
    // Only long token tails count; ordinary short names such as AQ.test do not.
    if value.match_indices("AQ.").any(|(index, _)| {
        let token_byte = |b: u8| b.is_ascii_alphanumeric() || b == b'-' || b == b'_';
        (index == 0 || !token_byte(value.as_bytes()[index - 1]))
            && value.as_bytes()[index + 3..]
                .iter()
                .take_while(|&&b| token_byte(b))
                .count()
                >= 24
    }) {
        return Err("Credential-like text cannot be stored or sent as assistant content".into());
    }
    Ok(())
}
fn history_credential_settings(
    conversation: &Conversation,
    active: &Settings,
) -> Result<Vec<Settings>, String> {
    conversation.validate()?;
    validate_settings(active, false)?;
    let mut seen = HashSet::new();
    let mut settings = Vec::new();
    let mut add = |connection: Settings| -> Result<(), String> {
        validate_settings(&connection, false)?;
        if !connection.local && seen.insert(credential_account(&connection)?) {
            if settings.len() >= MAX_HISTORY_CREDENTIAL_NAMESPACES {
                return Err("A conversation can use at most 32 remote provider credential namespaces; start a new conversation".into());
            }
            settings.push(connection);
        }
        Ok(())
    };
    add(active.clone())?;
    for message in &conversation.messages {
        let Some(provider) = message.provider else {
            if message.endpoint.is_some()
                || message.local.is_some()
                || message.model.is_some()
                || message.remote_allowed.is_some()
            {
                return Err("History connection metadata requires provider provenance".into());
            }
            continue;
        };
        let (endpoint, local) = match &message.endpoint {
            Some(endpoint) => (
                endpoint.clone(),
                message
                    .local
                    .ok_or("History connection requires local/remote provenance")?,
            ),
            None => {
                // Older official-provider history can identify its namespace
                // unambiguously because these URLs are fixed by the native app.
                if let Some(endpoint) = official_endpoint(provider) {
                    (endpoint.into(), message.local.unwrap_or(false))
                } else {
                    return Err(
                        "History connection requires endpoint and local/remote provenance".into(),
                    );
                }
            }
        };
        add(Settings {
            provider,
            model: message.model.clone().unwrap_or_default(),
            endpoint,
            local,
        })?;
    }
    Ok(settings)
}
pub fn reject_json_credentials(
    value: &serde_json::Value,
    secret: Option<&str>,
) -> Result<(), String> {
    match value {
        serde_json::Value::String(value) => reject_credentials(value, secret)?,
        serde_json::Value::Array(values) => {
            for value in values {
                reject_json_credentials(value, secret)?;
            }
        }
        serde_json::Value::Object(values) => {
            for (key, value) in values {
                reject_credentials(key, secret)?;
                reject_json_credentials(value, secret)?;
            }
        }
        _ => {}
    }
    Ok(())
}
pub fn write_conversation_checked(
    directory: &Path,
    conversation: &Conversation,
    active: &Settings,
) -> Result<(), String> {
    write_conversation_checked_with(directory, conversation, active, credential)
}
fn write_conversation_checked_with(
    directory: &Path,
    conversation: &Conversation,
    active: &Settings,
    mut lookup: impl FnMut(&Settings) -> Result<Option<Zeroizing<String>>, String>,
) -> Result<(), String> {
    // Validate every namespace and the bound before any OS lookup or disk write.
    let settings = history_credential_settings(conversation, active)?;
    let value = serde_json::to_value(conversation).map_err(|_| "Invalid assistant history")?;
    reject_json_credentials(&value, None)?;
    for connection in settings {
        if let Some(secret) = lookup(&connection)? {
            // Scan decoded strings so JSON escaping cannot hide quoted or
            // backslash-containing compatible-provider credentials.
            reject_json_credentials(&value, Some(&secret))?;
        }
    }
    write_conversation(directory, conversation)
}
fn history_directory(directory: &Path) -> Result<PathBuf, String> {
    let path = directory.join("conversations");
    ensure_directory(&path)?;
    Ok(path)
}
fn write_conversation(directory: &Path, conversation: &Conversation) -> Result<(), String> {
    conversation.validate()?;
    reject_json_credentials(
        &serde_json::to_value(conversation).map_err(|_| "Invalid assistant history")?,
        None,
    )?;
    let history = history_directory(directory)?;
    let path = owned_path(&history, &conversation.id)?;
    let mut count = 0;
    let mut total = 0u64;
    for item in fs::read_dir(&history).map_err(|_| "Could not inspect assistant history")? {
        let item = item.map_err(|_| "Could not inspect assistant history")?;
        if item.path().extension().is_some_and(|e| e == "json") && item.path() != path {
            count += 1;
            total = total.saturating_add(
                item.metadata()
                    .map_err(|_| "Could not inspect assistant history")?
                    .len(),
            );
        }
    }
    let bytes = serde_json::to_vec(conversation).map_err(|_| "Invalid assistant history")?;
    if count >= MAX_CONVERSATIONS || total + bytes.len() as u64 > MAX_TOTAL_HISTORY {
        return Err("Local chat storage is full; delete an old conversation".into());
    }
    atomic_json(&path, conversation, MAX_HISTORY)
}
pub fn read_conversation(directory: &Path, id: &str) -> Result<Conversation, String> {
    let conversation: Conversation = read_json(
        &owned_path(&history_directory(directory)?, id)?,
        MAX_HISTORY as u64,
    )?;
    conversation.validate()?;
    if conversation.id != id {
        return Err("Assistant history identity does not match".into());
    }
    reject_json_credentials(
        &serde_json::to_value(&conversation).map_err(|_| "Invalid assistant history")?,
        None,
    )?;
    Ok(conversation)
}
pub fn list_conversations(
    directory: &Path,
    project_id: Option<&str>,
) -> Result<Vec<ConversationSummary>, String> {
    if let Some(id) = project_id {
        identity(id)?;
    }
    let mut result = Vec::new();
    for item in fs::read_dir(history_directory(directory)?)
        .map_err(|_| "Could not inspect assistant history")?
        .take(MAX_CONVERSATIONS + 1)
    {
        let item = item.map_err(|_| "Could not inspect assistant history")?;
        if let Some(id) = item.path().file_stem().and_then(|v| v.to_str()) {
            if let Ok(c) = read_conversation(directory, id) {
                if c.project_id.as_deref() == project_id {
                    result.push(ConversationSummary {
                        id: c.id,
                        project_id: c.project_id,
                        title: c.title,
                        updated_at: c.updated_at,
                        message_count: c.messages.len(),
                    });
                }
            }
        }
    }
    result.sort_by_key(|c| std::cmp::Reverse(c.updated_at));
    Ok(result)
}
pub fn delete_conversation(directory: &Path, id: &str) -> Result<(), String> {
    let path = owned_path(&history_directory(directory)?, id)?;
    if !path.exists() {
        return Ok(());
    }
    if !fs::symlink_metadata(&path)
        .map_err(|_| "Could not inspect assistant history")?
        .is_file()
    {
        return Err("Assistant history is not a regular file".into());
    }
    fs::remove_file(path).map_err(|_| "Could not delete assistant history".into())
}
pub fn append_audit(path: &Path, audit: &Audit) -> Result<(), String> {
    if path.exists() {
        let metadata =
            fs::symlink_metadata(path).map_err(|_| "Could not inspect assistant audit")?;
        if !metadata.is_file() || metadata.len() > 128 * 1024 {
            return Err("Assistant audit is full or invalid".into());
        }
    }
    let mut options = OpenOptions::new();
    options.create(true).append(true);
    protect_open(&mut options);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .map_err(|_| "Could not write assistant audit")?;
    let mut bytes = serde_json::to_vec(audit).map_err(|_| "Invalid assistant audit")?;
    bytes.push(b'\n');
    file.write_all(&bytes)
        .map_err(|_| "Could not write assistant audit".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    fn fixture_conversation() -> Conversation {
        Conversation {
            format_version: 1,
            id: uuid::Uuid::new_v4().to_string(),
            project_id: None,
            title: "Fixture".into(),
            updated_at: 1,
            messages: vec![],
        }
    }
    fn fixture_message(settings: &Settings) -> Message {
        Message {
            id: uuid::Uuid::new_v4().to_string(),
            role: Role::User,
            content: "Synthetic history".into(),
            created_at: 1,
            status: MessageStatus::Complete,
            provider: Some(settings.provider),
            model: Some(settings.model.clone()),
            endpoint: Some(settings.endpoint.clone()),
            local: Some(settings.local),
            remote_allowed: Some(!settings.local),
            context: None,
            usage: None,
        }
    }
    fn fixture_local() -> Settings {
        Settings {
            provider: Provider::Ollama,
            model: "fixture".into(),
            endpoint: "http://127.0.0.1:11434/v1".into(),
            local: true,
        }
    }
    fn fixture_compatible(endpoint: &str) -> Settings {
        Settings {
            provider: Provider::Compatible,
            model: "fixture".into(),
            endpoint: endpoint.into(),
            local: false,
        }
    }
    fn fixture_models() -> Vec<Model> {
        vec![Model {
            id: "fixture".into(),
            name: "Fixture".into(),
            streaming: "unknown".into(),
            context_tokens: None,
            output_tokens: None,
        }]
    }
    #[test]
    fn catalog_refresh_cannot_resurrect_disconnected_local_or_shared_origin_connections() {
        let directory = tempfile::tempdir().unwrap();
        let first = fixture_compatible("https://gateway.example/v1");
        let second = fixture_compatible("https://gateway.example/v2");
        let local = fixture_local();
        for settings in [first.clone(), second.clone(), local.clone()] {
            save_connection_with(directory.path(), settings, fixture_models(), &mut |_| {
                Ok(true)
            })
            .unwrap();
        }
        disconnect_with(
            directory.path(),
            &first,
            |_| panic!("Shared origin remains connected"),
            &mut |_| Ok(true),
        )
        .unwrap();
        disconnect_with(
            directory.path(),
            &local,
            |_| panic!("Local has no key"),
            &mut |_| Ok(true),
        )
        .unwrap();
        let original = fs::read(directory.path().join("settings.json")).unwrap();
        for stale in [first, local] {
            assert!(refresh_connection_with(
                directory.path(),
                stale,
                fixture_models(),
                &mut |_| Ok(true)
            )
            .is_err());
            assert_eq!(
                fs::read(directory.path().join("settings.json")).unwrap(),
                original
            );
        }
        let refreshed =
            refresh_connection_with(directory.path(), second, fixture_models(), &mut |_| {
                Ok(true)
            })
            .unwrap();
        assert_eq!(refreshed.connections.len(), 1);
    }
    #[test]
    fn one_os_credential_status_failure_does_not_hide_other_providers_or_expose_error_details() {
        let directory = tempfile::tempdir().unwrap();
        let first = fixture_compatible("https://first.example/v1");
        let second = fixture_compatible("https://second.example/v1");
        save_connection_with(
            directory.path(),
            first.clone(),
            fixture_models(),
            &mut |_| Ok(true),
        )
        .unwrap();
        save_connection_with(
            directory.path(),
            second.clone(),
            fixture_models(),
            &mut |_| Ok(true),
        )
        .unwrap();
        let original = fs::read(directory.path().join("settings.json")).unwrap();
        let mut present = |settings: &Settings| {
            if settings.endpoint == first.endpoint {
                Err("opaque-fixture-secret".into())
            } else {
                Ok(true)
            }
        };
        let value = configuration_with(
            read_stored_with(directory.path(), &mut present).unwrap(),
            &mut present,
        )
        .unwrap();
        assert_eq!(value.connections.len(), 2);
        assert!(!value.credential_present);
        assert!(!value.connections[0].credential_present);
        assert_eq!(
            value.connections[0].error.as_deref(),
            Some(CREDENTIAL_ACCESS_ERROR)
        );
        assert!(value.connections[1].credential_present);
        assert!(value.connections[1].error.is_none());
        assert!(!serde_json::to_string(&value)
            .unwrap()
            .contains("opaque-fixture-secret"));
        assert_eq!(
            fs::read(directory.path().join("settings.json")).unwrap(),
            original
        );
        let selected = select_settings_with(directory.path(), second, &mut present).unwrap();
        assert!(selected.credential_present);
        assert_eq!(selected.settings.endpoint, "https://second.example/v1");
    }
    #[test]
    fn connections_and_active_chat_selection_are_independent_and_disconnect_is_targeted() {
        let directory = tempfile::tempdir().unwrap();
        let first = fixture_compatible("https://first.example/v1");
        let second = fixture_compatible("https://second.example/v1");
        let mut present = |_: &Settings| Ok(true);
        let initial = save_connection_with(
            directory.path(),
            first.clone(),
            fixture_models(),
            &mut present,
        )
        .unwrap();
        assert_eq!(initial.settings.endpoint, first.endpoint);
        let both = save_connection_with(
            directory.path(),
            second.clone(),
            fixture_models(),
            &mut present,
        )
        .unwrap();
        assert_eq!(both.connections.len(), 2);
        assert_eq!(both.settings.endpoint, first.endpoint);
        let selected =
            select_settings_with(directory.path(), second.clone(), &mut present).unwrap();
        assert_eq!(selected.settings.endpoint, second.endpoint);
        assert_eq!(selected.connections[0].models[0].id, "fixture");
        let mut removed = Vec::new();
        let remaining = disconnect_with(
            directory.path(),
            &first,
            |settings| {
                removed.push(settings.endpoint.clone());
                Ok(())
            },
            &mut present,
        )
        .unwrap();
        assert_eq!(removed, vec![first.endpoint]);
        assert_eq!(remaining.connections.len(), 1);
        assert_eq!(remaining.settings.endpoint, second.endpoint);
        assert!(remaining.credential_present);
        assert_eq!(
            read_json::<StoredSettings>(
                &directory.path().join("settings.json"),
                MAX_SETTINGS as u64
            )
            .unwrap()
            .format_version,
            2
        );
    }
    #[test]
    fn migration_finds_previously_approved_official_keys_without_rewriting_legacy_bytes() {
        let directory = tempfile::tempdir().unwrap();
        let settings = Settings {
            model: "fixture".into(),
            ..Settings::default()
        };
        write_settings(directory.path(), settings.clone()).unwrap();
        let original = fs::read(directory.path().join("settings.json")).unwrap();
        let mut probed = Vec::new();
        let mut present = |connection: &Settings| {
            probed.push(connection.provider);
            Ok(connection.provider != Provider::Anthropic)
        };
        let stored = read_stored_with(directory.path(), &mut present).unwrap();
        assert_eq!(stored.connections.len(), 2);
        assert_eq!(stored.settings.provider, Provider::Gemini);
        assert_eq!(stored.settings.model, "fixture");
        assert_eq!(
            probed,
            vec![Provider::Gemini, Provider::Openai, Provider::Anthropic]
        );
        assert_eq!(
            fs::read(directory.path().join("settings.json")).unwrap(),
            original
        );
    }
    #[test]
    fn endpoint_paths_share_credentials_but_can_be_disconnected_independently() {
        let directory = tempfile::tempdir().unwrap();
        let first = fixture_compatible("https://gateway.example/v1");
        let second = fixture_compatible("https://gateway.example/v2");
        save_connection_with(
            directory.path(),
            first.clone(),
            fixture_models(),
            &mut |_| Ok(true),
        )
        .unwrap();
        save_connection_with(
            directory.path(),
            second.clone(),
            fixture_models(),
            &mut |_| Ok(true),
        )
        .unwrap();
        let remaining = disconnect_with(
            directory.path(),
            &first,
            |_| panic!("Shared origin key must remain"),
            &mut |_| Ok(true),
        )
        .unwrap();
        assert_eq!(remaining.connections.len(), 1);
        assert_eq!(remaining.settings.endpoint, second.endpoint);
    }
    #[test]
    fn unavailable_or_malformed_selection_preserves_registry() {
        let directory = tempfile::tempdir().unwrap();
        let settings = fixture_compatible("https://gateway.example/v1");
        save_connection_with(
            directory.path(),
            settings.clone(),
            fixture_models(),
            &mut |_| Ok(true),
        )
        .unwrap();
        let original = fs::read(directory.path().join("settings.json")).unwrap();
        let mut changed = settings.clone();
        changed.model = "unreported".into();
        assert!(select_settings_with(directory.path(), changed, &mut |_| Ok(true)).is_err());
        assert!(
            select_settings_with(directory.path(), settings.clone(), &mut |_| Ok(false)).is_err()
        );
        let mut models = fixture_models();
        models[0].name = "invalid\nname".into();
        assert!(
            save_connection_with(directory.path(), settings, models, &mut |_| Ok(true)).is_err()
        );
        assert_eq!(
            fs::read(directory.path().join("settings.json")).unwrap(),
            original
        );
    }
    #[test]
    fn connection_inventory_is_bounded_before_writing() {
        let directory = tempfile::tempdir().unwrap();
        for index in 0..MAX_CONNECTIONS {
            save_connection_with(
                directory.path(),
                fixture_compatible(&format!("https://fixture-{index}.example/v1")),
                fixture_models(),
                &mut |_| Ok(true),
            )
            .unwrap();
        }
        let original = fs::read(directory.path().join("settings.json")).unwrap();
        assert!(save_connection_with(
            directory.path(),
            fixture_compatible("https://additional.example/v1"),
            fixture_models(),
            &mut |_| Ok(true)
        )
        .is_err());
        assert_eq!(
            fs::read(directory.path().join("settings.json")).unwrap(),
            original
        );
    }
    #[test]
    fn disconnect_removes_only_the_current_key_and_clears_the_persisted_model() {
        let directory = tempfile::tempdir().unwrap();
        let settings = fixture_compatible("https://fixture.example/v1");
        write_settings(directory.path(), settings.clone()).unwrap();
        let history = fixture_conversation();
        write_conversation(directory.path(), &history).unwrap();
        let previous = fs::read(
            owned_path(&history_directory(directory.path()).unwrap(), &history.id).unwrap(),
        )
        .unwrap();
        let value = disconnect_with(
            directory.path(),
            &settings,
            |selected| {
                assert_eq!(selected.endpoint, settings.endpoint);
                assert_eq!(selected.model, settings.model);
                Ok(())
            },
            &mut |selected| Ok(selected.provider == Provider::Compatible),
        )
        .unwrap();
        assert!(value.settings.model.is_empty());
        assert!(!value.credential_present);
        assert!(read_settings(directory.path()).unwrap().model.is_empty());
        assert_eq!(
            fs::read(
                owned_path(&history_directory(directory.path()).unwrap(), &history.id).unwrap()
            )
            .unwrap(),
            previous
        );
    }
    #[test]
    fn failed_key_removal_keeps_connection_settings() {
        let directory = tempfile::tempdir().unwrap();
        let settings = fixture_compatible("https://fixture.example/v1");
        write_settings(directory.path(), settings.clone()).unwrap();
        let previous = fs::read(directory.path().join("settings.json")).unwrap();
        assert!(disconnect_with(
            directory.path(),
            &settings,
            |_| Err("Fixture OS failure".into()),
            &mut |_| Ok(true)
        )
        .is_err());
        assert_eq!(
            fs::read(directory.path().join("settings.json")).unwrap(),
            previous
        );
    }
    #[test]
    fn local_disconnect_does_not_access_the_os_credential_store() {
        let directory = tempfile::tempdir().unwrap();
        write_settings(directory.path(), fixture_local()).unwrap();
        let value = disconnect_with(
            directory.path(),
            &fixture_local(),
            |_| panic!("Local endpoints have no managed key"),
            &mut |_| Ok(false),
        )
        .unwrap();
        assert!(value.settings.model.is_empty());
        assert!(value.settings.local);
    }
    #[test]
    fn rejects_paths_and_credentials() {
        let dir = tempfile::tempdir().unwrap();
        assert!(owned_path(dir.path(), "../settings").is_err());
        assert!(
            reject_credentials("before unit-test-secret after", Some("unit-test-secret")).is_err()
        );
        assert!(reject_credentials("sk-fake-fixture-1234567890", None).is_err());
        assert!(reject_credentials("Stress in Pa", None).is_ok());
    }
    #[test]
    fn a_stale_disconnect_cannot_remove_a_new_connection() {
        let directory = tempfile::tempdir().unwrap();
        write_settings(directory.path(), fixture_local()).unwrap();
        assert!(disconnect_with(
            directory.path(),
            &fixture_compatible("https://fixture.example/v1"),
            |_| panic!("A stale confirmation cannot remove a different key"),
            &mut |_| Ok(false)
        )
        .is_err());
        assert_eq!(read_settings(directory.path()).unwrap().model, "fixture");
    }
    #[test]
    fn compatible_credentials_are_bound_to_canonical_provider_origin() {
        let mut settings = Settings {
            provider: Provider::Compatible,
            model: String::new(),
            endpoint: "https://gateway.example/v1".into(),
            local: false,
        };
        let account = credential_account(&settings).unwrap();
        settings.endpoint = "https://gateway.example:443/v2".into();
        assert_eq!(credential_account(&settings).unwrap(), account);
        settings.endpoint = "https://different.example/v1".into();
        assert_ne!(credential_account(&settings).unwrap(), account);
        settings.endpoint = "https://gateway.example:8443/v1".into();
        assert_ne!(credential_account(&settings).unwrap(), account);
    }
    #[test]
    fn recognizes_long_aq_credentials_at_token_boundaries() {
        let token = format!("AQ.{}", "fixture_tail-123_".repeat(2));
        for value in [
            token.clone(),
            format!("Bearer {token}"),
            format!("\"{token}\""),
            format!("before:{token},after"),
            format!("{token}.suffix"),
        ] {
            assert!(reject_credentials(&value, None).is_err());
        }
        assert!(reject_credentials(&format!("AQ.{}", "x".repeat(24)), None).is_err());
        assert!(reject_credentials(&format!("AQ.{}", "x".repeat(23)), None).is_ok());
        assert!(reject_credentials("AQ.test in a short label", None).is_ok());
        assert!(reject_credentials(&format!("PAQ.{}", "x".repeat(24)), None).is_ok());
    }
    #[test]
    fn history_generic_scan_uses_decoded_tokens_before_any_lookup() {
        let directory = tempfile::tempdir().unwrap();
        for token in [
            format!("AQ.{}", "x".repeat(24)),
            "sk-fixture-1234567890123456789".into(),
            "AIzaFixture1234567890123456789".into(),
        ] {
            for separator in ['\n', '\r', '\t'] {
                let mut conversation = fixture_conversation();
                let mut message = fixture_message(&fixture_local());
                message.content = format!("Before{separator}{token}");
                conversation.messages.push(message);
                assert!(write_conversation_checked_with(
                    directory.path(),
                    &conversation,
                    &fixture_local(),
                    |_| panic!("Credential-like history must not access the OS credential store"),
                )
                .is_err());
            }
        }
        assert!(!directory.path().join("conversations").exists());
    }
    #[test]
    fn history_credentials_include_active_and_all_historical_provider_origins() {
        let active = fixture_compatible("https://gateway.example/v1");
        let mut conversation = fixture_conversation();
        for connection in [
            active.clone(),
            fixture_compatible("https://gateway.example:443/other"),
            fixture_compatible("https://gateway.example:8443/v1"),
            Settings {
                provider: Provider::Openai,
                endpoint: official_endpoint(Provider::Openai).unwrap().into(),
                ..Settings::default()
            },
            fixture_compatible("https://api.openai.com/other"),
            Settings::default(),
            fixture_local(),
        ] {
            conversation.messages.push(fixture_message(&connection));
        }
        let namespaces = history_credential_settings(&conversation, &active)
            .unwrap()
            .iter()
            .map(|s| credential_account(s).unwrap())
            .collect::<Vec<_>>();
        assert_eq!(
            namespaces,
            vec![
                "compatible:https://gateway.example",
                "compatible:https://gateway.example:8443",
                "openai:https://api.openai.com",
                "compatible:https://api.openai.com",
                "gemini:https://generativelanguage.googleapis.com",
            ]
        );
    }
    #[test]
    fn legacy_official_provenance_uses_only_its_fixed_remote_endpoint() {
        let mut conversation = fixture_conversation();
        let mut message = fixture_message(&Settings::default());
        message.endpoint = None;
        message.local = None;
        conversation.messages.push(message);
        let settings = history_credential_settings(&conversation, &fixture_local()).unwrap();
        assert_eq!(settings.len(), 1);
        assert_eq!(settings[0].endpoint, Settings::default().endpoint);
        assert!(!settings[0].local);
        conversation.messages[0].local = Some(true);
        assert!(history_credential_settings(&conversation, &fixture_local()).is_err());
    }
    #[test]
    fn malformed_history_provenance_is_rejected_before_any_credential_lookup() {
        let directory = tempfile::tempdir().unwrap();
        let compatible = fixture_compatible("https://gateway.example/v1");
        let mut invalid = Vec::new();
        let mut conversation = fixture_conversation();
        conversation.messages.push(fixture_message(&compatible));
        conversation.messages[0].provider = None;
        invalid.push(conversation);
        let mut conversation = fixture_conversation();
        conversation.messages.push(fixture_message(&compatible));
        conversation.messages[0].endpoint = None;
        conversation.messages[0].local = Some(true);
        invalid.push(conversation);
        let mut conversation = fixture_conversation();
        conversation
            .messages
            .push(fixture_message(&fixture_local()));
        conversation.messages[0].endpoint = Some("http://remote.example/v1".into());
        invalid.push(conversation);
        let mut conversation = fixture_conversation();
        conversation
            .messages
            .push(fixture_message(&Settings::default()));
        conversation.messages[0].endpoint = Some("https://another.example/v1beta".into());
        invalid.push(conversation);
        let mut conversation = fixture_conversation();
        conversation
            .messages
            .push(fixture_message(&Settings::default()));
        conversation.project_id = Some("owned-project".into());
        conversation.messages[0].context = Some(Context {
            kind: ContextKind::Study,
            project_id: Some("other-project".into()),
            study_id: Some("study".into()),
            revision: Some(1),
            source_ids: vec![],
            text: "Synthetic context".into(),
        });
        invalid.push(conversation);
        let mut conversation = fixture_conversation();
        conversation.id = "../history".into();
        invalid.push(conversation);
        for conversation in invalid {
            assert!(write_conversation_checked_with(
                directory.path(),
                &conversation,
                &fixture_local(),
                |_| panic!("Invalid history must not access the OS credential store"),
            )
            .is_err());
        }
        assert!(!directory.path().join("conversations").exists());
    }
    #[test]
    fn history_namespace_limit_is_checked_before_any_credential_lookup() {
        let directory = tempfile::tempdir().unwrap();
        let mut conversation = fixture_conversation();
        for index in 0..MAX_HISTORY_CREDENTIAL_NAMESPACES {
            conversation
                .messages
                .push(fixture_message(&fixture_compatible(&format!(
                    "https://fixture-{index}.example/v1"
                ))));
        }
        let mut looked_up = 0;
        write_conversation_checked_with(directory.path(), &conversation, &fixture_local(), |_| {
            looked_up += 1;
            Ok(None)
        })
        .unwrap();
        assert_eq!(looked_up, MAX_HISTORY_CREDENTIAL_NAMESPACES);
        let active = fixture_compatible("https://additional.example/v1");
        let error =
            write_conversation_checked_with(directory.path(), &conversation, &active, |_| {
                panic!("Over-limit history must not access the OS credential store")
            })
            .unwrap_err();
        assert!(error.contains("at most 32"));
    }
    #[test]
    fn local_switch_cannot_store_a_historical_provider_secret() {
        let directory = tempfile::tempdir().unwrap();
        let mut conversation = fixture_conversation();
        write_conversation(directory.path(), &conversation).unwrap();
        let path = owned_path(
            &history_directory(directory.path()).unwrap(),
            &conversation.id,
        )
        .unwrap();
        let original = fs::read(&path).unwrap();
        let mut message = fixture_message(&Settings::default());
        message.content = "Before opaque-fixture-secret after".into();
        conversation.messages.push(message);
        let mut looked_up = Vec::new();
        let error = write_conversation_checked_with(
            directory.path(),
            &conversation,
            &fixture_local(),
            |settings| {
                looked_up.push(credential_account(settings).unwrap());
                Ok(Some(Zeroizing::new("opaque-fixture-secret".into())))
            },
        )
        .unwrap_err();
        assert_eq!(
            looked_up,
            vec!["gemini:https://generativelanguage.googleapis.com"]
        );
        assert!(!error.contains("opaque-fixture-secret"));
        assert_eq!(fs::read(&path).unwrap(), original);
    }
    #[test]
    fn history_exact_scan_handles_json_escaping_and_every_string_field() {
        let directory = tempfile::tempdir().unwrap();
        for secret in ["opaque\"fixture-secret", "opaque\\fixture-secret"] {
            for field in ["title", "content", "context"] {
                let mut conversation = fixture_conversation();
                let mut message =
                    fixture_message(&fixture_compatible("https://gateway.example/v1"));
                match field {
                    "title" => conversation.title = secret.into(),
                    "content" => message.content = secret.into(),
                    _ => {
                        message.context = Some(Context {
                            kind: ContextKind::Help,
                            project_id: None,
                            study_id: None,
                            revision: None,
                            source_ids: vec!["overview".into()],
                            text: secret.into(),
                        })
                    }
                }
                conversation.messages.push(message);
                assert!(!serde_json::to_string(&conversation)
                    .unwrap()
                    .contains(secret));
                let error = write_conversation_checked_with(
                    directory.path(),
                    &conversation,
                    &fixture_local(),
                    |_| Ok(Some(Zeroizing::new(secret.into()))),
                )
                .unwrap_err();
                assert!(!error.contains(secret));
            }
        }
        assert!(!directory.path().join("conversations").exists());
    }
    #[test]
    fn credential_access_failure_preserves_existing_history() {
        let directory = tempfile::tempdir().unwrap();
        let mut conversation = fixture_conversation();
        write_conversation(directory.path(), &conversation).unwrap();
        let path = owned_path(
            &history_directory(directory.path()).unwrap(),
            &conversation.id,
        )
        .unwrap();
        let original = fs::read(&path).unwrap();
        conversation
            .messages
            .push(fixture_message(&Settings::default()));
        let error = write_conversation_checked_with(
            directory.path(),
            &conversation,
            &fixture_local(),
            |_| Err(CREDENTIAL_ACCESS_ERROR.into()),
        )
        .unwrap_err();
        assert_eq!(error, CREDENTIAL_ACCESS_ERROR);
        assert_eq!(fs::read(&path).unwrap(), original);
    }
    #[cfg(unix)]
    #[test]
    fn consent_and_audit_permissions_and_symlinks_are_enforced() {
        use std::os::unix::fs::PermissionsExt;
        let directory = tempfile::tempdir().unwrap();
        let protected = directory.path().join("owned");
        ensure_directory(&protected).unwrap();
        assert_eq!(
            fs::metadata(&protected).unwrap().permissions().mode() & 0o777,
            0o700
        );
        let target = protected.join("snapshot.json");
        atomic_json(&target, &serde_json::json!({"data":"fixture"}), 1024).unwrap();
        assert_eq!(
            fs::metadata(&target).unwrap().permissions().mode() & 0o777,
            0o600
        );
        let audit = protected.join("fixture.audit");
        std::os::unix::fs::symlink(&target, &audit).unwrap();
        let entry = Audit {
            time: 1,
            tool: "phyra_help".into(),
            scope: "help".into(),
            project_id: None,
            revision: None,
            allowed: true,
        };
        assert!(append_audit(&audit, &entry).is_err());
        assert!(read_owned_bytes(&audit, 1024).is_err());
        fs::remove_file(&audit).unwrap();
        append_audit(&audit, &entry).unwrap();
        assert_eq!(
            fs::metadata(&audit).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
    #[test]
    fn atomic_history_is_versioned_and_validated() {
        let dir = tempfile::tempdir().unwrap();
        let c = Conversation {
            format_version: 1,
            id: uuid::Uuid::new_v4().to_string(),
            project_id: None,
            title: "Fixture".into(),
            updated_at: 1,
            messages: vec![],
        };
        write_conversation(dir.path(), &c).unwrap();
        assert_eq!(
            read_conversation(dir.path(), &c.id).unwrap().title,
            "Fixture"
        );
        let mut bad = c;
        bad.format_version = 2;
        assert!(write_conversation(dir.path(), &bad).is_err());
        delete_conversation(dir.path(), &bad.id).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn refuses_symlink_history() {
        let dir = tempfile::tempdir().unwrap();
        let history = history_directory(dir.path()).unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        std::os::unix::fs::symlink("/etc/passwd", owned_path(&history, &id).unwrap()).unwrap();
        assert!(read_conversation(dir.path(), &id).is_err());
        assert!(delete_conversation(dir.path(), &id).is_err());
    }
}
