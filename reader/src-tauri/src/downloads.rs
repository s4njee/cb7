//! Offline downloads ("pin this book").
//!
//! A pin is a directory under `AppState.pinned_dir` (a sibling of the LRU media
//! cache), named `sha256(server_url + "|" + comic_id)`. It holds a
//! `manifest.json` — the `list_downloads` entry plus a `files` map of
//! `<query-stripped /api path> → { name, contentType, size }` — and the payload
//! files themselves (thumbnail, comic pages, or the book `/file`).
//!
//! `download_book` returns immediately and drives the fetch on the async
//! runtime, fetching sequentially (LAN-friendly), skipping files already on
//! disk (resume), persisting the manifest and emitting
//! [`PROGRESS_EVENT`] after every unit. The pinned tree is exempt from LRU
//! eviction and `clear_media_cache`; the proxy consults it via
//! [`lookup_pinned`].

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::download_policy::{derive_status, parse_comic_id, plan_units, should_skip};
use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, DownloadHandle};

// Re-export policy entry points used outside this module (proxy, tests).
pub use crate::download_policy::{pin_key, strip_query, DownloadStatus};

/// Tauri event emitted after every completed unit (and once with `error` set on
/// failure or cancel).
pub const PROGRESS_EVENT: &str = "shelf://download-progress";

/// One pinned file, as recorded in the manifest's `files` map. `size` is kept
/// (beyond the contract's `name`/`contentType`) purely to make resume decisions
/// exact; the frontend never reads the manifest.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    /// File name on disk, relative to the pin directory.
    pub name: String,
    pub content_type: String,
    #[serde(default)]
    pub size: u64,
}

/// The on-disk `manifest.json`: the `list_downloads` entry plus the `files` map.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub comic_id: i64,
    pub title: String,
    pub media_type: String,
    pub total: i64,
    pub done: i64,
    pub bytes: u64,
    pub complete: bool,
    /// Last failure or cancel message; cleared when a run succeeds a unit.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    /// Server origin this pin came from (`None` = legacy pre-scoping manifest).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server: Option<String>,
    #[serde(default)]
    pub files: HashMap<String, FileEntry>,
}

/// A `list_downloads` row — the manifest without its `files` map.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadInfo {
    pub comic_id: i64,
    pub title: String,
    pub media_type: String,
    pub total: i64,
    pub done: i64,
    pub bytes: u64,
    pub complete: bool,
    pub status: DownloadStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    /// True when `done > 0` and incomplete — a resume will skip finished units.
    pub resumable: bool,
}

/// Payload of [`PROGRESS_EVENT`] (camelCase keys per the contract).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    comic_id: i64,
    title: String,
    media_type: String,
    total: i64,
    done: i64,
    bytes: u64,
    complete: bool,
    status: DownloadStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    resumable: bool,
}

/// A pinned manifest as held in the proxy's in-memory index: just what a proxy
/// request needs (the pin directory and the query-stripped path → file map).
pub struct PinnedManifest {
    pub dir: PathBuf,
    pub files: HashMap<String, FileEntry>,
}

impl Manifest {
    fn new(comic_id: i64, title: String, media_type: String, total: i64, server: String) -> Self {
        Self {
            comic_id,
            title,
            media_type,
            total,
            done: 0,
            bytes: 0,
            complete: false,
            last_error: None,
            server: Some(server),
            files: HashMap::new(),
        }
    }

    fn info(&self, active: bool) -> DownloadInfo {
        let status = derive_status(self.complete, active, self.last_error.as_deref(), self.done);
        DownloadInfo {
            comic_id: self.comic_id,
            title: self.title.clone(),
            media_type: self.media_type.clone(),
            total: self.total,
            done: self.done,
            bytes: self.bytes,
            complete: self.complete,
            status,
            last_error: self.last_error.clone(),
            resumable: !self.complete && self.done > 0,
        }
    }

    /// Drop entries whose backing file has vanished or no longer matches its
    /// recorded size, so a resumed run re-fetches exactly the missing units.
    fn reconcile(&mut self, dir: &Path) {
        self.files.retain(|_, entry| {
            std::fs::metadata(dir.join(&entry.name))
                .map(|meta| meta.len() > 0 && meta.len() == entry.size)
                .unwrap_or(false)
        });
    }

