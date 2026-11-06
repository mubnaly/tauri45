import { existsSync, cpSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const targetWww = resolve(__dirname, '../www');
const sourceWww = resolve(__dirname, '../../mobile45/www');

if (existsSync(sourceWww)) {
    try {
        console.log(`[sync-frontend] Syncing latest build from ${sourceWww} -> ${targetWww}...`);
        cpSync(sourceWww, targetWww, { recursive: true, force: true });
        console.log('[sync-frontend] Frontend assets synced successfully.');
    } catch (err) {
        console.warn('[sync-frontend] Could not copy from mobile45/www, using existing www:', err.message);
    }
} else {
    console.log('[sync-frontend] Standalone build: Using existing packaged www frontend.');
}

if (!existsSync(resolve(targetWww, 'index.html'))) {
    console.error('[sync-frontend] ERROR: target www/index.html is missing!');
    process.exit(1);
} else {
    console.log('[sync-frontend] Verified: www/index.html is present and ready.');
}
