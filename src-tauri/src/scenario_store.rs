//! Atomic on-disk store for user-named Dynamic scenarios.
//!
//! The file is a single JSON document (`scenarios.json`) inside the Tauri app
//! data directory and carries an explicit `schema_version`. Scenario text is
//! plain, non-secret content the user explicitly chose to save here; it must
//! never reach logs, error messages, diagnostics or command DTOs.
//!
//! All validation happens before a write, and the write itself is
//! temp-file + flush/sync + atomic replace so a corrupted file is preserved and
//! no partial document is ever visible.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager, Runtime};

use crate::commands::CommandError;

/// Current and only supported document version.
pub const SCENARIO_SCHEMA_VERSION: u32 = 1;
/// File name inside the app data directory.
pub const SCENARIO_FILE_NAME: &str = "scenarios.json";

/// Protocol-safe upper bound for printable text (matches the wire limit).
pub const MAX_SCENARIO_TEXT_BYTES: usize = 512;
/// Display-name bound; names are UI labels, not device values.
pub const MAX_SCENARIO_NAME_BYTES: usize = 64;
/// Refuse unbounded documents instead of truncating user data.
pub const MAX_SCENARIO_COUNT: usize = 256;
/// TTL bounds accepted by the Dynamic protocol (seconds).
pub const MIN_TTL_SECONDS: u32 = 1;
pub const MAX_TTL_SECONDS: u32 = 86_400;

/// One persisted scenario. Field names are the stable on-disk contract.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PersistedScenario {
    /// Opaque desktop id; never a protocol slot or HID path.
    pub id: String,
    pub name: String,
    /// Non-secret plain text the user chose to store.
    pub text: String,
    /// `null` keeps the device default TTL.
    pub ttl_seconds: Option<u32>,
    pub keep_after_execute: bool,
    /// Opaque device alias or `null`; never a HID path or serial.
    pub target_device: Option<String>,
    /// Opaque object id or `null`; never a numeric wire slot.
    pub target_object: Option<String>,
}

/// Complete stored document.
///
/// This is the on-disk schema only (`snake_case` JSON keys). The Tauri wire
/// format is a separate DTO (`ScenarioDocumentDto`) so that neither side can
/// drift into the other's field names.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScenarioDocument {
    pub schema_version: u32,
    pub scenarios: Vec<PersistedScenario>,
}

impl Default for ScenarioDocument {
    fn default() -> Self {
        Self {
            schema_version: SCENARIO_SCHEMA_VERSION,
            scenarios: Vec::new(),
        }
    }
}

/// Tauri wire DTO for one scenario (`camelCase`, matches `src/bridge.ts`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedScenarioDto {
    pub id: String,
    pub name: String,
    pub text: String,
    pub ttl_seconds: Option<u32>,
    pub keep_after_execute: bool,
    pub target_device: Option<String>,
    pub target_object: Option<String>,
}

/// Tauri wire DTO for the whole document (`camelCase`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioDocumentDto {
    pub schema_version: u32,
    pub scenarios: Vec<PersistedScenarioDto>,
}

impl From<&ScenarioDocument> for ScenarioDocumentDto {
    fn from(document: &ScenarioDocument) -> Self {
        Self {
            schema_version: document.schema_version,
            scenarios: document
                .scenarios
                .iter()
                .map(|scenario| PersistedScenarioDto {
                    id: scenario.id.clone(),
                    name: scenario.name.clone(),
                    text: scenario.text.clone(),
                    ttl_seconds: scenario.ttl_seconds,
                    keep_after_execute: scenario.keep_after_execute,
                    target_device: scenario.target_device.clone(),
                    target_object: scenario.target_object.clone(),
                })
                .collect(),
        }
    }
}

