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

import { invoke } from '@tauri-apps/api/core';
import type {
    BadgeFamily,
    BadgeState,
    CourseModule,
    CourseRow,
    DeviceInfo,
    IntegrityReport,
    LoginInput,
    MediaItem,
    Post,
    PendingAttempt,
    ProtectionReport,
    Session,
    StorageUsage,
    SyncQueueInput,
    SyncReport,
    Tenant,
    TenantBranding,
    YouTubeConfig,
} from '../types';

/**
 * Typed wrapper around `window.__TAURI_INTERNALS__.invoke`.
 *
 * Every Rust command lives behind this interface so the WebView can also run in
 * a plain browser (`npm run dev`) against an in-memory fallback. The native
 * implementation is the one that ships inside the shell.
 */
export interface AllamaBridge {
    readonly isNative: boolean;

    tenantList(): Promise<Tenant[]>;
    tenantResolve(code: string): Promise<Tenant | null>;
    tenantBranding(tenantId: string): Promise<TenantBranding | null>;

    authLogin(input: LoginInput): Promise<Session>;
    authSession(tenantId: string): Promise<Session | null>;
    authSessions(): Promise<Session[]>;
    authLogout(tenantId: string): Promise<void>;

    wsCall<T>(tenantId: string, func: string, params?: Record<string, unknown>): Promise<T>;
    query<T>(sql: string, params?: unknown[]): Promise<T[]>;
    execute(sql: string, params?: unknown[]): Promise<number>;

    badgesState(tenantId: string, userId: number): Promise<BadgeState[]>;
    badgesAward(
        tenantId: string,
        userId: number,
        family: BadgeFamily,
        xp: number,
        detail?: string,
    ): Promise<BadgeState>;
    badgesTick(tenantId: string, userId: number, seconds: number): Promise<BadgeState | null>;

    mediaList(tenantId: string, userId: number): Promise<MediaItem[]>;
    mediaImport(input: {
        tenantId: string;
        userId: number;
        title?: string;
        url: string;
    }): Promise<MediaItem>;
    mediaProgress(mediaId: string, seconds: number): Promise<void>;
    mediaServer(): Promise<{ port: number; baseUrl: string }>;

    socialPosts(tenantId: string, limit?: number): Promise<Post[]>;
    socialCreatePost(input: {
        tenantId: string;
        userId: number;
        author: string;
        body: string;
    }): Promise<Post>;
    socialLike(tenantId: string, postId: string): Promise<number>;

    syncQueueAttempt(input: SyncQueueInput): Promise<string>;
    syncPending(tenantId: string): Promise<PendingAttempt[]>;
    syncFlush(tenantId: string): Promise<SyncReport>;

    setCaptureProtection(enabled: boolean): Promise<ProtectionReport>;
    integrity(): Promise<IntegrityReport>;
    device(): Promise<DeviceInfo>;
    storageUsage(): Promise<StorageUsage>;

    youtubeQuality(quality: string): Promise<YouTubeConfig>;
    applyYouTubeQuality(quality: string): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* Native (Tauri) implementation                                              */
/* -------------------------------------------------------------------------- */

class TauriBridge implements AllamaBridge {
    readonly isNative = true;

    tenantList(): Promise<Tenant[]> {
        return invoke('tenant_list');
    }

    tenantResolve(code: string): Promise<Tenant | null> {
        return invoke('tenant_resolve', { code });
    }

    tenantBranding(tenantId: string): Promise<TenantBranding | null> {
        return invoke('tenant_branding', { tenantId });
    }

    authLogin(input: LoginInput): Promise<Session> {
        return invoke('auth_login', {
            tenantId: input.tenantId,
            siteUrl: input.siteUrl ?? null,
            username: input.username,
            password: input.password,
        });
    }

    authSession(tenantId: string): Promise<Session | null> {
        return invoke('auth_session', { tenantId });
    }

    authSessions(): Promise<Session[]> {
        return invoke('auth_sessions');
    }

    authLogout(tenantId: string): Promise<void> {
        return invoke('auth_logout', { tenantId });
    }

    wsCall<T>(tenantId: string, func: string, params?: Record<string, unknown>): Promise<T> {
        return invoke('ws_call', { tenantId, function: func, params: params ?? {} });
    }

    query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
        return invoke('db_query', { sql, params });
    }

    execute(sql: string, params: unknown[] = []): Promise<number> {
        return invoke('db_execute', { sql, params });
    }

