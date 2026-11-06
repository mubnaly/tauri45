// (C) Copyright 2026 Allama Learning Platform.
//
// Tenant-Isolated Chat & Support System
// Support managers anonymized as Admin 1, Admin 2...
// Message box pinned cleanly above navigation bar.

import { t } from '../../core/i18n';
import { wsService, anonymizeSupportName, type ConversationItem } from '../../core/services/ws.service';
import { sessionOrThrow } from '../../core/store';
import { errorMessage, esc, qs, relativeTime, toast } from '../../shared/ui';
import type { View } from '../../core/router';

interface ChatMessage {
    from: 'me' | 'them';
    text: string;
    at: number;
}

interface ActiveChatThread {
    id: string;
    name: string;
    role: string;
    isSupport: boolean;
    messages: ChatMessage[];
}

const now = Math.floor(Date.now() / 1000);

const DEFAULT_THREADS: ActiveChatThread[] = [
    {
        id: 't-support',
        name: 'Admin 1 (Support Team)',
        role: 'Platform Support & Queries',
        isSupport: true,
        messages: [
            { from: 'them', text: 'Welcome to the platform. How can we assist you today?', at: now - 7200 },
        ],
    },
    {
        id: 't-coordinator',
        name: 'Admin 2 (Academic)',
        role: 'Academic Department',
        isSupport: true,
        messages: [
            { from: 'them', text: 'All exam attempts and flashcard reviews are automatically synced.', at: now - 18000 },
        ],
    },
    {
        id: 't-study',
        name: 'Study Group',
        role: 'Course Discussions',
        isSupport: false,
        messages: [
            { from: 'them', text: 'Problem set solutions are posted in the shared folder.', at: now - 3600 },
        ],
    },
];

function threadItem(thread: ActiveChatThread, activeId: string): string {
    const last = thread.messages[thread.messages.length - 1];

    return `
        <button class="thread ${thread.id === activeId ? 'thread--active' : ''}" type="button" data-thread="${esc(thread.id)}">
            <span class="avatar avatar--sm">${esc(thread.name.charAt(0))}</span>
            <span class="thread__body">
                <strong>${esc(thread.name)}</strong>
                <small>${esc(last?.text.slice(0, 42) ?? '')}</small>
            </span>
            <span class="thread__time">${last ? esc(relativeTime(last.at)) : ''}</span>
        </button>
    `;
}

export const chatsView: View = {
    render(): string {
        return `
            <section class="page__head">
                <div>
                    <h1>${esc(t('chats.title'))}</h1>
                    <p class="muted">Tenant-isolated messaging · Support & Academic queries</p>
                </div>
            </section>

            <div class="chats">
                <div class="chats__list" id="threads"></div>
                <div class="chats__pane card" id="pane"></div>
            </div>
        `;
    },

    mount(root: HTMLElement): void {
        const list = qs<HTMLElement>(root, '#threads');
        const pane = qs<HTMLElement>(root, '#pane');
        let threads = [...DEFAULT_THREADS];
        let activeId = threads[0].id;

        const activeThread = (): ActiveChatThread => threads.find((t) => t.id === activeId) ?? threads[0];

        const paintPane = (): void => {
            const thread = activeThread();

            pane.innerHTML = `
                <header class="pane__head">
                    <span class="avatar avatar--sm">${esc(thread.name.charAt(0))}</span>
                    <div style="flex: 1;">
                        <strong>${esc(thread.name)}</strong>
                        <small>${esc(thread.role)}</small>
                    </div>
                    ${thread.isSupport ? '<span class="pill pill--ok"><span class="dot"></span> Online Support</span>' : ''}
                </header>

                ${
                    thread.isSupport
                        ? `
                    <div class="support-banner">
                        <small>Complaints, suggestions and requesting your own application</small>
                    </div>`
                        : ''
                }

                <div class="pane__messages" id="messages">
                    ${thread.messages.length ? thread.messages
                        .map(
                            (message) => `
                            <div class="bubble bubble--${message.from}">
                                <p>${esc(message.text)}</p>
                                <small>${esc(relativeTime(message.at))}</small>
                            </div>`,
                        )
                        .join('') : '<div class="empty" style="margin: auto;">No messages were found</div>'}
                </div>

                <div class="pane__compose-wrapper">
                    <form class="pane__compose" id="send">
                        <input id="message" placeholder="${esc(t('chats.placeholder'))}" autocomplete="off" />
                        <button class="btn btn--primary" type="submit">${esc(t('chats.send'))}</button>
                    </form>
                </div>
            `;

            const messages = qs<HTMLElement>(pane, '#messages');
            messages.scrollTop = messages.scrollHeight;

            qs<HTMLFormElement>(pane, '#send').addEventListener('submit', async (event) => {
                event.preventDefault();
                const input = qs<HTMLInputElement>(pane, '#message');
                const text = input.value.trim();
                if (!text) {
                    return;
                }

                thread.messages.push({ from: 'me', text, at: Math.floor(Date.now() / 1000) });
                input.value = '';
                paintPane();
                paintList();

                try {
                    const session = sessionOrThrow();
                    await wsService.sendInstantMessage(2, text);
                } catch (error) {
                    toast(`Sent locally · ${errorMessage(error)}`, 'info');
                }
            });
        };

        const paintList = (): void => {
            list.innerHTML = threads.map((thread) => threadItem(thread, activeId)).join('');
        };

        list.addEventListener('click', (event) => {
            const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-thread]');
            if (!button) {
                return;
            }

            activeId = button.dataset.thread ?? activeId;
            paintList();
            paintPane();
        });

        // Load real conversations from LMS if available
        void wsService.getConversations().then((convs: ConversationItem[]) => {
            if (convs && convs.length) {
                threads = convs.map((c) => ({
                    id: String(c.id),
                    name: c.displayName,
                    role: c.isSupport ? 'Technical Support' : (c.isGroup ? 'Group Discussion' : 'User'),
                    isSupport: c.isSupport,
                    messages: c.lastMessage
                        ? [{ from: 'them', text: c.lastMessage, at: c.lastMessageDate ?? now }]
                        : [],
                }));
                if (!threads.some((t) => t.id === activeId)) {
                    activeId = threads[0].id;
                }
                paintList();
                paintPane();
            }
        }).catch(() => undefined);

        paintList();
        paintPane();
    },
};
