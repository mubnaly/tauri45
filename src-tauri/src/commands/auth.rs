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

//! Login, tenant resolution and the native token vault.
//!
//! The web-service token is written to SQLite and never returned to JavaScript;
//! every authenticated call goes through `ws_call` in `commands/network.rs`.

use crate::db::now;
use crate::network::api;
use crate::tenant::TenantEntry;
use crate::AppState;
use serde::Serialize;
use serde_json::{json, Map, Value};

#[derive(Debug, Clone)]
pub struct StoredSession {
    pub tenant_id: String,
    pub site_url: String,
    pub user_id: i64,
    pub username: String,
    pub full_name: Option<String>,
    pub site_name: Option<String>,
    pub lang: Option<String>,
    pub user_picture: Option<String>,
    pub token: String,
    pub expires_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionView {
    pub tenant_id: String,
    pub site_url: String,
    pub user_id: i64,
    pub username: String,
    pub full_name: Option<String>,
    pub site_name: Option<String>,
    pub lang: Option<String>,
    pub user_picture: Option<String>,
    pub expires_at: Option<i64>,
}

impl SessionView {
    fn from_row(row: &Map<String, Value>, site_url: String) -> Self {
        let text = |key: &str| row.get(key).and_then(Value::as_str).map(String::from);

        Self {
            tenant_id: text("tenant_id").unwrap_or_default(),
            site_url,
            user_id: row.get("user_id").and_then(Value::as_i64).unwrap_or(0),
            username: text("username").unwrap_or_default(),
            full_name: text("full_name"),
            site_name: text("site_name"),
            lang: text("lang"),
            user_picture: text("user_picture"),
            expires_at: row.get("expires_at").and_then(Value::as_i64),
        }
    }
}

/// Resolves a tenant code to a registry entry.
pub fn resolve_tenant(state: &AppState, tenant_id: &str) -> Result<TenantEntry, String> {
    state
        .tenants
        .resolve(tenant_id)
        .ok_or_else(|| format!("unknown tenant code '{tenant_id}'"))
}

#[tauri::command]
pub async fn auth_login(
    state: tauri::State<'_, AppState>,
    tenant_id: String,
    site_url: Option<String>,
    username: String,
    password: String,
) -> Result<SessionView, String> {
    let app = state.inner();
    let tenant = resolve_tenant(app, &tenant_id)?;

    let site_url = site_url
        .map(|url| url.trim().trim_end_matches('/').to_string())
        .filter(|url| !url.is_empty())
        .unwrap_or_else(|| tenant.backend_url.trim_end_matches('/').to_string());

    if !site_url.starts_with("https://") && !site_url.starts_with("http://") {
        return Err("site URL must start with https://".to_string());
    }

    let username = username.trim().to_string();
    if username.is_empty() || password.is_empty() {
        return Err("username and password are required".to_string());
    }

    let payload = app
        .http
        .post_form_json(
            &format!("{site_url}/login/token.php"),
            &[
                ("username".to_string(), username.clone()),
                ("password".to_string(), password),
                ("service".to_string(), "moodle_mobile_app".to_string()),
            ],
        )
        .await?;

    let token = match payload.get("token").and_then(Value::as_str) {
        Some(token) => token.to_string(),
        None => {
            let message = payload
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("the site rejected the credentials");
            return Err(format!("login failed: {message}"));
        }
    };
    let private_token = payload.get("privatetoken").and_then(Value::as_str);

    let info = api::call(
        app.http.client(),
        &site_url,
        &token,
        "core_webservice_get_site_info",
        &json!({}),
    )
    .await?;

    let user_id = info
        .get("userid")
        .and_then(Value::as_i64)
        .ok_or("site info did not include a user id")?;

    let text = |key: &str| info.get(key).and_then(Value::as_str).map(String::from);
    let full_name = text("fullname");
    let site_name = text("sitename");
    let lang = text("lang");
    let user_picture = text("userpictureurl");

    app.db.execute(
        "INSERT INTO mdl_tenant_config (tenant_id, site_url, company_id, app_name, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(tenant_id) DO UPDATE SET site_url = excluded.site_url, updated_at = excluded.updated_at",
        &[
            json!(tenant.id),
            json!(site_url),
            json!(tenant.company_id),
            json!(site_name),
            json!(now()),
        ],
    )?;

    app.db.execute(
        "INSERT INTO mdl_auth_sessions
            (tenant_id, user_id, username, full_name, token, private_token, site_name, lang, user_picture, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(tenant_id, user_id) DO UPDATE SET
            username = excluded.username,
            full_name = excluded.full_name,
            token = excluded.token,
            private_token = excluded.private_token,
            site_name = excluded.site_name,
            lang = excluded.lang,
            user_picture = excluded.user_picture,
            created_at = excluded.created_at",
        &[
            json!(tenant.id),
            json!(user_id),
            json!(username),
            json!(full_name),
            json!(token),
            json!(private_token),
            json!(site_name),
            json!(lang),
            json!(user_picture),
            json!(now()),
        ],
    )?;

    Ok(SessionView {
        tenant_id: tenant.id,
        site_url,
        user_id,
        username,
        full_name,
        site_name,
        lang,
        user_picture,
        expires_at: None,
    })
}

/// Loads the stored session including the token (Rust-only).
pub fn load_session(state: &AppState, tenant_id: &str) -> Result<StoredSession, String> {
    let row = state
        .db
        .query_one(
            "SELECT s.tenant_id, s.user_id, s.username, s.full_name, s.site_name, s.lang,
                    s.user_picture, s.token, s.expires_at, t.site_url
             FROM mdl_auth_sessions s
             JOIN mdl_tenant_config t ON t.tenant_id = s.tenant_id
             WHERE s.tenant_id = ?1
             ORDER BY s.created_at DESC
             LIMIT 1",
            &[json!(tenant_id)],
        )?
        .ok_or_else(|| format!("not signed in to tenant '{tenant_id}'"))?;

    let text = |key: &str| row.get(key).and_then(Value::as_str).map(String::from);

    Ok(StoredSession {
        tenant_id: tenant_id.to_string(),
        site_url: text("site_url").unwrap_or_default(),
        user_id: row.get("user_id").and_then(Value::as_i64).unwrap_or(0),
        username: text("username").unwrap_or_default(),
        full_name: text("full_name"),
        site_name: text("site_name"),
        lang: text("lang"),
        user_picture: text("user_picture"),
        token: text("token").unwrap_or_default(),
        expires_at: row.get("expires_at").and_then(Value::as_i64),
    })
}

#[tauri::command]
pub fn auth_session(
    state: tauri::State<'_, AppState>,
    tenant_id: String,
) -> Result<Option<SessionView>, String> {
    let app = state.inner();
    let row = app.db.query_one(
        "SELECT s.tenant_id, s.user_id, s.username, s.full_name, s.site_name, s.lang,
                s.user_picture, s.expires_at, t.site_url
         FROM mdl_auth_sessions s
         JOIN mdl_tenant_config t ON t.tenant_id = s.tenant_id
         WHERE s.tenant_id = ?1
         ORDER BY s.created_at DESC
         LIMIT 1",
        &[json!(tenant_id)],
    )?;

    Ok(row.map(|row| {
        let site_url = row
            .get("site_url")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        SessionView::from_row(&row, site_url)
    }))
}

#[tauri::command]
pub fn auth_sessions(state: tauri::State<'_, AppState>) -> Result<Vec<SessionView>, String> {
    let rows = state.db.query(
        "SELECT s.tenant_id, s.user_id, s.username, s.full_name, s.site_name, s.lang,
                s.user_picture, s.expires_at, t.site_url
         FROM mdl_auth_sessions s
         JOIN mdl_tenant_config t ON t.tenant_id = s.tenant_id
         ORDER BY s.created_at DESC",
        &[],
    )?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let site_url = row
                .get("site_url")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            SessionView::from_row(&row, site_url)
        })
        .collect())
}

#[tauri::command]
pub fn auth_logout(state: tauri::State<'_, AppState>, tenant_id: String) -> Result<(), String> {
    state
        .db
        .execute("DELETE FROM mdl_auth_sessions WHERE tenant_id = ?1", &[json!(tenant_id)])?;

    Ok(())
}
