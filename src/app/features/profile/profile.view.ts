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
import { refreshBadges, signOut } from '../../core/services/auth.service';
import { bridge } from '../../core/services/tauri-bridge';
import { setCaptureProtection } from '../../core/services/video.service';
import { flushQueue, pendingAttempts } from '../../core/services/sync.service';
import { wsService, formatTenantUserCode, type StudyReport } from '../../core/services/ws.service';
import { sessionOrThrow, state } from '../../core/store';
import type { BadgeState, DeviceInfo, IntegrityReport, StorageUsage } from '../../core/types';
import { errorMessage, esc, formatBytes, icon, qs, toast } from '../../shared/ui';
import type { View } from '../../core/router';

function badgeCard(badge: BadgeState): string {
    return `
        <div class="badge">
            <div class="badge__top">
                <span class="badge__name">${esc(t(`family.${badge.family}`))}</span>
                <span class="badge__level">L${badge.level}</span>
            </div>
            <div class="progress"><div class="progress__bar" style="width:${Math.round(badge.progress * 100)}%"></div></div>
            <div class="badge__foot">
                <span>${badge.xp} ${esc(t('common.xp'))}</span>
                <span>${badge.streak > 0 ? `${badge.streak}🔥` : ''}</span>
            </div>
        </div>
    `;
}

