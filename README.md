# Allama — Tauri v2 shell (`tauri45`)

Implementation of [`TAURI_MIGRATION_PLAN.md`](./TAURI_MIGRATION_PLAN.md): the
`mobile45` Angular/Ionic + Capacitor app rebuilt on a Rust core and a native
WebView. The Angular domain model, Moodle web-service contract and tenant
registry carry over; the Capacitor plugins are replaced by Rust commands.

```
tauri45/
├── src/                        # frontend SPA (TypeScript, Vite)
│   ├── app/core/               # store, router, i18n, IPC services
│   ├── app/features/           # auth, courses, player, flashcards, social, chats, profile
│   ├── app/shared/             # navbar, DOM/format helpers
│   └── styles/theme.css        # frosted-glass shell, dark mode, RTL
├── src-tauri/                  # Rust core
│   ├── src/db/                 # SQLite (WAL) + schema + migrations
│   ├── src/network/            # reqwest client, Moodle REST wrappers
│   ├── src/security/           # AES-256-GCM file crypto, capture protection, integrity
│   ├── src/video/              # loopback encrypted media server, YouTube quality bridge
│   ├── src/tenant.rs           # tenant registry, code resolution, brand cache
│   ├── src/badges.rs           # five-family XP engine, levels, streaks
│   └── src/commands/           # IPC command modules
├── scripts/build-tenants.mjs   # Phase 6 white-label build pipeline
├── tenants-registry.json       # embedded into the binary at compile time
└── docs/ANDROID.md             # Kotlin bridge, FLAG_SECURE, back button
```

## Requirements

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | ≥ 22 | `mobile45` already requires it |
| Rust | ≥ 1.77 stable | `rustup` + `cargo` (not installed on this machine yet) |
| Platform deps | WebView2 (Win), Android SDK + NDK (mobile) | see Tauri v2 prerequisites |

```bash
npm install          # frontend + Tauri CLI
npm run dev          # SPA at http://127.0.0.1:1420 (browser fallback, no Rust)
npm run typecheck    # tsc --noEmit
npm run app:dev      # full shell: Vite + cargo run (needs Rust)
npm run app:build    # desktop installers
npm run android:init # generates src-tauri/gen/android (needs Rust + NDK)
npm run android:dev
```

`npm run dev` runs against a localStorage-backed fallback bridge, so the UI is
usable before Rust is installed. Any command name, argument or payload shape is
identical to the native path — only the backend differs.

## What each phase delivered

**Phase 1 — workspace**: `package.json`, `tsconfig.json`, `vite.config.ts`,
`src-tauri/Cargo.toml`, `build.rs`, `tauri.conf.json` (identifier
`online.allama.mobile`, Android minSdk 24, locked-down CSP), capabilities for
fs/notification/clipboard/network.

**Phase 2 — Rust core**:

| Module | Behaviour |
| --- | --- |
| `db/mod.rs` | One `rusqlite` connection behind `Arc<Mutex<_>>`, WAL + `synchronous=NORMAL`, 5 s busy timeout, migrations from `db/schema.rs`, JSON row conversion |
| `network/mod.rs` | `reqwest` client (rustls, timeouts, connection pool), JSON form posts, streamed downloads |
| `network/api.rs` | Moodle REST calls, `name[0][field]` parameter flattening, `exception`/`errorcode` detection |
| `security/crypto.rs` | `ALMA1` chunked AES-256-GCM format, per-file keys derived with HMAC-SHA256, range decryption that only touches the needed chunks |
| `tenant.rs` | Embedded registry, `safwa`-style code resolution, unknown-code subdomain fallback, brand cache directory |

**Phase 3 — frontend**: typed bridge (`src/app/core/services/tauri-bridge.ts`)
with one method per command, auth service that never sees the token, frosted
navbar, hash router, en/ar i18n with RTL.

