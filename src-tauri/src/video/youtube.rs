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

//! YouTube quality bridge (Subsystem 3).
//!
//! YouTube ignores `setPlaybackQuality` on adaptive (DASH) streams unless the
//! range is forced, and `modestbranding`/`vq` URL parameters are dead. The
//! player is embedded with `enablejsapi=1`; this module produces the script that
//! drives the embedded frame through the documented postMessage API from the
//! app's own WebView (postMessage is cross-origin safe, so no frame injection is
//! needed).

use serde::Serialize;

/// Quality values accepted by the IFrame API, best first.
pub const QUALITIES: [&str; 6] = ["highres", "hd2160", "hd1440", "hd1080", "hd720", "large"];

#[derive(Debug, Clone, Serialize)]
pub struct YouTubeConfig {
    pub requested: String,
    pub quality: String,
    pub qualities: Vec<String>,
    pub script: String,
}

/// Maps a user preference to a quality the IFrame API understands.
pub fn normalise_quality(quality: &str) -> &'static str {
    match quality.trim().to_lowercase().as_str() {
        "2160" | "2160p" | "4k" | "hd2160" => "hd2160",
        "1440" | "1440p" | "hd1440" => "hd1440",
        "1080" | "1080p" | "hd1080" | "fullhd" | "best" => "hd1080",
        "720" | "720p" | "hd720" => "hd720",
        "480" | "480p" => "large",
        "360" | "360p" | "medium" => "medium",
        "240" | "240p" | "small" => "small",
        "auto" | "default" => "default",
        "highest" | "highres" => "highres",
        _ => "hd1080",
    }
}

/// Script that forces the requested quality on every YouTube iframe found.
///
/// `setPlaybackQualityRange` is the only call that survives the DASH override;
/// plain `setPlaybackQuality` is kept as a fallback for older players.
pub fn quality_script(quality: &str) -> String {
    let quality = normalise_quality(quality);

    format!(
        r#"(function () {{
    var quality = "{quality}";
    var frames = document.querySelectorAll('iframe[src*="youtube"], iframe[data-allama-player]');
    if (!frames.length) {{ return 0; }}
    for (var i = 0; i < frames.length; i++) {{
        var frame = frames[i];
        if (!frame.src.includes('enablejsapi=1')) {{
            frame.src += (frame.src.includes('?') ? '&' : '?') + 'enablejsapi=1&origin=' + encodeURIComponent(location.origin);
        }}
        var send = function (func) {{
            frame.contentWindow.postMessage(JSON.stringify({{
                event: 'command',
                func: func,
                args: [quality, quality]
            }}), '*');
        }};
        send('setPlaybackQualityRange');
        send('setPlaybackQuality');
    }}
    window.__allamaYouTubeQuality = quality;
    return frames.length;
}})();"#
    )
}

/// Same bridge, expressed for the Rust-driven `VP9/AV1` fallback path where the
/// app can only ask for the highest available stream.
pub fn best_effort_script() -> String {
    quality_script("highres")
}
