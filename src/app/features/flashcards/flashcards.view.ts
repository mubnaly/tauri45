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
import { awardFlashcardReview } from '../../core/services/badges.service';
import { queueAttempt } from '../../core/services/db.service';
import { state } from '../../core/store';
import type { BadgeState } from '../../core/types';
import { errorMessage, esc, qs, toast } from '../../shared/ui';
import type { View } from '../../core/router';

interface Card {
    front: string;
    back: string;
    hint: string;
}

const DECK: Card[] = [
    { front: 'derivative of sin(x)', back: 'cos(x)', hint: 'Calculus · limits' },
    { front: 'derivative of e^x', back: 'e^x', hint: 'Calculus · exponentials' },
    { front: 'Newton’s second law', back: 'F = m · a', hint: 'Mechanics' },
    { front: 'unit of force', back: 'newton (N) = kg·m/s²', hint: 'Mechanics · units' },
    { front: '∫ (1/x) dx', back: 'ln|x| + C', hint: 'Integration' },
    { front: 'مرادف كلمة "سريع"', back: 'عجول / وشيك', hint: 'اللغة العربية' },
    { front: 'derivative of ln(x)', back: '1/x', hint: 'Calculus' },
];

function xpBar(badge: BadgeState | undefined): string {
    if (!badge) {
        return '';
    }

    return `
        <div class="xpbar">
            <div class="xpbar__top">
                <span>${esc(t('family.flashcard'))} · ${esc(t('common.level'))} ${badge.level}</span>
                <span>${badge.xp} ${esc(t('common.xp'))}</span>
            </div>
            <div class="progress"><div class="progress__bar" style="width:${Math.round(badge.progress * 100)}%"></div></div>
        </div>
    `;
}

export const flashcardsView: View = {
    render(): string {
        return `
            <section class="page__head">
                <div>
                    <h1>${esc(t('cards.title'))}</h1>
                    <p class="muted">${esc(t('cards.hint'))}</p>
                </div>
                ${xpBar(state.badges.find((badge) => badge.family === 'flashcard'))}
            </section>

            <div class="cards-stage" id="cards-stage"></div>
        `;
    },

    mount(root: HTMLElement): void {
        const stage = qs<HTMLElement>(root, '#cards-stage');
        let index = 0;
        let flipped = false;
        let reviewed = 0;

        const paint = (): void => {
            if (index >= DECK.length) {
                stage.innerHTML = `
                    <div class="card cards-done">
                        <h2>${esc(t('cards.done'))}</h2>
                        <p class="muted">${reviewed} / ${DECK.length} reviewed · ${reviewed * 5} ${esc(t('common.xp'))}</p>
                        <button class="btn btn--primary" type="button" id="restart">${esc(t('common.retry'))}</button>
                    </div>
                `;
                qs<HTMLButtonElement>(stage, '#restart').addEventListener('click', () => {
                    index = 0;
                    reviewed = 0;
                    flipped = false;
                    paint();
                });

                return;
            }

            const card = DECK[index];
            stage.innerHTML = `
                <div class="cards-progress">${index + 1} / ${DECK.length}</div>
                <button class="flashcard ${flipped ? 'flashcard--back' : ''}" type="button" id="flip">
                    <small>${esc(card.hint)}</small>
                    <div class="flashcard__face">${esc(flipped ? card.back : card.front)}</div>
                    <span class="flashcard__hint">${flipped ? 'Tap to hide' : esc(t('cards.show'))}</span>
                </button>
                <div class="cards-actions">
                    <button class="btn" type="button" id="again" ${flipped ? '' : 'disabled'}>${esc(t('cards.again'))}</button>
                    <button class="btn btn--primary" type="button" id="good" ${flipped ? '' : 'disabled'}>${esc(t('cards.good'))}</button>
                </div>
            `;

            qs<HTMLButtonElement>(stage, '#flip').addEventListener('click', () => {
                flipped = !flipped;
                paint();
            });

            const grade = async (gotIt: boolean): Promise<void> => {
                try {
                    await queueAttempt('flashcard:deck:calculus', { index, front: card.front, gotIt }, gotIt ? 1 : 0);
                    const xp = await awardFlashcardReview('calculus', gotIt);
                    toast(`+${xp} XP`, 'success');
                } catch (error) {
                    toast(errorMessage(error), 'error');
                }

                reviewed += gotIt ? 1 : 0;
                index += 1;
                flipped = false;
                paint();
            };

            qs<HTMLButtonElement>(stage, '#again').addEventListener('click', () => void grade(false));
            qs<HTMLButtonElement>(stage, '#good').addEventListener('click', () => void grade(true));
        };

        paint();
    },
};