**Phase 4 — subsystems**: local encrypted streaming server with HTTP `206`
range support, YouTube quality forcing through the IFrame postMessage API
(`setPlaybackQualityRange` + `setPlaybackQuality` fallback), five badge families
with levels/streaks and a 30-second checkpoint, tenant-scoped social feed, and
an offline queue that survives failed flushes.

**Phase 5 — mobile hardening**: `security::set_capture_protection` uses
`SetWindowDisplayAffinity(WDA_MONITOR)` on Windows and a JNI call to
`MainActivity.setSecureScreen` on Android; root/debugger heuristics for exams;
`.cargo/config.toml` NDK linker settings. See `docs/ANDROID.md`.

**Phase 6 — multi-tenant builds**: `npm run tenants:build -- --only safwa
--platform android`, or omit `--only` to build every tenant.

## Plugin mapping (Capacitor → Tauri)

| mobile45 | tauri45 |
| --- | --- |
| `@capacitor-community/sqlite` | `rusqlite` via `db_*` commands (`tauri-plugin-sql` not needed: the connection is owned by Rust) |
| `@capacitor/filesystem` | `tauri-plugin-fs` + sandboxed `storage_*` commands |
| `@capacitor-community/privacy-screen` | `security_set_capture` (Win32 / `FLAG_SECURE`) |
| `@capacitor/network` | `tauri-plugin-network` + `navigator.onLine` events |
| `@capacitor/local-notifications` | `tauri-plugin-notification` |
| `@capacitor/clipboard` | `tauri-plugin-clipboard-manager` |
| `@capacitor/device` | `security_device` (`sysinfo` + install UUID) |
| `@capacitor-community/native-audio` | not ported yet — Web Audio covers quiz ticks |
| `@capacitor-mlkit/barcode-scanning` | not ported yet — `tauri-plugin-barcode-scanner` is the drop-in, add it with Rust present |
| `@awesome-cordova-plugins/push` | not ported yet — needs FCM/APNs credentials; events should be emitted into `AppState` and forwarded with `app.emit` |

## Server contract used by the sync engine

`sync_flush` calls three external functions, so `../moodle/local/li/` must expose
them (feature-detect before showing an entry point):

| Function | Args | Used for |
| --- | --- | --- |
| `local_li_sync_offline_attempt` | `attemptid`, `context`, `payload`, `grade`, `timecreated` | quiz/assignment attempts queued offline |
| `local_li_badges_sync` | `events[]` (`id`, `family`, `xp`, `detail`, `timecreated`) | XP/badge events |
| `local_li_feed_post_create` | `postid`, `message`, `timecreated` | community posts |

A failed call never drops data: the row keeps its payload and error text and is
retried on the next flush.

## Local data layout

```
<app_data>/
├── allama.db (+ -wal, -shm)   # tenants, sessions, courses, attempts, media, XP, posts
├── keys/master.key            # 32-byte device master key (0600 on unix)
├── media/<tenant>/<id>.enc    # ALMA1 encrypted media
├── tenants/<tenant>/logo.img  # cached tenant branding
└── device-id                  # stable per-install identifier
```

## Verification status

- `npm run typecheck` and `npm run build` are the checks for the frontend.
- The Rust crate is **not compiled yet**: no Rust toolchain is installed on this
  machine. `cargo build` / `cargo clippy` is the next step after
  `rustup target add x86_64-pc-windows-msvc` (or the Android targets).

### Known limitations

- **TLS certificate pinning** is not enforced by the Rust client yet. The plan
  calls for it; the hook belongs in `network/mod.rs` (a custom
  `rustls::client::danger::ServerCertVerifier` on the `ClientBuilder`). Until
  then the client relies on the platform trust store via rustls.
- **iOS/macOS capture protection** reports `enforced: false`; it needs the
  native blur/`objc2` implementation.
- The media server decrypts the requested range into memory (per request), not
  into a streaming reader. Fine for lesson-sized files; use a reader for
  multi-GB assets.
- The mobile Gradle project under `src-tauri/gen/android` must be generated on a
  machine with Rust (`npm run android:init`); it is intentionally not committed.