    /// Recompute `done`/`bytes`/`complete` from the current `files` map.
    /// `counted` is the set of unit paths that count toward `done` (every page
    /// for comics, the `/file` for books — the thumbnail is excluded).
    fn recompute(&mut self, counted: &HashSet<String>) {
        self.done = self
            .files
            .keys()
            .filter(|path| counted.contains(*path))
            .count() as i64;
        self.bytes = self.files.values().map(|entry| entry.size).sum();
        self.complete = self.done >= self.total;
    }
}

fn pin_dir(state: &AppState, server_url: &str, comic_id: i64) -> PathBuf {
    state.pinned_dir.join(pin_key(server_url, comic_id))
}

fn manifest_path(dir: &Path) -> PathBuf {
    dir.join("manifest.json")
}

fn load_manifest(dir: &Path) -> Option<Manifest> {
    let bytes = std::fs::read(manifest_path(dir)).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn save_manifest(dir: &Path, manifest: &Manifest) -> ApiResult<()> {
    let bytes = serde_json::to_vec_pretty(manifest)
        .map_err(|err| ApiError::local(format!("serialize manifest: {err}")))?;
    std::fs::write(manifest_path(dir), bytes)?;
    Ok(())
}

/// Sum of every file directly under `dir` (pins are flat besides `manifest.json`).
fn dir_size(dir: &Path) -> u64 {
    let mut total = 0;
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    total += meta.len();
                }
            }
        }
    }
    total
}

fn emit_progress(app: &AppHandle, manifest: &Manifest, active: bool, error: Option<String>) {
    let status = derive_status(
        manifest.complete,
        active && error.is_none(),
        error.as_deref().or(manifest.last_error.as_deref()),
        manifest.done,
    );
    let payload = DownloadProgress {
        comic_id: manifest.comic_id,
        title: manifest.title.clone(),
        media_type: manifest.media_type.clone(),
        total: manifest.total,
        done: manifest.done,
        bytes: manifest.bytes,
        complete: manifest.complete,
        status,
        error,
        resumable: !manifest.complete && manifest.done > 0,
    };
    if let Err(err) = app.emit(PROGRESS_EVENT, payload) {
        log::warn!("failed to emit download progress: {err}");
    }
}