impl From<&ScenarioDocumentDto> for ScenarioDocument {
    fn from(document: &ScenarioDocumentDto) -> Self {
        Self {
            schema_version: document.schema_version,
            scenarios: document
                .scenarios
                .iter()
                .map(|scenario| PersistedScenario {
                    id: scenario.id.clone(),
                    name: scenario.name.clone(),
                    text: scenario.text.clone(),
                    ttl_seconds: scenario.ttl_seconds,
                    keep_after_execute: scenario.keep_after_execute,
                    target_device: scenario.target_device.clone(),
                    target_object: scenario.target_object.clone(),
                })
                .collect(),
        }
    }
}

/// Sanitized store failure. Carries no path, OS text or scenario content.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScenarioStoreError {
    /// The file exists but cannot be parsed, or is not supported schema.
    Corrupt,
    /// The document is structurally fine but violates a scenario invariant.
    Invalid,
    /// The write (or its atomic replace) failed.
    WriteFailed,
    /// The app data directory is unknown or cannot be created.
    Unavailable,
}

impl ScenarioStoreError {
    pub fn code(self) -> &'static str {
        match self {
            Self::Corrupt => "scenario_store_corrupt",
            Self::Invalid => "scenario_store_invalid",
            Self::WriteFailed => "scenario_store_write_failed",
            Self::Unavailable => "scenario_store_unavailable",
        }
    }

    pub fn message(self) -> &'static str {
        match self {
            Self::Corrupt => {
                "The saved scenarios file could not be read. The file was left unchanged."
            }
            Self::Invalid => "The scenario data is not valid and was not saved.",
            Self::WriteFailed => "The scenario file could not be written.",
            Self::Unavailable => "The scenario storage location is unavailable.",
        }
    }
}

impl std::fmt::Display for ScenarioStoreError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.message())
    }
}

impl std::error::Error for ScenarioStoreError {}

impl From<ScenarioStoreError> for CommandError {
    fn from(error: ScenarioStoreError) -> Self {
        CommandError {
            code: error.code().to_string(),
            message: error.message().to_string(),
        }
    }
}

/// True for the text character set accepted by the Dynamic protocol:
/// printable US ASCII plus LF, Tab and Backspace.
pub fn is_supported_text(text: &str) -> bool {
    text.bytes()
        .all(|byte| matches!(byte, 0x20..=0x7e | b'\n' | b'\t' | 0x08))
}

fn valid_opaque(value: &str) -> bool {
    !value.is_empty() && value.len() <= 64 && value.bytes().all(|byte| byte.is_ascii_graphic())
}

/// Validate the whole document before any write; never truncates or repairs.
pub fn validate(document: &ScenarioDocument) -> Result<(), ScenarioStoreError> {
    if document.schema_version != SCENARIO_SCHEMA_VERSION {
        return Err(ScenarioStoreError::Corrupt);
    }
    if document.scenarios.len() > MAX_SCENARIO_COUNT {
        return Err(ScenarioStoreError::Invalid);
    }
    let mut seen_ids: Vec<&str> = Vec::with_capacity(document.scenarios.len());
    for scenario in &document.scenarios {
        if !valid_opaque(&scenario.id) || seen_ids.contains(&scenario.id.as_str()) {
            return Err(ScenarioStoreError::Invalid);
        }
        seen_ids.push(&scenario.id);
        if scenario.name.trim().is_empty() || scenario.name.len() > MAX_SCENARIO_NAME_BYTES {
            return Err(ScenarioStoreError::Invalid);
        }
        if scenario.text.len() > MAX_SCENARIO_TEXT_BYTES || !is_supported_text(&scenario.text) {
            return Err(ScenarioStoreError::Invalid);
        }
        if let Some(ttl) = scenario.ttl_seconds {
            if !(MIN_TTL_SECONDS..=MAX_TTL_SECONDS).contains(&ttl) {
                return Err(ScenarioStoreError::Invalid);
            }
        }
        for value in [&scenario.target_device, &scenario.target_object]
            .into_iter()
            .flatten()
        {
            if !valid_opaque(value) {
                return Err(ScenarioStoreError::Invalid);
            }
        }
    }
    Ok(())
}

