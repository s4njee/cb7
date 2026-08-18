//! The local library — books the app *owns*.
//!
//! CB8 opens to this shelf, with or without a server. A book here is a real
//! file in the app's data directory plus a catalog entry; nothing about reading
//! it touches the network. See `docs/LOCAL-FIRST.md` for the design.
//!
//! Two decisions are load-bearing and both come from the native Flutter client
//! (`~/cb8_flutter`), which settled this domain first:
//!
//! 1. **Data dir, not cache.** iOS may evict `app_cache_dir` under pressure. A
//!    library that can evaporate is not a library.
//! 2. **Relative paths in the catalog.** On iOS the data-container UUID changes
//!    on every reinstall, so an absolute path recorded today is dangling
//!    tomorrow even though the file itself survived. Every path in
//!    `catalog.json` is relative to `<app_data>/library` and resolved at use.

use std::io::SeekFrom;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Runtime, State};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};

use crate::error::{ApiError, ApiResult};
use crate::local_zip::{entry_bytes, folder_page_names, is_image_folder, pack_image_folder_to_zip, page_names};
use crate::state::AppState;

/// Progress event name; payload is {@link DownloadProgress}.
const PROGRESS_EVENT: &str = "shelf://local-download-progress";

/* --------------------------------------------------------------- catalog */

/// Where a downloaded book came from, so the same book isn't fetched twice and
/// (later) progress can sync back to the server it belongs to.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Origin {
    pub server: String,
    pub comic_id: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    #[serde(default)]
    pub page: Option<i64>,
    #[serde(default)]
    pub location: Option<String>,
    #[serde(default)]
    pub percent: Option<f64>,
    /// Unix milliseconds of the last read, or null if never opened.
    #[serde(default)]
    pub read_at: Option<i64>,
}

/// One book in the local library. Paths are **relative to `<app_data>/library`**.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalBook {
    pub id: i64,
    pub title: String,
    /// Embedded creator names, when the format provides them.
    #[serde(default)]
    pub authors: Vec<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub publisher: Option<String>,
    #[serde(default)]
    pub published_at: Option<String>,
    /// e.g. `books/9f2c….epub`; linked image folders have an empty file path.
    pub file: String,
    /// e.g. `covers/9f2c….jpg`; null until a cover exists.
    #[serde(default)]
    pub cover: Option<String>,
    /// Lowercase, no dot: `epub` | `pdf` | `mobi` | `azw3` | `cbz` | `cbr` | `cb7` | `folder`.
    pub ext: String,
    /// `book` | `comic`.
    pub media_type: String,
    /// Comics: page count once counted. Books: 0.
    #[serde(default)]
    pub page_count: i64,
    pub bytes: u64,
    /// Unix milliseconds.
    pub added_at: i64,
    #[serde(default)]
    pub origin: Option<Origin>,
    #[serde(default)]
    pub progress: Progress,
    /// Set when the book is favorited on this device.
    #[serde(default)]
    pub favorited: bool,
    /// SHA-256 of the file bytes; used to dedupe re-imports (duplicate
    /// detection). Null for legacy records until re-hashed.
    #[serde(default)]
    pub content_hash: Option<String>,
    /// User/import-set series name, e.g. "Kaiju Diaries". Null when unknown.
    #[serde(default)]
    pub series: Option<String>,
    /// Volume within the series, e.g. "1" or "01". Null when unknown.
    #[serde(default)]
    pub volume: Option<String>,
    /// Free-form user tags (local books; server books use the server's tags).
    #[serde(default)]
    pub tags: Vec<String>,
    /// User-defined collections this book belongs to.
    #[serde(default)]
    pub collections: Vec<String>,
    /// `"linked"` when the book is read in place from `external_path` (a
    /// user-attached folder); null/absent means an app-owned copy.
    #[serde(default)]
    pub source: Option<String>,
    /// Absolute path the file is read from when `source == "linked"`. Absent
    /// for app-owned copies (they read from `file`, relative to the library).
    #[serde(default)]
    pub external_path: Option<String>,
    /// Linked book whose external file has gone missing (moved/deleted on
    /// disk). Derived at list time — never persisted.
    #[serde(default, skip)]
    pub missing: bool,
    /// Absolute acquisition URL when this book was fetched from an OPDS
    /// catalog. Used to skip a second download of the same file.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub acquired_from: Option<String>,
}

/// A user-attached folder read in place (no copy). Books inside are
/// catalogued with a `linked` source and read from their original path.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedFolder {
    pub id: i64,
    /// Absolute path to the folder being watched.
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Catalog {
    pub version: u32,
    #[serde(default)]
    pub books: Vec<LocalBook>,
    /// Monotonic id source. Never reused, so a deleted book's id can't be
    /// mistaken for a live one by a stale cache key.
    #[serde(default = "one")]
    pub next_id: i64,
    /// User-attached folders read in place (linked books).
    #[serde(default)]
    pub linked_folders: Vec<LinkedFolder>,
}

fn one() -> i64 {
    1
}

impl Default for Catalog {
    fn default() -> Self {
        Self {
            version: 1,
            books: Vec::new(),
            next_id: 1,
            linked_folders: Vec::new(),
        }
    }
}

impl Catalog {
    /// Load from disk, or start empty. A corrupt catalog is *not* fatal: it is
    /// logged and replaced, because refusing to launch would strand every book.
    #[cfg(test)]
    pub fn load(path: &Path) -> Self {
        match std::fs::read(path) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|err| {
                log::warn!("local catalog unreadable ({err}); starting empty");
                Catalog::default()
            }),
            Err(_) => Catalog::default(),
        }
    }

    fn find(&self, id: i64) -> Option<&LocalBook> {
        self.books.iter().find(|b| b.id == id)
    }
}

/* ------------------------------------------------------------------ paths */

fn books_dir(state: &AppState) -> PathBuf {
    state.library_dir.join("books")
}

fn covers_dir(state: &AppState) -> PathBuf {
    state.library_dir.join("covers")
}

/// Resolve a catalog-relative path against the library root.
fn resolve(state: &AppState, rel: &str) -> PathBuf {
    state.library_dir.join(rel)
}

/// Write a catalog snapshot atomically (`.tmp` + rename), so a crash mid-write
/// can never leave a half-written library index behind.
#[cfg(test)]
async fn write_catalog_snapshot(path: &Path, snapshot: &Catalog) -> ApiResult<()> {
    let bytes =
        serde_json::to_vec_pretty(snapshot).map_err(|err| ApiError::local(format!("serialize catalog: {err}")))?;
    let tmp = path.with_extension("tmp");
    tokio::fs::write(&tmp, bytes).await?;
    tokio::fs::rename(&tmp, path).await?;
    Ok(())
}

/// Mutate the in-memory catalog and persist under the catalog write lock.
/// Concurrent callers serialize: each snapshot includes all prior mutations,
/// so progress + favorite + cover cannot clobber each other out of order.
async fn mutate_catalog<R>(state: &AppState, f: impl FnOnce(&mut Catalog) -> R) -> ApiResult<R> {
    let _write = state.catalog_write.lock().await;
    let (result, before, snapshot) = {
        let mut catalog = state.catalog.lock().await;
        let before = catalog.clone();
        let result = f(&mut catalog);
        (result, before, catalog.clone())
    };
    state
        .catalog_store
        .persist(&before, &snapshot)
        .map_err(|err| ApiError::local(format!("persist catalog: {err}")))?;
    Ok(result)
}

/// Snapshot + write while the caller already holds `catalog_write`.
async fn save_under_write_lock(state: &AppState) -> ApiResult<()> {
    let snapshot = state.catalog.lock().await.clone();
    let before = state
        .catalog_store
        .load()
        .map_err(|err| ApiError::local(format!("load catalog before write: {err}")))?;
    state
        .catalog_store
        .persist(&before, &snapshot)
        .map_err(|err| ApiError::local(format!("persist catalog: {err}")))
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// A short, collision-free stem for an app-owned file. Not a real UUID — it
/// only has to be unique within one library directory, and hashing a nanosecond
/// clock plus a process-local counter covers that without a new dependency.
fn new_uid() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let mut hasher = Sha256::new();
    hasher.update(nanos.to_le_bytes());
    hasher.update(n.to_le_bytes());
    hex::encode(hasher.finalize())[..24].to_string()
}

/// Streaming SHA-256 of a file — bounded memory even for multi-GB PDFs. Used
/// for duplicate detection: re-importing the same bytes dedupes to the existing
/// record instead of creating a second copy.
fn content_hash(path: &Path) -> ApiResult<String> {
    use std::io::Read;
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

/// Stable hash for a linked image folder, independent of directory entry order.
fn image_folder_hash(path: &Path) -> ApiResult<String> {
    let mut hasher = Sha256::new();
    for name in folder_page_names(path)? {
        hasher.update(name.as_bytes());
        let mut file = std::fs::File::open(path.join(&name))?;
        let mut buf = [0u8; 64 * 1024];
        loop {
            let n = std::io::Read::read(&mut file, &mut buf)?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
        }
    }
    Ok(hex::encode(hasher.finalize()))
}

fn display_title(path: &Path) -> String {
    path.file_stem()
        .or_else(|| path.file_name())
        .and_then(|s| s.to_str())
        .unwrap_or("Untitled")
        .to_string()
}

/// Normalized, dotless, lowercase extension of a path (`""` when absent).
fn ext_of(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default()
}

/// Comics are page-addressed archives; everything else is a book.
fn media_type_for(ext: &str) -> &'static str {
    match ext {
        "cbz" | "cbr" | "cb7" | "folder" | "zip" | "rar" => "comic",
        _ => "book",
    }
}

