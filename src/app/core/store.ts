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

import type { BadgeState, Lang, Session, Tenant } from './types';

export interface BrandState {
    appName: string;
    primaryColor: string;
    logo: string | null;
}

export interface AppState {
    session: Session | null;
    tenant: Tenant | null;
    brand: BrandState;
    lang: Lang;
    online: boolean;
    badges: BadgeState[];
    syncing: boolean;
}

const LANG_KEY = 'allama.lang';

function initialLang(): Lang {
    try {
        const stored = localStorage.getItem(LANG_KEY);
        if (stored === 'ar' || stored === 'en') {
            return stored;
        }
    } catch {
        /* storage unavailable */
    }

    return 'en';
}

export const state: AppState = {
    session: null,
    tenant: null,
    brand: { appName: 'Allama', primaryColor: '#2563EB', logo: null },
    lang: initialLang(),
    online: navigator.onLine,
    badges: [],
    syncing: false,
};

type Listener = () => void;

const listeners = new Set<Listener>();

export function subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function setState(patch: Partial<AppState>): void {
    Object.assign(state, patch);
    listeners.forEach((listener) => listener());
}

export function setLang(lang: Lang): void {
    try {
        localStorage.setItem(LANG_KEY, lang);
    } catch {
        /* storage unavailable */
    }

    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    setState({ lang });
}

export function applyBrand(brand: Partial<BrandState>): void {
    const next: BrandState = { ...state.brand, ...brand };
    document.documentElement.style.setProperty('--brand', next.primaryColor);
    setState({ brand: next });
}

export function sessionOrThrow(): Session {
    if (!state.session) {
        throw new Error('not signed in');
    }

    return state.session;
}
