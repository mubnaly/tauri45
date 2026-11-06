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
import { setState, state, sessionOrThrow } from '../store';
import type { BadgeFamily } from '../types';
import { bridge } from './tauri-bridge';

const FLASHCARD_XP = 5;
const VIDEO_XP_PER_MINUTE = 2;

export async function awardFlashcardReview(deckId: string, gotIt: boolean): Promise<number> {
    const session = sessionOrThrow();
    const xp = gotIt ? FLASHCARD_XP : 2;

    await bridge.badgesAward(
        session.tenantId,
        session.userId,
        'flashcard',
        xp,
        `deck ${deckId}: ${gotIt ? 'mastered' : 'repeated'}`,
    );

    await refreshBadges();

    return xp;
}

export async function awardVideoMinutes(minutes: number): Promise<void> {
    if (minutes < 1) {
        return;
    }

    const session = sessionOrThrow();
    await bridge.badgesAward(
        session.tenantId,
        session.userId,
        'video',
        Math.min(120, Math.round(minutes * VIDEO_XP_PER_MINUTE)),
        'video watch time',
    );
    await refreshBadges();
}

export function familyLabel(family: BadgeFamily): string {
    return `family.${family}`;
}

/**
 * 30-second activity checkpoint from the plan. Runs only while the window is
 * visible, so a backgrounded app never farms XP.
 */
export function startActivityTicker(): () => void {
    const timer = window.setInterval(() => {
        if (!state.session || document.visibilityState !== 'visible' || !navigator.onLine) {
            return;
        }

        const session = state.session;
        bridge.badgesTick(session.tenantId, session.userId, 30).catch(() => undefined);
    }, 30_000);

    return () => window.clearInterval(timer);
}

/** Local-only optimistics update, used before the native round trip resolves. */
export function patchBadgeXp(family: BadgeFamily, xp: number): void {
    setState({
        badges: state.badges.map((badge) =>
            badge.family === family ? { ...badge, xp: badge.xp + xp } : badge,
        ),
    });
}
