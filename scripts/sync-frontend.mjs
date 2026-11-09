import { existsSync, cpSync, readFileSync, writeFileSync, readdirSync, copyFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const targetWww = resolve(__dirname, '../www');
const sourceWww = resolve(__dirname, '../../mobile45/www');
const sourceConfig = resolve(__dirname, '../../mobile45/moodle.config.json');

// Only copy from sourceWww if source exists and is newer or index.html is missing
if (existsSync(sourceWww)) {
    try {
        console.log(`[sync-frontend] Checking source assets...`);
        // We sync if target doesn't exist
        if (!existsSync(resolve(targetWww, 'index.html'))) {
            console.log(`[sync-frontend] Syncing latest build from ${sourceWww} -> ${targetWww}...`);
            cpSync(sourceWww, targetWww, { recursive: true, force: true });
            console.log('[sync-frontend] Frontend assets synced successfully.');
        }
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

// 2. Patch index.html with base href and Tauri-Cordova-NativeHttp-SQLite bridge
let html = readFileSync(targetIndex, 'utf8');

// Replace base href
html = html.replace(/<base\s+href="[^"]*"\s*\/?>/i, '<base href="./">');

const bridgeScript = `
    <!-- Tauri Runtime & Cordova/NativeHttp/SQLite Compatibility Bridge -->
    <script>
        (function() {
            window.isTauri = true;
            window.cordova = window.cordova || {
                platformId: 'android',
                version: '12.0.0',
                plugins: {},
                plugin: {}
            };
            window.cordova.plugin = window.cordova.plugin || {};
            window.cordova.plugins = window.cordova.plugins || {};

            // NativeHttp ErrorCode & HTTP shim to bridge requests cleanly to Tauri native reqwest / fetch
            var httpShim = {
                ErrorCode: {
                    GENERIC: -1,
                    SSL_EXCEPTION: -2,
                    SERVER_NOT_FOUND: -3,
                    TIMEOUT: -4,
                    UNSUPPORTED_URL: -5,
                    NOT_CONNECTED: -6,
                    POST_PROCESSING_FAILED: -7,
                    ABORTED: -8
                },
                setServerTrustMode: function(mode, success, error) { if (success) success(); },
                setClientAuthMode: function(mode, opts, success, error) { if (success) success(); },
                setHeader: function(host, header, value, success, error) { if (success) success(); },
                setDataSerializer: function(serializer, success, error) { if (success) success(); },
                setRequestTimeout: function(timeout, success, error) { if (success) success(); },
                sendRequest: function(url, options, success, error) {
                    var method = (options && options.method) ? options.method.toUpperCase() : 'GET';
                    var reqHeaders = Object.assign({}, (options && options.headers) || {});
                    var serializer = (options && options.serializer) || 'urlencoded';
                    var responseType = (options && options.responseType) || 'json';
                    var body = undefined;

                    // 1. Process query parameters
                    if (options && options.params && typeof options.params === 'object') {
                        var qParts = [];
                        for (var pk in options.params) {
                            if (Object.prototype.hasOwnProperty.call(options.params, pk) && options.params[pk] != null) {
                                qParts.push(encodeURIComponent(pk) + '=' + encodeURIComponent(options.params[pk]));
                            }
                        }
                        if (qParts.length > 0) {
                            url += (url.indexOf('?') >= 0 ? '&' : '?') + qParts.join('&');
                        }
                    }

                    // 2. Serialize request body properly
                    if (method !== 'GET' && method !== 'HEAD' && options && options.data !== undefined && options.data !== null) {
                        if (serializer === 'json') {
                            body = (typeof options.data === 'string') ? options.data : JSON.stringify(options.data);
                            if (!reqHeaders['Content-Type'] && !reqHeaders['content-type']) {
                                reqHeaders['Content-Type'] = 'application/json; charset=utf-8';
                            }
                        } else if (serializer === 'urlencoded') {
                            if (typeof options.data === 'object') {
                                var parts = [];
                                for (var k in options.data) {
                                    if (Object.prototype.hasOwnProperty.call(options.data, k) && options.data[k] != null) {
                                        parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(options.data[k]));
                                    }
                                }
                                body = parts.join('&');
                            } else {
                                body = String(options.data);
                            }
                            if (!reqHeaders['Content-Type'] && !reqHeaders['content-type']) {
                                reqHeaders['Content-Type'] = 'application/x-www-form-urlencoded; charset=utf-8';
                            }
                        } else {
                            body = (typeof options.data === 'string') ? options.data : JSON.stringify(options.data);
                        }
                    }

                    // Helper to format success response as required by CoreNativeToAngularHttpResponse
                    function deliverSuccess(status, rawData, headers, respUrl) {
                        var parsedData = rawData;
                        if (responseType === 'json') {
                            if (typeof rawData === 'string') {
                                try {
                                    parsedData = JSON.parse(rawData);
                                } catch (pErr) {
                                    console.warn('[NativeHttp Bridge] Could not parse JSON response:', pErr);
                                    parsedData = rawData;
                                }
                            }
                        }
                        if (success) {
                            success({
                                status: status,
                                data: parsedData,
                                headers: headers || {},
                                url: respUrl || url
                            });
                        }
                    }

                    // Helper to format error response
                    function deliverError(status, errText) {
                        var code = -1;
                        var sErr = String(errText || '');
                        if (sErr.indexOf('SSL') >= 0 || sErr.indexOf('certificate') >= 0) {
                            code = -2;
                        } else if (sErr.indexOf('timed out') >= 0 || sErr.indexOf('timeout') >= 0) {
                            code = -4;
                        } else if (sErr.indexOf('not found') >= 0 || sErr.indexOf('dns') >= 0) {
                            code = -3;
                        }
                        if (error) {
                            error({
                                status: status && status > 0 ? status : code,
                                error: sErr || 'Network error'
                            });
                        }
                    }

                    // Try Tauri Native reqwest IPC first (no CORS, native speed and reliability)
                    if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
                        var reqPayload = {
                            method: method,
                            url: url,
                            headers: reqHeaders,
                            body: body,
                            timeout: (options && options.timeout) || 30
                        };

                        window.__TAURI__.core.invoke('native_http_request', { request: reqPayload })
                            .then(function(res) {
                                deliverSuccess(res.status, res.data, res.headers, res.url);
                            })
                            .catch(function(ipcErr) {
                                console.warn('[NativeHttp Bridge] IPC failed, falling back to fetch:', ipcErr);
                                doFetch();
                            });
                    } else {
                        doFetch();
                    }

                    function doFetch() {
                        var fetchOpts = {
                            method: method,
                            headers: reqHeaders
                        };
                        if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
                            fetchOpts.body = body;
                        }

                        fetch(url, fetchOpts)
                            .then(function(res) {
                                return res.text().then(function(text) {
                                    var hdrs = {};
                                    try {
                                        if (res.headers && res.headers.forEach) {
                                            res.headers.forEach(function(val, key) { hdrs[key] = val; });
                                        }
                                    } catch (_) {}
                                    deliverSuccess(res.status, text, hdrs, res.url);
                                });
                            })
                            .catch(function(fErr) {
                                deliverError(-1, (fErr && fErr.message) || 'Network error');
                            });
                    }
                }
            };
            window.cordova.plugin.http = httpShim;
            window.cordova.plugins.http = httpShim;

            // Device Shim
            window.device = window.device || {
                available: true,
                platform: 'Android',
                version: '14.0',
                uuid: 'tauri-app-device',
                cordova: '12.0.0',
                model: 'Tauri Desktop',
                manufacturer: 'Allama',
                isVirtual: false,
                serial: 'unknown'
            };

            // StatusBar Shim
            window.StatusBar = window.StatusBar || {
                isVisible: true,
                overlaysWebView: function() {},
                styleDefault: function() {},
                styleLightContent: function() {},
                styleBlackTranslucent: function() {},
                styleBlackOpaque: function() {},
                backgroundColorByName: function() {},
                backgroundColorByHexString: function() {},
                hide: function() {},
                show: function() {}
            };

            // Keyboard Shim
            window.Keyboard = window.Keyboard || {
                hide: function() {},
                show: function() {},
                isVisible: false
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

// Remove previous bridge if present and re-inject updated bridge
if (html.includes('<!-- Tauri Runtime')) {
    html = html.replace(/<!-- Tauri Runtime[\s\S]*?<\/script>/, bridgeScript.trim());
} else {
    html = html.replace('<head>', '<head>\n' + bridgeScript);
}
writeFileSync(targetIndex, html);
console.log('[sync-frontend] Injected updated Tauri runtime bridge (with NativeHttp ErrorCode) into www/index.html');

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
