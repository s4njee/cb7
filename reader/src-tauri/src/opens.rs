//! Normalized open-request delivery.
//!
//! Every way a book reaches the app — macOS `RunEvent::Opened`, Windows/Linux
//! startup argv, a second single-instance forwarding — funnels through
//! [`record_opens`], which turns the raw source (a `file://` URL or a plain
//! filesystem path) into a canonical, supported book path.
//!
//! Delivery is channel-gated by readiness, so a single OS open event can never
//! double-import:
//!
//! - **Before the frontend is ready** (webview still booting), requests are
//!   queued and the frontend drains them once via `take_opened_paths`.
//! - **After the frontend is ready**, requests are emitted as the live
//!   `shelf://opened-files` event, which the frontend listens for.
//!
//! A request goes to exactly one channel, so the cold-start drain and a live
//! event can't both deliver the same path.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};

use crate::local;

/// Pending open requests + the readiness gate that decides their channel.
pub struct OpenRequests {
    /// Canonical, supported book paths waiting for the frontend to drain.
    pending: Mutex<Vec<String>>,
    /// False until the frontend has drained once (i.e. is listening for live
    /// events). Set by `take_opened_paths`.
    ready: AtomicBool,
}

impl Default for OpenRequests {
    fn default() -> Self {
        Self {
            pending: Mutex::new(Vec::new()),
            ready: AtomicBool::new(false),
        }
    }
}

/// Normalize one raw open source into a canonical, supported book path.
///
/// Accepts a `file://` URL (Open In / share sheet / Files) or a plain
/// filesystem path (Windows/Linux argv, single-instance args). Returns `None`
/// for anything that isn't an existing file with a supported book extension —
/// unsupported files are dropped here, before they reach the importer.
fn normalize_source(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let path = if trimmed.starts_with("file:") {
        url::Url::parse(trimmed).ok()?.to_file_path().ok()?
    } else {
        PathBuf::from(trimmed)
    };
    if !local::is_supported_book_path(&path) {
        return None;
    }
    // Canonicalize so the same file via different spellings (or a symlink)
    // dedupes to one path — and so Windows/Linux argv paths resolve.
    let canon = std::fs::canonicalize(&path).ok()?;
    Some(canon.to_string_lossy().into_owned())
}

/// Filter raw process args (from Windows/Linux startup or a second
/// single-instance) down to existing book files. `argv[0]` (the executable) is
/// skipped; everything else must be a supported book file to survive. This is
/// the single-instance argument-parsing contract — a `--flag` or `-x` is not a
/// book and is dropped here.
#[cfg(any(target_os = "windows", target_os = "linux"))]
pub fn book_args(args: &[String]) -> Vec<String> {
    args.iter().skip(1).filter_map(|a| normalize_source(a)).collect()
}

/// Queue (pre-ready) or emit live (post-ready) a batch of open requests.
///
/// One OS open event is one call: sources are deduped within the batch, and
/// the batch goes entirely to one channel.
pub fn record_opens(app: &AppHandle, sources: Vec<String>) {
    if sources.is_empty() {
        return;
    }
    let mut seen = HashSet::new();
    let paths: Vec<String> = sources
        .into_iter()
        .filter_map(|s| normalize_source(&s))
        .filter(|p| seen.insert(p.clone()))
        .collect();
    if paths.is_empty() {
        return;
    }

    let state = app.state::<OpenRequests>();
    if state.ready.load(Ordering::SeqCst) {
        let _ = app.emit("shelf://opened-files", paths);
        return;
    }
    let mut pending = match state.pending.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    pending.extend(paths);
}

/// Mark the frontend ready and drain cold-start requests. Returns `[]` when
/// nothing is pending. Called once at boot, after the live listener is up.
#[tauri::command]
pub fn take_opened_paths(app: tauri::AppHandle) -> Vec<String> {
    let state = app.state::<OpenRequests>();
    state.ready.store(true, Ordering::SeqCst);
    let mut pending = match state.pending.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    std::mem::take(&mut *pending)
}

/// Best-effort restore/focus of the main window (second-instance forward, or a
/// cold-start "Open with" on Windows/Linux). A book is already about to import;
/// bringing the window forward is what makes that visible.
#[cfg(any(target_os = "windows", target_os = "linux"))]
pub fn focus_main_window<R: tauri::Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_book(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("cb8-opens-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        std::fs::write(&path, b"book").unwrap();
        path
    }

    #[test]
    fn normalize_accepts_file_urls_and_plain_paths() {
        let epub = tmp_book("a.epub");
        assert_eq!(
            normalize_source(&format!("file://{}", epub.display())),
            Some(epub.canonicalize().unwrap().to_string_lossy().into_owned())
        );
        let cbz = tmp_book("b.cbz");
        assert_eq!(
            normalize_source(cbz.to_str().unwrap()),
            Some(cbz.canonicalize().unwrap().to_string_lossy().into_owned())
        );
    }

    #[test]
    fn normalize_rejects_non_books_and_missing_files() {
        let txt = tmp_book("notes.txt");
        assert_eq!(normalize_source(txt.to_str().unwrap()), None);
        assert_eq!(normalize_source("/nonexistent/book.epub"), None);
        assert_eq!(normalize_source(""), None);
    }

    #[cfg(any(target_os = "windows", target_os = "linux"))]
    #[test]
    fn book_args_skips_executable_and_flags() {
        let epub = tmp_book("a.epub");
        let args = vec![
            "/usr/bin/reader".to_string(),
            epub.to_string_lossy().into_owned(),
            "--flag".to_string(),
        ];
        assert_eq!(book_args(&args).len(), 1);
        assert_eq!(
            book_args(&args)[0],
            epub.canonicalize().unwrap().to_string_lossy().into_owned()
        );
    }
}