/// Parse a raw document body. Rejects unknown schema versions without touching
/// the source file.
pub fn parse_document(raw: &str) -> Result<ScenarioDocument, ScenarioStoreError> {
    let document: ScenarioDocument =
        serde_json::from_str(raw).map_err(|_| ScenarioStoreError::Corrupt)?;
    validate(&document)?;
    Ok(document)
}

/// Read the document at `path`. A missing file is an empty current-version
/// document; a broken file is reported as corrupt and left untouched.
pub fn load_from_path(path: &Path) -> Result<ScenarioDocument, ScenarioStoreError> {
    match fs::read_to_string(path) {
        Ok(raw) => parse_document(&raw),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(ScenarioDocument::default())
        }
        // Permission and other I/O failures are a storage problem, not a
        // corrupt document; the file itself is left untouched either way.
        Err(_) => Err(ScenarioStoreError::Unavailable),
    }
}

/// Process-wide write lock so concurrent saves cannot share one temp file.
static SAVE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn temp_path_for(path: &Path) -> Result<PathBuf, ScenarioStoreError> {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or(ScenarioStoreError::Unavailable)?;
    Ok(path.with_file_name(format!("{file_name}.tmp")))
}

/// Validate, then atomically replace `path` through a sibling temp file.
///
/// The temp file is always removed on failure; the previous file is only
/// replaced after the new bytes are flushed and synced.
pub fn save_to_path(path: &Path, document: &ScenarioDocument) -> Result<(), ScenarioStoreError> {
    // Held across validation, temp write and replace: a second save on any
    // thread waits instead of racing over the single fixed temp file.
    let _guard = SAVE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    validate(document)?;
    let serialized =
        serde_json::to_string_pretty(document).map_err(|_| ScenarioStoreError::WriteFailed)?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|_| ScenarioStoreError::Unavailable)?;
    }

    let temp_path = temp_path_for(path)?;
    let write_result = (|| -> std::io::Result<()> {
        let mut file = fs::File::create(&temp_path)?;
        file.write_all(serialized.as_bytes())?;
        file.write_all(b"\n")?;
        file.flush()?;
        file.sync_all()?;
        Ok(())
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temp_path);
        return Err(ScenarioStoreError::WriteFailed);
    }

    if replace_file(&temp_path, path).is_err() {
        let _ = fs::remove_file(&temp_path);
        return Err(ScenarioStoreError::WriteFailed);
    }

    Ok(())
}

/// Replace `path` with `temp_path`.
///
/// A direct rename is atomic on Unix and on Windows when the target is absent.
/// Windows refuses rename-over-existing, so that case goes through a backup
/// swap instead of deleting the previous document up front.
fn replace_file(temp_path: &Path, path: &Path) -> std::io::Result<()> {
    match fs::rename(temp_path, path) {
        Ok(()) => Ok(()),
        Err(_) => replace_file_with_backup(temp_path, path),
    }
}

/// Keep the previous document under a backup name until the new bytes are in
/// place, and restore it if the replacement fails.
fn replace_file_with_backup(temp_path: &Path, path: &Path) -> std::io::Result<()> {
    let backup = temp_path_for(path).map_err(|_| std::io::Error::other("no backup path"))?;
    let backup = backup.with_extension("bak");
    let had_original = path.exists();
    if had_original {
        let _ = fs::remove_file(&backup);
        fs::rename(path, &backup)?;
    }
    match fs::rename(temp_path, path) {
        Ok(()) => {
            if had_original {
                let _ = fs::remove_file(&backup);
            }
            Ok(())
        }
        Err(error) => {
            if had_original {
                let _ = fs::rename(&backup, path);
            }
            Err(error)
        }
    }
}

/// Resolve the store path inside the app data directory.
pub fn scenario_file_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, ScenarioStoreError> {
    app.path()
        .resolve(SCENARIO_FILE_NAME, BaseDirectory::AppData)
        .map_err(|_| ScenarioStoreError::Unavailable)
}