/// Content type for a file we serve out of the library, by extension.
pub fn content_type_for(ext: &str) -> &'static str {
    match ext {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "epub" => "application/epub+zip",
        "pdf" => "application/pdf",
        "cbz" | "zip" => "application/zip",
        "cb7" => "application/x-7z-compressed",
        _ => "application/octet-stream",
    }
}

/// What "Add books" will accept. CBR is included: it imports and shelves fine,
/// and only *reading* it locally is unsupported (no unrar) — an honest message
/// at open time beats refusing the file at the picker with no explanation.
const IMPORTABLE_EXTS: [&str; 7] = ["epub", "pdf", "cbz", "cbr", "cb7", "mobi", "azw3"];

/// Whether a path is a supported book file or a plain image folder.
pub fn is_supported_book_path(path: &std::path::Path) -> bool {
    if path.is_dir() {
        return is_image_folder(path);
    }
    if !path.is_file() {
        return false;
    }
    let ext = ext_of(path);
    IMPORTABLE_EXTS.contains(&ext.as_str())
}

/* -------------------------------------------------------------- commands */

/// Every book in the local library. Linked books get a derived `missing` flag
/// when their external file has gone away (so the UI can offer Locate/Remove).
#[tauri::command]
pub async fn local_list(state: State<'_, AppState>) -> Result<Vec<LocalBook>, ApiError> {
    let mut books = state.catalog.lock().await.books.clone();
    for book in books.iter_mut() {
        if book.source.as_deref() == Some("linked") {
            let exists = book
                .external_path
                .as_ref()
                .map(|p| std::path::Path::new(p).exists())
                .unwrap_or(false);
            book.missing = !exists;
        }
    }
    Ok(books)
}

/// Normalize a path that may arrive as a `file://` URL (Open In / share sheet)
/// or as a plain filesystem path (document picker).
fn import_source_path(raw: &str) -> PathBuf {
    let trimmed = raw.trim();
    if trimmed.starts_with("file:") {
        if let Ok(url) = url::Url::parse(trimmed) {
            if let Ok(path) = url.to_file_path() {
                return path;
            }
        }
    }
    PathBuf::from(trimmed)
}

/// Per-file import outcome: what was added vs skipped/failed, so the frontend
/// can report every file without one bad file blocking the rest.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub added: Vec<LocalBook>,
    pub skipped: Vec<ImportNote>,
    pub failed: Vec<ImportNote>,
}

/// One file that did not import, with the reason.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportNote {
    pub path: String,
    pub reason: String,
}

/// Live progress of a batch import, emitted per file.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgress {
    pub done: u64,
    pub total: u64,
    pub current: String,
}

/// Depth cap for recursive folder scans. Deep enough for real trees, shallow
/// enough that an accidental giant folder doesn't hang the import.
const SCAN_MAX_DEPTH: usize = 8;
/// Hard cap on files collected by a scan, so a folder with tens of thousands of
/// entries surfaces a "too many" preview instead of walking everything.
const SCAN_MAX_FILES: usize = 2000;

/// Result of scanning a directory for books (the recursive-import preview).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderScan {
    /// Supported book files found, in walk order.
    pub supported: Vec<String>,
    /// Files found that aren't a supported format.
    pub unsupported: Vec<String>,
    /// Whether the walk hit the depth or file cap (preview may be partial).
    pub truncated: bool,
}

/// Walk a directory tree collecting supported book files (no import — this is
/// the "Found 214 supported files, 3 unsupported" preview).
fn walk_folder(root: &Path) -> FolderScan {
    if is_image_folder(root) {
        return FolderScan {
            supported: vec![root.to_string_lossy().into_owned()],
            unsupported: Vec::new(),
            truncated: false,
        };
    }
    let mut supported = Vec::new();
    let mut unsupported = Vec::new();
    let mut truncated = false;
    let mut stack: Vec<(PathBuf, usize)> = vec![(root.to_path_buf(), 0)];
    while let Some((dir, depth)) = stack.pop() {
        if depth >= SCAN_MAX_DEPTH {
            truncated = true;
            continue;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(ft) = entry.file_type() else { continue };
            if ft.is_dir() {
                if is_image_folder(&path) {
                    if supported.len() + unsupported.len() < SCAN_MAX_FILES {
                        supported.push(path.to_string_lossy().into_owned());
                    } else {
                        truncated = true;
                    }
                } else if depth + 1 < SCAN_MAX_DEPTH {
                    stack.push((path, depth + 1));
                } else {
                    truncated = true;
                }
            } else if ft.is_file() {
                if supported.len() + unsupported.len() >= SCAN_MAX_FILES {
                    truncated = true;
                    break;
                }
                if is_supported_book_path(&path) {
                    supported.push(path.to_string_lossy().into_owned());
                } else {
                    unsupported.push(path.to_string_lossy().into_owned());
                }
            }
        }
    }
    FolderScan {
        supported,
        unsupported,
        truncated,
    }
}

/// Preview a directory: list the supported book files a recursive import would
/// add, plus what it would skip. The frontend shows this before confirming.
#[tauri::command]
pub async fn local_scan_folder(dir: String) -> Result<FolderScan, ApiError> {
    let root = import_source_path(&dir);
    if !root.is_dir() {
        return Err(ApiError::local("Not a folder"));
    }
    tokio::task::spawn_blocking(move || walk_folder(&root))
        .await
        .map_err(|err| ApiError::local(format!("folder scan panicked: {err}")))
}

/// Ask the in-flight import to stop after the current file. Best-effort:
/// an import that is already done ignores it.
#[tauri::command]
pub fn local_cancel_import(state: State<'_, AppState>) {
    state.import_cancel.store(true, std::sync::atomic::Ordering::SeqCst);
}

/// Copy files into the library and catalog them.
///
/// Copying (rather than referencing in place) is deliberate: an imported file
/// may live behind a security-scoped URL that is only valid for this one pick,
/// so a stored reference would read fine today and fail on the next launch.
/// Same rule applies to Open In / share-sheet URLs from Files.
///
/// Per-file, never batch-fatal: an unsupported, unreadable, or corrupt file is
/// reported in the result and skipped, while the rest still import. A file that
/// fails never leaves a partial catalog row — it is not catalogued at all.
/// Progress event name; payload is `{ done, total, current }`.
const IMPORT_PROGRESS_EVENT: &str = "shelf://local-import-progress";

