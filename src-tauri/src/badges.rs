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

//! Gamification XP engine (Subsystem 5).
//!
//! Mirrors `local-badges.ts`: five independent families, one XP row per
//! (tenant, user, family) plus an append-only event log that the sync worker
//! forwards to the site when connectivity returns.

use crate::db::{now, schema::BADGE_FAMILIES, Database};
use serde::Serialize;
use serde_json::json;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BadgeState {
    pub family: String,
    pub xp: i64,
    pub level: i64,
    pub level_floor: i64,
    pub next_level_xp: i64,
    pub progress: f64,
    pub streak: i64,
    pub updated_at: i64,
}

/// XP needed to reach `level` (level 1 starts at 0).
pub fn level_floor(level: i64) -> i64 {
    if level <= 1 {
        return 0;
    }

    let level = level as f64;
    (25.0 * (level - 1.0) * level) as i64
}

pub fn level_for(xp: i64) -> i64 {
    let mut level = 1;
    while xp >= level_floor(level + 1) {
        level += 1;
        if level > 500 {
            break;
        }
    }
    level
}

pub fn is_family(family: &str) -> bool {
    BADGE_FAMILIES.contains(&family)
}

/// Awards XP and returns the recomputed state for that family.
pub fn award(
    db: &Database,
    tenant_id: &str,
    user_id: i64,
    family: &str,
    xp: i64,
    detail: Option<&str>,
) -> Result<BadgeState, String> {
    if !is_family(family) {
        return Err(format!(
            "unknown badge family '{family}' (expected one of {})",
            BADGE_FAMILIES.join(", ")
        ));
    }

    let xp = xp.clamp(0, 10_000);
    let event_id = uuid::Uuid::new_v4().to_string();
    let timestamp = now();

    db.execute(
        "INSERT INTO mdl_xp_events (id, tenant_id, user_id, family, xp, detail, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        &[
            json!(event_id),
            json!(tenant_id),
            json!(user_id),
            json!(family),
            json!(xp),
            json!(detail),
            json!(timestamp),
        ],
    )?;

    db.execute(
        "INSERT INTO mdl_gamification_xp (tenant_id, user_id, family, xp, streak, updated_at)
         VALUES (?1, ?2, ?3, ?4, 0, ?5)
         ON CONFLICT(tenant_id, user_id, family)
         DO UPDATE SET xp = xp + excluded.xp, updated_at = excluded.updated_at",
        &[
            json!(tenant_id),
            json!(user_id),
            json!(family),
            json!(xp),
            json!(timestamp),
        ],
    )?;

    let streak = compute_streak(db, tenant_id, user_id)?;
    if family == "streak" || xp > 0 {
        db.execute(
            "UPDATE mdl_gamification_xp SET streak = ?4
             WHERE tenant_id = ?1 AND user_id = ?2 AND family = ?3",
            &[json!(tenant_id), json!(user_id), json!(family), json!(streak)],
        )?;
    }

    state(db, tenant_id, user_id, family)
}

/// Returns one family's state (zeroed when the user has no history yet).
pub fn state(
    db: &Database,
    tenant_id: &str,
    user_id: i64,
    family: &str,
) -> Result<BadgeState, String> {
    let row = db.query_one(
        "SELECT xp, streak, updated_at FROM mdl_gamification_xp
         WHERE tenant_id = ?1 AND user_id = ?2 AND family = ?3",
        &[json!(tenant_id), json!(user_id), json!(family)],
    )?;

    let xp = row
        .as_ref()
        .and_then(|row| row.get("xp"))
        .and_then(|value| value.as_i64())
        .unwrap_or(0);
    let streak = row
        .as_ref()
        .and_then(|row| row.get("streak"))
        .and_then(|value| value.as_i64())
        .unwrap_or(0);
    let updated_at = row
        .as_ref()
        .and_then(|row| row.get("updated_at"))
        .and_then(|value| value.as_i64())
        .unwrap_or(0);

    let level = level_for(xp);
    let floor = level_floor(level);
    let next = level_floor(level + 1);
    let span = (next - floor).max(1);
    let progress = ((xp - floor) as f64 / span as f64).clamp(0.0, 1.0);

    Ok(BadgeState {
        family: family.to_string(),
        xp,
        level,
        level_floor: floor,
        next_level_xp: next,
        progress,
        streak,
        updated_at,
    })
}

/// All five families for a user.
pub fn state_all(db: &Database, tenant_id: &str, user_id: i64) -> Result<Vec<BadgeState>, String> {
    BADGE_FAMILIES
        .iter()
        .map(|family| state(db, tenant_id, user_id, family))
        .collect()
}

/// Consecutive days (ending today or yesterday) that produced an XP event.
fn compute_streak(db: &Database, tenant_id: &str, user_id: i64) -> Result<i64, String> {
    let rows = db.query(
        "SELECT DISTINCT date(created_at, 'unixepoch') AS day
         FROM mdl_xp_events
         WHERE tenant_id = ?1 AND user_id = ?2
         ORDER BY day DESC
         LIMIT 400",
        &[json!(tenant_id), json!(user_id)],
    )?;

    let days: Vec<String> = rows
        .iter()
        .filter_map(|row| row.get("day").and_then(|value| value.as_str()).map(String::from))
        .collect();

    let today = civil_day(0);
    let yesterday = civil_day(-1);

    let mut streak = 0i64;
    let mut expected = if days.first().map(String::as_str) == Some(today.as_str())
        || days.first().map(String::as_str) == Some(yesterday.as_str())
    {
        days.first().cloned()
    } else {
        None
    };

    for day in days {
        if Some(day.clone()) != expected {
            break;
        }
        streak += 1;
        expected = previous_day(&day);
    }

    Ok(streak)
}

/// UTC date string offset by `offset_days`, matching SQLite's `date()` output.
fn civil_day(offset_days: i64) -> String {
    let seconds = now() + offset_days * 86_400;
    let days = seconds.div_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    format!("{year:04}-{month:02}-{day:02}")
}

fn previous_day(day: &str) -> Option<String> {
    let mut parts = day.split('-');
    let year: i64 = parts.next()?.parse().ok()?;
    let month: u32 = parts.next()?.parse().ok()?;
    let date: u32 = parts.next()?.parse().ok()?;

    let days = days_from_civil(year, month, date) - 1;
    let (year, month, day) = civil_from_days(days);

    Some(format!("{year:04}-{month:02}-{day:02}"))
}

/// Howard Hinnant's `civil_from_days`.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = if month <= 2 { year + 1 } else { year };

    (year, month, day)
}

fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let yoe = year - era * 400;
    let month = month as i64;
    let doy = (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + day as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;

    era * 146_097 + doe - 719_468
}
