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

import { sessionOrThrow } from '../store';
import type { CourseModule, CourseRow } from '../types';
import { bridge } from './tauri-bridge';

const MODULE_KEY = 'allama.modules.';

interface RawCourse {
    id: number;
    fullname: string;
    shortname?: string;
    summary?: string;
    categoryname?: string;
    courseimage?: string;
    progress?: number;
}

/** Courses already stored in the native SQLite cache. */
export async function cachedCourses(): Promise<CourseRow[]> {
    const session = sessionOrThrow();

    if (!bridge.isNative) {
        return readLocalCourses(session.tenantId);
    }

    return bridge.query<CourseRow>(
        `SELECT course_id, fullname, shortname, summary, category, image_url, progress
         FROM mdl_cached_courses
         WHERE tenant_id = ?1 AND user_id = ?2
         ORDER BY fullname`,
        [session.tenantId, session.userId],
    );
}

/** Pulls enrolled courses from Moodle and stores them for offline use. */
export async function syncCourses(): Promise<CourseRow[]> {
    const session = sessionOrThrow();

    const response = await bridge.wsCall<{ courses?: RawCourse[] }>(
        session.tenantId,
        'core_course_get_enrolled_courses_by_timeline_classification',
        { classification: 'inprogress', limit: 0, offset: 0, sort: 'fullname' },
    );

    const rows: CourseRow[] = (response.courses ?? []).map((course) => ({
        course_id: Number(course.id),
        fullname: course.fullname ?? 'Untitled course',
        shortname: course.shortname ?? null,
        summary: stripHtml(course.summary ?? ''),
        category: course.categoryname ?? null,
        image_url: course.courseimage ?? null,
        progress: typeof course.progress === 'number' ? course.progress / 100 : 0,
    }));

    if (!rows.length) {
        return cachedCourses();
    }

    for (const row of rows) {
        if (!bridge.isNative) {
            continue;
        }

        await bridge.execute(
            `INSERT INTO mdl_cached_courses
                (tenant_id, user_id, course_id, fullname, shortname, summary, category, image_url, progress, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(tenant_id, user_id, course_id) DO UPDATE SET
                fullname = excluded.fullname,
                shortname = excluded.shortname,
                summary = excluded.summary,
                category = excluded.category,
                image_url = excluded.image_url,
                progress = excluded.progress,
                updated_at = excluded.updated_at`,
            [
                session.tenantId,
                session.userId,
                row.course_id,
                row.fullname,
                row.shortname ?? null,
                row.summary ?? null,
                row.category ?? null,
                row.image_url ?? null,
                row.progress,
                Math.floor(Date.now() / 1000),
            ],
        );
    }

    if (!bridge.isNative) {
        writeLocalCourses(session.tenantId, rows);
    }

    return rows;
}

/** Course contents, cached per course for the player route. */
export async function courseModules(courseId: number): Promise<CourseModule[]> {
    const session = sessionOrThrow();
    const cached = readModules(session.tenantId, courseId);
    if (cached.length) {
        return cached;
    }

    try {
        const sections = await bridge.wsCall<RawSection[]>(
            session.tenantId,
            'core_course_get_contents',
            { courseid: courseId },
        );

        const modules = flattenModules(sections);
        writeModules(session.tenantId, courseId, modules);

        return modules;
    } catch {
        return [];
    }
}

/** Persists an offline attempt (quiz answer, flashcard review, ...). */
export async function queueAttempt(
    context: string,
    payload: unknown,
    grade?: number,
): Promise<string> {
    const session = sessionOrThrow();

    return bridge.syncQueueAttempt({
        tenantId: session.tenantId,
        userId: session.userId,
        context,
        payload,
        grade: grade ?? null,
    });
}

interface RawSection {
    name?: string;
    modules?: {
        id: number;
        name: string;
        modname: string;
        url?: string;
        description?: string;
        contents?: { fileurl?: string; filename?: string; mimetype?: string }[];
    }[];
}

function flattenModules(sections: RawSection[]): CourseModule[] {
    const modules: CourseModule[] = [];

    for (const section of sections) {
        for (const module of section.modules ?? []) {
            const file = (module.contents ?? [])[0];
            const youtube = extractYoutube(module.url ?? '');
            const media = file?.mimetype?.startsWith('video/') ? file.fileurl : undefined;

            modules.push({
                id: module.id,
                name: module.name,
                modname: module.modname,
                url: module.url,
                description: stripHtml(module.description ?? ''),
                mediaUrl: media,
                youtubeId: youtube,
                sectionName: section.name,
            });
        }
    }

    return modules;
}

function extractYoutube(url: string): string | undefined {
    const match = url.match(/(?:youtu\.be\/|v=|embed\/)([\w-]{11})/);

    return match?.[1];
}

function stripHtml(html: string): string {
    return html
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function readLocalCourses(tenantId: string): CourseRow[] {
    try {
        const raw = localStorage.getItem(`allama.courses.${tenantId}`);

        return raw ? (JSON.parse(raw) as CourseRow[]) : [];
    } catch {
        return [];
    }
}

function writeLocalCourses(tenantId: string, rows: CourseRow[]): void {
    try {
        localStorage.setItem(`allama.courses.${tenantId}`, JSON.stringify(rows));
    } catch {
        /* ignore quota errors in demo mode */
    }
}

function readModules(tenantId: string, courseId: number): CourseModule[] {
    try {
        const raw = sessionStorage.getItem(`${MODULE_KEY}${tenantId}.${courseId}`);

        return raw ? (JSON.parse(raw) as CourseModule[]) : [];
    } catch {
        return [];
    }
}

function writeModules(tenantId: string, courseId: number, modules: CourseModule[]): void {
    try {
        sessionStorage.setItem(`${MODULE_KEY}${tenantId}.${courseId}`, JSON.stringify(modules));
    } catch {
        /* ignore quota errors */
    }
}