#[tauri::command]
pub async fn local_import<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<ImportReport, ApiError> {
    tokio::fs::create_dir_all(books_dir(&state)).await?;
    tokio::fs::create_dir_all(covers_dir(&state)).await?;

    // Fresh batch → clear any previous cancel so a stale flag can't abort it.
    state.import_cancel.store(false, Ordering::SeqCst);

    let mut report = ImportReport {
        added: Vec::new(),
        skipped: Vec::new(),
        failed: Vec::new(),
    };
    let total = paths.len();
    for (done, raw) in paths.into_iter().enumerate() {
        // Cooperatively cancel a large recursive import at a file boundary.
        if state.import_cancel.load(Ordering::SeqCst) {
            report.skipped.push(ImportNote {
                path: "…".into(),
                reason: "Import cancelled.".into(),
            });
            break;
        }
        let _ = app.emit(
            IMPORT_PROGRESS_EVENT,
            ImportProgress {
                done: done as u64,
                total: total as u64,
                current: raw.clone(),
            },
        );
        let src = import_source_path(&raw);
        let ext = ext_of(&src);

        let is_folder = src.is_dir() && is_image_folder(&src);
        if src.is_dir() && !is_folder {
            report.skipped.push(ImportNote {
                path: raw.clone(),
                reason: "Folder has no direct image pages.".into(),
            });
            continue;
        }
        // The picker is unfiltered (see `pickAndImportBooks`), so this is where
        // "is that a book?" is actually decided.
        if !IMPORTABLE_EXTS.contains(&ext.as_str()) {
            report.skipped.push(ImportNote {
                path: raw.clone(),
                reason: "Not a supported book format (EPUB, PDF, CBZ, CBR, CB7, MOBI, AZW3) or image folder.".into(),
            });
            continue;
        }
        let title = display_title(&src);

        // Duplicate detection: hash the source (bounded memory) and skip if a
        // book with the same bytes is already in the catalog — re-importing the
        // same file must not create a second copy.
        let src_for_hash = src.clone();
        let hash = tokio::task::spawn_blocking(move || {
            if is_folder {
                image_folder_hash(&src_for_hash)
            } else {
                content_hash(&src_for_hash)
            }
        })
        .await
        .map_err(|err| ApiError::local(format!("hash panicked: {err}")))?;
        let hash = match hash {
            Ok(h) => h,
            Err(err) => {
                report.failed.push(ImportNote {
                    path: raw.clone(),
                    reason: format!("Could not read the file: {}", err.message),
                });
                continue;
            }
        };
        {
            let catalog = state.catalog.lock().await;
            if catalog.books.iter().any(|b| b.content_hash.as_deref() == Some(&hash)) {
                report.skipped.push(ImportNote {
                    path: raw.clone(),
                    reason: "Already in your library — skipped as a duplicate.".into(),
                });
                continue;
            }
        }

        let uid = new_uid();
        // MOBI/KF8 is converted once at import time so the reader only needs
        // to understand EPUB/PDF/comics. The original source is never
        // modified and DRM is never bypassed.
        let storage_ext = if is_folder {
            "cbz"
        } else if ext == "mobi" || ext == "azw3" {
            "epub"
        } else {
            ext.as_str()
        };
        let rel = format!("books/{uid}.{storage_ext}");
        let dest = resolve(&state, &rel);
        let write_result = if is_folder {
            let source = src.clone();
            let destination = dest.clone();
            tokio::task::spawn_blocking(move || pack_image_folder_to_zip(&source, &destination))
                .await
                .map_err(|err| ApiError::local(format!("image-folder pack panicked: {err}")))?
        } else if ext == "mobi" || ext == "azw3" {
            let source = src.clone();
            let converted = tokio::task::spawn_blocking(move || crate::mobi_import::to_epub(&source))
                .await
                .map_err(|err| ApiError::local(format!("MOBI conversion panicked: {err}")))?;
            match converted {
                Ok(bytes) => tokio::fs::write(&dest, bytes).await.map_err(ApiError::from),
                Err(err) => Err(err),
            }
        } else {
            tokio::fs::copy(&src, &dest).await.map(|_| ()).map_err(ApiError::from)
        };
        if let Err(err) = write_result {
            report.failed.push(ImportNote {
                path: raw.clone(),
                reason: if ext == "mobi" || ext == "azw3" {
                    err.message
                } else {
                    format!("Could not copy the file: {err}")
                },
            });
            continue;
        }
        let bytes = tokio::fs::metadata(&dest).await.map(|m| m.len()).unwrap_or(0);

        let mut book = LocalBook {
            id: 0, // assigned below, under the lock
            title,
            authors: Vec::new(),
            description: None,
            language: None,
            publisher: None,
            published_at: None,
            file: rel,
            cover: None,
            ext: storage_ext.to_string(),
            media_type: media_type_for(storage_ext).to_string(),
            page_count: 0,
            bytes,
            added_at: now_ms(),
            origin: None,
            progress: Progress::default(),
            favorited: false,
            content_hash: Some(hash.clone()),
            series: None,
            volume: None,
            tags: Vec::new(),
            collections: Vec::new(),
            source: None,
            external_path: None,
            missing: false,
            acquired_from: None,
        };

        let heuristic = crate::metadata::filename_heuristics(&raw);
        if heuristic.volume.is_some() {
            if let Some(title) = heuristic.title {
                book.title = title;
            }
            book.series = heuristic.series;
            book.volume = heuristic.volume;
        }

        let metadata_path = dest.clone();
        let metadata_ext = storage_ext.to_string();
        if let Ok(Ok(metadata)) =
            tokio::task::spawn_blocking(move || crate::metadata::extract(&metadata_path, &metadata_ext)).await
        {
            if let Some(title) = metadata.title {
                book.title = title;
            }
            book.authors = metadata.authors;
            book.description = metadata.description;
            book.language = metadata.language;
            book.publisher = metadata.publisher;
            book.published_at = metadata.published_at;
            if book.series.is_none() {
                book.series = metadata.series;
            }
            if book.volume.is_none() {
                book.volume = metadata.volume;
            }
        }

        if storage_ext == "epub" {
            let cover_path = dest.clone();
            if let Ok(Ok(Some((cover_bytes, cover_ext)))) =
                tokio::task::spawn_blocking(move || crate::metadata::extract_epub_cover(&cover_path)).await
            {
                let rel_cover = format!("covers/{}.{}", hash, cover_ext);
                if tokio::fs::write(resolve(&state, &rel_cover), cover_bytes).await.is_ok() {
                    book.cover = Some(rel_cover);
                }
            }
        }

        // A CBZ/CBR carries its own cover and page count; extract both now so
        // the shelf is complete the moment the import finishes. EPUB and PDF
        // covers are rendered client-side later (see `save_local_cover`) —
        // keeping those renderers out of Rust is the whole reason this split
        // exists. RAR (CBR) reads only page headers + the cover entry on demand.
        if book.media_type == "comic"
            && (storage_ext == "cbz" || storage_ext == "cb7" || (storage_ext == "cbr" && cfg!(desktop)))
        {
            let path = dest.clone();
            let hash2 = hash.clone();
            let covers = covers_dir(&state);
            let ext = storage_ext.to_string();
            let extracted = tokio::task::spawn_blocking(move || -> ApiResult<(i64, Option<String>)> {
                let names = page_names(&path, &ext)?;
                let count = names.len() as i64;
                let cover = match names.first() {
                    Some(first) => {
                        let bytes = entry_bytes(&path, &ext, first)?;
                        let cext = ext_of(Path::new(first));
                        let cext = if cext.is_empty() { "jpg".into() } else { cext };
                        std::fs::write(covers.join(format!("{hash2}.{cext}")), bytes)?;
                        Some(format!("covers/{hash2}.{cext}"))
                    }
                    None => None,
                };
                Ok((count, cover))
            })
            .await
            .map_err(|err| ApiError::local(format!("archive read panicked: {err}")))?;
            match extracted {
                Ok((count, cover)) => {
                    book.page_count = count;
                    book.cover = cover;
                }
                // A corrupt archive is a per-file failure: it must not leave a
                // catalog row pointing at an unreadable file. Clean up the copy.
                Err(err) => {
                    let _ = tokio::fs::remove_file(&dest).await;
                    report.failed.push(ImportNote {
                        path: raw.clone(),
                        reason: format!("Not a readable comic archive: {}", err.message),
                    });
                    continue;
                }
            }
        }

        let pushed = mutate_catalog(&state, |catalog| {
            book.id = catalog.next_id;
            catalog.next_id += 1;
            catalog.books.push(book.clone());
            book.clone()
        })
        .await?;
        crate::local_search::invalidate_index(&state);
        report.added.push(pushed);
    }

    // New books are searchable without the user asking: start the background
    // index pass as soon as the batch lands.
    crate::local_search::kick(&app, &state);
    Ok(report)
}

/// Remove a book and its files. Returns bytes freed.
#[tauri::command]
pub async fn local_delete(state: State<'_, AppState>, id: i64) -> Result<u64, ApiError> {
    let removed = {
        let _write = state.catalog_write.lock().await;
        let removed = {
            let mut catalog = state.catalog.lock().await;
            match catalog.books.iter().position(|b| b.id == id) {
                Some(idx) => catalog.books.remove(idx),
                None => return Ok(0),
            }
        };
        save_under_write_lock(&state).await?;
        removed
    };

    let mut freed = 0;
    for rel in [Some(removed.file.clone()), removed.cover.clone()]
        .into_iter()
        .flatten()
    {
        let path = resolve(&state, &rel);
        if let Ok(meta) = tokio::fs::metadata(&path).await {
            freed += meta.len();
        }
        let _ = tokio::fs::remove_file(&path).await;
    }
    crate::local_search::invalidate_index(&state);
    Ok(freed)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    comic_id: i64,
    received: u64,
    total: Option<u64>,
    done: bool,
}

