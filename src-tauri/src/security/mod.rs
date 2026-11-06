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

//! Security, anti-cheating and DRM hooks (Subsystem 4).

pub mod crypto;

use serde::Serialize;

/// Result of a capture-protection toggle, so the UI can tell the user when the
/// current platform cannot enforce it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtectionReport {
    pub enabled: bool,
    pub enforced: bool,
    pub platform: String,
    pub mechanism: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrityReport {
    pub platform: String,
    pub rooted: bool,
    pub debugger_attached: bool,
    pub indicators: Vec<String>,
}

/// Enables OS-level screen-capture prevention for exam and DRM content.
///
/// * Windows: `SetWindowDisplayAffinity(WDA_MONITOR)` keeps OBS/Discord capture
///   tools from seeing the window while it stays visible to the user.
/// * Android: `FLAG_SECURE` through a JNI call into `MainActivity`.
/// * iOS/macOS: reported as not enforced (needs a native plugin, see README).
pub fn set_capture_protection(
    window: &tauri::WebviewWindow,
    enabled: bool,
) -> Result<ProtectionReport, String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::HWND;
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            SetWindowDisplayAffinity, WDA_MONITOR, WDA_NONE,
        };

        let raw = window.hwnd().map_err(|e| format!("window handle: {e}"))?.0;
        let hwnd = raw as HWND;
        let affinity = if enabled { WDA_MONITOR } else { WDA_NONE };

        let ok = unsafe { SetWindowDisplayAffinity(hwnd, affinity) };
        if ok == 0 {
            return Err("SetWindowDisplayAffinity failed".to_string());
        }

        return Ok(ProtectionReport {
            enabled,
            enforced: true,
            platform: "windows".to_string(),
            mechanism: "SetWindowDisplayAffinity(WDA_MONITOR)".to_string(),
        });
    }

    #[cfg(target_os = "android")]
    {
        android::set_secure_screen(enabled)?;

        return Ok(ProtectionReport {
            enabled,
            enforced: true,
            platform: "android".to_string(),
            mechanism: "WindowManager.LayoutParams.FLAG_SECURE".to_string(),
        });
    }

    #[cfg(not(any(windows, target_os = "android")))]
    {
        let _ = (window, enabled);

        Ok(ProtectionReport {
            enabled,
            enforced: false,
            platform: std::env::consts::OS.to_string(),
            mechanism: "not implemented for this platform".to_string(),
        })
    }
}

/// Root / jailbreak / debugger heuristics used before showing exam content.
pub fn integrity_check() -> IntegrityReport {
    let mut indicators = Vec::new();

    let su_paths = [
        "/system/xbin/su",
        "/system/bin/su",
        "/system/sbin/su",
        "/sbin/su",
        "/su/bin/su",
        "/data/local/xbin/su",
        "/data/local/bin/su",
        "/data/adb/magisk",
    ];

    let mut rooted = false;
    for path in su_paths {
        if std::path::Path::new(path).exists() {
            rooted = true;
            indicators.push(format!("su binary present: {path}"));
        }
    }

    #[cfg(target_os = "android")]
    {
        if let Ok(tags) = std::fs::read_to_string("/proc/version") {
            if tags.contains("test-keys") {
                rooted = true;
                indicators.push("kernel built with test-keys".to_string());
            }
        }
    }

    let debugger_attached = debugger_present();
    if debugger_attached {
        indicators.push("a debugger is attached".to_string());
    }

    IntegrityReport {
        platform: std::env::consts::OS.to_string(),
        rooted,
        debugger_attached,
        indicators,
    }
}

#[cfg(target_os = "android")]
fn debugger_present() -> bool {
    std::fs::read_to_string("/proc/self/status")
        .map(|status| {
            status
                .lines()
                .find(|line| line.starts_with("TracerPid:"))
                .and_then(|line| line.split(':').nth(1))
                .and_then(|value| value.trim().parse::<u32>().ok())
                .map(|pid| pid != 0)
                .unwrap_or(false)
        })
        .unwrap_or(false)
}

#[cfg(windows)]
fn debugger_present() -> bool {
    unsafe { windows_sys::Win32::System::Diagnostics::Debug::IsDebuggerPresent() != 0 }
}

#[cfg(not(any(windows, target_os = "android")))]
fn debugger_present() -> bool {
    false
}

/// Android bridge. The Kotlin side must expose `setSecureScreen(boolean)` on the
/// activity; see `docs/ANDROID.md` for the three-line MainActivity override.
#[cfg(target_os = "android")]
pub mod android {
    use jni::objects::{JObject, JValue};

    pub fn set_secure_screen(enabled: bool) -> Result<(), String> {
        let context = ndk_context::android_context();
        let vm = unsafe { jni::JavaVM::from_raw(context.vm().cast()) }
            .map_err(|e| format!("attach JVM: {e}"))?;
        let mut env = vm
            .attach_current_thread()
            .map_err(|e| format!("attach thread: {e}"))?;
        let activity = unsafe { JObject::from_raw(context.context().cast()) };

        env.call_method(
            &activity,
            "setSecureScreen",
            "(Z)V",
            &[JValue::Bool(u8::from(enabled))],
        )
        .map_err(|e| format!("MainActivity.setSecureScreen: {e}"))?;

        Ok(())
    }
}
