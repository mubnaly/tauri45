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

//! Allama native core: SQLite, encrypted media, tenant branding, gamification
//! and the security hooks described in `TAURI_MIGRATION_PLAN.md`.

pub mod badges;
pub mod commands;
pub mod db;
pub mod network;
pub mod security;
pub mod tenant;
pub mod video;

use std::path::PathBuf;
use tauri::Manager;

/// Everything the IPC commands can reach. `tauri::State<AppState>` is injected
/// by the builder below.
pub struct AppState {
    pub data_dir: PathBuf,
    pub db: db::Database,
    pub http: network::HttpClient,
    pub crypto: security::crypto::Crypto,
    pub tenants: tenant::TenantManager,
    pub media: video::MediaServer,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("resolve app data dir: {e}"))?;
            std::fs::create_dir_all(&data_dir)
                .map_err(|e| format!("create app data dir: {e}"))?;

            let db = db::Database::open(&data_dir)?;
            let http = network::HttpClient::new()?;
            let crypto = security::crypto::Crypto::load_or_create(&data_dir.join("keys"))?;
            let tenants = tenant::TenantManager::new(&data_dir);
            let media = video::MediaServer::start(db.clone(), crypto.clone())?;

            log::info!(
                "Allama core ready (data dir: {}, media port: {})",
                data_dir.display(),
                media.port
            );

            app.manage(AppState {
                data_dir,
                db,
                http,
                crypto,
                tenants,
                media,
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Database
            commands::db::db_query,
            commands::db::db_execute,
            commands::db::db_batch,
            commands::db::db_stats,
            // Auth
            commands::auth::auth_login,
            commands::auth::auth_session,
            commands::auth::auth_sessions,
            commands::auth::auth_logout,
            // Tenants
            commands::tenant::tenant_list,
            commands::tenant::tenant_resolve,
            commands::tenant::tenant_branding,
            commands::tenant::tenant_active,
            commands::tenant::tenant_logo,
            // Web services
            commands::network::ws_call,
            commands::network::ws_call_raw,
            // Media / video
            commands::media::media_server_info,
            commands::media::media_import,
            commands::media::media_list,
            commands::media::media_progress,
            commands::media::media_remove,
            commands::security::video_youtube_quality,
            commands::security::video_apply_youtube_quality,
            // Gamification
            commands::badges::badges_state,
            commands::badges::badges_award,
            commands::badges::badges_tick,
            // Social
            commands::social::social_posts,
            commands::social::social_create_post,
            commands::social::social_like,
            // Sync
            commands::sync::sync_queue_attempt,
            commands::sync::sync_pending,
            commands::sync::sync_flush,
            // Storage
            commands::storage::storage_usage,
            commands::storage::storage_write_text,
            commands::storage::storage_read_text,
            commands::storage::storage_list,
            commands::storage::storage_remove,
            // Security
            commands::security::security_set_capture,
            commands::security::security_integrity,
            commands::security::security_device,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Allama");
}
