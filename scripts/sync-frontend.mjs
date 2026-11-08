import { existsSync, cpSync, readFileSync, writeFileSync, readdirSync, copyFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const targetWww = resolve(__dirname, '../www');
const sourceWww = resolve(__dirname, '../../mobile45/www');
const sourceConfig = resolve(__dirname, '../../mobile45/moodle.config.json');

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

const targetIndex = resolve(targetWww, 'index.html');
if (!existsSync(targetIndex)) {
    console.error('[sync-frontend] ERROR: target www/index.html is missing!');
    process.exit(1);
}

// 1. Copy moodle.config.json into www/assets/
const assetsDir = resolve(targetWww, 'assets');
if (existsSync(sourceConfig) && existsSync(assetsDir)) {
    copyFileSync(sourceConfig, resolve(assetsDir, 'moodle.config.json'));
    console.log('[sync-frontend] Copied moodle.config.json -> www/assets/moodle.config.json');
}

// 2. Patch index.html with base href and Tauri-Cordova-SQLite bridge
let html = readFileSync(targetIndex, 'utf8');

// Replace base href
html = html.replace(/<base\s+href="[^"]*"\s*\/?>/i, '<base href="./">');

const bridgeScript = `
    <!-- Tauri Runtime & Cordova/SQLite Compatibility Bridge -->
    <script>
        (function() {
            window.isTauri = true;
            window.cordova = window.cordova || {
                platformId: 'android',
                version: '12.0.0',
                plugins: {}
            };

            function createResultSet(rows, affected) {
                var list = Array.isArray(rows) ? rows : [];
                return {
                    rows: {
                        length: list.length,
                        item: function(i) { return list[i]; }
                    },
                    rowsAffected: affected || 0,
                    insertId: 0
                };
            }

            // High compatibility SQLite plugin bridge
            window.sqlitePlugin = window.sqlitePlugin || {
                openDatabase: function(options, successCallback, errorCallback) {
                    var dbName = (options && options.name) || 'allama.db';
                    var db = {
                        name: dbName,
                        executeSql: function(sql, params, success, error) {
                            params = params || [];
                            if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
                                var isSelect = /^\\s*SELECT/i.test(sql);
                                var cmd = isSelect ? 'db_query' : 'db_execute';
                                window.__TAURI__.core.invoke(cmd, { sql: sql, params: params })
                                    .then(function(res) {
                                        var rows = Array.isArray(res) ? res : [];
                                        var affected = typeof res === 'number' ? res : 0;
                                        if (success) success(createResultSet(rows, affected));
                                    })
                                    .catch(function(err) {
                                        console.warn('[SQLite Tauri] IPC query caught:', sql, err);
                                        if (success) {
                                            success(createResultSet([], 0));
                                        } else if (error) {
                                            error(err);
                                        }
                                    });
                            } else {
                                if (success) {
                                    setTimeout(function() {
                                        success(createResultSet([], 0));
                                    }, 0);
                                }
                            }
                        },
                        sqlBatch: function(statements, success, error) {
                            if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
                                window.__TAURI__.core.invoke('db_batch', { statements: statements })
                                    .then(function() { if (success) success(); })
                                    .catch(function() { if (success) success(); });
                            } else {
                                if (success) setTimeout(success, 0);
                            }
                        },
                        transaction: function(fn, errCb, succCb) {
                            var tx = {
                                executeSql: function(sql, params, s, e) {
                                    db.executeSql(sql, params, s, e);
                                }
                            };
                            try {
                                fn(tx);
                                if (succCb) setTimeout(succCb, 0);
                            } catch (ex) {
                                if (errCb) errCb(ex);
                            }
                        },
                        readTransaction: function(fn, errCb, succCb) {
                            db.transaction(fn, errCb, succCb);
                        },
                        close: function(succ) { if (succ) succ(); }
                    };

                    if (successCallback) {
                        setTimeout(function() { successCallback(db); }, 0);
                    }
                    return db;
                }
            };

            // Desktop Security Bridge Mock
            window.desktopSecurity = window.desktopSecurity || {
                isDesktop: true,
                setContentProtection: function(enabled) {
                    if (window.__TAURI__ && window.__TAURI__.core) {
                        return window.__TAURI__.core.invoke('security_set_capture', { enabled: enabled });
                    }
                    return Promise.resolve(true);
                },
                onCaptureAttempt: function() {}
            };

            // Desktop Video Bridge Mock
            window.desktopVideoBridge = window.desktopVideoBridge || {
                isDesktop: true,
                setYouTubeQuality: function() { return Promise.resolve(true); },
                toggleYouTubeNativeControls: function() { return Promise.resolve(true); }
            };

            // Fire deviceready so Ionic Platform.ready() resolves immediately and never stays stuck on white screen
            function fireDeviceReady() {
                setTimeout(function() {
                    try {
                        var evt = new CustomEvent('deviceready', { bubbles: true, cancelable: true });
                        document.dispatchEvent(evt);
                    } catch (e) {
                        var oldEvt = document.createEvent('Event');
                        oldEvt.initEvent('deviceready', true, true);
                        document.dispatchEvent(oldEvt);
                    }
                    console.log('[Tauri] deviceready dispatched successfully.');
                }, 30);
            }

            if (document.readyState === 'complete' || document.readyState === 'interactive') {
                fireDeviceReady();
            } else {
                document.addEventListener('DOMContentLoaded', fireDeviceReady, { once: true });
            }
        })();
    </script>
`;

if (!html.includes('Tauri Runtime & Cordova/SQLite Compatibility Bridge')) {
    html = html.replace('<head>', '<head>\n' + bridgeScript);
    writeFileSync(targetIndex, html);
    console.log('[sync-frontend] Injected Tauri runtime bridge into www/index.html');
} else {
    writeFileSync(targetIndex, html);
    console.log('[sync-frontend] www/index.html base href updated.');
}

// 3. Patch sqlite-wasm paths in all JS chunks from "/assets/lib/sqlite3/" to "assets/lib/sqlite3/"
const ABSOLUTE = ['"/assets/lib/sqlite3/', "'/assets/lib/sqlite3/"];
const RELATIVE = ['"assets/lib/sqlite3/', "'assets/lib/sqlite3/"];
let jsPatched = 0;

for (const entry of readdirSync(targetWww, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
    const file = join(targetWww, entry.name);
    let content = readFileSync(file, 'utf8');
    let modified = false;

    ABSOLUTE.forEach((abs, i) => {
        if (content.includes(abs)) {
            content = content.split(abs).join(RELATIVE[i]);
            modified = true;
        }
    });

    if (modified) {
        writeFileSync(file, content);
        jsPatched++;
    }
}
if (jsPatched > 0) {
    console.log(`[sync-frontend] Patched sqlite-wasm asset paths in ${jsPatched} JS file(s).`);
}

console.log('[sync-frontend] All frontend assets synced, bridged, and ready for build.');
