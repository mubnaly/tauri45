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

/** Escapes a value for safe interpolation into an HTML template string. */
export function esc(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function qs<T extends Element>(root: ParentNode, selector: string): T {
    const element = root.querySelector<T>(selector);
    if (!element) {
        throw new Error(`element not found: ${selector}`);
    }

    return element;
}

export function qsa<T extends Element>(root: ParentNode, selector: string): T[] {
    return Array.from(root.querySelectorAll<T>(selector));
}

let toastHost: HTMLElement | null = null;

/** Transient status message; errors stay longer and use the danger colour. */
export function toast(message: string, kind: 'info' | 'success' | 'error' = 'info'): void {
    if (!toastHost || !toastHost.isConnected) {
        toastHost = document.createElement('div');
        toastHost.className = 'toast-host';
        toastHost.setAttribute('role', 'status');
        document.body.appendChild(toastHost);
    }

    const item = document.createElement('div');
    item.className = `toast toast--${kind}`;
    item.textContent = message;
    toastHost.appendChild(item);

    window.setTimeout(
        () => {
            item.classList.add('toast--out');
            window.setTimeout(() => item.remove(), 250);
        },
        kind === 'error' ? 5200 : 2800,
    );
}

export function errorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    return typeof error === 'string' ? error : 'unexpected error';
}

export function formatBytes(bytes: number): string {
    if (!bytes) {
        return '0 B';
    }
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const value = bytes / 1024 ** index;

    return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

export function formatDuration(totalSeconds: number): string {
    const seconds = Math.max(0, Math.round(totalSeconds));
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;

    return `${minutes}:${String(rest).padStart(2, '0')}`;
}

export function relativeTime(epochSeconds: number): string {
    const diff = Math.max(0, Math.floor(Date.now() / 1000) - epochSeconds);
    if (diff < 60) {
        return 'just now';
    }
    if (diff < 3600) {
        return `${Math.floor(diff / 60)}m ago`;
    }
    if (diff < 86_400) {
        return `${Math.floor(diff / 3600)}h ago`;
    }

    return `${Math.floor(diff / 86_400)}d ago`;
}

/** Inline SVG icon set (no icon font, no extra request). */
export function icon(name: string): string {
    const paths: Record<string, string> = {
        courses: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5Z"/><path d="M20 18v3H6.5A2.5 2.5 0 0 1 4 18.5"/>',
        cards: '<rect x="3" y="6" width="13" height="14" rx="2"/><path d="M8 6V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-2"/>',
        social: '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15 20a5 5 0 0 1 6-4"/>',
        chats: '<path d="M21 12a8 8 0 1 1-3.2-6.4"/><path d="M8 12h.01M12 12h.01M16 12h.01"/>',
        profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
        play: '<path d="M8 5v14l11-7z"/>',
        download: '<path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M4 21h16"/>',
        shield: '<path d="M12 3l8 3v6c0 5-3.4 8.2-8 9-4.6-.8-8-4-8-9V6l8-3Z"/>',
        check: '<path d="m4 12 5 5L20 6"/>',
        back: '<path d="M15 19 8 12l7-7"/>',
        sync: '<path d="M21 12a9 9 0 0 1-15.4 6.4"/><path d="M3 12a9 9 0 0 1 15.4-6.4"/><path d="M18 3v5h-5"/><path d="M6 21v-5h5"/>',
        logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    };

    return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name] ?? ''}</svg>`;
}
