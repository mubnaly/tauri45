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

/**
 * Shared types for the Tauri IPC contract. Shapes mirror the Rust structs in
 * `src-tauri/src/commands/` (snake_case only where a raw SQLite row is returned).
 */

export type Lang = 'en' | 'ar';

export interface Tenant {
    id: string;
    backendUrl: string;
    companyId?: number | null;
    brandingApi?: string | null;
    bundleId?: string | null;
    description?: string | null;
}

export interface Session {
    tenantId: string;
    siteUrl: string;
    userId: number;
    username: string;
    fullName?: string | null;
    siteName?: string | null;
    lang?: string | null;
    userPicture?: string | null;
    expiresAt?: number | null;
}

export interface LoginInput {
    tenantId: string;
    siteUrl?: string;
    username: string;
    password: string;
}

export interface TenantBranding {
    tenantId: string;
    siteUrl: string;
    appName?: string | null;
    primaryColor?: string | null;
    logoUrl?: string | null;
    logoPath?: string | null;
    onboarding?: string | null;
    raw?: unknown;
}

export type BadgeFamily = 'video' | 'pdf' | 'flashcard' | 'usage' | 'streak';

export interface BadgeState {
    family: BadgeFamily;
    xp: number;
    level: number;
    levelFloor: number;
    nextLevelXp: number;
    progress: number;
    streak: number;
    updatedAt: number;
}

export interface CourseRow {
    course_id: number;
    fullname: string;
    shortname?: string | null;
    summary?: string | null;
    category?: string | null;
    image_url?: string | null;
    progress: number;
}

export interface CourseModule {
    id: number;
    name: string;
    modname: string;
    url?: string;
    description?: string;
    mediaUrl?: string;
    youtubeId?: string;
    sectionName?: string;
}

export interface MediaItem {
    id: string;
    title?: string | null;
    source_url?: string | null;
    size_bytes: number;
    plain_bytes: number;
    duration_seconds: number;
    watched_seconds: number;
    created_at: number;
    streamUrl: string;
}

export interface Post {
    id: string;
    author: string;
    body: string;
    likes: number;
    created_at: number;
    synced_at?: number | null;
}

export interface PendingAttempt {
    id: string;
    user_id: number;
    context: string;
    payload: string;
    grade?: number | null;
    created_at: number;
    status: string;
    error?: string | null;
}

export interface SyncReport {
    attempts: number;
    xpEvents: number;
    posts: number;
    failed: number;
    errors: string[];
}

export interface ProtectionReport {
    enabled: boolean;
    enforced: boolean;
    platform: string;
    mechanism: string;
}

export interface IntegrityReport {
    platform: string;
    rooted: boolean;
    debuggerAttached: boolean;
    indicators: string[];
}

export interface DeviceInfo {
    platform: string;
    arch: string;
    cpuCount: number;
    totalMemoryBytes: number;
    deviceId: string;
    keyFingerprint: string;
}

export interface StorageUsage {
    dataDir: string;
    dbBytes: number;
    mediaBytes: number;
    keyBytes: number;
    totalBytes: number;
}

export interface YouTubeConfig {
    requested: string;
    quality: string;
    qualities: string[];
    script: string;
}

export interface SyncQueueInput {
    tenantId: string;
    userId: number;
    context: string;
    payload: unknown;
    grade?: number | null;
}