/// The actual pin loop, running on the async runtime. Fetches units
/// sequentially through the shared client (so the session cookie applies),
/// skipping ones already present, persisting the manifest and emitting progress
/// after each. A non-2xx, transport error, or cancel records the error, emits,
/// and stops with partials intact.
async fn run_download(
    app: AppHandle,
    server: String,
    comic_id: i64,
    title: String,
    media_type: String,
    page_count: i64,
    cancel: Arc<AtomicBool>,
) {
    let state = app.state::<AppState>();
    let dir = pin_dir(&state, &server, comic_id);
    let is_comic = media_type == "comic";
    let total = if is_comic { page_count.max(0) } else { 1 };

    if let Err(err) = std::fs::create_dir_all(&dir) {
        let mut manifest = Manifest::new(comic_id, title, media_type, total, server.clone());
        manifest.recompute(&HashSet::new());
        let msg = format!("Could not create pin folder: {err}");
        manifest.last_error = Some(msg.clone());
        let _ = save_manifest(&dir, &manifest);
        emit_progress(&app, &manifest, false, Some(msg));
        finish(&state, comic_id).await;
        return;
    }

    let units = plan_units(comic_id, is_comic, page_count);
    let counted: HashSet<String> = units
        .iter()
        .filter(|unit| unit.counted)
        .map(|unit| unit.path.clone())
        .collect();

    // Resume from an existing manifest (or start fresh), then reconcile against
    // what is actually on disk before recomputing progress.
    let mut manifest = load_manifest(&dir)
        .unwrap_or_else(|| Manifest::new(comic_id, title.clone(), media_type.clone(), total, server.clone()));
    manifest.title = title;
    manifest.media_type = media_type;
    manifest.total = total;
    manifest.reconcile(&dir);
    manifest.recompute(&counted);
    // Starting a run clears the previous failure so UI shows active/queued.
    manifest.last_error = None;
    let _ = save_manifest(&dir, &manifest);
    // Announce resume/start so the sheet can say "Resuming…" when done > 0.
    emit_progress(&app, &manifest, true, None);

    let mut errored = false;
    for unit in &units {
        if cancel.load(Ordering::SeqCst) {
            let msg = "Download cancelled — partial files kept; Retry resumes.".to_string();
            manifest.last_error = Some(msg.clone());
            let _ = save_manifest(&dir, &manifest);
            emit_progress(&app, &manifest, false, Some(msg));
            errored = true;
            break;
        }

        let file_path = dir.join(&unit.name);
        let on_disk = std::fs::metadata(&file_path).map(|meta| meta.len()).unwrap_or(0);
        if should_skip(manifest.files.get(&unit.path).map(|e| e.size), on_disk) {
            continue;
        }

        let url = format!("{server}{}", unit.path);
        let response = match state.client.get(&url).send().await {
            Ok(response) => response,
            Err(err) => {
                let msg = ApiError::from(err).message;
                manifest.last_error = Some(msg.clone());
                let _ = save_manifest(&dir, &manifest);
                emit_progress(&app, &manifest, false, Some(msg));
                errored = true;
                break;
            }
        };
        if !response.status().is_success() {
            let status = response.status().as_u16();
            let msg = format!("Server returned {status}");
            manifest.last_error = Some(msg.clone());
            let _ = save_manifest(&dir, &manifest);
            emit_progress(&app, &manifest, false, Some(msg));
            errored = true;
            break;
        }

        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string)
            .unwrap_or_else(|| "application/octet-stream".to_string());

        let body = match response.bytes().await {
            Ok(bytes) => bytes,
            Err(err) => {
                let msg = ApiError::from(err).message;
                manifest.last_error = Some(msg.clone());
                let _ = save_manifest(&dir, &manifest);
                emit_progress(&app, &manifest, false, Some(msg));
                errored = true;
                break;
            }
        };

        if let Err(err) = std::fs::write(&file_path, &body) {
            let msg = format!("Could not write file: {err}");
            manifest.last_error = Some(msg.clone());
            let _ = save_manifest(&dir, &manifest);
            emit_progress(&app, &manifest, false, Some(msg));
            errored = true;
            break;
        }

        manifest.files.insert(
            unit.path.clone(),
            FileEntry {
                name: unit.name.clone(),
                content_type,
                size: body.len() as u64,
            },
        );
        manifest.last_error = None;
        manifest.recompute(&counted);
        if let Err(err) = save_manifest(&dir, &manifest) {
            log::warn!("failed to persist manifest for comic {comic_id}: {}", err.message);
        }
        emit_progress(&app, &manifest, true, None);
    }

    if !errored {
        manifest.last_error = None;
        manifest.recompute(&counted);
        if let Err(err) = save_manifest(&dir, &manifest) {
            log::warn!("failed to persist manifest for comic {comic_id}: {}", err.message);
        }
        emit_progress(&app, &manifest, false, None);
    }

    finish(&state, comic_id).await;
}

/// Drop the in-flight handle and invalidate the proxy's pinned index so newly
/// written files become servable offline.
async fn finish(state: &AppState, comic_id: i64) {
    state.downloads.lock().await.remove(&comic_id);
    invalidate_index(state).await;
}

/// Serve pinned bytes for a proxy request, if any pinned manifest for the
/// *current* server holds the query-stripped path. Builds the pin-key-keyed
/// index lazily. Does NOT touch the LRU cache.
///
/// `server` is the connected server origin; pins are scoped by
/// `pin_key(server_url, comic_id)` (the pin directory name), so two servers
/// that both have a comic id can never serve each other's bytes.
pub async fn lookup_pinned(state: &AppState, server: &str, path: &str) -> Option<(Vec<u8>, String)> {
    let stripped = strip_query(path);
    let comic_id = parse_comic_id(stripped)?;
    let key = pin_key(server, comic_id);

    let mut guard = state.pinned_index.lock().await;
    if guard.is_none() {
        *guard = Some(build_index(&state.pinned_dir));
    }
    let index = guard.as_ref()?;
    let manifest = index.get(&key)?;
    let entry = manifest.files.get(stripped)?;
    let bytes = std::fs::read(manifest.dir.join(&entry.name)).ok()?;
    Some((bytes, entry.content_type.clone()))
}

