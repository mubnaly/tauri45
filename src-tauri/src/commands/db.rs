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

//! Raw database IPC commands.
//!
//! These exist for the offline data layer and as an escape hatch; feature code
//! should prefer the typed commands (`auth_*`, `media_*`, `badges_*`, ...).

use crate::AppState;
use serde::Serialize;
use serde_json::{Map, Value};

#[tauri::command]
pub fn db_query(
    state: tauri::State<'_, AppState>,
    sql: String,
    params: Option<Vec<Value>>,
) -> Result<Vec<Map<String, Value>>, String> {
    state.db.query(&sql, params.as_deref().unwrap_or(&[]))
}

#[tauri::command]
pub fn db_execute(
    state: tauri::State<'_, AppState>,
    sql: String,
    params: Option<Vec<Value>>,
) -> Result<usize, String> {
    state.db.execute(&sql, params.as_deref().unwrap_or(&[]))
}

#[tauri::command]
pub fn db_batch(state: tauri::State<'_, AppState>, statements: Vec<String>) -> Result<(), String> {
    state.db.batch(&statements)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbStats {
    pub path: String,
    pub bytes: u64,
    pub wal_bytes: u64,
}

#[tauri::command]
pub fn db_stats(state: tauri::State<'_, AppState>) -> Result<DbStats, String> {
    let path = state.data_dir.join("allama.db");
    let wal = state.data_dir.join("allama.db-wal");
    let size = |file: &std::path::Path| std::fs::metadata(file).map(|m| m.len()).unwrap_or(0);

    Ok(DbStats {
        path: path.to_string_lossy().to_string(),
        bytes: size(&path),
        wal_bytes: size(&wal),
    })
}
