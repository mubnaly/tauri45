// (C) Copyright 2015 Moodle Pty Ltd.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

//! Sandboxed filesystem abstraction over `<app_data>` (Subsystem 1 / 3).
//!
//! Every path is resolved inside the app data directory; traversal sequences and
//! absolute paths are rejected before touching the disk.

use crate::AppState;
use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageUsage {
    pub data_dir: String,
    pub db_bytes: u64,
    pub media_bytes: u64,
    pub key_bytes: u64,
    pub total_bytes: u64,
}

#[tauri::command]
pub fn storage_usage(state: tauri::State<'_, AppState>) -> StorageUsage {
    let data_dir = state.data_dir.clone();

    StorageUsage {
        db_bytes: dir_size(&data_dir, &["allama.db", "allama.db-wal", "allama.db-shm"]),
        media_bytes: dir_size(&data_dir, &["media"]),
        key_bytes: dir_size(&data_dir, &["keys"]),
        total_bytes: tree_size(&data_dir),
        data_dir: data_dir.to_string_lossy().to_string(),
    }
}

#[tauri::command]
pub fn storage_write_text(
    state: tauri::State<'_, AppState>,
    relative: String,
    contents: String,
) -> Result<String, String> {
    let path = resolve(&state.data_dir, &relative)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create {parent:?}: {e}"))?;
    }

    std::fs::write(&path, contents).map_err(|e| format!("write {path:?}: {e}"))?;

    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn storage_read_text(
    state: tauri::State<'_, AppState>,
    relative: String,
) -> Result<Option<String>, String> {
    let path = resolve(&state.data_dir, &relative)?;
    if !path.exists() {
        return Ok(None);
    }

    std::fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("read {path:?}: {e}"))
}

#[tauri::command]
pub fn storage_list(
    state: tauri::State<'_, AppState>,
    relative: Option<String>,
) -> Result<Vec<Value>, String> {
    let path = resolve(&state.data_dir, relative.as_deref().unwrap_or(""))?;
    if !path.is_dir() {
        return Ok(Vec::new());
    }

    let mut entries = Vec::new();
    for entry in std::fs::read_dir(&path).map_err(|e| format!("list {path:?}: {e}"))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let metadata = entry.metadata().map_err(|e| e.to_string())?;

        entries.push(json!({
            "name": entry.file_name().to_string_lossy(),
            "isDir": metadata.is_dir(),
            "bytes": metadata.len(),
        }));
    }

    entries.sort_by(|a, b| {
        a.get("name")
            .and_then(Value::as_str)
            .cmp(&b.get("name").and_then(Value::as_str))
    });

    Ok(entries)
}

#[tauri::command]
pub fn storage_remove(
    state: tauri::State<'_, AppState>,
    relative: String,
) -> Result<(), String> {
    let path = resolve(&state.data_dir, &relative)?;
    if path == state.data_dir {
        return Err("refusing to delete the app data directory".to_string());
    }

    if path.is_dir() {
        std::fs::remove_dir_all(&path).map_err(|e| format!("remove {path:?}: {e}"))
    } else if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("remove {path:?}: {e}"))
    } else {
        Ok(())
    }
}

fn resolve(root: &Path, relative: &str) -> Result<PathBuf, String> {
    if relative.trim().is_empty() {
        return Ok(root.to_path_buf());
    }
    if relative.starts_with('/') || relative.starts_with('\\') || relative.contains(':') {
        return Err("absolute paths are not allowed".to_string());
    }
    if relative
        .split(|c| c == '/' || c == '\\')
        .any(|segment| segment == "..")
    {
        return Err("path traversal is not allowed".to_string());
    }

    Ok(root.join(relative))
}

fn dir_size(root: &Path, entries: &[&str]) -> u64 {
    entries
        .iter()
        .map(|entry| {
            let path = root.join(entry);
            if path.is_dir() {
                tree_size(&path)
            } else {
                std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0)
            }
        })
        .sum()
}

fn tree_size(root: &Path) -> u64 {
    let mut total = 0;
    let Ok(entries) = std::fs::read_dir(root) else {
        return 0;
    };

    for entry in entries.flatten() {
        let Ok(metadata) = entry.metadata() else { continue };
        if metadata.is_dir() {
            total += tree_size(&entry.path());
        } else {
            total += metadata.len();
        }
    }

    total
}
