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

//! Offline synchronisation engine.
//!
//! Attempts, XP events and social posts are queued locally and flushed in one
//! pass. A failed item is never dropped: it stays queued with its error so the
//! next flush retries it.

use crate::commands::auth::load_session;
use crate::db::now;
use crate::network::api;
use crate::AppState;
use serde::Serialize;
use serde_json::{json, Value};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    pub attempts: usize,
    pub xp_events: usize,
    pub posts: usize,
    pub failed: usize,
    pub errors: Vec<String>,
}

#[tauri::command]
pub fn sync_queue_attempt(
    state: tauri::State<'_, AppState>,
    tenant_id: String,
    user_id: i64,
    context: String,
    payload: Value,
    grade: Option<f64>,
) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();

    state.db.execute(
        "INSERT INTO mdl_offline_attempts (id, tenant_id, user_id, context, payload, grade, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        &[
            json!(id),
            json!(tenant_id),
            json!(user_id),
            json!(context),
            json!(payload.to_string()),
            json!(grade),
            json!(now()),
        ],
    )?;

    Ok(id)
}

#[tauri::command]
pub fn sync_pending(
    state: tauri::State<'_, AppState>,
    tenant_id: String,
) -> Result<Vec<Value>, String> {
    let rows = state.db.query(
        "SELECT id, user_id, context, payload, grade, created_at, status, error
         FROM mdl_offline_attempts
         WHERE tenant_id = ?1 AND status <> 'synced'
         ORDER BY created_at ASC",
        &[json!(tenant_id)],
    )?;

    Ok(rows.into_iter().map(Value::Object).collect())
}

#[tauri::command]
pub async fn sync_flush(
    state: tauri::State<'_, AppState>,
    tenant_id: String,
) -> Result<SyncReport, String> {
    let app = state.inner();
    let session = load_session(app, &tenant_id)?;

    let mut report = SyncReport {
        attempts: 0,
        xp_events: 0,
        posts: 0,
        failed: 0,
        errors: Vec::new(),
    };

    // 1. Quiz / assignment attempts.
    let attempts = app.db.query(
        "SELECT id, user_id, context, payload, grade, created_at
         FROM mdl_offline_attempts
         WHERE tenant_id = ?1 AND status <> 'synced'
         ORDER BY created_at ASC
         LIMIT 50",
        &[json!(tenant_id)],
    )?;

    for attempt in attempts {
        let id = attempt
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let payload = attempt
            .get("payload")
            .and_then(Value::as_str)
            .map(|raw| serde_json::from_str::<Value>(raw).unwrap_or_else(|_| json!(raw)))
            .unwrap_or(Value::Null);

        let params = json!({
            "attemptid": id,
            "context": attempt.get("context").cloned().unwrap_or(Value::Null),
            "payload": payload,
            "grade": attempt.get("grade").cloned().unwrap_or(Value::Null),
            "timecreated": attempt.get("created_at").cloned().unwrap_or(Value::Null),
        });

        match api::call(
            app.http.client(),
            &session.site_url,
            &session.token,
            "local_li_sync_offline_attempt",
            &params,
        )
        .await
        {
            Ok(_) => {
                app.db.execute(
                    "UPDATE mdl_offline_attempts SET status = 'synced', synced_at = ?2, error = NULL WHERE id = ?1",
                    &[json!(id), json!(now())],
                )?;
                report.attempts += 1;
            }
            Err(error) => {
                app.db.execute(
                    "UPDATE mdl_offline_attempts SET status = 'failed', error = ?2 WHERE id = ?1",
                    &[json!(id), json!(error.clone())],
                )?;
                report.failed += 1;
                report.errors.push(error);
            }
        }
    }

    // 2. XP / badge events.
    let events = app.db.query(
        "SELECT id, family, xp, detail, created_at
         FROM mdl_xp_events
         WHERE tenant_id = ?1 AND user_id = ?2 AND synced_at IS NULL
         ORDER BY created_at ASC
         LIMIT 200",
        &[json!(tenant_id), json!(session.user_id)],
    )?;

    if !events.is_empty() {
        let payload = json!({
            "events": events
                .iter()
                .map(|event| json!({
                    "id": event.get("id"),
                    "family": event.get("family"),
                    "xp": event.get("xp"),
                    "detail": event.get("detail"),
                    "timecreated": event.get("created_at"),
                }))
                .collect::<Vec<_>>()
        });

        match api::call(
            app.http.client(),
            &session.site_url,
            &session.token,
            "local_li_badges_sync",
            &payload,
        )
        .await
        {
            Ok(_) => {
                for event in &events {
                    if let Some(id) = event.get("id").and_then(Value::as_str) {
                        app.db.execute(
                            "UPDATE mdl_xp_events SET synced_at = ?2 WHERE id = ?1",
                            &[json!(id), json!(now())],
                        )?;
                    }
                }
                report.xp_events = events.len();
            }
            Err(error) => {
                report.failed += 1;
                report.errors.push(error);
            }
        }
    }

    // 3. Community posts.
    let posts = app.db.query(
        "SELECT id, body, created_at
         FROM mdl_social_posts
         WHERE tenant_id = ?1 AND user_id = ?2 AND synced_at IS NULL
         ORDER BY created_at ASC
         LIMIT 50",
        &[json!(tenant_id), json!(session.user_id)],
    )?;

    for post in posts {
        let id = post
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();

        let params = json!({
            "postid": id,
            "message": post.get("body").cloned().unwrap_or(Value::Null),
            "timecreated": post.get("created_at").cloned().unwrap_or(Value::Null),
        });

        match api::call(
            app.http.client(),
            &session.site_url,
            &session.token,
            "local_li_feed_post_create",
            &params,
        )
        .await
        {
            Ok(_) => {
                app.db.execute(
                    "UPDATE mdl_social_posts SET synced_at = ?2 WHERE id = ?1",
                    &[json!(id), json!(now())],
                )?;
                report.posts += 1;
            }
            Err(error) => {
                report.failed += 1;
                report.errors.push(error);
            }
        }
    }

    Ok(report)
}
