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

import { refreshBadges } from './auth.service';
import { setState, sessionOrThrow } from '../store';
import type { PendingAttempt, SyncReport } from '../types';
import { bridge } from './tauri-bridge';

export async function pendingAttempts(): Promise<PendingAttempt[]> {
    const session = sessionOrThrow();

    return bridge.syncPending(session.tenantId);
}

/** Flushes attempts, XP events and community posts in one native pass. */
export async function flushQueue(): Promise<SyncReport> {
    const session = sessionOrThrow();

    setState({ syncing: true });
    try {
        const report = await bridge.syncFlush(session.tenantId);
        await refreshBadges();

        return report;
    } finally {
        setState({ syncing: false });
    }
}

export function watchConnectivity(): () => void {
    const update = () => setState({ online: navigator.onLine });

    window.addEventListener('online', update);
    window.addEventListener('offline', update);

    return () => {
        window.removeEventListener('online', update);
        window.removeEventListener('offline', update);
    };
}
