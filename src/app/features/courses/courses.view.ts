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

import { t } from '../../core/i18n';
import { cachedCourses, syncCourses } from '../../core/services/db.service';
import { state } from '../../core/store';
import type { CourseRow } from '../../core/types';
import { errorMessage, esc, icon, qs, toast } from '../../shared/ui';
import type { View } from '../../core/router';

function courseCard(course: CourseRow): string {
    const progress = Math.round(Math.max(0, Math.min(1, course.progress)) * 100);

    return `
        <a class="card course" href="#/course/${course.course_id}">
            <div class="course__head">
                <span class="course__badge">${esc((course.shortname ?? 'CRS').slice(0, 6))}</span>
                <span class="course__cat">${esc(course.category ?? 'General')}</span>
            </div>
            <h3>${esc(course.fullname)}</h3>
            <p class="course__summary">${esc(course.summary ?? '')}</p>
            <div class="progress">
                <div class="progress__bar" style="width:${progress}%"></div>
            </div>
            <div class="course__foot">
                <span>${progress}% ${esc(t('courses.progress'))}</span>
                <span class="course__open">${esc(t('courses.open'))} →</span>
            </div>
        </a>
    `;
}

export const coursesView: View = {
    render(): string {
        return `
            <section class="page__head">
                <div>
                    <h1>${esc(t('courses.title'))}</h1>
                    <p class="muted">${esc(state.session?.fullName ?? '')} · ${esc(state.session?.siteName ?? '')}</p>
                </div>
                <div class="page__actions">
                    <button class="btn" type="button" id="sync-courses">
                        ${icon('sync')}<span>${esc(t('courses.sync'))}</span>
                    </button>
                </div>
            </section>

            <p class="pill pill--soft" id="cache-pill">${esc(t('courses.offline'))}</p>

            <div class="grid" id="course-grid">
                <div class="card skeleton"></div>
                <div class="card skeleton"></div>
                <div class="card skeleton"></div>
            </div>
        `;
    },

    mount(root: HTMLElement): void {
        const grid = qs<HTMLElement>(root, '#course-grid');
        const syncButton = qs<HTMLButtonElement>(root, '#sync-courses');

        const paint = (courses: CourseRow[]): void => {
            if (!courses.length) {
                grid.innerHTML = `<div class="empty">${esc(t('courses.empty'))}</div>`;

                return;
            }

            grid.innerHTML = courses.map(courseCard).join('');
        };

        const load = async (): Promise<void> => {
            try {
                const courses = await cachedCourses();
                paint(courses);

                if (!courses.length && navigator.onLine) {
                    paint(await syncCourses());
                }
            } catch (error) {
                grid.innerHTML = `<div class="empty">${esc(errorMessage(error))}</div>`;
            }
        };

        syncButton.addEventListener('click', async () => {
            syncButton.disabled = true;
            syncButton.classList.add('btn--busy');

            try {
                const courses = await syncCourses();
                paint(courses);
                toast(`Cached ${courses.length} courses`, 'success');
            } catch (error) {
                toast(errorMessage(error), 'error');
            } finally {
                syncButton.disabled = false;
                syncButton.classList.remove('btn--busy');
            }
        });

        void load();
    },
};
