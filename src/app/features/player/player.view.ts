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
import { awardVideoMinutes } from '../../core/services/badges.service';
import { courseModules, queueAttempt } from '../../core/services/db.service';
import {
    applyYoutubeQuality,
    downloadMedia,
    QUALITY_OPTIONS,
    saveProgress,
    setCaptureProtection,
    storedQuality,
    youtubeEmbedUrl,
} from '../../core/services/video.service';
import { state } from '../../core/store';
import type { CourseModule } from '../../core/types';
import { errorMessage, esc, icon, qs, toast } from '../../shared/ui';
import type { View, ViewContext } from '../../core/router';

function qualityOptions(): string {
    const current = storedQuality();

    return QUALITY_OPTIONS.map(
        (option) =>
            `<option value="${esc(option.value)}" ${option.value === current ? 'selected' : ''}>${esc(
                option.label,
            )}</option>`,
    ).join('');
}

export const playerView: View = {
    render(ctx: ViewContext): string {
        return `
            <section class="page__head">
                <div>
                    <a class="backlink" href="#/course/${esc(ctx.params.courseId ?? '')}">
                        ${icon('back')}<span>${esc(t('course.back'))}</span>
                    </a>
                    <h1 id="player-title">Loading activity…</h1>
                    <p class="muted" id="player-sub"></p>
                </div>
                <div class="page__actions">
                    <label class="select">
                        <span>${esc(t('player.quality'))}</span>
                        <select id="quality">${qualityOptions()}</select>
                    </label>
                    <button class="btn" type="button" id="capture" aria-pressed="false">
                        ${icon('shield')}<span>${esc(t('player.capture'))}</span>
                    </button>
                </div>
            </section>

            <div class="player" id="player-stage">
                <div class="player__frame" id="player-frame">
                    <div class="player__placeholder">Loading…</div>
                </div>
                <aside class="player__side" id="player-side"></aside>
            </div>
        `;
    },

    mount(root: HTMLElement, ctx: ViewContext): void | (() => void) {
        const courseId = Number(ctx.params.courseId ?? 0);
        const moduleId = Number(ctx.params.moduleId ?? 0);
        const frame = qs<HTMLElement>(root, '#player-frame');
        const side = qs<HTMLElement>(root, '#player-side');
        const quality = qs<HTMLSelectElement>(root, '#quality');
        const capture = qs<HTMLButtonElement>(root, '#capture');
        let watchedSeconds = 0;
        let progressTimer = 0;
        let mediaId: string | null = null;

        quality.addEventListener('change', () => {
            void applyYoutubeQuality(quality.value);
        });

        capture.addEventListener('click', async () => {
            const enable = capture.getAttribute('aria-pressed') !== 'true';
            try {
                const report = await setCaptureProtection(enable);
                capture.setAttribute('aria-pressed', String(enable));
                capture.classList.toggle('btn--active', enable);
                toast(
                    report.enforced ? t('player.captureOn') : `Not enforced here: ${report.mechanism}`,
                    report.enforced ? 'success' : 'info',
                );
            } catch (error) {
                toast(errorMessage(error), 'error');
            }
        });

        const renderModule = (module: CourseModule): void => {
            qs<HTMLElement>(root, '#player-title').textContent = module.name;
            qs<HTMLElement>(root, '#player-sub').textContent =
                `${module.modname} · ${module.sectionName ?? 'General'}`;

            if (module.youtubeId) {
                frame.innerHTML = `
                    <iframe
                        data-allama-player
                        src="${esc(youtubeEmbedUrl(module.youtubeId))}"
                        title="${esc(module.name)}"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowfullscreen
                    ></iframe>`;
                void applyYoutubeQuality(quality.value);

                return;
            }

            if (module.mediaUrl) {
                mediaId = null;
                frame.innerHTML = `
                    <video id="video" controls playsinline preload="metadata" src="${esc(module.mediaUrl)}"></video>
                `;
                const video = qs<HTMLVideoElement>(frame, '#video');
                video.addEventListener('timeupdate', () => {
                    watchedSeconds = Math.max(watchedSeconds, video.currentTime);
                });

                return;
            }

            if (module.modname === 'flashcard') {
                frame.innerHTML = `
                    <div class="player__placeholder">
                        <h3>Flashcard deck</h3>
                        <p>Review the deck and earn XP offline.</p>
                        <a class="btn btn--primary" href="#/flashcards">Open flashcards</a>
                    </div>`;

                return;
            }

            frame.innerHTML = `
                <div class="player__placeholder">
                    <h3>${esc(module.name)}</h3>
                    <p>${esc(module.description || 'This activity opens in the course activity sheet.')}</p>
                    ${module.url ? `<a class="btn" href="${esc(module.url)}" target="_blank" rel="noreferrer">Open on site</a>` : ''}
                </div>`;
        };

        const renderSide = (module: CourseModule): void => {
            side.innerHTML = `
                <h3>${esc(t('profile.badges'))}</h3>
                <ul class="facts">
                    <li><span>Module</span><strong>${esc(module.modname)}</strong></li>
                    <li><span>${esc(t('player.progress'))}</span><strong id="watched">0:00</strong></li>
                    <li><span>${esc(t('common.xp'))}</span><strong>${esc(String(state.badges.find((b) => b.family === 'video')?.xp ?? 0))}</strong></li>
                </ul>
                <button class="btn btn--block" type="button" id="download">
                    ${icon('download')}<span>${esc(t('player.offline'))}</span>
                </button>
                ${
                    module.modname === 'quiz'
                        ? `<button class="btn btn--primary btn--block" type="button" data-submit-quiz>${icon('check')}<span>${esc(
                              t('player.queue'),
                          )}</span></button>`
                        : ''
                }
                <p class="hint">Encrypted with AES-256-GCM and streamed from a loopback server.</p>
            `;

            qs<HTMLButtonElement>(side, '#download').addEventListener('click', async () => {
                const url = module.mediaUrl ?? module.url;
                if (!url) {
                    toast('This activity has no downloadable media', 'info');

                    return;
                }

                try {
                    const item = await downloadMedia(module.name, url);
                    mediaId = item.id;
                    toast('Saved offline (encrypted)', 'success');
                } catch (error) {
                    toast(errorMessage(error), 'error');
                }
            });
        };

        void (async () => {
            try {
                const modules = await courseModules(courseId);
                const module = modules.find((entry) => entry.id === moduleId);
                if (!module) {
                    frame.innerHTML = `<div class="player__placeholder">Activity not found in the offline cache.</div>`;

                    return;
                }

                renderModule(module);
                renderSide(module);

                if (module.mediaUrl) {
                    progressTimer = window.setInterval(() => {
                        const watched = qs<HTMLElement>(root, '#watched');
                        if (watched) {
                            watched.textContent = `${Math.floor(watchedSeconds / 60)}:${String(
                                Math.round(watchedSeconds % 60),
                            ).padStart(2, '0')}`;
                        }
                    }, 1000);
                }
            } catch (error) {
                frame.innerHTML = `<div class="player__placeholder">${esc(errorMessage(error))}</div>`;
            }
        })();

        const submitQuiz = async (): Promise<void> => {
            try {
                await queueAttempt(`course:${courseId}:module:${moduleId}`, { answers: [1, 3, 2] }, 0.8);
                toast('Attempt queued for sync', 'success');
            } catch (error) {
                toast(errorMessage(error), 'error');
            }
        };

        side.addEventListener('click', (event) => {
            if ((event.target as HTMLElement).closest('[data-submit-quiz]')) {
                void submitQuiz();
            }
        });

        return () => {
            window.clearInterval(progressTimer);
            if (watchedSeconds >= 60) {
                void awardVideoMinutes(watchedSeconds / 60);
            }
            void setCaptureProtection(false).catch(() => undefined);
            if (mediaId) {
                void saveProgress(mediaId, watchedSeconds).catch(() => undefined);
            }
        };
    },
};
