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

//! Offline media: download, encrypt, list, progress and local stream URLs
//! (Subsystem 3).

use crate::commands::auth::load_session;
use crate::db::{now, schema::BADGE_FAMILIES};
use crate::security::crypto::CHUNK_SIZE;
use crate::tenant::sanitise_segment;
use crate::AppState;
use serde::Serialize;
use serde_json::{json, Map, Value};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaServerInfo {
    pub port: u16,
    pub base_url: String,
    pub families: Vec<String>,
}

#[tauri::command]
pub fn media_server_info(state: tauri::State<'_, AppState>) -> MediaServerInfo {
    MediaServerInfo {
        port: state.media.port,
        base_url: state.media.base_url(),
        families: BADGE_FAMILIES.iter().map(|f| f.to_string()).collect(),
    }
}

/// Downloads a remote file and stores it AES-256 encrypted.
#[tauri::command]
pub async fn media_import(
    state: tauri::State<'_, AppState>,
    tenant_id: String,
    user_id: i64,
    title: Option<String>,
    url: String,
) -> Result<Value, String> {
    let app = state.inner();
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("media URL must start with https://".to_string());
    }

    let media_id = uuid::Uuid::new_v4().to_string();
    let dir = app.data_dir.join("media").join(sanitise_segment(&tenant_id));
    let temp = dir.join(format!("{media_id}.part"));
    let encrypted_path = dir.join(format!("{media_id}.enc"));

    let token = load_session(app, &tenant_id)
        .ok()
        .filter(|session| url.starts_with(&session.site_url))
        .map(|session| session.token);

    app.http
        .download(&url, &temp, token.as_deref())
        .await
        .map_err(|e| format!("download media: {e}"))?;

    let crypto = app.crypto.clone();
    let source = temp.clone();
    let destination = encrypted_path.clone();
    let file_id = media_id.clone();

    let report = tauri::async_runtime::spawn_blocking(move || {
        crypto.encrypt_file(&source, &destination, &file_id)
    })
    .await
    .map_err(|e| format!("encrypt task: {e}"))??;

    let _ = std::fs::remove_file(&temp);

    app.db.execute(
        "INSERT INTO mdl_media_files
            (id, tenant_id, user_id, title, source_url, local_path, size_bytes, plain_bytes,
             encrypted, chunk_size, duration_seconds, watched_seconds, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9, 0, 0, ?10)",
        &[
            json!(media_id),
            json!(tenant_id),
            json!(user_id),
            json!(title),
            json!(url),
            json!(encrypted_path.to_string_lossy().to_string()),
            json!(report.encrypted_bytes as i64),
            json!(report.plain_bytes as i64),
            json!(CHUNK_SIZE as i64),
            json!(now()),
        ],
    )?;

    media_entry(app, &media_id)
}

#[tauri::command]
pub fn media_list(
    state: tauri::State<'_, AppState>,
    tenant_id: String,
    user_id: i64,
) -> Result<Vec<Value>, String> {
    let app = state.inner();
    let rows = app.db.query(
        "SELECT id, title, source_url, size_bytes, plain_bytes, duration_seconds, watched_seconds, created_at
         FROM mdl_media_files
         WHERE tenant_id = ?1 AND user_id = ?2
         ORDER BY created_at DESC",
        &[json!(tenant_id), json!(user_id)],
    )?;

    Ok(rows
        .into_iter()
        .map(|mut row| {
            let id = row
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            row.insert("streamUrl".to_string(), json!(app.media.stream_url(&id)));
            Value::Object(row)
        })
        .collect())
}

#[tauri::command]
pub fn media_progress(
    state: tauri::State<'_, AppState>,
    media_id: String,
    watched_seconds: i64,
) -> Result<(), String> {
    state.db.execute(
        "UPDATE mdl_media_files SET watched_seconds = MAX(watched_seconds, ?2) WHERE id = ?1",
        &[json!(media_id), json!(watched_seconds.max(0))],
    )?;

    Ok(())
}

#[tauri::command]
pub fn media_remove(state: tauri::State<'_, AppState>, media_id: String) -> Result<(), String> {
    let row = state.db.query_one(
        "SELECT local_path FROM mdl_media_files WHERE id = ?1",
        &[json!(media_id)],
    )?;

    if let Some(path) = row
        .as_ref()
        .and_then(|row| row.get("local_path"))
        .and_then(Value::as_str)
    {
        let _ = std::fs::remove_file(path);
    }

    state
        .db
        .execute("DELETE FROM mdl_media_files WHERE id = ?1", &[json!(media_id)])?;

    Ok(())
}

fn media_entry(app: &AppState, media_id: &str) -> Result<Value, String> {
    let row: Map<String, Value> = app
        .db
        .query_one(
            "SELECT id, title, source_url, size_bytes, plain_bytes, duration_seconds, watched_seconds, created_at
             FROM mdl_media_files WHERE id = ?1",
            &[json!(media_id)],
        )?
        .ok_or("media row disappeared after import")?;

    let mut row = row;
    row.insert("streamUrl".to_string(), json!(app.media.stream_url(media_id)));

    Ok(Value::Object(row))
}