    badgesState(tenantId: string, userId: number): Promise<BadgeState[]> {
        return invoke('badges_state', { tenantId, userId });
    }

    badgesAward(
        tenantId: string,
        userId: number,
        family: BadgeFamily,
        xp: number,
        detail?: string,
    ): Promise<BadgeState> {
        return invoke('badges_award', {
            tenantId,
            userId,
            family,
            xp,
            detail: detail ?? null,
        });
    }

    badgesTick(tenantId: string, userId: number, seconds: number): Promise<BadgeState | null> {
        return invoke('badges_tick', { tenantId, userId, seconds });
    }

    mediaList(tenantId: string, userId: number): Promise<MediaItem[]> {
        return invoke('media_list', { tenantId, userId });
    }

    mediaImport(input: {
        tenantId: string;
        userId: number;
        title?: string;
        url: string;
    }): Promise<MediaItem> {
        return invoke('media_import', {
            tenantId: input.tenantId,
            userId: input.userId,
            title: input.title ?? null,
            url: input.url,
        });
    }

    mediaProgress(mediaId: string, seconds: number): Promise<void> {
        return invoke('media_progress', { mediaId, watchedSeconds: Math.round(seconds) });
    }

    mediaServer(): Promise<{ port: number; baseUrl: string }> {
        return invoke('media_server_info').then((info) => {
            const payload = info as { port: number; baseUrl: string };
            return { port: payload.port, baseUrl: payload.baseUrl };
        });
    }

    socialPosts(tenantId: string, limit = 50): Promise<Post[]> {
        return invoke('social_posts', { tenantId, limit });
    }

    socialCreatePost(input: {
        tenantId: string;
        userId: number;
        author: string;
        body: string;
    }): Promise<Post> {
        return invoke('social_create_post', input);
    }

    socialLike(tenantId: string, postId: string): Promise<number> {
        return invoke('social_like', { tenantId, postId });
    }

    syncQueueAttempt(input: SyncQueueInput): Promise<string> {
        return invoke('sync_queue_attempt', {
            tenantId: input.tenantId,
            userId: input.userId,
            context: input.context,
            payload: input.payload,
            grade: input.grade ?? null,
        });
    }

    syncPending(tenantId: string): Promise<PendingAttempt[]> {
        return invoke('sync_pending', { tenantId });
    }

    syncFlush(tenantId: string): Promise<SyncReport> {
        return invoke('sync_flush', { tenantId });
    }

    setCaptureProtection(enabled: boolean): Promise<ProtectionReport> {
        return invoke('security_set_capture', { enabled });
    }

    integrity(): Promise<IntegrityReport> {
        return invoke('security_integrity');
    }

    device(): Promise<DeviceInfo> {
        return invoke('security_device');
    }

    storageUsage(): Promise<StorageUsage> {
        return invoke('storage_usage');
    }

    youtubeQuality(quality: string): Promise<YouTubeConfig> {
        return invoke('video_youtube_quality', { quality });
    }

    applyYouTubeQuality(quality: string): Promise<void> {
        return invoke('video_apply_youtube_quality', { quality }).then(() => undefined);
    }
}

/* -------------------------------------------------------------------------- */
/* Browser fallback (dev without the Rust shell)                              */
/* -------------------------------------------------------------------------- */

const DEMO_TENANTS: Tenant[] = [
    { id: 'safwa', backendUrl: 'https://safwa.allama.online', companyId: 6, description: 'Al-Safwa Learning Platform' },
    { id: 'maher', backendUrl: 'https://first.allama.online', companyId: 1, description: 'Al Maher Learning Platform' },
    { id: 'dalgamoun', backendUrl: 'https://dalgamoun.allama.online', companyId: 2, description: 'Dalgamoun Learning Platform' },
    { id: 'habiba', backendUrl: 'https://habiba.allama.online', companyId: 3, description: 'Habiba Learning Platform' },
    { id: 'hety', backendUrl: 'https://hety.allama.online', companyId: 4, description: 'Hety Learning Platform' },
    { id: 'ramadan', backendUrl: 'https://ramadan.allama.online', companyId: 5, description: 'Ramadan Learning Platform' },
    { id: 'daheeh', backendUrl: 'https://dalgamoun.allama.online', companyId: 7, description: 'Al-Daheeh Learning Platform' },
    { id: 'zdoctor', backendUrl: 'https://zdoctor.allama.online', companyId: 8, description: 'Z Doctor Learning Platform' },
    { id: 'zayyat', backendUrl: 'https://zayyat.allama.online', companyId: 2, description: 'Kafe AzZayyat Learning Platform' },
];

