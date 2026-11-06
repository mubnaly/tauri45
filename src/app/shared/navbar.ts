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

import { t, otherLang } from '../core/i18n';
import { setLang, state } from '../core/store';
import type { Session } from '../core/types';
import { esc, icon } from './ui';

const TABS = [
    { path: '/courses', key: 'nav.courses', icon: 'courses' },
    { path: '/flashcards', key: 'nav.cards', icon: 'cards' },
    { path: '/social', key: 'nav.social', icon: 'social' },
    { path: '/chats', key: 'nav.chats', icon: 'chats' },
    { path: '/profile', key: 'nav.profile', icon: 'profile' },
];

/** Frosted-glass navbar + tab strip, shared by every signed-in screen. */
export function renderNav(session: Session, active: string): string {
    const brandName = state.brand.appName || session.siteName || 'Allama';
    const initial = (session.fullName ?? session.username).charAt(0).toUpperCase();
    const level = state.badges.reduce((total, badge) => total + badge.xp, 0);

    return `
        <header class="topbar">
            <a class="topbar__brand" href="#/courses">
                ${state.brand.logo
                    ? `<img class="topbar__logo" src="${esc(state.brand.logo)}" alt="" />`
                    : `<span class="topbar__mark">${esc(initial)}</span>`}
                <span class="topbar__names">
                    <strong>${esc(brandName)}</strong>
                    <small>${esc(session.siteName ?? session.siteUrl)}</small>
                </span>
            </a>

            <div class="topbar__spacer"></div>

            <span class="pill ${state.online ? 'pill--ok' : 'pill--warn'}" title="${esc(session.siteUrl)}">
                <span class="dot"></span>${state.online ? 'Online' : 'Offline'}
            </span>
            <span class="pill pill--xp">${esc(level)} ${esc(t('common.xp'))}</span>

            <button class="icon-btn" id="lang-toggle" type="button" title="${esc(t('common.language'))}">
                ${esc(t('common.language'))}
            </button>

            <a class="avatar" href="#/profile" title="${esc(session.fullName ?? session.username)}">
                ${esc(initial)}
            </a>
        </header>

        <nav class="tabs" aria-label="Main">
            ${TABS.map(
                (tab) => `
                <a class="tab ${active === tab.path ? 'tab--active' : ''}" href="#${tab.path}">
                    ${icon(tab.icon)}
                    <span>${esc(t(tab.key))}</span>
                </a>`,
            ).join('')}
        </nav>
    `;
}

export function wireNav(root: ParentNode): void {
    root.querySelector('#lang-toggle')?.addEventListener('click', () => setLang(otherLang()));
}