/// Download a server book into the local library.
///
/// Streamed chunk-by-chunk to disk — a 500 MB scan must never be buffered in
/// memory, which is exactly the failure that motivated this whole design. The
/// file lands via a `.part` rename so an interrupted download is never
/// catalogued as a complete book.
#[tauri::command]
pub async fn local_download<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    comic_id: i64,
    title: String,
    ext: String,
    media_type: String,
    page_count: i64,
) -> Result<LocalBook, ApiError> {
    let server = state.server_url().await?;
    let origin = Origin {
        server: server.clone(),
        comic_id,
    };

    // Already have it? Downloading twice would just burn bandwidth and produce
    // a duplicate shelf entry. Still emit a terminal progress event so any UI
    // that called `start` can clear its progress bar.
    if let Some(existing) = state
        .catalog
        .lock()
        .await
        .books
        .iter()
        .find(|b| b.origin.as_ref() == Some(&origin))
    {
        let _ = app.emit(
            PROGRESS_EVENT,
            DownloadProgress {
                comic_id,
                received: existing.bytes,
                total: Some(existing.bytes),
                done: true,
            },
        );
        return Ok(existing.clone());
    }

    tokio::fs::create_dir_all(books_dir(&state)).await?;
    tokio::fs::create_dir_all(covers_dir(&state)).await?;

    let ext = if ext.is_empty() {
        "bin".to_string()
    } else {
        ext.to_ascii_lowercase()
    };
    let uid = new_uid();
    let rel = format!("books/{uid}.{ext}");
    let dest = resolve(&state, &rel);
    let part = dest.with_extension("part");

    let response = state
        .client
        .get(format!("{server}/api/comics/{comic_id}/file"))
        .header(reqwest::header::ORIGIN, server.clone())
        .send()
        .await?;
    if !response.status().is_success() {
        return Err(ApiError::status(
            response.status().as_u16(),
            "Could not download this book",
        ));
    }
    let total = response.content_length();

    let mut file = tokio::fs::File::create(&part).await?;
    let mut stream = response.bytes_stream();
    let mut received: u64 = 0;
    let mut since_emit: u64 = 0;
    // Announce immediately so the UI can show a progress track (indeterminate
    // until Content-Length is known / first chunk lands).
    let _ = app.emit(
        PROGRESS_EVENT,
        DownloadProgress {
            comic_id,
            received: 0,
            total,
            done: false,
        },
    );
    // ~256 KiB ticks — responsive bar without flooding the webview.
    const EMIT_EVERY: u64 = 256 * 1024;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(ApiError::from)?;
        file.write_all(&chunk).await?;
        received += chunk.len() as u64;
        since_emit += chunk.len() as u64;
        if since_emit >= EMIT_EVERY {
            since_emit = 0;
            let _ = app.emit(
                PROGRESS_EVENT,
                DownloadProgress {
                    comic_id,
                    received,
                    total,
                    done: false,
                },
            );
        }
    }
    file.flush().await?;
    drop(file);
    tokio::fs::rename(&part, &dest).await?;

    // The server already has a cover; taking it is cheaper and better than
    // re-deriving one, and it means a downloaded book looks right immediately.
    let cover = fetch_cover(&state, &server, comic_id, &uid).await;

    let mut book = LocalBook {
        id: 0,
        title,
        authors: Vec::new(),
        description: None,
        language: None,
        publisher: None,
        published_at: None,
        file: rel,
        cover,
        ext: ext.clone(),
        media_type: if media_type.is_empty() {
            media_type_for(&ext).to_string()
        } else {
            media_type
        },
        page_count,
        bytes: received,
        added_at: now_ms(),
        origin: Some(origin),
        progress: Progress::default(),
        favorited: false,
        content_hash: None, // filled below once the file is finalized
        series: None,
        volume: None,
        tags: Vec::new(),
        collections: Vec::new(),
        source: None,
        external_path: None,
        missing: false,
        acquired_from: None,
    };

    // Hash the finalized file so a download dedupes against a locally-imported
    // copy of the same book.
    {
        let path = dest.clone();
        book.content_hash = tokio::task::spawn_blocking(move || content_hash(&path))
            .await
            .ok()
            .and_then(Result::ok);
    }

    // A downloaded CBZ/CBR's real page count comes from the archive; the
    // server's number is a fine default but the local reader pages the file
    // itself. CBR count is desktop-only (no RAR backend on mobile).
    if book.ext == "cbz" || book.ext == "cb7" || (book.ext == "cbr" && cfg!(desktop)) {
        let path = dest.clone();
        let ext = book.ext.clone();
        if let Ok(Ok(names)) = tokio::task::spawn_blocking(move || page_names(&path, &ext)).await {
            if !names.is_empty() {
                book.page_count = names.len() as i64;
            }
        }
    }

    {
        let _write = state.catalog_write.lock().await;
        {
            let mut catalog = state.catalog.lock().await;
            book.id = catalog.next_id;
            catalog.next_id += 1;
            catalog.books.push(book.clone());
        }
        save_under_write_lock(&state).await?;
    }

    let _ = app.emit(
        PROGRESS_EVENT,
        DownloadProgress {
            comic_id,
            received,
            total: Some(received),
            done: true,
        },
    );
    Ok(book)
}

/// Best-effort cover fetch for a downloaded book. A missing cover is cosmetic —
/// the typographic fallback stands in — so every failure here is swallowed.
async fn fetch_cover(state: &AppState, server: &str, comic_id: i64, uid: &str) -> Option<String> {
    let response = state
        .client
        .get(format!("{server}/api/comics/{comic_id}/thumbnail?width=480"))
        .header(reqwest::header::ORIGIN, server.to_string())
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let ext = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .and_then(|ct| match ct.split(';').next()?.trim() {
            "image/png" => Some("png"),
            "image/webp" => Some("webp"),
            "image/gif" => Some("gif"),
            "image/jpeg" => Some("jpg"),
            _ => None,
        })
        .unwrap_or("jpg");
    let bytes = response.bytes().await.ok()?;
    if bytes.is_empty() {
        return None;
    }
    let rel = format!("covers/{uid}.{ext}");
    tokio::fs::write(state.library_dir.join(&rel), &bytes).await.ok()?;
    Some(rel)
}

/// Destination for an incoming app-owned file (`books/<uid>.<ext>`).
pub(crate) async fn prepare_owned_dest(state: &AppState, ext: &str) -> ApiResult<(String, PathBuf)> {
    tokio::fs::create_dir_all(books_dir(state)).await?;
    tokio::fs::create_dir_all(covers_dir(state)).await?;
    let uid = new_uid();
    let rel = format!("books/{uid}.{ext}");
    let dest = resolve(state, &rel);
    Ok((rel, dest))
}

/// Write cover bytes into the covers dir. Failures are cosmetic.
pub(crate) async fn write_cover_bytes(state: &AppState, bytes: &[u8], ext: &str) -> Option<String> {
    if bytes.is_empty() {
        return None;
    }
    let uid = new_uid();
    let ext = if ext.is_empty() { "jpg" } else { ext };
    let rel = format!("covers/{uid}.{ext}");
    tokio::fs::write(state.library_dir.join(&rel), bytes).await.ok()?;
    Some(rel)
}

/// An already-on-disk app-owned file ready to be catalogued.
pub(crate) struct OwnedIngest {
    pub title: String,
    pub ext: String,
    pub rel: String,
    pub dest: PathBuf,
    pub bytes: u64,
    pub cover: Option<String>,
    pub acquired_from: Option<String>,
}

/// Result of cataloguing a downloaded/imported file.
pub(crate) struct Ingested {
    pub book: LocalBook,
    pub already_owned: bool,
}

/// Catalog an already-written app-owned book. Dedupes by `acquired_from` and
/// content hash: a match deletes the new copy and returns the existing record.
pub(crate) async fn catalog_owned_file(state: &AppState, ingest: OwnedIngest) -> ApiResult<Ingested> {
    let dest = ingest.dest;
    let mut book = LocalBook {
        id: 0,
        title: ingest.title,
        authors: Vec::new(),
        description: None,
        language: None,
        publisher: None,
        published_at: None,
        file: ingest.rel,
        cover: ingest.cover,
        ext: ingest.ext.clone(),
        media_type: media_type_for(&ingest.ext).to_string(),
        page_count: 0,
        bytes: ingest.bytes,
        added_at: now_ms(),
        origin: None,
        progress: Progress::default(),
        favorited: false,
        content_hash: None,
        series: None,
        volume: None,
        tags: Vec::new(),
        collections: Vec::new(),
        source: None,
        external_path: None,
        missing: false,
        acquired_from: ingest.acquired_from.clone(),
    };

    let heuristic = crate::metadata::filename_heuristics(&book.title);
    if heuristic.volume.is_some() {
        book.series = heuristic.series;
        book.volume = heuristic.volume;
    }

    let metadata_path = dest.clone();
    let metadata_ext = book.ext.clone();
    if let Ok(Ok(metadata)) =
        tokio::task::spawn_blocking(move || crate::metadata::extract(&metadata_path, &metadata_ext)).await
    {
        if let Some(title) = metadata.title {
            book.title = title;
        }
        book.authors = metadata.authors;
        book.description = metadata.description;
        book.language = metadata.language;
        book.publisher = metadata.publisher;
        book.published_at = metadata.published_at;
        book.series = metadata.series;
        book.volume = metadata.volume;
    }

    {
        let path = dest.clone();
        book.content_hash = tokio::task::spawn_blocking(move || content_hash(&path))
            .await
            .ok()
            .and_then(Result::ok);
    }

    if book.ext == "cbz" || (book.ext == "cbr" && cfg!(desktop)) {
        let path = dest.clone();
        let ext = book.ext.clone();
        if let Ok(Ok(names)) = tokio::task::spawn_blocking(move || page_names(&path, &ext)).await {
            if !names.is_empty() {
                book.page_count = names.len() as i64;
            }
        }
    }

    // Hash (or acquired-from) already in the catalog → drop the new copy.
    {
        let catalog = state.catalog.lock().await;
        let existing = catalog.books.iter().find(|b| {
            (book.content_hash.is_some() && b.content_hash == book.content_hash)
                || (ingest.acquired_from.is_some() && b.acquired_from == ingest.acquired_from)
        });
        if let Some(existing) = existing {
            let existing = existing.clone();
            drop(catalog);
            let _ = tokio::fs::remove_file(&dest).await;
            if let Some(cover) = &book.cover {
                let _ = tokio::fs::remove_file(resolve(state, cover)).await;
            }
            return Ok(Ingested {
                book: existing,
                already_owned: true,
            });
        }
    }

    let pushed = mutate_catalog(state, |catalog| {
        book.id = catalog.next_id;
        catalog.next_id += 1;
        catalog.books.push(book.clone());
        book.clone()
    })
    .await?;
    crate::local_search::invalidate_index(state);
    Ok(Ingested {
        book: pushed,
        already_owned: false,
    })
}

pub(crate) async fn find_by_acquired_from(state: &AppState, href: &str) -> Option<LocalBook> {
    state
        .catalog
        .lock()
        .await
        .books
        .iter()
        .find(|b| b.acquired_from.as_deref() == Some(href))
        .cloned()
}

pub(crate) fn is_importable_ext(ext: &str) -> bool {
    IMPORTABLE_EXTS.contains(&ext)
}

/// Byte length of a local book file — the first thing the PDF range reader asks.
#[tauri::command]
pub async fn local_file_length(state: State<'_, AppState>, id: i64) -> Result<u64, ApiError> {
    let path = book_path(&state, id).await?;
    Ok(tokio::fs::metadata(&path).await?.len())
}

