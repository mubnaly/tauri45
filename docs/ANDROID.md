# Android hardening (Phase 5)

`src-tauri/gen/android` is generated, not committed. Run once on a machine with
Rust and the Android SDK/NDK installed:

```bash
npm install
npm run android:init     # tauri android init — writes src-tauri/gen/android
```

`tauri.conf.json` already pins `bundle.android.minSdkVersion` to 24 and the
identifier to `online.allama.mobile`. The tenant build script rewrites the
identifier per tenant from `tenants-registry.json`.

## 1. `FLAG_SECURE` bridge

`security::set_capture_protection` calls
`MainActivity.setSecureScreen(boolean)` through JNI. Add that method to the
generated activity (`src-tauri/gen/android/app/src/main/kotlin/.../MainActivity.kt`):

```kotlin
package online.allama.mobile

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setSecureScreen(true)
    }

    /** Called from Rust (`security::android::set_secure_screen`). */
    fun setSecureScreen(enabled: Boolean) {
        runOnUiThread {
            if (enabled) {
                window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
            } else {
                window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
            }
        }
    }
}
```

Keep the class package and name exactly as generated; only add the method and
the `onCreate` call. If the class is renamed, update the command name string in
`src-tauri/src/security/mod.rs`.

## 2. Hardware back button

Tauri v2 forwards the back gesture to the WebView history. The router uses hash
navigation, so `history.back()` returns to the previous screen; add an explicit
handler in `src/main.ts` only if a screen needs to intercept it:

```ts
import { getCurrentWindow } from '@tauri-apps/api/window';

await getCurrentWindow().listen('android-back-button', () => {
    if (location.hash !== '#/courses') {
        history.back();
    }
});
```

## 3. Status bar colour

Match `moodle.config.json` (`statusbarbgandroid: #2563EB`):

```ts
import { setStatusBarColor } from '@tauri-apps/api/window'; // desktop only
```

On Android the status bar is styled by the system theme; set
`window.setStatusBarColor` in the generated activity with
`WindowCompat.setDecorFitsSystemWindows` if exact parity is required.

## 4. Build

```bash
npm run android:build                       # APK/AAB for the current identifier
npm run tenants:build -- --only safwa --platform android
```
