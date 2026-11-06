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

import { authView } from '../features/auth/auth.view';
import { chatsView } from '../features/chats/chats.view';
import { courseView } from '../features/courses/course.view';
import { coursesView } from '../features/courses/courses.view';
import { flashcardsView } from '../features/flashcards/flashcards.view';
import { playerView } from '../features/player/player.view';
import { profileView } from '../features/profile/profile.view';
import { socialView } from '../features/social/social.view';
import { renderNav, wireNav } from '../shared/navbar';
import { startActivityTicker } from './services/badges.service';
import { restoreSession } from './services/auth.service';
import { watchConnectivity } from './services/sync.service';
import { setLang, state, subscribe } from './store';

export interface ViewContext {
    params: Record<string, string>;
}

export interface View {
    render(ctx: ViewContext): string;
    /** Returns an optional teardown function for listeners/timers. */
    mount?(root: HTMLElement, ctx: ViewContext): void | (() => void);
}

interface Route {
    pattern: string;
    view: View;
}

const ROUTES: Route[] = [
    { pattern: '/login', view: authView },
    { pattern: '/courses', view: coursesView },
    { pattern: '/course/:id', view: courseView },
    { pattern: '/player/:courseId/:moduleId', view: playerView },
    { pattern: '/flashcards', view: flashcardsView },
    { pattern: '/social', view: socialView },
    { pattern: '/chats', view: chatsView },
    { pattern: '/profile', view: profileView },
];

const DEFAULT_ROUTE = '/courses';

let teardown: (() => void) | null = null;
let renderToken = 0;

export function navigate(path: string): void {
    if (location.hash === `#${path}`) {
        void render();
        return;
    }

    location.hash = `#${path}`;
}

function matchRoute(path: string): { route: Route; params: Record<string, string> } | null {
    const segments = path.split('/').filter(Boolean);

    for (const route of ROUTES) {
        const pattern = route.pattern.split('/').filter(Boolean);
        if (pattern.length !== segments.length) {
            continue;
        }

        const params: Record<string, string> = {};
        let matched = true;

        for (let index = 0; index < pattern.length; index++) {
            const part = pattern[index];
            if (part.startsWith(':')) {
                params[part.slice(1)] = decodeURIComponent(segments[index]);
            } else if (part !== segments[index]) {
                matched = false;
                break;
            }
        }

        if (matched) {
            return { route, params };
        }
    }

    return null;
}

function currentPath(): string {
    const hash = location.hash.replace(/^#/, '');

    return hash.startsWith('/') ? hash : DEFAULT_ROUTE;
}

async function render(): Promise<void> {
    const token = ++renderToken;
    const app = document.getElementById('app');
    if (!app) {
        return;
    }

    const path = currentPath();
    const matched = matchRoute(path);

    if (!state.session) {
        if (path !== '/login') {
            location.hash = '#/login';

            return;
        }

        teardown?.();
        teardown = null;
        app.innerHTML = authView.render({ params: {} });
        whitelistAuthMount(app);

        return;
    }

    if (path === '/login') {
        navigate(DEFAULT_ROUTE);

        return;
    }

    const active = matched ?? matchRoute(DEFAULT_ROUTE);
    if (!active) {
        return;
    }

    teardown?.();
    teardown = null;

    app.innerHTML = `
        <div class="shell">
            ${renderNav(state.session, active.route.pattern)}
            <main class="page" id="page"></main>
        </div>
    `;

    const page = app.querySelector<HTMLElement>('#page');
    if (!page || token !== renderToken) {
        return;
    }

    page.innerHTML = active.route.view.render({ params: active.params });
    wireNav(app);

    const result = active.route.view.mount?.(page, { params: active.params });
    if (token === renderToken && typeof result === 'function') {
        teardown = result;
    }
}

/** Auth view mounts on the root element (no shell/nav while signed out). */
function whitelistAuthMount(app: HTMLElement): void {
    const result = authView.mount?.(app, { params: {} });
    if (typeof result === 'function') {
        teardown = result;
    }
}

export async function startApp(): Promise<void> {
    setLang(state.lang);
    watchConnectivity();
    const stopTicker = startActivityTicker();

    try {
        await restoreSession();
    } catch {
        // No stored session (or the vault is unavailable): show the login screen.
    }

    let lastLang = state.lang;
    let lastTenant = state.session?.tenantId ?? null;

    subscribe(() => {
        const tenant = state.session?.tenantId ?? null;
        if (state.lang !== lastLang || tenant !== lastTenant) {
            lastLang = state.lang;
            lastTenant = tenant;
            void render();
        }
    });

    window.addEventListener('hashchange', () => void render());
    window.addEventListener('beforeunload', () => {
        stopTicker();
        teardown?.();
    });

    await render();
}
