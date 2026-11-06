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

//! Security commands (Subsystem 4) and device identity for multi-tenant
//! hardware tracking.

use crate::security::{self, IntegrityReport, ProtectionReport};
use crate::video::youtube;
use serde::Serialize;
use serde_json::{json, Value};

#[tauri::command]
pub fn security_set_capture(
    window: tauri::WebviewWindow,
    enabled: bool,
) -> Result<ProtectionReport, String> {
    security::set_capture_protection(&window, enabled)
}

#[tauri::command]
pub fn security_integrity() -> IntegrityReport {
    security::integrity_check()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub platform: String,
    pub arch: String,
    pub cpu_count: usize,
    pub total_memory_bytes: u64,
    pub device_id: String,
    pub key_fingerprint: String,
}

#[tauri::command]
pub fn security_device(state: tauri::State<'_, crate::AppState>) -> DeviceInfo {
    let mut system = sysinfo::System::new_all();
    system.refresh_memory();

    DeviceInfo {
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        cpu_count: system.cpus().len(),
        total_memory_bytes: system.total_memory(),
        device_id: read_device_id(&state.data_dir).unwrap_or_else(|_| "unknown".to_string()),
        key_fingerprint: state.crypto.key_fingerprint(),
    }
}

/// Creates a stable per-install identifier (used for tenant hardware limits).
fn read_device_id(data_dir: &std::path::Path) -> Result<String, String> {
    let path = data_dir.join("device-id");

    if let Ok(existing) = std::fs::read_to_string(&path) {
        let existing = existing.trim().to_string();
        if !existing.is_empty() {
            return Ok(existing);
        }
    }

    let id = uuid::Uuid::new_v4().to_string();
    std::fs::write(&path, &id).map_err(|e| format!("write device id: {e}"))?;

    Ok(id)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YouTubeQualityConfig {
    pub requested: String,
    pub quality: String,
    pub qualities: Vec<String>,
    pub script: String,
}

/// Returns the quality script the UI evals to force YouTube's DASH stream to the
/// requested rendition.
#[tauri::command]
pub fn video_youtube_quality(quality: Option<String>) -> YouTubeQualityConfig {
    let requested = quality.unwrap_or_else(|| "1080".to_string());
    let normalised = youtube::normalise_quality(&requested).to_string();

    YouTubeQualityConfig {
        script: youtube::quality_script(&normalised),
        requested,
        quality: normalised,
        qualities: youtube::QUALITIES.iter().map(|q| q.to_string()).collect(),
    }
}

/// Fallback path: applies the quality script directly to the caller WebView.
#[tauri::command]
pub fn video_apply_youtube_quality(
    window: tauri::WebviewWindow,
    quality: Option<String>,
) -> Result<Value, String> {
    let quality = youtube::normalise_quality(quality.as_deref().unwrap_or("1080"));
    window
        .eval(&youtube::quality_script(quality))
        .map_err(|e| format!("eval youtube bridge: {e}"))?;

    Ok(json!({ "applied": quality }))
}
