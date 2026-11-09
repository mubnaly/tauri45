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

//! Authenticated web-service bridge and native HTTP handler.

use std::collections::HashMap;
use crate::commands::auth::load_session;
use crate::network::api;
use crate::AppState;
use serde_json::{json, Value};

#[derive(serde::Deserialize)]
pub struct HttpRequestPayload {
    pub method: Option<String>,
    pub url: String,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<String>,
    pub timeout: Option<u64>,
}

#[derive(serde::Serialize)]
pub struct HttpResponsePayload {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub data: String,
    pub url: String,
}

/// Generic native HTTP request command bypassing any WebView CORS or origin restrictions.
#[tauri::command]
pub async fn native_http_request(
    state: tauri::State<'_, AppState>,
    request: HttpRequestPayload,
) -> Result<HttpResponsePayload, String> {
    let app = state.inner();
    let method_str = request.method.unwrap_or_else(|| "GET".to_string()).to_uppercase();
    let method = match method_str.as_str() {
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "DELETE" => reqwest::Method::DELETE,
        "HEAD" => reqwest::Method::HEAD,
        "PATCH" => reqwest::Method::PATCH,
        _ => reqwest::Method::GET,
    };

    let mut builder = app.http.client().request(method, &request.url);

    if let Some(headers) = request.headers {
        for (k, v) in headers {
            if let (Ok(name), Ok(val)) = (
                reqwest::header::HeaderName::from_bytes(k.as_bytes()),
                reqwest::header::HeaderValue::from_str(&v),
            ) {
                builder = builder.header(name, val);
            }
        }
    }

    if let Some(timeout_secs) = request.timeout {
        if timeout_secs > 0 {
            builder = builder.timeout(std::time::Duration::from_secs(timeout_secs));
        }
    }

    if let Some(body) = request.body {
        builder = builder.body(body);
    }

    let response = builder
        .send()
        .await
        .map_err(|e| format!("Network request failed: {e}"))?;

    let status = response.status().as_u16();
    let final_url = response.url().to_string();

    let mut resp_headers = HashMap::new();
    for (k, v) in response.headers() {
        if let Ok(val_str) = v.to_str() {
            resp_headers.insert(k.as_str().to_string(), val_str.to_string());
        }
    }

    let data = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {e}"))?;

    Ok(HttpResponsePayload {
        status,
        headers: resp_headers,
        data,
        url: final_url,
    })
}

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