#[tauri::command]
pub async fn load_scenarios<R: Runtime>(
    app: AppHandle<R>,
) -> Result<ScenarioDocumentDto, CommandError> {
    let path = scenario_file_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        load_from_path(&path)
            .map(|document| ScenarioDocumentDto::from(&document))
            .map_err(CommandError::from)
    })
    .await
    .map_err(|_| CommandError {
        code: ScenarioStoreError::Unavailable.code().to_string(),
        message: ScenarioStoreError::Unavailable.message().to_string(),
    })?
}

#[tauri::command]
pub async fn save_scenarios<R: Runtime>(
    app: AppHandle<R>,
    document: ScenarioDocumentDto,
) -> Result<ScenarioDocumentDto, CommandError> {
    if document.schema_version != SCENARIO_SCHEMA_VERSION {
        return Err(ScenarioStoreError::Corrupt.into());
    }
    let path = scenario_file_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let persisted = ScenarioDocument::from(&document);
        save_to_path(&path, &persisted)?;
        Ok::<ScenarioDocumentDto, ScenarioStoreError>(document)
    })
    .await
    .map_err(|_| CommandError {
        code: ScenarioStoreError::Unavailable.code().to_string(),
        message: ScenarioStoreError::Unavailable.message().to_string(),
    })?
    .map_err(CommandError::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(id: &str) -> PersistedScenario {
        PersistedScenario {
            id: id.to_string(),
            name: "Sample name".to_string(),
            text: "line one\nline two".to_string(),
            ttl_seconds: Some(300),
            keep_after_execute: true,
            target_device: None,
            target_object: Some("object-alpha".to_string()),
        }
    }

    fn sample_document() -> ScenarioDocument {
        ScenarioDocument {
            schema_version: SCENARIO_SCHEMA_VERSION,
            scenarios: vec![sample("abc-1"), sample("abc-2")],
        }
    }

    fn temp_dir(name: &str) -> PathBuf {
        let mut dir = std::env::temp_dir();
        dir.push(format!("rm-scenario-store-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    #[test]
    fn missing_file_is_empty_document() {
        let dir = temp_dir("missing");
        let path = dir.join(SCENARIO_FILE_NAME);
        let document = load_from_path(&path).expect("empty document");
        assert_eq!(document.schema_version, SCENARIO_SCHEMA_VERSION);
        assert!(document.scenarios.is_empty());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn round_trip_preserves_structure() {
        let dir = temp_dir("roundtrip");
        let path = dir.join(SCENARIO_FILE_NAME);
        let document = sample_document();
        save_to_path(&path, &document).expect("save");

        let loaded = load_from_path(&path).expect("load");
        assert_eq!(loaded.schema_version, SCENARIO_SCHEMA_VERSION);
        assert_eq!(loaded.scenarios.len(), document.scenarios.len());
        assert_eq!(loaded.scenarios[0].id, document.scenarios[0].id);
        assert_eq!(loaded, document);

        // No temp residue after a successful replace.
        assert!(!temp_path_for(&path).expect("temp path").exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn unsupported_schema_version_is_rejected() {
        let document = ScenarioDocument {
            schema_version: 2,
            scenarios: Vec::new(),
        };
        assert_eq!(validate(&document), Err(ScenarioStoreError::Corrupt));
        let raw = r#"{"schema_version":2,"scenarios":[]}"#;
        assert_eq!(parse_document(raw), Err(ScenarioStoreError::Corrupt));
    }

    #[test]
    fn corrupt_json_keeps_original_file() {
        let dir = temp_dir("corrupt");
        let path = dir.join(SCENARIO_FILE_NAME);
        let original = "{ not json";
        fs::write(&path, original).expect("seed corrupt file");

        let error = load_from_path(&path).expect_err("corrupt");
        assert_eq!(error, ScenarioStoreError::Corrupt);
        assert_eq!(error.code(), "scenario_store_corrupt");
        let stored = fs::read_to_string(&path).expect("file still present");
        assert_eq!(stored, original);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn disk_json_uses_snake_case_keys() {
        let raw = serde_json::to_string(&sample_document()).expect("serialize");
        let value: serde_json::Value = serde_json::from_str(&raw).expect("json");
        assert!(value.get("schema_version").is_some());
        assert!(value.get("schemaVersion").is_none());
        let scenario = &value["scenarios"][0];
        for key in [
            "ttl_seconds",
            "keep_after_execute",
            "target_device",
            "target_object",
        ] {
            assert!(scenario.get(key).is_some(), "disk key {key} missing");
        }
        for key in [
            "ttlSeconds",
            "keepAfterExecute",
            "targetDevice",
            "targetObject",
        ] {
            assert!(scenario.get(key).is_none(), "wire key {key} leaked to disk");
        }
    }

    #[test]
    fn wire_dto_uses_camel_case_keys_and_round_trips() {
        let dto = ScenarioDocumentDto::from(&sample_document());
        let value = serde_json::to_value(&dto).expect("json");
        assert!(value.get("schemaVersion").is_some());
        assert!(value.get("schema_version").is_none());
        let scenario = &value["scenarios"][0];
        for key in [
            "ttlSeconds",
            "keepAfterExecute",
            "targetDevice",
            "targetObject",
        ] {
            assert!(scenario.get(key).is_some(), "wire key {key} missing");
        }
        for key in [
            "ttl_seconds",
            "keep_after_execute",
            "target_device",
            "target_object",
        ] {
            assert!(scenario.get(key).is_none(), "disk key {key} leaked to wire");
        }
        // Nullable wire fields are present as JSON null, not omitted.
        assert!(scenario
            .get("targetDevice")
            .expect("targetDevice")
            .is_null());

        let back: ScenarioDocumentDto = serde_json::from_value(value).expect("parse wire DTO");
        assert_eq!(ScenarioDocument::from(&back), sample_document());
    }

    #[test]
    fn missing_scenarios_field_is_corrupt() {
        assert_eq!(
            parse_document(r#"{"schema_version":1}"#),
            Err(ScenarioStoreError::Corrupt)
        );
        assert!(serde_json::from_str::<ScenarioDocumentDto>(r#"{"schemaVersion":1}"#).is_err());
    }

    #[test]
    fn unreadable_path_is_unavailable_and_missing_is_empty() {
        let dir = temp_dir("read-errors");
        // A directory at the store path is an I/O failure, not a corrupt file.
        let error = load_from_path(&dir).expect_err("directory is unreadable");
        assert_eq!(error, ScenarioStoreError::Unavailable);
        assert_eq!(error.code(), "scenario_store_unavailable");
        assert_eq!(
            load_from_path(&dir.join("absent.json")).expect("missing file"),
            ScenarioDocument::default()
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn concurrent_saves_serialize_and_leave_no_residue() {
        let dir = temp_dir("concurrent");
        let path = dir.join(SCENARIO_FILE_NAME);
        let handles: Vec<_> = (0..8)
            .map(|index| {
                let path = path.clone();
                let document = ScenarioDocument {
                    schema_version: SCENARIO_SCHEMA_VERSION,
                    scenarios: vec![sample(&format!("id-{index}"))],
                };
                std::thread::spawn(move || {
                    save_to_path(&path, &document).expect("save");
                    document
                })
            })
            .collect();
        let documents: Vec<ScenarioDocument> = handles
            .into_iter()
            .map(|handle| handle.join().expect("join"))
            .collect();

        let loaded = load_from_path(&path).expect("load");
        assert!(
            documents.contains(&loaded),
            "stored document must be exactly one written document"
        );
        assert!(!temp_path_for(&path).expect("temp path").exists());
        assert!(!path.with_extension("bak").exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn validation_rejects_invalid_payloads() {
        let duplicate = ScenarioDocument {
            schema_version: SCENARIO_SCHEMA_VERSION,
            scenarios: vec![sample("dup"), sample("dup")],
        };
        assert_eq!(validate(&duplicate), Err(ScenarioStoreError::Invalid));

        let empty_id = ScenarioDocument {
            schema_version: SCENARIO_SCHEMA_VERSION,
            scenarios: vec![sample("")],
        };
        assert_eq!(validate(&empty_id), Err(ScenarioStoreError::Invalid));

        let long_name = ScenarioDocument {
            schema_version: SCENARIO_SCHEMA_VERSION,
            scenarios: vec![PersistedScenario {
                name: "n".repeat(MAX_SCENARIO_NAME_BYTES + 1),
                ..sample("long-name")
            }],
        };
        assert_eq!(validate(&long_name), Err(ScenarioStoreError::Invalid));

        let blank_name = ScenarioDocument {
            schema_version: SCENARIO_SCHEMA_VERSION,
            scenarios: vec![PersistedScenario {
                name: "   ".to_string(),
                ..sample("blank-name")
            }],
        };
        assert_eq!(validate(&blank_name), Err(ScenarioStoreError::Invalid));

        let bad_chars = ScenarioDocument {
            schema_version: SCENARIO_SCHEMA_VERSION,
            scenarios: vec![PersistedScenario {
                text: "unsupported ✨".to_string(),
                ..sample("bad-chars")
            }],
        };
        assert_eq!(validate(&bad_chars), Err(ScenarioStoreError::Invalid));

        let long_text = ScenarioDocument {
            schema_version: SCENARIO_SCHEMA_VERSION,
            scenarios: vec![PersistedScenario {
                text: "a".repeat(MAX_SCENARIO_TEXT_BYTES + 1),
                ..sample("long-text")
            }],
        };
        assert_eq!(validate(&long_text), Err(ScenarioStoreError::Invalid));

        for ttl in [0, MAX_TTL_SECONDS + 1] {
            let bad_ttl = ScenarioDocument {
                schema_version: SCENARIO_SCHEMA_VERSION,
                scenarios: vec![PersistedScenario {
                    ttl_seconds: Some(ttl),
                    ..sample("bad-ttl")
                }],
            };
            assert_eq!(validate(&bad_ttl), Err(ScenarioStoreError::Invalid));
        }

        let too_many = ScenarioDocument {
            schema_version: SCENARIO_SCHEMA_VERSION,
            scenarios: (0..=MAX_SCENARIO_COUNT)
                .map(|index| sample(&format!("id-{index}")))
                .collect(),
        };
        assert_eq!(validate(&too_many), Err(ScenarioStoreError::Invalid));
    }

    #[test]
    fn invalid_payload_is_never_written_and_temp_is_cleaned() {
        let dir = temp_dir("atomic");
        let path = dir.join(SCENARIO_FILE_NAME);
        save_to_path(&path, &sample_document()).expect("initial save");

        let invalid = ScenarioDocument {
            schema_version: SCENARIO_SCHEMA_VERSION,
            scenarios: vec![sample("broken")]
                .into_iter()
                .map(|mut s| {
                    s.ttl_seconds = Some(0);
                    s
                })
                .collect(),
        };
        assert_eq!(
            save_to_path(&path, &invalid),
            Err(ScenarioStoreError::Invalid)
        );

        // Previous document survives and no temp file is left behind.
        let loaded = load_from_path(&path).expect("previous document");
        assert_eq!(loaded.scenarios.len(), 2);
        assert!(!temp_path_for(&path).expect("temp path").exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn backup_swap_replaces_and_leaves_no_residue() {
        let dir = temp_dir("backup-swap");
        let path = dir.join(SCENARIO_FILE_NAME);
        let temp = temp_path_for(&path).expect("temp path");
        fs::write(&path, "previous document").expect("seed previous");
        fs::write(&temp, "next document").expect("seed next");

        replace_file_with_backup(&temp, &path).expect("backup swap");

        assert_eq!(
            fs::read_to_string(&path).expect("new file"),
            "next document"
        );
        assert!(!temp.exists());
        assert!(!path.with_extension("bak").exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn text_charset_matches_protocol() {
        assert!(is_supported_text("ok\n\t\u{8}"));
        assert!(!is_supported_text("emoji ✨"));
        assert!(!is_supported_text("中文"));
    }
}
