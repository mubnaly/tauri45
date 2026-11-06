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

import { sessionOrThrow } from '../store';
import type { MediaItem, ProtectionReport } from '../types';
import { bridge } from './tauri-bridge';

const QUALITY_KEY = 'allama.video.quality';

export const QUALITY_OPTIONS = [
    { value: '1080', label: '1080p' },
    { value: '720', label: '720p' },
    { value: '1440', label: '1440p' },
    { value: '2160', label: '2160p' },
    { value: '480', label: '480p' },
];

export function storedQuality(): string {
    try {
        return localStorage.getItem(QUALITY_KEY) ?? '1080';
    } catch {
        return '1080';
    }
}

export function storeQuality(quality: string): void {
    try {
        localStorage.setItem(QUALITY_KEY, quality);
    } catch {
        /* ignore */
    }
}

/**
 * Builds a YouTube embed URL that accepts the IFrame postMessage API. Without
 * `enablejsapi=1` the quality command is silently ignored.
 */
export function youtubeEmbedUrl(videoId: string): string {
    const origin = encodeURIComponent(window.location.origin);
    const params = new URLSearchParams({
        enablejsapi: '1',
        origin: window.location.origin,
        rel: '0',
        modestbranding: '1',
        playsinline: '1',
        iv_load_policy: '3',
    });

    void origin;

    return `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`;
}

/** Asks Rust to force the DASH rendition on every embedded YouTube frame. */
export async function applyYoutubeQuality(quality: string): Promise<void> {
    storeQuality(quality);

    if (!bridge.isNative) {
        await bridge.applyYouTubeQuality(quality);
        return;
    }

    try {
        await bridge.applyYouTubeQuality(quality);
    } catch {
        const config = await bridge.youtubeQuality(quality);
        document.querySelectorAll<HTMLIFrameElement>('iframe[data-allama-player]').forEach((frame) => {
            frame.contentWindow?.postMessage(
                JSON.stringify({
                    event: 'command',
                    func: 'setPlaybackQualityRange',
                    args: [config.quality, config.quality],
                }),
                '*',
            );
        });
    }
}

export async function setCaptureProtection(enabled: boolean): Promise<ProtectionReport> {
    return bridge.setCaptureProtection(enabled);
}

export async function offlineMedia(): Promise<MediaItem[]> {
    const session = sessionOrThrow();

    return bridge.mediaList(session.tenantId, session.userId);
}

export async function downloadMedia(title: string, url: string): Promise<MediaItem> {
    const session = sessionOrThrow();

    return bridge.mediaImport({
        tenantId: session.tenantId,
        userId: session.userId,
        title,
        url,
    });
}

export async function saveProgress(mediaId: string, seconds: number): Promise<void> {
    await bridge.mediaProgress(mediaId, seconds);
}