/// Read the half-open `[begin, end)` range of a local book, clamped at EOF.
#[tauri::command]
pub async fn local_read_range(
    state: State<'_, AppState>,
    id: i64,
    begin: u64,
    end: u64,
) -> Result<tauri::ipc::Response, ApiError> {
    if end <= begin {
        return Ok(tauri::ipc::Response::new(Vec::new()));
    }
    let path = book_path(&state, id).await?;
    let mut file = tokio::fs::File::open(&path).await?;
    file.seek(SeekFrom::Start(begin)).await?;
    let want = (end - begin) as usize;
    let mut buf = vec![0u8; want];
    let mut filled = 0;
    while filled < want {
        let n = file.read(&mut buf[filled..]).await?;
        if n == 0 {
            break;
        }
        filled += n;
    }
    buf.truncate(filled);
    Ok(tauri::ipc::Response::new(buf))
}

/// Number of pages in a local comic; cached back into the catalog on first ask.
#[tauri::command]
pub async fn local_page_count(state: State<'_, AppState>, id: i64) -> Result<i64, ApiError> {
    let book = get_book(&state, id).await?;
    if book.page_count > 0 {
        return Ok(book.page_count);
    }
    let path = book_disk_path(&state, &book)?;
    let ext = book.ext.clone();
    let names = tokio::task::spawn_blocking(move || page_names(&path, &ext))
        .await
        .map_err(|err| ApiError::local(format!("archive read panicked: {err}")))??;
    let count = names.len() as i64;
    mutate_catalog(&state, |catalog| {
        if let Some(entry) = catalog.books.iter_mut().find(|b| b.id == id) {
            entry.page_count = count;
        }
    })
    .await?;
    Ok(count)
}

/// Raw bytes of page `index` of a local comic, plus its content type.
/// Also the engine behind the proxy's `/local/<id>/page/<n>` route.
///
/// CBZ and CBR share one page pipeline; `local_zip::page_names` /
/// `entry_bytes` dispatch to the right archive backend. CBR is desktop-only —
/// mobile has no RAR backend, so it still reports the server-only message.
pub async fn read_page(state: &AppState, id: i64, index: usize) -> ApiResult<(Vec<u8>, String)> {
    let book = get_book(state, id).await?;
    if book.ext == "cbr" && !cfg!(desktop) {
        return Err(ApiError::local(
            "CBR comics can only be read from a server — this device can't unpack RAR.",
        ));
    }
    let path = book_disk_path(state, &book)?;
    let ext = book.ext.clone();
    tokio::task::spawn_blocking(move || {
        let names = page_names(&path, &ext)?;
        let name = names.get(index).ok_or_else(|| ApiError::local("No such page"))?.clone();
        let bytes = entry_bytes(&path, &ext, &name)?;
        let ct = content_type_for(&ext_of(Path::new(&name))).to_string();
        Ok((bytes, ct))
    })
    .await
    .map_err(|err| ApiError::local(format!("archive read panicked: {err}")))?
}

/// Cover bytes + content type for a local book, if one has been extracted.
pub async fn read_cover(state: &AppState, id: i64) -> ApiResult<(Vec<u8>, String)> {
    let book = get_book(state, id).await?;
    let rel = book.cover.ok_or_else(|| ApiError::local("No cover yet"))?;
    let path = resolve(state, &rel);
    let bytes = tokio::fs::read(&path).await?;
    Ok((bytes, content_type_for(&ext_of(&path)).to_string()))
}

/// Whole-file bytes + content type (EPUB: epub.js wants the archive in one go).
pub async fn read_file(state: &AppState, id: i64) -> ApiResult<(Vec<u8>, String)> {
    let book = get_book(state, id).await?;
    let path = book_disk_path(state, &book)?;
    let bytes = tokio::fs::read(&path).await?;
    Ok((bytes, content_type_for(&book.ext).to_string()))
}

/// Record reading progress locally. Mirrors `PUT /api/comics/:id/progress`.
#[tauri::command]
pub async fn local_set_progress(
    state: State<'_, AppState>,
    id: i64,
    page: Option<i64>,
    location: Option<String>,
    percent: Option<f64>,
) -> Result<(), ApiError> {
    mutate_catalog(&state, |catalog| {
        let Some(book) = catalog.books.iter_mut().find(|b| b.id == id) else {
            return;
        };
        if page.is_some() {
            book.progress.page = page;
        }
        if location.is_some() {
            book.progress.location = location;
        }
        if percent.is_some() {
            book.progress.percent = percent;
        }
        book.progress.read_at = Some(now_ms());
    })
    .await
}

/// Clear a local book's position entirely (the "mark unread" path).
#[tauri::command]
pub async fn local_clear_progress(state: State<'_, AppState>, id: i64) -> Result<(), ApiError> {
    mutate_catalog(&state, |catalog| {
        if let Some(book) = catalog.books.iter_mut().find(|b| b.id == id) {
            book.progress = Progress::default();
        }
    })
    .await
}

#[tauri::command]
pub async fn local_set_favorite(state: State<'_, AppState>, id: i64, favorited: bool) -> Result<(), ApiError> {
    mutate_catalog(&state, |catalog| {
        if let Some(book) = catalog.books.iter_mut().find(|b| b.id == id) {
            book.favorited = favorited;
        }
    })
    .await
}

/// Set series / volume / tags on a local book. `series`/`volume` null clears
/// them; `tags` replaces the full set. User edits are overrides that survive a
/// rescan (nothing here rewrites them from the file).
#[tauri::command]
pub async fn local_set_metadata(
    state: State<'_, AppState>,
    id: i64,
    title: Option<String>,
    authors: Vec<String>,
    series: Option<String>,
    volume: Option<String>,
    tags: Vec<String>,
) -> Result<(), ApiError> {
    let cleaned: Vec<String> = tags
        .into_iter()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();
    let cleaned_authors: Vec<String> = authors
        .into_iter()
        .map(|a| a.trim().to_string())
        .filter(|a| !a.is_empty())
        .collect();
    mutate_catalog(&state, |catalog| {
        if let Some(book) = catalog.books.iter_mut().find(|b| b.id == id) {
            if let Some(title) = title.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
                book.title = title.to_string();
            }
            book.authors = cleaned_authors.clone();
            book.series = series.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
            book.volume = volume.map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
            book.tags = cleaned.clone();
        }
    })
    .await
}

/// Add or remove a book from a named collection. Returns the book's updated
/// collection list so the UI can stay in sync without a full re-list.
#[tauri::command]
pub async fn local_toggle_collection(
    state: State<'_, AppState>,
    id: i64,
    collection: String,
    on: bool,
) -> Result<Vec<String>, ApiError> {
    let name = collection.trim().to_string();
    if name.is_empty() {
        return Ok(Vec::new());
    }
    mutate_catalog(&state, |catalog| {
        let Some(book) = catalog.books.iter_mut().find(|b| b.id == id) else {
            return Vec::new();
        };
        if on {
            if !book.collections.iter().any(|c| c == &name) {
                book.collections.push(name.clone());
            }
        } else {
            book.collections.retain(|c| c != &name);
        }
        book.collections.clone()
    })
    .await
}

/// List the user-attached (linked) folders read in place.
#[tauri::command]
pub async fn local_linked_folders(state: State<'_, AppState>) -> Result<Vec<LinkedFolder>, ApiError> {
    Ok(state.catalog.lock().await.linked_folders.clone())
}

