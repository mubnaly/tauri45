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

//! Tenant registry, branding download and cached tenant configuration.

use crate::db::now;
use crate::tenant::{find_string, TenantEntry};
use crate::AppState;
use base64::Engine;
use serde_json::{json, Value};

#[tauri::command]
pub fn tenant_list(state: tauri::State<'_, AppState>) -> Vec<TenantEntry> {
    state.tenants.all()
}

#[tauri::command]
pub fn tenant_resolve(
    state: tauri::State<'_, AppState>,
    code: String,
) -> Option<TenantEntry> {
    state.tenants.resolve(&code)
}

/// Downloads (or refreshes) the tenant branding and caches the logo locally.
#[tauri::command]
pub async fn tenant_branding(
    state: tauri::State<'_, AppState>,
    tenant_id: String,
) -> Result<Value, String> {
    let app = state.inner();
    let tenant = app
        .tenants
        .resolve(&tenant_id)
        .ok_or_else(|| format!("unknown tenant code '{tenant_id}'"))?;

    let branding_path = tenant
        .branding_api
        .clone()
        .unwrap_or_else(|| "/webservice/rest/server.php?wsfunction=local_iomad_get_company_branding&moodlewsrestformat=json".to_string());
    let url = format!("{}{}", tenant.backend_url.trim_end_matches('/'), branding_path);

    let mut request = app.http.client().get(&url);
    if let Some(company_id) = tenant.company_id {
        request = request.query(&[("company_id", company_id.to_string())]);
    }

    let response = request.send().await.map_err(|e| format!("branding: {e}"))?;
    let status = response.status();
    let body = response.text().await.map_err(|e| format!("branding: {e}"))?;

    if !status.is_success() {
        return Err(format!("branding: HTTP {status}"));
    }

    let payload: Value = serde_json::from_str(&body)
        .map_err(|e| format!("branding: invalid JSON ({e})"))?;

    if payload.get("exception").is_some() {
        return Err(format!(
            "branding: {}",
            payload
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("site returned an error")
        ));
    }

    let app_name = find_string(&payload, &["appname", "sitename", "name", "fullname"]);
    let primary_color = find_string(&payload, &["primarycolor", "primary_color", "color", "brandcolor"]);
    let logo_url = find_string(&payload, &["logo", "logourl", "logo_url", "image", "sitelogo"]);
    let onboarding = find_string(&payload, &["onboarding", "onboardingurl"]);

    let logo_path = match &logo_url {
        Some(logo_url) if logo_url.starts_with("http") => {
            let dir = app.tenants.branding_dir(&tenant.id);
            let destination = dir.join("logo.img");
            match app.http.download(logo_url, &destination, None).await {
                Ok(_) => Some(destination.to_string_lossy().to_string()),
                Err(error) => {
                    log::warn!("branding logo download failed: {error}");
                    None
                }
            }
        }
        _ => None,
    };

    app.db.execute(
        "INSERT INTO mdl_tenant_config
            (tenant_id, site_url, company_id, app_name, primary_color, logo_path, onboarding_json, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(tenant_id) DO UPDATE SET
            company_id = excluded.company_id,
            app_name = excluded.app_name,
            primary_color = excluded.primary_color,
            logo_path = excluded.logo_path,
            onboarding_json = excluded.onboarding_json,
            updated_at = excluded.updated_at",
        &[
            json!(tenant.id),
            json!(tenant.backend_url),
            json!(tenant.company_id),
            json!(app_name),
            json!(primary_color),
            json!(logo_path),
            json!(onboarding),
            json!(now()),
        ],
    )?;

    Ok(json!({
        "tenantId": tenant.id,
        "siteUrl": tenant.backend_url,
        "appName": app_name,
        "primaryColor": primary_color,
        "logoUrl": logo_url,
        "logoPath": logo_path,
        "onboarding": onboarding,
        "raw": payload,
    }))
}

/// The cached tenant configuration (no network).
#[tauri::command]
pub fn tenant_active(
    state: tauri::State<'_, AppState>,
    tenant_id: Option<String>,
) -> Result<Option<Value>, String> {
    let row = match tenant_id {
        Some(tenant_id) => state.db.query_one(
            "SELECT * FROM mdl_tenant_config WHERE tenant_id = ?1",
            &[json!(tenant_id)],
        )?,
        None => state.db.query_one(
            "SELECT * FROM mdl_tenant_config ORDER BY updated_at DESC LIMIT 1",
            &[],
        )?,
    };

    Ok(row.map(Value::Object))
}

/// Returns the cached logo as a data URL so it can be rendered without the
/// asset-protocol scope dance.
#[tauri::command]
pub fn tenant_logo(
    state: tauri::State<'_, AppState>,
    tenant_id: String,
) -> Result<Option<String>, String> {
    let row = state.db.query_one(
        "SELECT logo_path FROM mdl_tenant_config WHERE tenant_id = ?1",
        &[json!(tenant_id)],
    )?;

    let Some(path) = row
        .and_then(|row| row.get("logo_path").and_then(Value::as_str).map(String::from))
    else {
        return Ok(None);
    };

    let bytes = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(_) => return Ok(None),
    };

    let mime = mime_guess::from_path(&path).first_or_octet_stream().to_string();
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);

    Ok(Some(format!("data:{mime};base64,{encoded}")))
}
