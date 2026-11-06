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

//! Schema definitions for the embedded offline database (Subsystem 1).
//!
//! Every table is tenant-scoped: `tenant_id` is the first column of each
//! composite key so data isolation between tenants is enforced in storage, not
//! only in the UI.

pub const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS mdl_tenant_config (
    tenant_id       TEXT PRIMARY KEY,
    site_url        TEXT NOT NULL,
    company_id      INTEGER,
    app_name        TEXT,
    primary_color   TEXT,
    logo_path       TEXT,
    onboarding_json TEXT,
    updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mdl_auth_sessions (
    tenant_id     TEXT NOT NULL,
    user_id       INTEGER NOT NULL,
    username      TEXT NOT NULL,
    full_name     TEXT,
    token         TEXT NOT NULL,
    private_token TEXT,
    site_name     TEXT,
    lang          TEXT,
    user_picture  TEXT,
    expires_at    INTEGER,
    created_at    INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS mdl_cached_courses (
    tenant_id   TEXT NOT NULL,
    user_id     INTEGER NOT NULL,
    course_id   INTEGER NOT NULL,
    fullname    TEXT NOT NULL,
    shortname   TEXT,
    summary     TEXT,
    category    TEXT,
    image_url   TEXT,
    progress    REAL NOT NULL DEFAULT 0,
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, user_id, course_id)
);

CREATE TABLE IF NOT EXISTS mdl_offline_attempts (
    id         TEXT PRIMARY KEY,
    tenant_id  TEXT NOT NULL,
    user_id    INTEGER NOT NULL,
    context    TEXT NOT NULL,
    payload    TEXT NOT NULL,
    grade      REAL,
    created_at INTEGER NOT NULL,
    synced_at  INTEGER,
    status     TEXT NOT NULL DEFAULT 'pending',
    error      TEXT
);

CREATE TABLE IF NOT EXISTS mdl_media_files (
    id               TEXT PRIMARY KEY,
    tenant_id        TEXT NOT NULL,
    user_id          INTEGER NOT NULL,
    title            TEXT,
    source_url       TEXT,
    local_path       TEXT NOT NULL,
    size_bytes       INTEGER NOT NULL,
    plain_bytes      INTEGER NOT NULL DEFAULT 0,
    encrypted        INTEGER NOT NULL DEFAULT 1,
    chunk_size       INTEGER NOT NULL,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    watched_seconds  INTEGER NOT NULL DEFAULT 0,
    created_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mdl_gamification_xp (
    tenant_id   TEXT NOT NULL,
    user_id     INTEGER NOT NULL,
    family      TEXT NOT NULL,
    xp          INTEGER NOT NULL DEFAULT 0,
    streak      INTEGER NOT NULL DEFAULT 0,
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, user_id, family)
);

CREATE TABLE IF NOT EXISTS mdl_xp_events (
    id         TEXT PRIMARY KEY,
    tenant_id  TEXT NOT NULL,
    user_id    INTEGER NOT NULL,
    family     TEXT NOT NULL,
    xp         INTEGER NOT NULL,
    detail     TEXT,
    created_at INTEGER NOT NULL,
    synced_at  INTEGER
);

CREATE TABLE IF NOT EXISTS mdl_social_posts (
    id         TEXT PRIMARY KEY,
    tenant_id  TEXT NOT NULL,
    user_id    INTEGER NOT NULL,
    author     TEXT NOT NULL,
    body       TEXT NOT NULL,
    likes      INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    synced_at  INTEGER
);
"#;

pub const MIGRATIONS: &str = r#"
CREATE INDEX IF NOT EXISTS idx_attempts_status ON mdl_offline_attempts(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_media_tenant ON mdl_media_files(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_xp_events_pending ON mdl_xp_events(tenant_id, synced_at);
CREATE INDEX IF NOT EXISTS idx_social_tenant ON mdl_social_posts(tenant_id, created_at DESC);
PRAGMA user_version = 1;
"#;

/// Gamification families (Subsystem 5) kept in one place so the Rust XP engine
/// and the frontend agree on the identifiers.
pub const BADGE_FAMILIES: [&str; 5] = ["video", "pdf", "flashcard", "usage", "streak"];
