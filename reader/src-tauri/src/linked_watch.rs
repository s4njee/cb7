//! Watch linked library folders for on-disk changes and tell the frontend.
//!
//! Linked folders are read in place, so the shelf can go stale when books are
//! added or removed on disk. Each attached folder gets a `notify` watcher that
//! emits `shelf://linked-folders-changed` on any create/modify/remove event;
//! the frontend turns that into a Rescan prompt. Watching is best-effort — if
//! it can't start, the manual Rescan action still works.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// Handle to one running folder watcher (cancelled by dropping).
pub struct FolderWatch {
    _watcher: RecommendedWatcher,
}

/// Live set of watchers keyed by the folder path they watch.
pub struct LinkedWatches(pub Mutex<HashMap<String, FolderWatch>>);

impl Default for LinkedWatches {
    fn default() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

/// Start (or restart) a watcher for one linked folder. On any relevant file
/// event it emits `shelf://linked-folders-changed` so the frontend can offer a
/// Rescan. Best-effort: an unwatchable path just means manual Rescan only.
pub fn watch_folder<R: Runtime>(app: AppHandle<R>, path: &str) {
    let state: tauri::State<'_, LinkedWatches> = app.state::<LinkedWatches>();
    let mut guard = state.0.lock();
    if let Ok(watches) = guard.as_mut() {
        // Replace any existing watcher for this path (folder re-attached).
        watches.remove(path);
        let sender = app.clone();
        let handler = move |res: notify::Result<notify::Event>| {
            if res.is_ok() {
                let _ = sender.emit("shelf://linked-folders-changed", ());
            }
        };
        if let Ok(mut watcher) = RecommendedWatcher::new(
            handler,
            Config::default().with_poll_interval(Duration::from_millis(500)),
        ) {
            if watcher
                .watch(std::path::Path::new(path), RecursiveMode::Recursive)
                .is_ok()
            {
                watches.insert(path.to_string(), FolderWatch { _watcher: watcher });
            }
        }
    }
}

/// Stop watching a folder (removed via `local_remove_linked_folder`). The
/// watcher drops when its entry leaves the map, which cancels the thread.
pub fn unwatch_folder<R: Runtime>(app: &AppHandle<R>, path: &str) {
    if let Ok(mut watches) = app.state::<LinkedWatches>().0.lock() {
        watches.remove(path);
    }
}