/// Key the index by the pin directory name — `pin_key(server_url, comic_id)` —
/// so a comic id on one server never collides with the same id on another.
fn build_index(root: &Path) -> HashMap<String, PinnedManifest> {
    let mut index = HashMap::new();
    if let Ok(entries) = std::fs::read_dir(root) {
        for entry in entries.flatten() {
            let dir = entry.path();
            if !dir.is_dir() {
                continue;
            }
            let Some(key) = entry.file_name().to_str().map(str::to_string) else {
                continue;
            };
            if let Some(manifest) = load_manifest(&dir) {
                index.insert(key, PinnedManifest { dir, files: manifest.files });
            }
        }
    }
    index
}

async fn invalidate_index(state: &AppState) {
    *state.pinned_index.lock().await = None;
}

#[tauri::command]
pub async fn download_book(
    app: AppHandle,
    state: State<'_, AppState>,
    comic_id: i64,
    title: String,
    media_type: String,
    page_count: i64,
) -> Result<(), ApiError> {
    let server = state.server_url().await?;

    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut map = state.downloads.lock().await;
        if map.contains_key(&comic_id) {
            return Err(ApiError::local("This book is already downloading"));
        }
        map.insert(comic_id, DownloadHandle { cancel: cancel.clone() });
    }

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        run_download(app_handle, server, comic_id, title, media_type, page_count, cancel).await;
    });
    Ok(())
}

#[tauri::command]
pub async fn cancel_download(state: State<'_, AppState>, comic_id: i64) -> Result<(), ApiError> {
    if let Some(handle) = state.downloads.lock().await.get(&comic_id) {
        handle.cancel.store(true, Ordering::SeqCst);
    }
    Ok(())
}

#[tauri::command]
pub async fn remove_download(state: State<'_, AppState>, comic_id: i64) -> Result<u64, ApiError> {
    let server = state.server_url().await?;
    // Ask an in-flight pin to stop before we delete under it.
    if let Some(handle) = state.downloads.lock().await.get(&comic_id) {
        handle.cancel.store(true, Ordering::SeqCst);
    }
    // A legacy pin (predates server scoping) from another server lives under a
    // different hash dir than the current server's, so fall back to scanning
    // when the current-server dir doesn't exist.
    let mut dir = pin_dir(&state, &server, comic_id);
    if !dir.exists() {
        dir = find_pin_dir(&state.pinned_dir, comic_id).unwrap_or(dir);
    }
    let freed = dir_size(&dir);
    if dir.exists() {
        std::fs::remove_dir_all(&dir)?;
    }
    invalidate_index(&state).await;
    Ok(freed)
}

/// Find a pin directory whose manifest holds `comic_id`, regardless of which
/// server it came from. Used to remove legacy pins whose hash dir doesn't match
/// the current server.
fn find_pin_dir(root: &Path, comic_id: i64) -> Option<PathBuf> {
    let entries = std::fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        if let Some(manifest) = load_manifest(&dir) {
            if manifest.comic_id == comic_id {
                return Some(dir);
            }
        }
    }
    None
}

/// True when `manifest` belongs to `server` for listing purposes: either it
/// records that server, or it is a legacy pre-scoping manifest (treated as a
/// current-server pin — still visible and removable).
fn manifest_belongs_to(manifest: &Manifest, server: &str) -> bool {
    match manifest.server.as_deref() {
        Some(origin) => origin == server,
        None => true,
    }
}