export const profileView: View = {
    render(): string {
        const session = state.session;

        return `
            <section class="page__head">
                <div>
                    <h1>${esc(t('profile.title'))}</h1>
                    <p class="muted">${esc(session?.siteUrl ?? '')}</p>
                </div>
                <button class="btn btn--danger" type="button" id="logout">
                    ${icon('logout')}<span>${esc(t('profile.logout'))}</span>
                </button>
            </section>

            <section class="card profile">
                <div class="profile__id">
                    <span class="avatar avatar--lg">${esc((session?.fullName ?? 'A').charAt(0))}</span>
                    <div style="flex: 1;">
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;">
                            <h2>${esc(session?.fullName ?? session?.username ?? '')}</h2>
                            <span class="pill pill--xp" style="font-size: 0.85rem; font-weight: 700; letter-spacing: 0.05em;">
                                ID: ${esc(formatTenantUserCode(session?.tenantId ?? 'AL', session?.userId ?? 1042))}
                            </span>
                        </div>
                        <p class="muted">${esc(session?.username ?? '')} · ${esc(session?.siteName ?? '')}</p>
                        <span class="pill pill--soft">tenant: ${esc(session?.tenantId ?? '')}</span>
                    </div>
                </div>
            </section>

            <section class="card">
                <div class="card__head">
                    <h3>Time Spent Using App</h3>
                    <span class="pill pill--ok" id="time-status"><span class="dot"></span> Live</span>
                </div>
                <div class="facts" id="study-time">
                    <div><span>Today</span><strong id="time-today">-- min</strong></div>
                    <div><span>This Week</span><strong id="time-week">-- min</strong></div>
                    <div><span>Total Hours (All-Time)</span><strong id="time-total">-- hrs</strong></div>
                    <div><span>Active Streak</span><strong id="time-streak">-- days 🔥</strong></div>
                </div>
            </section>

            <section class="card">
                <h3>${esc(t('profile.badges'))}</h3>
                <div class="badges" id="badges"></div>
            </section>

            <div class="grid grid--two">
                <section class="card">
                    <h3>${esc(t('profile.security'))}</h3>
                    <label class="switch">
                        <input type="checkbox" id="capture" />
                        <span>${esc(t('profile.protection'))}</span>
                    </label>
                    <div class="facts" id="integrity">
                        <div class="muted">Checking…</div>
                    </div>
                </section>

                <section class="card">
                    <h3>${esc(t('profile.storage'))}</h3>
                    <div class="facts" id="storage">
                        <div class="muted">…</div>
                    </div>
                </section>
            </div>

            <section class="card">
                <div class="card__head">
                    <h3>${esc(t('profile.sync'))}</h3>
                    <button class="btn" type="button" id="flush">${icon('sync')}<span>${esc(t('profile.flush'))}</span></button>
                </div>
                <div class="facts" id="pending"><div class="muted">…</div></div>
            </section>
        `;
    },

    mount(root: HTMLElement): void {
        const badges = qs<HTMLElement>(root, '#badges');
        const integrityHost = qs<HTMLElement>(root, '#integrity');
        const storageHost = qs<HTMLElement>(root, '#storage');
        const pendingHost = qs<HTMLElement>(root, '#pending');
        const capture = qs<HTMLInputElement>(root, '#capture');
        const flush = qs<HTMLButtonElement>(root, '#flush');

        const paintBadges = (): void => {
            badges.innerHTML = state.badges.length
                ? state.badges.map(badgeCard).join('')
                : '<div class="muted">No XP yet — review a deck or watch a lesson.</div>';
        };

        const paintPending = async (): Promise<void> => {
            try {
                const attempts = await pendingAttempts();
                pendingHost.innerHTML = `
                    <div><span>${esc(t('profile.pending'))}</span><strong>${attempts.length}</strong></div>
                    <div><span>Tenant</span><strong>${esc(sessionOrThrow().tenantId)}</strong></div>
                `;
            } catch (error) {
                pendingHost.innerHTML = `<div class="muted">${esc(errorMessage(error))}</div>`;
            }
        };

        capture.addEventListener('change', async () => {
            try {
                const report = await setCaptureProtection(capture.checked);
                capture.checked = report.enforced ? capture.checked : false;
                toast(
                    report.enforced
                        ? `Enforced via ${report.mechanism}`
                        : `Not enforced: ${report.mechanism}`,
                    report.enforced ? 'success' : 'info',
                );
            } catch (error) {
                capture.checked = false;
                toast(errorMessage(error), 'error');
            }
        });

        flush.addEventListener('click', async () => {
            flush.disabled = true;
            try {
                const report = await flushQueue();
                toast(
                    `Synced ${report.attempts} attempts · ${report.xpEvents} XP events · ${report.posts} posts`,
                    report.failed ? 'info' : 'success',
                );
                if (report.errors.length) {
                    toast(report.errors[0], 'error');
                }
                await paintPending();
                paintBadges();
            } catch (error) {
                toast(errorMessage(error), 'error');
            } finally {
                flush.disabled = false;
            }
        });

        root.querySelector('#logout')?.addEventListener('click', async () => {
            await signOut();
            location.hash = '#/login';
        });

        const paintStudyTime = async (): Promise<void> => {
            try {
                const report: StudyReport = await wsService.getStudyReport();
                const todayEl = root.querySelector('#time-today');
                const weekEl = root.querySelector('#time-week');
                const totalEl = root.querySelector('#time-total');
                const streakEl = root.querySelector('#time-streak');

                if (todayEl) todayEl.textContent = `${report.totalMinutesToday} min`;
                if (weekEl) weekEl.textContent = `${report.totalMinutesWeek} min`;
                if (totalEl) totalEl.textContent = `${report.totalHoursAllTime} hrs`;
                if (streakEl) streakEl.textContent = `${report.streakDays} days 🔥`;
            } catch {
                /* keep fallback values */
            }
        };

        paintBadges();
        void paintPending();
        void paintStudyTime();
        void refreshBadges().then(paintBadges);

        // Update live time spent every 15 seconds while viewing profile
        const timeInterval = window.setInterval(paintStudyTime, 15_000);
        window.addEventListener('hashchange', () => clearInterval(timeInterval), { once: true });

        void bridge
            .integrity()
            .then((report: IntegrityReport) => {
                integrityHost.innerHTML = `
                    <div><span>Platform</span><strong>${esc(report.platform)}</strong></div>
                    <div><span>Rooted</span><strong>${report.rooted ? 'yes' : 'no'}</strong></div>
                    <div><span>Debugger</span><strong>${report.debuggerAttached ? 'attached' : 'clear'}</strong></div>
                    ${
                        report.indicators.length
                            ? `<div><span>Indicators</span><strong>${esc(report.indicators.join(', '))}</strong></div>`
                            : ''
                    }
                `;
            })
            .catch(() => {
                integrityHost.innerHTML = '<div class="muted">Integrity check unavailable</div>';
            });

        void bridge
            .storageUsage()
            .then((usage: StorageUsage) => {
                storageHost.innerHTML = `
                    <div><span>Database</span><strong>${esc(formatBytes(usage.dbBytes))}</strong></div>
                    <div><span>Media</span><strong>${esc(formatBytes(usage.mediaBytes))}</strong></div>
                    <div><span>Keys</span><strong>${esc(formatBytes(usage.keyBytes))}</strong></div>
                    <div><span>Total</span><strong>${esc(formatBytes(usage.totalBytes))}</strong></div>
                `;
            })
            .catch(() => {
                storageHost.innerHTML = '<div class="muted">Storage stats unavailable</div>';
            });

        void bridge
            .device()
            .then((device: DeviceInfo) => {
                if (!storageHost.querySelector('[data-device]')) {
                    storageHost.insertAdjacentHTML(
                        'beforeend',
                        `<div data-device><span>${esc(t('profile.device'))}</span><strong>${esc(
                            `${device.platform}/${device.arch} · ${device.cpuCount} cores`,
                        )}</strong></div>`,
                    );
                }
            })
            .catch(() => undefined);
    },
};