/// Attach a folder and catalog every supported book inside it, read *in place*
/// (no copy). Each book gets a `linked` source + `external_path`; existing
/// linked books for the same file are replaced rather than duplicated.
#[tauri::command]
pub async fn local_add_linked_folder<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    path: String,
) -> Result<Vec<LocalBook>, ApiError> {
    let root = import_source_path(&path);
    if !root.is_dir() {
        return Err(ApiError::local("Not a folder"));
    }
    #[cfg(desktop)]
    crate::linked_watch::watch_folder(app.clone(), root.to_string_lossy().as_ref());
    let scan_root = root.clone();
    let scan = tokio::task::spawn_blocking(move || walk_folder(&scan_root))
        .await
        .map_err(|err| ApiError::local(format!("folder scan panicked: {err}")))?;

    let mut added = Vec::new();
    for file in &scan.supported {
        let file_path = file.clone();
        let is_folder = Path::new(&file_path).is_dir();
        let linked_ext = if is_folder {
            "folder".to_string()
        } else {
            ext_of(Path::new(&file_path))
        };
        let hash = tokio::task::spawn_blocking(move || {
            if is_folder {
                image_folder_hash(Path::new(&file_path))
            } else {
                content_hash(Path::new(&file_path))
            }
        })
        .await
        .ok()
        .and_then(Result::ok)
        .unwrap_or_default();
        let mut book = LocalBook {
            id: 0,
            title: display_title(Path::new(&file)),
            authors: Vec::new(),
            description: None,
            language: None,
            publisher: None,
            published_at: None,
            file: String::new(), // not app-owned
            cover: None,
            ext: linked_ext.clone(),
            media_type: media_type_for(&linked_ext).to_string(),
            page_count: 0,
            bytes: std::fs::metadata(file)
                .map(|m| if is_folder { 0 } else { m.len() })
                .unwrap_or(0),
            added_at: now_ms(),
            origin: None,
            progress: Progress::default(),
            favorited: false,
            content_hash: Some(hash),
            series: None,
            volume: None,
            tags: Vec::new(),
            collections: Vec::new(),
            source: Some("linked".into()),
            external_path: Some(file.clone()),
            missing: false,
            acquired_from: None,
        };
        let heuristic = crate::metadata::filename_heuristics(file);
        if heuristic.volume.is_some() {
            book.series = heuristic.series;
            book.volume = heuristic.volume;
        }
        let metadata_path = file.clone();
        let metadata_ext = book.ext.clone();
        if let Ok(Ok(metadata)) =
            tokio::task::spawn_blocking(move || crate::metadata::extract(Path::new(&metadata_path), &metadata_ext))
                .await
        {
            if let Some(title) = metadata.title {
                book.title = title;
            }
            book.authors = metadata.authors;
            book.description = metadata.description;
            book.language = metadata.language;
            book.publisher = metadata.publisher;
            book.published_at = metadata.published_at;
            book.series = metadata.series;
            book.volume = metadata.volume;
        }
        let pushed = mutate_catalog(&state, |catalog| {
            // Replace any existing linked book with the same external path so a
            // rescan never duplicates the same file.
            if let Some(idx) = catalog
                .books
                .iter()
                .position(|b| b.external_path.as_deref() == book.external_path.as_deref())
            {
                book.id = catalog.books[idx].id;
                book.added_at = catalog.books[idx].added_at;
                book.progress = catalog.books[idx].progress.clone();
                book.favorited = catalog.books[idx].favorited;
                book.title = catalog.books[idx].title.clone();
                book.authors = catalog.books[idx].authors.clone();
                book.description = catalog.books[idx].description.clone();
                book.language = catalog.books[idx].language.clone();
                book.publisher = catalog.books[idx].publisher.clone();
                book.published_at = catalog.books[idx].published_at.clone();
                book.series = catalog.books[idx].series.clone();
                book.volume = catalog.books[idx].volume.clone();
                book.tags = catalog.books[idx].tags.clone();
                book.collections = catalog.books[idx].collections.clone();
                book.cover = catalog.books[idx].cover.clone();
                book.origin = catalog.books[idx].origin.clone();
                let existing = &mut catalog.books[idx];
                *existing = book.clone();
            } else {
                book.id = catalog.next_id;
                catalog.next_id += 1;
                catalog.books.push(book.clone());
            }
            // Register the folder once.
            if !catalog.linked_folders.iter().any(|f| f.path == root.to_string_lossy()) {
                let fid = catalog.next_id;
                catalog.next_id += 1;
                catalog.linked_folders.push(LinkedFolder {
                    id: fid,
                    path: root.to_string_lossy().into_owned(),
                });
            }
            book.clone()
        })
        .await?;
        added.push(pushed);
    }
    crate::local_search::invalidate_index(&state);
    crate::local_search::kick(&app, &state);
    Ok(added)
}

/// Re-scan every linked folder: add books that appeared, refresh external
/// metadata, and mark ones that vanished (their `missing` flag shows at list
/// time). Returns the total books across linked folders after the scan.
#[tauri::command]
pub async fn local_rescan_linked_folders(state: State<'_, AppState>) -> Result<usize, ApiError> {
    let folders = state.catalog.lock().await.linked_folders.clone();
    let mut total = 0usize;
    for folder in folders {
        let path = folder.path.clone();
        let scan = tokio::task::spawn_blocking(move || walk_folder(Path::new(&path)))
            .await
            .map_err(|err| ApiError::local(format!("folder scan panicked: {err}")))?;
        for file in &scan.supported {
            let external = file.clone();
            let linked_ext = if Path::new(&external).is_dir() {
                "folder".to_string()
            } else {
                ext_of(Path::new(&external))
            };
            let mut book = LocalBook {
                id: 0,
                title: display_title(Path::new(&external)),
                authors: Vec::new(),
                description: None,
                language: None,
                publisher: None,
                published_at: None,
                file: String::new(),
                cover: None,
                ext: linked_ext.clone(),
                media_type: media_type_for(&linked_ext).to_string(),
                page_count: 0,
                bytes: std::fs::metadata(&external)
                    .map(|m| if Path::new(&external).is_dir() { 0 } else { m.len() })
                    .unwrap_or(0),
                added_at: now_ms(),
                origin: None,
                progress: Progress::default(),
                favorited: false,
                content_hash: None,
                series: None,
                volume: None,
                tags: Vec::new(),
                collections: Vec::new(),
                source: Some("linked".into()),
                external_path: Some(external.clone()),
                missing: false,
                acquired_from: None,
            };
            let heuristic = crate::metadata::filename_heuristics(&external);
            if heuristic.volume.is_some() {
                book.series = heuristic.series;
                book.volume = heuristic.volume;
            }
            let metadata_path = external.clone();
            let metadata_ext = book.ext.clone();
            if let Ok(Ok(metadata)) =
                tokio::task::spawn_blocking(move || crate::metadata::extract(Path::new(&metadata_path), &metadata_ext))
                    .await
            {
                if let Some(title) = metadata.title {
                    book.title = title;
                }
                book.authors = metadata.authors;
                book.description = metadata.description;
                book.language = metadata.language;
                book.publisher = metadata.publisher;
                book.published_at = metadata.published_at;
                book.series = metadata.series;
                book.volume = metadata.volume;
            }
            let hash_path = external.clone();
            let is_folder = Path::new(&hash_path).is_dir();
            let hash = tokio::task::spawn_blocking(move || {
                if is_folder {
                    image_folder_hash(Path::new(&hash_path))
                } else {
                    content_hash(Path::new(&hash_path))
                }
            })
            .await
            .ok()
            .and_then(Result::ok)
            .unwrap_or_default();
            book.content_hash = Some(hash);
            let external_ref = external.clone();
            mutate_catalog(&state, |catalog| {
                if let Some(idx) = catalog
                    .books
                    .iter()
                    .position(|b| b.external_path.as_deref() == Some(external_ref.as_str()))
                {
                    book.id = catalog.books[idx].id;
                    let existing = &mut catalog.books[idx];
                    // Keep user metadata + progress; refresh size/hash.
                    existing.bytes = book.bytes;
                    existing.content_hash = book.content_hash.clone();
                    existing.title = book.title.clone();
                    existing.authors = book.authors.clone();
                    existing.description = book.description.clone();
                    existing.language = book.language.clone();
                    existing.publisher = book.publisher.clone();
                    existing.published_at = book.published_at.clone();
                } else {
                    book.id = catalog.next_id;
                    catalog.next_id += 1;
                    catalog.books.push(book.clone());
                }
            })
            .await?;
            total += 1;
        }
        // Anything in this folder's linked set no longer on disk → the `missing`
        // flag is derived at list time; nothing is deleted, so the user can
        // Locate a book that merely moved.
    }
    if total > 0 {
        crate::local_search::invalidate_index(&state);
    }
    Ok(total)
}

/// Remove a linked folder and its books from the catalog. The files on disk
/// are untouched — the app only ever reads them in place.
#[tauri::command]
pub async fn local_remove_linked_folder<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    id: i64,
) -> Result<(), ApiError> {
    let folder_path = {
        let catalog = state.catalog.lock().await;
        catalog
            .linked_folders
            .iter()
            .find(|f| f.id == id)
            .map(|f| f.path.clone())
    };
    if let Some(path) = folder_path {
        #[cfg(desktop)]
        crate::linked_watch::unwatch_folder(&app, &path);
    }
    mutate_catalog(&state, |catalog| {
        let Some(folder) = catalog.linked_folders.iter().find(|f| f.id == id).cloned() else {
            return;
        };
        catalog.linked_folders.retain(|f| f.id != id);
        catalog.books.retain(|b| {
            !(b.source.as_deref() == Some("linked")
                && b.external_path.as_deref().is_some_and(|p| p.starts_with(&folder.path)))
        });
    })
    .await?;
    crate::local_search::invalidate_index(&state);
    // The removed folder's books must leave the search index too, or a hit
    // would open a book that is no longer on the shelf.
    crate::local_search::kick(&app, &state);
    Ok(())
}

/// Re-point a missing linked book at a new file (Locate). Returns the updated
/// book. The user picked a replacement path for the same content.
#[tauri::command]
pub async fn local_locate_linked_book(
    state: State<'_, AppState>,
    id: i64,
    new_path: String,
) -> Result<LocalBook, ApiError> {
    let mut updated: Option<LocalBook> = None;
    mutate_catalog(&state, |catalog| {
        if let Some(book) = catalog.books.iter_mut().find(|b| b.id == id) {
            if book.source.as_deref() != Some("linked") {
                return;
            }
            book.external_path = Some(new_path);
            book.missing = false;
            updated = Some(book.clone());
        }
    })
    .await?;
    crate::local_search::invalidate_index(&state);
    updated.ok_or_else(|| ApiError::local("No such linked book"))
}

/// Rename a collection everywhere it is used (fixing a typo, or folding one
/// collection into another). Returns nothing; the shelf re-lists.
#[tauri::command]
pub async fn local_rename_collection(state: State<'_, AppState>, from: String, to: String) -> Result<(), ApiError> {
    let from = from.trim().to_string();
    let to = to.trim().to_string();
    if from.is_empty() || to.is_empty() || from == to {
        return Ok(());
    }
    mutate_catalog(&state, |catalog| {
        for book in catalog.books.iter_mut() {
            if let Some(idx) = book.collections.iter().position(|c| c == &from) {
                book.collections[idx] = to.clone();
            }
        }
    })
    .await
}