#[tauri::command]
pub async fn list_downloads(state: State<'_, AppState>) -> Result<Vec<DownloadInfo>, ApiError> {
    let server = state.server_url().await?;
    let active: HashSet<i64> = state.downloads.lock().await.keys().copied().collect();
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&state.pinned_dir) {
        for entry in entries.flatten() {
            let dir = entry.path();
            if !dir.is_dir() {
                continue;
            }
            if let Some(manifest) = load_manifest(&dir) {
                // Only current-server pins are visible; a pin from a previous
                // server stays on disk but is hidden from this server's list.
                if !manifest_belongs_to(&manifest, &server) {
                    continue;
                }
                let is_active = active.contains(&manifest.comic_id);
                out.push(manifest.info(is_active));
            }
        }
    }
    // Active-only pins that haven't written a manifest yet (rare) still show.
    for id in &active {
        if !out.iter().any(|d| d.comic_id == *id) {
            out.push(DownloadInfo {
                comic_id: *id,
                title: "Downloading…".into(),
                media_type: "book".into(),
                total: 0,
                done: 0,
                bytes: 0,
                complete: false,
                status: DownloadStatus::Queued,
                last_error: None,
                resumable: false,
            });
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_round_trips_and_uses_camel_case() {
        let mut files = HashMap::new();
        files.insert(
            "/api/comics/5/pages/0".to_string(),
            FileEntry { name: "page-000000".into(), content_type: "image/jpeg".into(), size: 2048 },
        );
        let manifest = Manifest {
            comic_id: 5,
            title: "Test".into(),
            last_error: None,
            media_type: "comic".into(),
            total: 12,
            done: 1,
            bytes: 2048,
            complete: false,
            server: Some("http://host:8008".into()),
            files,
        };

        let json = serde_json::to_string(&manifest).unwrap();
        assert!(json.contains("\"comicId\":5"));
        assert!(json.contains("\"mediaType\":\"comic\""));
        assert!(json.contains("\"server\":\"http://host:8008\""));
        assert!(json.contains("\"contentType\":\"image/jpeg\""));

        let back: Manifest = serde_json::from_str(&json).unwrap();
        assert_eq!(back.comic_id, 5);
        assert_eq!(back.total, 12);
        assert_eq!(back.server.as_deref(), Some("http://host:8008"));
        assert_eq!(back.files["/api/comics/5/pages/0"].content_type, "image/jpeg");
        assert_eq!(back.files["/api/comics/5/pages/0"].size, 2048);
    }

    #[test]
    fn legacy_manifest_without_server_deserializes_as_none() {
        let json = r#"{"comicId":5,"title":"T","mediaType":"comic","total":3,"done":0,"bytes":0,"complete":false,"files":{}}"#;
        let manifest: Manifest = serde_json::from_str(json).unwrap();
        assert_eq!(manifest.server, None);
        assert_eq!(manifest.comic_id, 5);
        // Re-serializing a legacy manifest omits the absent server field.
        let json = serde_json::to_string(&manifest).unwrap();
        assert!(!json.contains("\"server\""));
    }

    #[test]
    fn manifest_belongs_to_keeps_current_server_and_legacy() {
        let mut manifest = Manifest::new(5, "T".into(), "comic".into(), 3, "http://a".into());
        assert!(manifest_belongs_to(&manifest, "http://a"));
        assert!(!manifest_belongs_to(&manifest, "http://b"));
        manifest.server = None; // legacy, pre-scoping
        assert!(manifest_belongs_to(&manifest, "http://b"));
    }

    #[test]
    fn recompute_counts_pages_and_excludes_thumbnail() {
        let units = plan_units(5, true, 3);
        let counted: HashSet<String> = units
            .iter()
            .filter(|u| u.counted)
            .map(|u| u.path.clone())
            .collect();
        assert_eq!(counted.len(), 3); // 3 pages, thumbnail excluded

        let mut manifest = Manifest::new(5, "T".into(), "comic".into(), 3, "http://host:8008".into());
        // Thumbnail + one page present.
        manifest.files.insert(
            "/api/comics/5/thumbnail".into(),
            FileEntry { name: "thumbnail".into(), content_type: "image/jpeg".into(), size: 50 },
        );
        manifest.files.insert(
            "/api/comics/5/pages/0".into(),
            FileEntry { name: "page-000000".into(), content_type: "image/jpeg".into(), size: 100 },
        );
        manifest.recompute(&counted);
        assert_eq!(manifest.done, 1); // only the page counts
        assert_eq!(manifest.bytes, 150); // thumbnail bytes still counted
        assert!(!manifest.complete);

        for n in 1..3 {
            manifest.files.insert(
                format!("/api/comics/5/pages/{n}"),
                FileEntry { name: format!("page-{n:06}"), content_type: "image/jpeg".into(), size: 100 },
            );
        }
        manifest.recompute(&counted);
        assert_eq!(manifest.done, 3);
        assert!(manifest.complete);
    }

}
