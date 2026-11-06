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
import { cachedCourses, courseModules } from '../../core/services/db.service';
import { state } from '../../core/store';
import type { CourseModule } from '../../core/types';
import { errorMessage, esc, icon, qs } from '../../shared/ui';
import type { View, ViewContext } from '../../core/router';

const MOD_ICONS: Record<string, string> = {
    video: 'play',
    flashcard: 'cards',
    quiz: 'check',
    resource: 'download',
    page: 'courses',
};

function moduleRow(courseId: string, module: CourseModule): string {
    const target =
        module.modname === 'video' || module.modname === 'flashcard'
            ? `#/player/${courseId}/${module.id}`
            : `#/player/${courseId}/${module.id}`;

    return `
        <a class="module" href="${target}">
            <span class="module__icon">${icon(MOD_ICONS[module.modname] ?? 'courses')}</span>
            <span class="module__body">
                <strong>${esc(module.name)}</strong>
                <small>${esc(module.modname)}${module.description ? ` · ${esc(module.description.slice(0, 80))}` : ''}</small>
            </span>
            <span class="module__go">→</span>
        </a>
    `;
}

export const courseView: View = {
    render(ctx: ViewContext): string {
        const courseId = ctx.params.id ?? '0';

        return `
            <section class="page__head">
                <div>
                    <a class="backlink" href="#/courses">${icon('back')}<span>${esc(t('course.back'))}</span></a>
                    <h1 id="course-title">Course #${esc(courseId)}</h1>
                    <p class="muted" id="course-sub">${esc(state.session?.siteName ?? '')}</p>
                </div>
            </section>
            <div class="stack" id="module-list">
                <div class="card skeleton"></div>
                <div class="card skeleton"></div>
            </div>
        `;
    },

    mount(root: HTMLElement, ctx: ViewContext): void {
        const courseId = Number(ctx.params.id ?? 0);
        const list = qs<HTMLElement>(root, '#module-list');

        void (async () => {
            try {
                const cached = await cachedCourses();
                const course = cached.find((row) => row.course_id === courseId);
                if (course) {
                    qs<HTMLElement>(root, '#course-title').textContent = course.fullname;
                    qs<HTMLElement>(root, '#course-sub').textContent = course.summary ?? '';
                }

                const modules = await courseModules(courseId);
                if (!modules.length) {
                    list.innerHTML = `<div class="empty">No activities cached for this course yet. Connect and reopen it.</div>`;

                    return;
                }

                const sections = new Map<string, CourseModule[]>();
                for (const module of modules) {
                    const key = module.sectionName || 'General';
                    sections.set(key, [...(sections.get(key) ?? []), module]);
                }

                list.innerHTML = `<h2 class="section-title">${esc(t('course.modules'))}</h2>${Array.from(sections)
                    .map(
                        ([section, items]) => `
                        <section class="card section">
                            <h3>${esc(section)}</h3>
                            <div class="section__items">
                                ${items.map((module) => moduleRow(String(courseId), module)).join('')}
                            </div>
                        </section>`,
                    )
                    .join('')}`;
            } catch (error) {
                list.innerHTML = `<div class="empty">${esc(errorMessage(error))}</div>`;
            }
        })();
    },
};