const DEMO_COURSES: CourseRow[] = [
    {
        course_id: 12,
        fullname: 'Mathematics — Grade 12',
        shortname: 'MATH12',
        summary: 'Differentiation, integration and exam technique with weekly quizzes.',
        category: 'Secondary',
        progress: 0.62,
    },
    {
        course_id: 14,
        fullname: 'Physics — Mechanics',
        shortname: 'PHY-MECH',
        summary: 'Newtonian mechanics with recorded lectures and problem sets.',
        category: 'Secondary',
        progress: 0.31,
    },
    {
        course_id: 21,
        fullname: 'Arabic Language Skills',
        shortname: 'ARB-SKILLS',
        summary: 'Reading comprehension, grammar drills and flashcards.',
        category: 'Languages',
        progress: 0.88,
    },
    {
        course_id: 33,
        fullname: 'Chemistry Lab Safety',
        shortname: 'CHEM-SAFE',
        summary: 'Short certification course with a final quiz.',
        category: 'Secondary',
        progress: 0.05,
    },
];

const DEMO_MODULES: Record<number, CourseModule[]> = {
    12: [
        { id: 1001, name: 'Welcome & syllabus', modname: 'page', description: 'How the course works.', sectionName: 'Week 1' },
        { id: 1002, name: 'Limits refresher (video)', modname: 'video', youtubeId: 'WUvTyaaNkzM', sectionName: 'Week 1' },
        { id: 1003, name: 'Differentiation rules', modname: 'resource', description: 'PDF · 24 pages', sectionName: 'Week 2' },
        { id: 1004, name: 'Quiz — derivatives', modname: 'quiz', sectionName: 'Week 2' },
        { id: 1005, name: 'Flashcards: formulas', modname: 'flashcard', sectionName: 'Week 3' },
    ],
    14: [
        { id: 2001, name: 'Vectors and scalars', modname: 'resource', sectionName: 'Week 1' },
        { id: 2002, name: 'Newton’s laws (video)', modname: 'video', youtubeId: 'kKKM8Y-u7ds', sectionName: 'Week 1' },
        { id: 2003, name: 'Problem set 1', modname: 'quiz', sectionName: 'Week 2' },
    ],
    21: [
        { id: 3001, name: 'Flashcards: vocabulary', modname: 'flashcard', sectionName: 'Unit 1' },
        { id: 3002, name: 'Reading: short stories', modname: 'resource', sectionName: 'Unit 1' },
        { id: 3003, name: 'Grammar drill', modname: 'quiz', sectionName: 'Unit 2' },
    ],
    33: [
        { id: 4001, name: 'Lab safety video', modname: 'video', youtubeId: '1iMYD6cL2i0', sectionName: 'Module 1' },
        { id: 4002, name: 'Certification quiz', modname: 'quiz', sectionName: 'Module 1' },
    ],
};

const DEMO_FLASHCARDS = [
    { front: 'derivative of sin(x)', back: 'cos(x)' },
    { front: 'derivative of e^x', back: 'e^x' },
    { front: 'Newton’s second law', back: 'F = m · a' },
    { front: 'unit of force', back: 'newton (N) = kg·m/s²' },
    { front: 'integration of 1/x', back: 'ln|x| + C' },
    { front: 'مرادف كلمة "سريع"', back: 'عجول / وشيك' },
];

const FAMILIES: BadgeFamily[] = ['video', 'pdf', 'flashcard', 'usage', 'streak'];

function levelFloor(level: number): number {
    return level <= 1 ? 0 : Math.round(25 * (level - 1) * level);
}

function levelFor(xp: number): number {
    let level = 1;
    while (xp >= levelFloor(level + 1)) {
        level += 1;
    }
    return level;
}

class BrowserBridge implements AllamaBridge {
    readonly isNative = false;

    private readonly key = (name: string) => `allama.demo.${name}`;

    private read<T>(name: string, fallback: T): T {
        try {
            const raw = localStorage.getItem(this.key(name));
            return raw ? (JSON.parse(raw) as T) : fallback;
        } catch {
            return fallback;
        }
    }

    private write(name: string, value: unknown): void {
        try {
            localStorage.setItem(this.key(name), JSON.stringify(value));
        } catch {
            /* storage full or blocked — demo mode only */
        }
    }

    async tenantList(): Promise<Tenant[]> {
        return DEMO_TENANTS;
    }

