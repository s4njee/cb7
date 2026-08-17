//! Native platform facts for the frontend platform boundary (`src/lib/platform.ts`).
//!
//! The media protocol base must come from here, not from `navigator.userAgent`:
//! the UA string is spoofable, differs between webviews, and is exactly the
//! kind of guess that breaks one OS while the other three keep working. Rust
//! knows the target at compile time, so the answer is exact by construction.
//!
//! These facts are resolved **once during boot** and cached on the frontend,
//! because media URLs (`<img src>` for covers and pages) are built
//! synchronously at render time — there is no async window to wait on there.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformInfo {
    /// `std::env::consts::OS`: `macos` | `windows` | `linux` | `ios` | `android`.
    pub os: &'static str,
    pub is_desktop: bool,
    /// The media protocol base for this platform, e.g. `cb8://localhost` or
    /// `http://cb8.localhost` — see `crate::proxy`.
    pub media_base: &'static str,
}

/// The protocol base Tauri registers per platform. Windows and Android get the
/// `http://cb8.localhost` form; everywhere else the `cb8://localhost` scheme.
/// Mirrors `proxy.rs`'s registration, and the one place this mapping lives.
fn media_base() -> &'static str {
    if cfg!(any(target_os = "windows", target_os = "android")) {
        "http://cb8.localhost"
    } else {
        "cb8://localhost"
    }
}

#[tauri::command]
pub fn platform_info() -> PlatformInfo {
    PlatformInfo {
        os: std::env::consts::OS,
        is_desktop: !cfg!(any(target_os = "android", target_os = "ios")),
        media_base: media_base(),
    }
}
