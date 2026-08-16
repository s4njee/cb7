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
use crate::local_zip::{entry_bytes, page_names};
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

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalBook {
    pub id: i64,
    pub title: String,
    /// e.g. `books/9f2c….epub`
    pub file: String,
    /// e.g. `covers/9f2c….jpg`; null until a cover exists.
    #[serde(default)]
    pub cover: Option<String>,
    /// Lowercase, no dot: `epub` | `pdf` | `cbz` | `cbr`.
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
}

fn one() -> i64 {
    1
}

impl Default for Catalog {
    fn default() -> Self {
        Self { version: 1, books: Vec::new(), next_id: 1 }
    }
}

impl Catalog {
    /// Load from disk, or start empty. A corrupt catalog is *not* fatal: it is
    /// logged and replaced, because refusing to launch would strand every book.
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

fn catalog_path(state: &AppState) -> PathBuf {
    state.library_dir.join("catalog.json")
}

/// Resolve a catalog-relative path against the library root.
fn resolve(state: &AppState, rel: &str) -> PathBuf {
    state.library_dir.join(rel)
}

/// Write a catalog snapshot atomically (`.tmp` + rename), so a crash mid-write
/// can never leave a half-written library index behind.
async fn write_catalog_snapshot(path: &Path, snapshot: &Catalog) -> ApiResult<()> {
    let bytes = serde_json::to_vec_pretty(snapshot)
        .map_err(|err| ApiError::local(format!("serialize catalog: {err}")))?;
    let tmp = path.with_extension("tmp");
    tokio::fs::write(&tmp, bytes).await?;
    tokio::fs::rename(&tmp, path).await?;
    Ok(())
}

/// Mutate the in-memory catalog and persist under the catalog write lock.
/// Concurrent callers serialize: each snapshot includes all prior mutations,
/// so progress + favorite + cover cannot clobber each other out of order.
async fn mutate_catalog<R>(
    state: &AppState,
    f: impl FnOnce(&mut Catalog) -> R,
) -> ApiResult<R> {
    let _write = state.catalog_write.lock().await;
    let (result, snapshot) = {
        let mut catalog = state.catalog.lock().await;
        let result = f(&mut catalog);
        (result, catalog.clone())
    };
    write_catalog_snapshot(&catalog_path(state), &snapshot).await?;
    Ok(result)
}

/// Persist the current in-memory catalog. Acquires the write lock so a concurrent
/// `mutate_catalog` cannot interleave a stale snapshot after ours.
async fn save(state: &AppState) -> ApiResult<()> {
    let _write = state.catalog_write.lock().await;
    save_under_write_lock(state).await
}

/// Snapshot + write while the caller already holds `catalog_write`.
async fn save_under_write_lock(state: &AppState) -> ApiResult<()> {
    let snapshot = state.catalog.lock().await.clone();
    write_catalog_snapshot(&catalog_path(state), &snapshot).await
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
        "cbz" | "cbr" | "zip" | "rar" => "comic",
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
        _ => "application/octet-stream",
    }
}

/// What "Add books" will accept. CBR is included: it imports and shelves fine,
/// and only *reading* it locally is unsupported (no unrar) — an honest message
/// at open time beats refusing the file at the picker with no explanation.
const IMPORTABLE_EXTS: [&str; 4] = ["epub", "pdf", "cbz", "cbr"];

/// Whether a path is a supported book **file** — used by the open-request
/// pipeline (`opens.rs`) to filter what is worth importing. Directories are
/// rejected here, not silently walked (v1 never recurses into folders).
pub fn is_supported_book_path(path: &std::path::Path) -> bool {
    if !path.is_file() {
        return false;
    }
    let ext = ext_of(path);
    IMPORTABLE_EXTS.contains(&ext.as_str())
}


/* -------------------------------------------------------------- commands */