    async tenantResolve(code: string): Promise<Tenant | null> {
        const normalised = code.trim().toLowerCase().split('.')[0];
        return (
            DEMO_TENANTS.find((tenant) => tenant.id === normalised) ?? {
                id: normalised,
                backendUrl: `https://${normalised}.allama.online`,
                companyId: null,
            }
        );
    }

    async tenantBranding(tenantId: string): Promise<TenantBranding | null> {
        const tenant = await this.tenantResolve(tenantId);
        if (!tenant) {
            return null;
        }

        const palette: Record<string, string> = {
            safwa: '#2563EB',
            maher: '#0F766E',
            dalgamoun: '#7C3AED',
            habiba: '#DB2777',
            hety: '#EA580C',
            ramadan: '#B45309',
            daheeh: '#0891B2',
            zdoctor: '#16A34A',
            zayyat: '#4F46E5',
        };

        return {
            tenantId: tenant.id,
            siteUrl: tenant.backendUrl,
            appName: tenant.description?.replace(' Learning Platform', '') ?? tenant.id,
            primaryColor: palette[tenant.id] ?? '#2563EB',
            logoUrl: null,
            logoPath: null,
        };
    }

    async authLogin(input: LoginInput): Promise<Session> {
        if (input.password.trim().toLowerCase() === 'fail') {
            throw new Error('login failed: invalid login, please try again');
        }
        if (input.username.trim().length < 2 || input.password.length < 2) {
            throw new Error('login failed: invalid login, please try again');
        }

        const tenant = await this.tenantResolve(input.tenantId);
        const session: Session = {
            tenantId: tenant?.id ?? input.tenantId,
            siteUrl: input.siteUrl?.trim() || tenant?.backendUrl || `https://${input.tenantId}.allama.online`,
            userId: 1042,
            username: input.username.trim(),
            fullName: input.username.trim().replace(/^\w/, (c) => c.toUpperCase()),
            siteName: tenant?.description ?? 'Allama',
            lang: 'en',
            userPicture: null,
            expiresAt: null,
        };

        this.write('session', session);
        this.seed();

        return session;
    }

    async authSession(tenantId: string): Promise<Session | null> {
        const session = this.read<Session | null>('session', null);
        return session && session.tenantId === tenantId ? session : null;
    }

    async authSessions(): Promise<Session[]> {
        const session = this.read<Session | null>('session', null);
        return session ? [session] : [];
    }

    async authLogout(): Promise<void> {
        this.write('session', null);
    }

