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
import { wsService, type SocialFeedItem } from '../../core/services/ws.service';
import { sessionOrThrow, state } from '../../core/store';
import { errorMessage, esc, qs, relativeTime, toast } from '../../shared/ui';
import type { View } from '../../core/router';

function postCard(post: SocialFeedItem): string {
    const initial = (post.author || '?').charAt(0).toUpperCase();

    return `
        <article class="card post" data-post="${esc(post.id)}">
            <header class="post__head">
                <span class="avatar avatar--sm">${esc(initial)}</span>
                <div>
                    <strong>${esc(post.author)}</strong>
                    <small>${esc(relativeTime(post.created_at))} · ${esc(post.synced_at ? 'synced' : 'local')}</small>
                </div>
            </header>
            <p class="post__body">${esc(post.body)}</p>
            <footer class="post__foot">
                <button class="btn btn--ghost" type="button" data-like="${esc(post.id)}">
                    ♥ <span data-likes>${post.likes}</span> · ${esc(t('social.like'))}
                </button>
            </footer>
        </article>
    `;
}

export const socialView: View = {
    render(): string {
        const tenantId = state.session?.tenantId || 'global';
        const brandName = state.brand.appName || state.session?.siteName || tenantId;

        return `
            <section class="page__head">
                <div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <h1>${esc(t('social.title'))}</h1>
                        <span class="pill pill--xp">Tenant: ${esc(tenantId)}</span>
                    </div>
                    <p class="muted">Private community for <strong>${esc(brandName)}</strong> members only</p>
                </div>
            </section>

            <form class="card compose" id="compose">
                <textarea id="body" rows="3" maxlength="4000" placeholder="${esc(t('social.placeholder'))}"></textarea>
                <div class="compose__foot">
                    <span class="muted" id="compose-count">0 / 4000</span>
                    <button class="btn btn--primary" type="submit">${esc(t('social.post'))}</button>
                </div>
            </form>

            <div class="stack" id="feed">
                <div class="card skeleton"></div>
                <div class="card skeleton"></div>
            </div>
        `;
    },

    mount(root: HTMLElement): void {
        const feed = qs<HTMLElement>(root, '#feed');
        const form = qs<HTMLFormElement>(root, '#compose');
        const body = qs<HTMLTextAreaElement>(root, '#body');
        const counter = qs<HTMLElement>(root, '#compose-count');

        const load = async (): Promise<void> => {
            sessionOrThrow();

            try {
                // Strict isolation: wsService.getSocialPosts queries only the active session's tenantId
                const posts = await wsService.getSocialPosts(50);
                feed.innerHTML = posts.length
                    ? posts.map(postCard).join('')
                    : `<div class="empty">No posts yet for this tenant. Start the conversation.</div>`;
            } catch (error) {
                feed.innerHTML = `<div class="empty">${esc(errorMessage(error))}</div>`;
            }
        };

        body.addEventListener('input', () => {
            counter.textContent = `${body.value.length} / 4000`;
        });

        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const text = body.value.trim();
            if (!text) {
                return;
            }

            try {
                await wsService.createSocialPost(text);
                body.value = '';
                counter.textContent = '0 / 4000';
                toast('Posted to tenant feed', 'success');
                await load();
            } catch (error) {
                toast(errorMessage(error), 'error');
            }
        });

        feed.addEventListener('click', async (event) => {
            const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-like]');
            if (!button) {
                return;
            }

            const postId = button.dataset.like ?? '';

            try {
                const likes = await wsService.likeSocialPost(postId);
                const label = button.querySelector('[data-likes]');
                if (label) {
                    label.textContent = String(likes);
                }
            } catch (error) {
                toast(errorMessage(error), 'error');
            }
        });

        void load();
    },
};
