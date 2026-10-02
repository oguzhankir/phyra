//! Secret-free, versioned local state. Provider credentials use native OS stores.
use super::{providers::validate_settings, types::*};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};
use tauri::Manager;
use zeroize::Zeroizing;
const MAX_CONVERSATIONS: usize = 100;
const MAX_TOTAL_HISTORY: u64 = 32 * 1024 * 1024;

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
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredSettings {
    format_version: u32,
    settings: Settings,
}
pub fn read_settings(directory: &Path) -> Result<Settings, String> {
    let path = directory.join("settings.json");
    if !path.exists() {
        return Ok(Settings::default());
    }
    let stored: StoredSettings = read_json(&path, 4096)?;
    if stored.format_version != 1 {
        return Err("Unsupported assistant settings version".into());
    }
    validate_settings(&stored.settings, false)?;
    Ok(stored.settings)
}
pub fn write_settings(directory: &Path, settings: Settings) -> Result<(), String> {
    validate_settings(&settings, false)?;
    atomic_json(
        &directory.join("settings.json"),
        &StoredSettings {
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
        Err(_) => Err("The OS credential store could not unlock this provider credential".into()),
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
    Ok(())
}
fn history_directory(directory: &Path) -> Result<PathBuf, String> {
    let path = directory.join("conversations");
    ensure_directory(&path)?;
    Ok(path)
}
pub fn write_conversation(directory: &Path, conversation: &Conversation) -> Result<(), String> {
    conversation.validate()?;
    reject_credentials(
        &serde_json::to_string(conversation).map_err(|_| "Invalid assistant history")?,
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
    reject_credentials(
        &serde_json::to_string(&conversation).map_err(|_| "Invalid assistant history")?,
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