/// Store a cover the client rendered (epub.js cover image, or pdf.js page 1 on
/// a canvas). Rust never learns to parse EPUB or PDF; the webview already can.
#[tauri::command]
pub async fn save_local_cover(
    state: State<'_, AppState>,
    id: i64,
    bytes: Vec<u8>,
    ext: Option<String>,
) -> Result<(), ApiError> {
    if bytes.is_empty() {
        return Ok(());
    }
    tokio::fs::create_dir_all(covers_dir(&state)).await?;
    let ext = ext.unwrap_or_else(|| "jpg".into()).to_ascii_lowercase();
    let book = get_book(&state, id).await?;
    let stem = book.content_hash.unwrap_or_else(new_uid);
    let rel = format!("covers/{stem}.{ext}");
    tokio::fs::write(resolve(&state, &rel), &bytes).await?;
    mutate_catalog(&state, |catalog| {
        if let Some(book) = catalog.books.iter_mut().find(|b| b.id == id) {
            book.cover = Some(rel);
        }
    })
    .await
}

/// Replace a local cover from a user-selected image file. The picker supplies
/// the path, but Rust performs the read and enforces the image/size boundary.
#[tauri::command]
pub async fn local_set_cover_from_path(state: State<'_, AppState>, id: i64, path: String) -> Result<(), ApiError> {
    let source = PathBuf::from(path);
    let ext = ext_of(&source);
    if !source.is_file() || !["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp"].contains(&ext.as_str()) {
        return Err(ApiError::local("Choose a JPG, PNG, GIF, WebP, AVIF, or BMP image"));
    }
    let bytes = tokio::fs::read(&source).await?;
    if bytes.len() > 50 * 1024 * 1024 {
        return Err(ApiError::local("Cover image is larger than 50 MiB"));
    }
    save_local_cover(state, id, bytes, Some(ext)).await
}

/* ----------------------------------------------------------------- helpers */

async fn get_book(state: &AppState, id: i64) -> ApiResult<LocalBook> {
    state
        .catalog
        .lock()
        .await
        .find(id)
        .cloned()
        .ok_or_else(|| ApiError::local("No such local book"))
}

async fn book_path(state: &AppState, id: i64) -> ApiResult<PathBuf> {
    let book = get_book(state, id).await?;
    book_disk_path(state, &book)
}

/// Where a book's bytes actually live. Linked books are read *in place* from
/// their external path (a user-attached folder, never copied); everything else
/// reads from app-owned storage via the catalog-relative `file`.
fn book_disk_path(state: &AppState, book: &LocalBook) -> ApiResult<PathBuf> {
    book_disk_path_at(&state.library_dir, book)
}

/// Pure path resolver (no AppState) so the linked/copy split is unit-testable.
fn book_disk_path_at(library_dir: &Path, book: &LocalBook) -> ApiResult<PathBuf> {
    if book.source.as_deref() == Some("linked") {
        if let Some(path) = book.external_path.as_ref() {
            return Ok(PathBuf::from(path));
        }
        return Err(ApiError::local("Linked book has no external path"));
    }
    Ok(library_dir.join(&book.file))
}

/// Total bytes held by the local library (books + covers), for Settings.
#[tauri::command]
pub async fn local_size(state: State<'_, AppState>) -> Result<u64, ApiError> {
    let books = state.catalog.lock().await.books.clone();
    let mut total = 0;
    for book in books {
        for rel in [Some(book.file), book.cover].into_iter().flatten() {
            if let Ok(meta) = tokio::fs::metadata(resolve(&state, &rel)).await {
                total += meta.len();
            }
        }
    }
    Ok(total)
}

