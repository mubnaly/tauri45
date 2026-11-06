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

//! Social feed. Every query is scoped by `tenant_id`, so a tenant can never read
//! another tenant's community even though they share one local database.

use crate::db::now;
use crate::AppState;
use serde_json::{json, Value};

#[tauri::command]
pub fn social_posts(
    state: tauri::State<'_, AppState>,
    tenant_id: String,
    limit: Option<i64>,
) -> Result<Vec<Value>, String> {
    let rows = state.db.query(
        "SELECT id, author, body, likes, created_at, synced_at
         FROM mdl_social_posts
         WHERE tenant_id = ?1
         ORDER BY created_at DESC
         LIMIT ?2",
        &[json!(tenant_id), json!(limit.unwrap_or(50).clamp(1, 200))],
    )?;

    Ok(rows.into_iter().map(Value::Object).collect())
}

#[tauri::command]
pub fn social_create_post(
    state: tauri::State<'_, AppState>,
    tenant_id: String,
    user_id: i64,
    author: String,
    body: String,
) -> Result<Value, String> {
    let body = body.trim().to_string();
    if body.is_empty() {
        return Err("post body cannot be empty".to_string());
    }
    if body.chars().count() > 4_000 {
        return Err("post is longer than 4000 characters".to_string());
    }

    let id = uuid::Uuid::new_v4().to_string();
    let created_at = now();

    state.db.execute(
        "INSERT INTO mdl_social_posts (id, tenant_id, user_id, author, body, likes, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6)",
        &[
            json!(id),
            json!(tenant_id),
            json!(user_id),
            json!(author),
            json!(body),
            json!(created_at),
        ],
    )?;

    Ok(json!({
        "id": id,
        "author": author,
        "body": body,
        "likes": 0,
        "created_at": created_at,
        "synced_at": null,
    }))
}

#[tauri::command]
pub fn social_like(
    state: tauri::State<'_, AppState>,
    tenant_id: String,
    post_id: String,
) -> Result<i64, String> {
    state.db.execute(
        "UPDATE mdl_social_posts SET likes = likes + 1 WHERE id = ?1 AND tenant_id = ?2",
        &[json!(post_id), json!(tenant_id)],
    )?;

    let row = state.db.query_one(
        "SELECT likes FROM mdl_social_posts WHERE id = ?1 AND tenant_id = ?2",
        &[json!(post_id), json!(tenant_id)],
    )?;

    Ok(row
        .and_then(|row| row.get("likes").and_then(Value::as_i64))
        .unwrap_or(0))
}
