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

//! Authenticated web-service bridge.

use crate::commands::auth::load_session;
use crate::network::api;
use crate::AppState;
use serde_json::{json, Value};

/// Calls a Moodle external function with the stored tenant token.
#[tauri::command]
pub async fn ws_call(
    state: tauri::State<'_, AppState>,
    tenant_id: String,
    function: String,
    params: Option<Value>,
) -> Result<Value, String> {
    let app = state.inner();
    let session = load_session(app, &tenant_id)?;
    let params = params.unwrap_or_else(|| json!({}));

    api::call(app.http.client(), &session.site_url, &session.token, &function, &params).await
}

/// Calls a function that returns HTML/plain text instead of JSON.
#[tauri::command]
pub async fn ws_call_raw(
    state: tauri::State<'_, AppState>,
    tenant_id: String,
    function: String,
    params: Option<Value>,
) -> Result<String, String> {
    let app = state.inner();
    let session = load_session(app, &tenant_id)?;

    let mut form = vec![
        ("wstoken".to_string(), session.token.clone()),
        ("wsfunction".to_string(), function.clone()),
        ("moodlewsrestformat".to_string(), "json".to_string()),
    ];
    api::flatten_params("", &params.unwrap_or_else(|| json!({})), &mut form);

    let response = app
        .http
        .client()
        .post(api::rest_endpoint(&session.site_url))
        .form(&form)
        .send()
        .await
        .map_err(|e| format!("{function}: {e}"))?;

    response.text().await.map_err(|e| format!("{function}: {e}"))
}