    async wsCall<T>(tenantId: string, func: string, params?: Record<string, unknown>): Promise<T> {
        const session = await this.authSession(tenantId);
        if (!session) {
            throw new Error(`not signed in to tenant '${tenantId}'`);
        }

        // 1. In browser mode, attempt direct fetch if backend allows CORS or reverse proxy
        try {
            if (session.siteUrl && !session.siteUrl.includes('demo')) {
                const url = `${session.siteUrl.replace(/\/+$/, '')}/webservice/rest/server.php`;
                const form = new URLSearchParams();
                form.append('wsfunction', func);
                form.append('moodlewsrestformat', 'json');
                if (params) {
                    for (const [key, val] of Object.entries(params)) {
                        if (typeof val === 'object' && val !== null) {
                            form.append(key, JSON.stringify(val));
                        } else {
                            form.append(key, String(val));
                        }
                    }
                }
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: form.toString(),
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data && !data.exception) {
                        return data as T;
                    }
                }
            }
        } catch {
            // Network failure or CORS blocked: gracefully proceed to offline mock handler below
        }

        // 2. Offline / local mock fallback handler
        if (func === 'core_course_get_contents') {
            const courseId = Number(params?.courseid ?? 0);
            return (DEMO_MODULES[courseId] ?? []) as unknown as T;
        }

        if (func === 'core_course_get_enrolled_courses_by_timeline_classification' || func === 'core_enrol_get_users_courses') {
            return (DEMO_COURSES as unknown) as T;
        }

        if (func === 'core_message_send_instant_messages') {
            return [{ msgid: Date.now() }] as unknown as T;
        }

        return {} as T;
    }

    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
        if (sql.includes('mdl_cached_courses')) {
            const courses = this.read<CourseRow[]>('courses', []);
            const tenantId = String(params[0] ?? '');
            const stored = this.read<Record<string, CourseRow[]>>('coursesByTenant', {});
            return tenantId && stored[tenantId] ? (stored[tenantId] as unknown as T[]) : (courses as unknown as T[]);
        }

        return [];
    }

    async execute(): Promise<number> {
        return 0;
    }

    private seed(): void {
        const courses = this.read<CourseRow[]>('courses', []);
        if (!courses.length) {
            this.write('courses', DEMO_COURSES);
        }
        if (!this.read<Record<string, BadgeState>>('badges', {})['usage']) {
            this.write('badges', {});
        }
        if (!this.read<Post[]>('posts', []).length) {
            this.write('posts', [
                {
                    id: 'seed-1',
                    author: 'Ms. Nour',
                    body: 'Reminder: the derivatives quiz closes Sunday 22:00. Review section 3.2 first!',
                    likes: 4,
                    created_at: Math.floor(Date.now() / 1000) - 3600,
                },
                {
                    id: 'seed-2',
                    author: 'Omar',
                    body: 'Uploaded my summary of Newton’s laws to the study group. Good luck everyone.',
                    likes: 9,
                    created_at: Math.floor(Date.now() / 1000) - 7200,
                },
            ]);
        }
    }

    async badgesState(tenantId: string, userId: number): Promise<BadgeState[]> {
        const store = this.read<Record<string, { xp: number; streak: number; updatedAt: number }>>('badges', {});
        const now = Math.floor(Date.now() / 1000);

        return FAMILIES.map((family) => {
            const entry = store[`${tenantId}:${userId}:${family}`] ?? { xp: 0, streak: 0, updatedAt: now };
            const level = levelFor(entry.xp);
            const floor = levelFloor(level);
            const next = levelFloor(level + 1);
            return {
                family,
                xp: entry.xp,
                level,
                levelFloor: floor,
                nextLevelXp: next,
                progress: Math.min(1, Math.max(0, (entry.xp - floor) / Math.max(1, next - floor))),
                streak: entry.streak,
                updatedAt: entry.updatedAt,
            };
        });
    }

    async badgesAward(
        tenantId: string,
        userId: number,
        family: BadgeFamily,
        xp: number,
        detail?: string,
    ): Promise<BadgeState> {
        const store = this.read<Record<string, { xp: number; streak: number; updatedAt: number }>>('badges', {});
        const key = `${tenantId}:${userId}:${family}`;
        const now = Math.floor(Date.now() / 1000);
        const entry = store[key] ?? { xp: 0, streak: 0, updatedAt: now };

        entry.xp += Math.max(0, Math.min(10_000, Math.round(xp)));
        entry.updatedAt = now;
        if (family === 'streak') {
            entry.streak += 1;
        }
        store[key] = entry;
        this.write('badges', store);

        if (detail) {
            const attempts = this.read<unknown[]>('xpEvents', []);
            attempts.push({ family, xp, detail, at: now });
            this.write('xpEvents', attempts);
        }

        const all = await this.badgesState(tenantId, userId);
        return all.find((state) => state.family === family) as BadgeState;
    }

    async badgesTick(tenantId: string, userId: number, seconds: number): Promise<BadgeState | null> {
        if (seconds < 30) {
            return null;
        }
        return this.badgesAward(tenantId, userId, 'usage', Math.min(10, Math.max(1, Math.floor(seconds / 30))), 'activity checkpoint');
    }

    async mediaList(tenantId: string, userId: number): Promise<MediaItem[]> {
        const all = this.read<MediaItem[]>('media', []);
        return all.filter((item) => item.id.startsWith(`${tenantId}:${userId}:`));
    }

    async mediaImport(input: {
        tenantId: string;
        userId: number;
        title?: string;
        url: string;
    }): Promise<MediaItem> {
        const all = this.read<MediaItem[]>('media', []);
        const item: MediaItem = {
            id: `${input.tenantId}:${input.userId}:${crypto.randomUUID()}`,
            title: input.title ?? input.url.split('/').pop() ?? 'Download',
            source_url: input.url,
            size_bytes: 18_400_000,
            plain_bytes: 18_400_000,
            duration_seconds: 620,
            watched_seconds: 0,
            created_at: Math.floor(Date.now() / 1000),
            streamUrl: input.url,
        };
        all.push(item);
        this.write('media', all);

        return item;
    }

    async mediaProgress(mediaId: string, seconds: number): Promise<void> {
        const all = this.read<MediaItem[]>('media', []);
        const item = all.find((entry) => entry.id === mediaId);
        if (item) {
            item.watched_seconds = Math.max(item.watched_seconds, Math.round(seconds));
            this.write('media', all);
        }
    }

    async mediaServer(): Promise<{ port: number; baseUrl: string }> {
        return { port: 0, baseUrl: '' };
    }

    async socialPosts(tenantId: string): Promise<Post[]> {
        const all = this.read<(Post & { tenantId?: string })[]>('posts', []);
        return all
            .filter((post) => !post.tenantId || post.tenantId === tenantId)
            .sort((a, b) => b.created_at - a.created_at);
    }

    async socialCreatePost(input: {
        tenantId: string;
        userId: number;
        author: string;
        body: string;
    }): Promise<Post> {
        const all = this.read<(Post & { tenantId?: string })[]>('posts', []);
        const post = {
            id: crypto.randomUUID(),
            tenantId: input.tenantId,
            author: input.author,
            body: input.body.trim(),
            likes: 0,
            created_at: Math.floor(Date.now() / 1000),
            synced_at: null,
        };
        all.push(post);
        this.write('posts', all);

        return post;
    }

    async socialLike(tenantId: string, postId: string): Promise<number> {
        const all = this.read<(Post & { tenantId?: string })[]>('posts', []);
        const post = all.find((entry) => entry.id === postId);
        if (!post) {
            return 0;
        }
        post.likes += 1;
        this.write('posts', all);

        return post.likes;
    }

    async syncQueueAttempt(input: SyncQueueInput): Promise<string> {
        const all = this.read<(PendingAttempt & { tenantId: string })[]>('attempts', []);
        const id = crypto.randomUUID();
        all.push({
            id,
            tenantId: input.tenantId,
            user_id: input.userId,
            context: input.context,
            payload: JSON.stringify(input.payload),
            grade: input.grade ?? null,
            created_at: Math.floor(Date.now() / 1000),
            status: 'pending',
            error: null,
        });
        this.write('attempts', all);

        return id;
    }

    async syncPending(tenantId: string): Promise<PendingAttempt[]> {
        return this.read<(PendingAttempt & { tenantId: string })[]>('attempts', []).filter(
            (attempt) => attempt.tenantId === tenantId && attempt.status !== 'synced',
        );
    }

    async syncFlush(tenantId: string): Promise<SyncReport> {
        const all = this.read<(PendingAttempt & { tenantId: string })[]>('attempts', []);
        let synced = 0;

        for (const attempt of all) {
            if (attempt.tenantId === tenantId && attempt.status !== 'synced') {
                attempt.status = 'synced';
                sync_at(attempt);
                synced += 1;
            }
        }
        this.write('attempts', all);

        return { attempts: synced, xpEvents: 0, posts: 0, failed: 0, errors: [] };
    }

    async setCaptureProtection(enabled: boolean): Promise<ProtectionReport> {
        return {
            enabled,
            enforced: false,
            platform: 'browser',
            mechanism: 'only available inside the Tauri shell',
        };
    }

    async integrity(): Promise<IntegrityReport> {
        return { platform: 'browser', rooted: false, debuggerAttached: false, indicators: [] };
    }

    async device(): Promise<DeviceInfo> {
        return {
            platform: navigator.platform || 'browser',
            arch: 'wasm',
            cpuCount: navigator.hardwareConcurrency || 4,
            totalMemoryBytes: 0,
            deviceId: 'browser',
            keyFingerprint: 'n/a',
        };
    }

    async storageUsage(): Promise<StorageUsage> {
        let total = 0;
        for (const key of Object.keys(localStorage)) {
            if (key.startsWith('allama.demo.')) {
                total += (localStorage.getItem(key) ?? '').length;
            }
        }

        return { dataDir: 'localStorage', dbBytes: total, mediaBytes: 0, keyBytes: 0, totalBytes: total };
    }

    async youtubeQuality(quality: string): Promise<YouTubeConfig> {
        return {
            requested: quality,
            quality,
            qualities: ['highres', 'hd2160', 'hd1440', 'hd1080', 'hd720', 'large'],
            script: '',
        };
    }

    async applyYouTubeQuality(quality: string): Promise<void> {
        const frames = document.querySelectorAll<HTMLIFrameElement>('iframe[data-allama-player]');
        frames.forEach((frame) => {
            frame.contentWindow?.postMessage(
                JSON.stringify({ event: 'command', func: 'setPlaybackQualityRange', args: [quality, quality] }),
                '*',
            );
        });
    }
}

function sync_at(attempt: PendingAttempt): void {
    attempt.status = 'synced';
}

const nativeAvailable = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const bridge: AllamaBridge = nativeAvailable ? new TauriBridge() : new BrowserBridge();
