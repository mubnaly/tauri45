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

//! Gamification commands (Subsystem 5).

use crate::badges::{self, BadgeState};
use crate::AppState;

#[tauri::command]
pub fn badges_state(
    state: tauri::State<'_, AppState>,
    tenant_id: String,
    user_id: i64,
) -> Result<Vec<BadgeState>, String> {
    badges::state_all(&state.db, &tenant_id, user_id)
}

#[tauri::command]
pub fn badges_award(
    state: tauri::State<'_, AppState>,
    tenant_id: String,
    user_id: i64,
    family: String,
    xp: i64,
    detail: Option<String>,
) -> Result<BadgeState, String> {
    badges::award(&state.db, &tenant_id, user_id, &family, xp, detail.as_deref())
}

/// Called by the UI on its 30-second activity checkpoint.
///
/// `seconds` is the app-interaction time since the last tick; 30 active seconds
/// award 1 XP (capped at 10 XP per tick so a suspended window cannot farm XP).
#[tauri::command]
pub fn badges_tick(
    state: tauri::State<'_, AppState>,
    tenant_id: String,
    user_id: i64,
    family: Option<String>,
    seconds: i64,
) -> Result<Option<BadgeState>, String> {
    if seconds < 30 {
        return Ok(None);
    }

    let family = family.unwrap_or_else(|| "usage".to_string());
    let xp = (seconds / 30).clamp(1, 10);

    badges::award(&state.db, &tenant_id, user_id, &family, xp, Some("activity checkpoint"))
        .map(Some)
}
