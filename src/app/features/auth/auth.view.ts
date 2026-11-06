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
import { signIn } from '../../core/services/auth.service';
import { bridge } from '../../core/services/tauri-bridge';
import { setLang, state } from '../../core/store';
import type { Tenant } from '../../core/types';
import { errorMessage, esc, qs, toast } from '../../shared/ui';
import type { View, ViewContext } from '../../core/router';

export const authView: View = {
    render(): string {
        return `
            <div class="auth">
                <section class="auth__brand">
                    <div class="auth__brandTop">
                        <span class="brand-mark">A</span>
                        <div>
                            <strong>Allama</strong>
                            <small>${esc(t('app.tagline'))}</small>
                        </div>
                    </div>

                    <h1>Tauri v2 shell<br /><span>Rust core · native webview</span></h1>

                    <ul class="auth__points">
                        <li>Offline SQLite cache with instant course access</li>
                        <li>AES-256 encrypted downloads and local streaming</li>
                        <li>Per-tenant branding, isolation and screen-capture protection</li>
                    </ul>

                    <div class="auth__tenants" id="tenant-chips">
                        <span class="auth__tenantsLabel">${esc(t('login.known'))}</span>
                        <div class="chips" id="tenant-list"></div>
                    </div>

                    <footer class="auth__foot">
                        ${esc(t('login.security'))}
                    </footer>
                </section>

                <section class="auth__panel">
                    <form class="card auth__form" id="login-form" autocomplete="on">
                        <div class="auth__panelHead">
                            <h2>${esc(t('login.title'))}</h2>
                            <button class="icon-btn" type="button" id="lang-toggle">
                                ${esc(t('common.language'))}
                            </button>
                        </div>

                        <label class="field">
                            <span>${esc(t('login.tenant'))}</span>
                            <input id="tenant" name="tenant" required value="safwa" spellcheck="false" />
                            <small>${esc(t('login.tenantHint'))}</small>
                        </label>

                        <label class="field">
                            <span>${esc(t('login.site'))}</span>
                            <input id="site" name="site" type="url" placeholder="https://safwa.allama.online" />
                        </label>

                        <label class="field">
                            <span>${esc(t('login.username'))}</span>
                            <input id="username" name="username" required autocomplete="username" />
                        </label>

                        <label class="field">
                            <span>${esc(t('login.password'))}</span>
                            <input id="password" name="password" type="password" required autocomplete="current-password" />
                        </label>

                        <button class="btn btn--primary btn--block" type="submit" id="login-submit">
                            ${esc(t('login.submit'))}
                        </button>

                        ${bridge.isNative
                            ? ''
                            : `<p class="hint">${esc(t('login.demo'))}</p>`}

                        <p class="error" id="login-error" hidden></p>
                    </form>
                </section>
            </div>
        `;
    },

    mount(root: HTMLElement): void | (() => void) {
        const chips = qs<HTMLElement>(root, '#tenant-list');
        const tenantInput = qs<HTMLInputElement>(root, '#tenant');
        const form = qs<HTMLFormElement>(root, '#login-form');
        const error = qs<HTMLElement>(root, '#login-error');
        const submit = qs<HTMLButtonElement>(root, '#login-submit');

        root.querySelector('#lang-toggle')?.addEventListener('click', () => {
            setLang(state.lang === 'ar' ? 'en' : 'ar');
            location.reload();
        });

        bridge
            .tenantList()
            .then((tenants: Tenant[]) => {
                chips.innerHTML = tenants
                    .map(
                        (tenant) =>
                            `<button class="chip" type="button" data-tenant="${esc(tenant.id)}" title="${esc(
                                tenant.description ?? tenant.backendUrl,
                            )}">${esc(tenant.id)}</button>`,
                    )
                    .join('');

                chips.querySelectorAll<HTMLButtonElement>('[data-tenant]').forEach((chip) => {
                    chip.addEventListener('click', () => {
                        const id = chip.dataset.tenant ?? '';
                        tenantInput.value = id;
                        chips.querySelectorAll('.chip--active').forEach((el) => el.classList.remove('chip--active'));
                        chip.classList.add('chip--active');
                    });
                });
            })
            .catch(() => {
                chips.innerHTML = '';
            });

        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            error.hidden = true;
            submit.disabled = true;
            submit.textContent = '…';

            try {
                const site = qs<HTMLInputElement>(root, '#site').value.trim();
                await signIn({
                    tenantId: tenantInput.value.trim(),
                    siteUrl: site || undefined,
                    username: qs<HTMLInputElement>(root, '#username').value,
                    password: qs<HTMLInputElement>(root, '#password').value,
                });
                toast('Signed in', 'success');
                location.hash = '#/courses';
            } catch (cause) {
                error.textContent = errorMessage(cause);
                error.hidden = false;
            } finally {
                submit.disabled = false;
                submit.textContent = t('login.submit');
            }
        });

        return () => {
            chips.innerHTML = '';
        };
    },
};

export type { ViewContext };