/// Every book in the local library.
#[tauri::command]
pub async fn local_list(state: State<'_, AppState>) -> Result<Vec<LocalBook>, ApiError> {
    Ok(state.catalog.lock().await.books.clone())
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
#[tauri::command]
pub async fn local_import(
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<ImportReport, ApiError> {
    tokio::fs::create_dir_all(books_dir(&state)).await?;
    tokio::fs::create_dir_all(covers_dir(&state)).await?;

    let mut report = ImportReport { added: Vec::new(), skipped: Vec::new(), failed: Vec::new() };
    for raw in paths {
        let src = import_source_path(&raw);
        let ext = ext_of(&src);

        // Directories are rejected, not walked (v1 never recurses). Say so
        // clearly rather than silently importing nothing.
        if src.is_dir() {
            report.skipped.push(ImportNote {
                path: raw.clone(),
                reason: "Folders can't be imported — choose the files inside.".into(),
            });
            continue;
        }
        // The picker is unfiltered (see `pickAndImportBooks`), so this is where
        // "is that a book?" is actually decided.
        if !IMPORTABLE_EXTS.contains(&ext.as_str()) {
            report.skipped.push(ImportNote {
                path: raw.clone(),
                reason: "Not a supported book format (EPUB, PDF, CBZ, CBR).".into(),
            });
            continue;
        }
        let title = src
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Untitled")
            .to_string();

        let uid = new_uid();
        let rel = format!("books/{uid}.{ext}");
        let dest = resolve(&state, &rel);
        if let Err(err) = tokio::fs::copy(&src, &dest).await {
            report.failed.push(ImportNote {
                path: raw.clone(),
                reason: format!("Could not copy the file: {err}"),
            });
            continue;
        }
        let bytes = tokio::fs::metadata(&dest).await.map(|m| m.len()).unwrap_or(0);

        let mut book = LocalBook {
            id: 0, // assigned below, under the lock
            title,
            file: rel,
            cover: None,
            ext: ext.clone(),
            media_type: media_type_for(&ext).to_string(),
            page_count: 0,
            bytes,
            added_at: now_ms(),
            origin: None,
            progress: Progress::default(),
            favorited: false,
        };

        // A CBZ/CBR carries its own cover and page count; extract both now so
        // the shelf is complete the moment the import finishes. EPUB and PDF
        // covers are rendered client-side later (see `save_local_cover`) —
        // keeping those renderers out of Rust is the whole reason this split
        // exists. RAR (CBR) reads only page headers + the cover entry on demand.
        if book.media_type == "comic" && (ext == "cbz" || (ext == "cbr" && cfg!(desktop))) {
            let path = dest.clone();
            let uid2 = uid.clone();
            let covers = covers_dir(&state);
            let ext = ext.clone();
            let extracted = tokio::task::spawn_blocking(move || -> ApiResult<(i64, Option<String>)> {
                let names = page_names(&path, &ext)?;
                let count = names.len() as i64;
                let cover = match names.first() {
                    Some(first) => {
                        let bytes = entry_bytes(&path, &ext, first)?;
                        let cext = ext_of(Path::new(first));
                        let cext = if cext.is_empty() { "jpg".into() } else { cext };
                        std::fs::write(covers.join(format!("{uid2}.{cext}")), bytes)?;
                        Some(format!("covers/{uid2}.{cext}"))
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
        report.added.push(pushed);
    }

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
    for rel in [Some(removed.file.clone()), removed.cover.clone()].into_iter().flatten() {
        let path = resolve(&state, &rel);
        if let Ok(meta) = tokio::fs::metadata(&path).await {
            freed += meta.len();
        }
        let _ = tokio::fs::remove_file(&path).await;
    }
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
    let origin = Origin { server: server.clone(), comic_id };

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

    let ext = if ext.is_empty() { "bin".to_string() } else { ext.to_ascii_lowercase() };
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
        DownloadProgress { comic_id, received: 0, total, done: false },
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
                DownloadProgress { comic_id, received, total, done: false },
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
    };

    // A downloaded CBZ/CBR's real page count comes from the archive; the
    // server's number is a fine default but the local reader pages the file
    // itself. CBR count is desktop-only (no RAR backend on mobile).
    if book.ext == "cbz" || (book.ext == "cbr" && cfg!(desktop)) {
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
        DownloadProgress { comic_id, received, total: Some(received), done: true },
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
    let path = resolve(&state, &book.file);
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
    let path = resolve(state, &book.file);
    let ext = book.ext.clone();
    tokio::task::spawn_blocking(move || {
        let names = page_names(&path, &ext)?;
        let name = names
            .get(index)
            .ok_or_else(|| ApiError::local("No such page"))?
            .clone();
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
    let path = resolve(state, &book.file);
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
pub async fn local_set_favorite(
    state: State<'_, AppState>,
    id: i64,
    favorited: bool,
) -> Result<(), ApiError> {
    mutate_catalog(&state, |catalog| {
        if let Some(book) = catalog.books.iter_mut().find(|b| b.id == id) {
            book.favorited = favorited;
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
    let rel = format!("covers/{}.{ext}", new_uid());
    tokio::fs::write(resolve(&state, &rel), &bytes).await?;
    mutate_catalog(&state, |catalog| {
        if let Some(book) = catalog.books.iter_mut().find(|b| b.id == id) {
            book.cover = Some(rel);
        }
    })
    .await
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
    Ok(resolve(state, &get_book(state, id).await?.file))
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
    use std::cmp::Ordering;
    use crate::local_zip::{is_image, natural_cmp};

    #[test]
    fn pages_sort_the_way_a_reader_counts() {
        let mut names = vec![
            "p10.jpg".to_string(),
            "p2.jpg".to_string(),
            "p1.jpg".to_string(),
        ];
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
        for ext in ["epub", "pdf", "cbz", "cbr"] {
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
    }

    /// Concurrent progress + favorite + cover mutations must all land in the
    /// final on-disk catalog (the pre-fix race could drop fields when
    /// snapshots finished out of order).
    #[tokio::test]
    async fn concurrent_mutations_preserve_all_fields() {
        use std::sync::Arc;
        use tokio::sync::Mutex;

        let dir = std::env::temp_dir().join(format!(
            "shelf-catalog-conc-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("catalog.json");

        let mut initial = Catalog::default();
        initial.books.push(LocalBook {
            id: 1,
            title: "T".into(),
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