/* -------------------------------------------------------------------- tests */

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local_zip::{is_image, natural_cmp};
    use std::cmp::Ordering;

    /// Build a temp tree of book files / unsupported files and return its root.
    fn temp_library_tree() -> (PathBuf, Vec<PathBuf>) {
        let dir = std::env::temp_dir().join(format!("cb8-folder-tree-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let a = dir.join("Series");
        let b = dir.join("Series").join("Vol 02");
        let c = dir.join("notes");
        std::fs::create_dir_all(&b).unwrap();
        std::fs::create_dir_all(&c).unwrap();
        let mut files = Vec::new();
        for p in [
            dir.join("Top.epub"),
            a.join("Issue 001.cbz"),
            b.join("Deep.png"),
            dir.join("readme.txt"),
            c.join("notes.md"),
        ] {
            std::fs::write(&p, b"x").unwrap();
            files.push(p);
        }
        (dir, files)
    }

    #[test]
    fn walk_folder_collects_supported_recursively() {
        let (root, files) = temp_library_tree();
        let scan = walk_folder(&root);
        // epub + cbz + the plain image folder are supported; txt/md are not.
        assert_eq!(scan.supported.len(), 3);
        assert!(scan
            .supported
            .iter()
            .all(|p| p.ends_with(".epub") || p.ends_with(".cbz") || p.ends_with("Vol 02")));
        assert_eq!(scan.unsupported.len(), 2);
        assert!(!scan.truncated);
        let _ = files;
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn walk_folder_respects_depth_cap() {
        let dir = std::env::temp_dir().join(format!("cb8-deep-tree-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        // Build a chain deeper than SCAN_MAX_DEPTH with a book at the bottom.
        let mut leaf = dir.clone();
        for _ in 0..SCAN_MAX_DEPTH + 3 {
            leaf = leaf.join("d");
        }
        std::fs::create_dir_all(&leaf).unwrap();
        std::fs::write(leaf.join("deep.epub"), b"x").unwrap();
        let scan = walk_folder(&dir);
        assert!(
            scan.supported.is_empty(),
            "deep file should be truncated: {:?}",
            scan.supported
        );
        assert!(scan.truncated, "depth cap should set truncated");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn walk_folder_caps_total_files() {
        let dir = std::env::temp_dir().join(format!("cb8-many-tree-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        for i in 0..SCAN_MAX_FILES + 50 {
            std::fs::write(dir.join(format!("{i}.epub")), b"x").unwrap();
        }
        let scan = walk_folder(&dir);
        assert!(scan.truncated, "file cap should set truncated");
        assert!(scan.supported.len() <= SCAN_MAX_FILES);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn pages_sort_the_way_a_reader_counts() {
        let mut names = vec!["p10.jpg".to_string(), "p2.jpg".to_string(), "p1.jpg".to_string()];
        names.sort_by(|a, b| natural_cmp(a, b));
        assert_eq!(names, vec!["p1.jpg", "p2.jpg", "p10.jpg"]);
    }

    #[test]
    fn zero_padding_does_not_change_the_order() {
        assert_eq!(natural_cmp("p007.jpg", "p7.jpg"), Ordering::Equal);
        assert_eq!(natural_cmp("p007.jpg", "p8.jpg"), Ordering::Less);
    }

    #[test]
    fn resource_forks_are_not_pages() {
        assert!(is_image("comic/page01.jpg"));
        assert!(is_image("PAGE01.PNG"));
        assert!(!is_image("__MACOSX/comic/._page01.jpg"));
        assert!(!is_image("comic/._page01.jpg"));
        assert!(!is_image("comic/ComicInfo.xml"));
    }

    #[test]
    fn only_book_formats_import() {
        for ext in ["epub", "pdf", "cbz", "cbr", "cb7", "mobi", "azw3"] {
            assert!(IMPORTABLE_EXTS.contains(&ext), "{ext} should import");
        }
        for ext in ["", "jpg", "txt", "mp3", "zip"] {
            assert!(!IMPORTABLE_EXTS.contains(&ext), "{ext} should not import");
        }
    }

    #[test]
    fn archives_are_comics_and_everything_else_is_a_book() {
        assert_eq!(media_type_for("cbz"), "comic");
        assert_eq!(media_type_for("cbr"), "comic");
        assert_eq!(media_type_for("cb7"), "comic");
        assert_eq!(media_type_for("folder"), "comic");
        assert_eq!(media_type_for("epub"), "book");
        assert_eq!(media_type_for("pdf"), "book");
    }

    #[test]
    fn uids_do_not_collide() {
        let a = new_uid();
        let b = new_uid();
        assert_ne!(a, b);
        assert_eq!(a.len(), 24);
    }

    #[test]
    fn a_corrupt_catalog_starts_empty_instead_of_failing() {
        let path = std::env::temp_dir().join("shelf-bad-catalog.json");
        std::fs::write(&path, b"{ not json").unwrap();
        let catalog = Catalog::load(&path);
        assert!(catalog.books.is_empty());
        assert_eq!(catalog.next_id, 1);
    }

    /// Replacing an *existing* catalog (not just writing a fresh one) must
    /// leave the new content on disk with no `.tmp` leftover — the crash-safe
    /// contract on every platform, Windows included.
    #[tokio::test]
    async fn catalog_replacement_overwrites_cleanly() {
        let path = std::env::temp_dir().join("shelf-replace-catalog.json");
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("tmp"));

        let mut first = Catalog {
            next_id: 2,
            ..Catalog::default()
        };
        first.books.push(LocalBook {
            id: 1,
            title: "first".into(),
            authors: Vec::new(),
            description: None,
            language: None,
            publisher: None,
            published_at: None,
            file: "books/a.epub".into(),
            cover: None,
            ext: "epub".into(),
            media_type: "book".into(),
            page_count: 0,
            bytes: 10,
            added_at: 0,
            origin: None,
            progress: Progress::default(),
            favorited: false,
            content_hash: None,
            series: None,
            volume: None,
            tags: Vec::new(),
            collections: Vec::new(),
            source: None,
            external_path: None,
            missing: false,
            acquired_from: None,
        });
        write_catalog_snapshot(&path, &first).await.unwrap();

        // Second write over the existing file.
        let mut second = Catalog {
            next_id: 3,
            ..Catalog::default()
        };
        second.books.push(LocalBook {
            id: 2,
            title: "second".into(),
            authors: Vec::new(),
            description: None,
            language: None,
            publisher: None,
            published_at: None,
            file: "books/b.cbz".into(),
            cover: None,
            ext: "cbz".into(),
            media_type: "comic".into(),
            page_count: 5,
            bytes: 20,
            added_at: 1,
            origin: None,
            progress: Progress::default(),
            favorited: false,
            content_hash: None,
            series: None,
            volume: None,
            tags: Vec::new(),
            collections: Vec::new(),
            source: None,
            external_path: None,
            missing: false,
            acquired_from: None,
        });
        write_catalog_snapshot(&path, &second).await.unwrap();

        let loaded = Catalog::load(&path);
        assert_eq!(loaded.books.len(), 1);
        assert_eq!(loaded.books[0].title, "second");
        assert_eq!(loaded.next_id, 3);
        // The atomic-write temp file must be gone, not stranded.
        assert!(!path.with_extension("tmp").exists(), "stale .tmp left behind");

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn content_hash_is_stable_and_detects_change() {
        let dir = std::env::temp_dir().join(format!("cb8-hash-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let a = dir.join("a.epub");
        let b = dir.join("b.epub");
        std::fs::write(&a, b"same bytes").unwrap();
        std::fs::write(&b, b"same bytes").unwrap();
        assert_eq!(content_hash(&a).unwrap(), content_hash(&b).unwrap());
        std::fs::write(&b, b"different").unwrap();
        assert_ne!(content_hash(&a).unwrap(), content_hash(&b).unwrap());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn linked_books_resolve_to_their_external_path() {
        // A linked book reads in place; a copy reads from app storage.
        let library_dir = Path::new("/tmp/lib");
        let mut linked = LocalBook {
            id: 1,
            title: "linked".into(),
            authors: Vec::new(),
            description: None,
            language: None,
            publisher: None,
            published_at: None,
            file: "books/x.epub".into(),
            cover: None,
            ext: "epub".into(),
            media_type: "book".into(),
            page_count: 0,
            bytes: 0,
            added_at: 0,
            origin: None,
            progress: Progress::default(),
            favorited: false,
            content_hash: None,
            series: None,
            volume: None,
            tags: Vec::new(),
            collections: Vec::new(),
            source: Some("linked".into()),
            external_path: Some("/Books/x.epub".into()),
            missing: false,
            acquired_from: None,
        };
        assert_eq!(
            book_disk_path_at(library_dir, &linked).unwrap(),
            PathBuf::from("/Books/x.epub")
        );
        // A linked book with no external path is an error, not a stray resolve.
        linked.external_path = None;
        assert!(book_disk_path_at(library_dir, &linked).is_err());

        let copy = LocalBook {
            id: 2,
            title: "copy".into(),
            authors: Vec::new(),
            description: None,
            language: None,
            publisher: None,
            published_at: None,
            file: "books/y.epub".into(),
            cover: None,
            ext: "epub".into(),
            media_type: "book".into(),
            page_count: 0,
            bytes: 0,
            added_at: 0,
            origin: None,
            progress: Progress::default(),
            favorited: false,
            content_hash: None,
            series: None,
            volume: None,
            tags: Vec::new(),
            collections: Vec::new(),
            source: None,
            external_path: None,
            missing: false,
            acquired_from: None,
        };
        assert_eq!(
            book_disk_path_at(library_dir, &copy).unwrap(),
            library_dir.join("books/y.epub")
        );
    }

    #[test]
    fn import_source_path_accepts_file_urls_and_plain_paths() {
        let plain = import_source_path("/tmp/book.epub");
        assert_eq!(plain, PathBuf::from("/tmp/book.epub"));

        let url = import_source_path("file:///Users/me/Library/book%20one.pdf");
        assert_eq!(url, PathBuf::from("/Users/me/Library/book one.pdf"));
    }

    #[test]
    fn catalog_paths_round_trip_as_relative() {
        // The whole point: what is stored must survive the container UUID
        // changing underneath it, so it must not be absolute.
        let json = r#"{"version":1,"books":[{"id":1,"title":"T","file":"books/a.epub",
            "ext":"epub","mediaType":"book","bytes":10,"addedAt":0}],"nextId":2}"#;
        let catalog: Catalog = serde_json::from_str(json).unwrap();
        let book = &catalog.books[0];
        assert_eq!(book.file, "books/a.epub");
        assert!(!Path::new(&book.file).is_absolute());
        assert_eq!(book.cover, None);
        assert_eq!(book.page_count, 0);
        assert!(!book.favorited);
        // New metadata fields default to empty rather than missing.
        assert_eq!(book.series, None);
        assert_eq!(book.tags, Vec::<String>::new());
        assert_eq!(book.collections, Vec::<String>::new());
    }

    /// Legacy catalogs (no metadata fields) deserialize with empty defaults.
    #[test]
    fn metadata_fields_default_empty_on_legacy_catalogs() {
        let json = r#"{"version":1,"books":[{"id":1,"title":"T","file":"books/a.epub",
            "ext":"epub","mediaType":"book","bytes":10,"addedAt":0}],"nextId":2}"#;
        let catalog: Catalog = serde_json::from_str(json).unwrap();
        assert_eq!(catalog.books[0].series, None);
        assert_eq!(catalog.books[0].tags, Vec::<String>::new());
        assert_eq!(catalog.books[0].collections, Vec::<String>::new());
        assert_eq!(catalog.books[0].acquired_from, None);
    }

    /// Concurrent progress + favorite + cover mutations must all land in the
    /// final on-disk catalog (the pre-fix race could drop fields when
    /// snapshots finished out of order).
    #[tokio::test]
    async fn concurrent_mutations_preserve_all_fields() {
        use std::sync::Arc;
        use tokio::sync::Mutex;

        let dir = std::env::temp_dir().join(format!("shelf-catalog-conc-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("catalog.json");

        let mut initial = Catalog::default();
        initial.books.push(LocalBook {
            id: 1,
            title: "T".into(),
            authors: Vec::new(),
            description: None,
            language: None,
            publisher: None,
            published_at: None,
            file: "books/a.epub".into(),
            cover: None,
            ext: "epub".into(),
            media_type: "book".into(),
            page_count: 0,
            bytes: 10,
            added_at: 0,
            origin: None,
            progress: Progress::default(),
            favorited: false,
            content_hash: None,
            series: None,
            volume: None,
            tags: Vec::new(),
            collections: Vec::new(),
            source: None,
            external_path: None,
            missing: false,
            acquired_from: None,
        });
        initial.next_id = 2;
        write_catalog_snapshot(&path, &initial).await.unwrap();

        let catalog = Arc::new(Mutex::new(Catalog::load(&path)));
        let write = Arc::new(Mutex::new(()));
        let path = Arc::new(path);

        async fn apply(
            catalog: Arc<Mutex<Catalog>>,
            write: Arc<Mutex<()>>,
            path: Arc<PathBuf>,
            f: impl FnOnce(&mut Catalog),
        ) {
            let _g = write.lock().await;
            let snapshot = {
                let mut c = catalog.lock().await;
                f(&mut c);
                c.clone()
            };
            write_catalog_snapshot(&path, &snapshot).await.unwrap();
        }

        let c1 = catalog.clone();
        let w1 = write.clone();
        let p1 = path.clone();
        let t_progress = tokio::spawn(async move {
            for page in 0..20 {
                apply(c1.clone(), w1.clone(), p1.clone(), |c| {
                    c.books[0].progress.page = Some(page);
                    c.books[0].progress.read_at = Some(page);
                })
                .await;
            }
        });

        let c2 = catalog.clone();
        let w2 = write.clone();
        let p2 = path.clone();
        let t_fav = tokio::spawn(async move {
            for i in 0..20 {
                apply(c2.clone(), w2.clone(), p2.clone(), |c| {
                    c.books[0].favorited = i % 2 == 0;
                })
                .await;
            }
        });

        let c3 = catalog.clone();
        let w3 = write.clone();
        let p3 = path.clone();
        let t_cover = tokio::spawn(async move {
            for i in 0..20 {
                apply(c3.clone(), w3.clone(), p3.clone(), |c| {
                    c.books[0].cover = Some(format!("covers/{i}.jpg"));
                })
                .await;
            }
        });

        t_progress.await.unwrap();
        t_fav.await.unwrap();
        t_cover.await.unwrap();

        let final_cat = Catalog::load(&path);
        let book = &final_cat.books[0];
        // Last progress write was page 19; last cover was covers/19.jpg;
        // last fav was true (i=18 even) or false (i=19) — favorited settled.
        assert_eq!(book.progress.page, Some(19));
        assert!(book.cover.is_some());
        assert!(book.cover.as_ref().unwrap().starts_with("covers/"));
        // All three fields present — not a partial snapshot from one writer.
        assert!(book.progress.read_at.is_some());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
