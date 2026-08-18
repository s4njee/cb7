//! Local full-text search for standalone books, backed by SQLite FTS5.
//!
//! The index lives in the catalog database (`catalog.sqlite3`) rather than in a
//! JSON sidecar, which buys three things the sidecar could not give us:
//!
//! * **Incremental maintenance.** Each book carries a fingerprint (size + mtime),
//!   so a catalog change re-indexes the book that changed instead of the shelf.
//! * **A background queue.** Work is derived by reconciling the catalog against
//!   `search_books`, so it is durable: a rebuild interrupted by an app kill
//!   resumes on the next launch instead of starting over.
//! * **Deep links.** Text is stored per *segment* — a chunk of an EPUB spine
//!   document, or one PDF page — and each segment carries the jump target the
//!   reader understands (a serialized Readium locator with a progression, or a
//!   0-based page index). A result opens the book *at the passage*.
//!
//! The index remains disposable: it is derived entirely from files on disk, it
//! is capped, and it can be turned off (which drops it).

use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime, State};
use zip::ZipArchive;

use crate::error::ApiError;
use crate::local::LocalBook;
use crate::state::AppState;
use crate::storage::{db_path, CatalogStore};

/// Progress of the background indexer, pushed to the frontend as it works.
pub const PROGRESS_EVENT: &str = "local-search-index";

const SETTINGS_FILE: &str = "search-settings.json";
/// Total extracted text kept across the whole library.
const MAX_INDEX_BYTES: i64 = 64 * 1024 * 1024;
/// Per book, so one enormous file cannot eat the whole budget.
const MAX_BOOK_BYTES: usize = 4 * 1024 * 1024;
/// Never decompress an individual EPUB spine entry beyond this amount. A
/// malformed or unusually large chapter should not monopolize memory.
const MAX_EPUB_ENTRY_BYTES: usize = 8 * 1024 * 1024;
/// lopdf loads a document before extracting pages; skip very large PDFs rather
/// than putting hundreds of megabytes on the indexer's heap.
const MAX_PDF_SOURCE_BYTES: u64 = 128 * 1024 * 1024;
/// Give the reader and other native work a chance between books.
const INDEX_PAUSE: Duration = Duration::from_millis(60);
/// Segment size. Small enough that a hit's progression lands the reader on the
/// passage, large enough that a query's words usually share one segment.
const SEGMENT_CHARS: usize = 1200;
/// Books shown per query, and sections shown per book.
const MAX_RESULT_BOOKS: usize = 8;
const MAX_RESULT_SEGMENTS: usize = 3;

// ---------------------------------------------------------------- settings

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSettings {
    pub enabled: bool,
    /// Extracted text currently held by the index.
    pub indexed_bytes: u64,
    pub indexed_books: u64,
    /// The cap `indexed_bytes` is measured against; books past it are skipped.
    pub max_bytes: u64,
    /// Books skipped because the index is full.
    pub capped_books: u64,
    pub indexing: bool,
    /// Books completed / queued in the run that is currently in flight.
    pub done: u64,
    pub total: u64,
    pub current_book: Option<String>,
}

/// Only the user's choice is persisted; every count is derived from the index.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredSettings {
    #[serde(default = "default_enabled")]
    enabled: bool,
}

fn default_enabled() -> bool {
    true
}

impl Default for StoredSettings {
    fn default() -> Self {
        Self { enabled: true }
    }
}

fn settings_path(state: &AppState) -> PathBuf {
    state.library_dir.join(SETTINGS_FILE)
}

fn read_stored(state: &AppState) -> StoredSettings {
    std::fs::read(settings_path(state))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn write_stored(state: &AppState, stored: &StoredSettings) -> Result<(), ApiError> {
    let bytes =
        serde_json::to_vec_pretty(stored).map_err(|e| ApiError::local(format!("serialize search settings: {e}")))?;
    std::fs::write(settings_path(state), bytes)?;
    Ok(())
}

// ------------------------------------------------------------ shared flags

/// Cross-thread indexer state. Lives in `AppState` behind an `Arc` so the
/// background thread can own a handle without borrowing the whole state.
#[derive(Default)]
pub struct SearchFlags {
    /// A worker thread is running right now.
    indexing: AtomicBool,
    /// Ask the running worker to stop after the current book.
    cancel: AtomicBool,
    /// The catalog changed since the last reconcile — the worker loops again.
    stale: AtomicBool,
    /// (done, total) of the run in flight, for the settings/status readout.
    progress: Mutex<(u64, u64)>,
    /// Title currently being extracted, for the library status bar.
    current_book: Mutex<Option<String>>,
}

// ------------------------------------------------------------------- hits

/// One indexed passage that matched. `target` is opaque to the shell: a
/// serialized Readium locator for EPUB, a 0-based page index for PDF — exactly
/// what the matching reader's `goTo` consumes.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSearchHit {
    /// Book id, so the library can pair the hit with its catalog record.
    pub id: i64,
    pub title: String,
    /// Section title or "Page 12" — where in the book this passage sits.
    pub label: String,
    pub snippet: String,
    pub target: serde_json::Value,
}

// ------------------------------------------------------------------ schema

fn open_db(library_dir: &Path) -> Result<Connection, ApiError> {
    let conn = Connection::open(db_path(library_dir))?;
    // The indexer writes while the UI reads; WAL plus a busy timeout keeps a
    // search from failing just because a book is being indexed underneath it.
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA busy_timeout = 5000;",
    )?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS search_books (
             book_id INTEGER PRIMARY KEY,
             title TEXT NOT NULL,
             fingerprint TEXT NOT NULL,
             bytes INTEGER NOT NULL,
             status TEXT NOT NULL,
             indexed_at INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS search_segments (
             id INTEGER PRIMARY KEY,
             book_id INTEGER NOT NULL,
             ordinal INTEGER NOT NULL,
             kind TEXT NOT NULL,
             target TEXT NOT NULL,
             label TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS search_segments_book ON search_segments(book_id);
         CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
             body,
             tokenize = 'unicode61 remove_diacritics 2'
         );",
    )?;
    Ok(conn)
}

/// The v2 sidecar is superseded by the FTS tables; remove it once so the old
/// (potentially 64 MB) file does not sit in the library forever.
fn drop_legacy_sidecar(library_dir: &Path) {
    let legacy = library_dir.join("search-index.json");
    if legacy.exists() {
        let _ = std::fs::remove_file(&legacy);
        log::info!("removed superseded search sidecar {}", legacy.display());
    }
}

// ------------------------------------------------------------- extraction

/// One indexed passage before it reaches the database.
struct Segment {
    ordinal: i64,
    /// `"locator"` (EPUB) or `"page"` (PDF).
    kind: &'static str,
    target: String,
    label: String,
    body: String,
}

fn supported(ext: &str) -> bool {
    matches!(ext, "epub" | "pdf")
}

fn book_path(library_dir: &Path, book: &LocalBook) -> PathBuf {
    if book.source.as_deref() == Some("linked") {
        book.external_path.as_deref().map(PathBuf::from).unwrap_or_default()
    } else {
        library_dir.join(&book.file)
    }
}

/// Size + mtime. Cheap, and enough to notice an edited or replaced file; a
/// change re-indexes exactly that book.
fn fingerprint(path: &Path) -> Option<String> {
    let meta = std::fs::metadata(path).ok()?;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0);
    Some(format!("{}:{}", meta.len(), mtime))
}

fn strip_markup(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut in_tag = false;
    for ch in input.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                out.push(' ');
            }
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Pull the human label for a spine document out of its own markup, so a result
/// reads "Chapter 4" rather than "OEBPS/ch04.xhtml".
fn document_label(raw: &str) -> Option<String> {
    for (open, close) in [("<title", "</title"), ("<h1", "</h1"), ("<h2", "</h2")] {
        let lower = raw.to_ascii_lowercase();
        let Some(start) = lower.find(open) else { continue };
        let Some(body_start) = lower[start..].find('>').map(|i| start + i + 1) else {
            continue;
        };
        let Some(end) = lower[body_start..].find(close).map(|i| body_start + i) else {
            continue;
        };
        let label = strip_markup(&raw[body_start..end]);
        if !label.is_empty() {
            return Some(label.chars().take(120).collect());
        }
    }
    None
}

/// Split a section into indexable passages. Chunking is what makes the deep
/// link precise: each chunk knows where it starts inside its section, so the
/// locator's progression lands the reader on the passage rather than on the
/// chapter's first line. Chunks do not overlap, so a phrase straddling a
/// boundary is missed — an acceptable trade for not double-reporting hits.
fn chunk_text(text: &str) -> Vec<(usize, String)> {
    let chars: Vec<char> = text.chars().collect();
    if chars.is_empty() {
        return Vec::new();
    }
    let mut chunks = Vec::new();
    let mut start = 0usize;
    while start < chars.len() {
        let mut end = (start + SEGMENT_CHARS).min(chars.len());
        // Prefer a word boundary so snippets do not begin mid-word.
        if end < chars.len() {
            if let Some(space) = chars[start..end].iter().rposition(|c| c.is_whitespace()) {
                if space > SEGMENT_CHARS / 2 {
                    end = start + space;
                }
            }
        }
        let body: String = chars[start..end].iter().collect();
        let body = body.trim().to_string();
        if !body.is_empty() {
            chunks.push((start, body));
        }
        start = end.max(start + 1);
    }
    chunks
}

/// A Readium locator, serialized exactly as `Locator.deserialize` expects.
/// `href` is the zip-relative spine path, which is what the frontend's EPUB
/// parser uses for `readingOrder`, so targets resolve without fuzzy matching.
fn locator_json(href: &str, progression: f64, highlight: &str) -> String {
    serde_json::json!({
        "href": href,
        "type": "application/xhtml+xml",
        "locations": { "progression": progression },
        "text": { "highlight": highlight.chars().take(60).collect::<String>() },
    })
    .to_string()
}

fn zip_entry_text<R: std::io::Read + std::io::Seek>(archive: &mut ZipArchive<R>, name: &str) -> Option<String> {
    fn read_entry<R: std::io::Read>(mut entry: R) -> Option<String> {
        let mut bytes = Vec::new();
        std::io::Read::take(&mut entry, MAX_EPUB_ENTRY_BYTES as u64)
            .read_to_end(&mut bytes)
            .ok()?;
        Some(String::from_utf8_lossy(&bytes).into_owned())
    }
    if let Ok(mut entry) = archive.by_name(name) {
        return read_entry(&mut entry);
    }
    // Manifest hrefs may be percent-encoded while zip entry names are not.
    let decoded = percent_decode(name);
    if decoded != name {
        if let Ok(mut entry) = archive.by_name(&decoded) {
            return read_entry(&mut entry);
        }
    }
    None
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&input[i + 1..i + 3], 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Resolve `rel` against the directory of `base`, the way the frontend's
/// `resolvePath` does, so both sides name the same spine entries.
fn resolve_zip_path(base: &str, rel: &str) -> String {
    let dir = base.rsplit_once('/').map(|(d, _)| d).unwrap_or("");
    let joined = if dir.is_empty() {
        rel.to_string()
    } else {
        format!("{dir}/{rel}")
    };
    let normalized = joined.replace('\\', "/");
    let mut parts: Vec<&str> = Vec::new();
    for seg in normalized.split('/') {
        match seg {
            "" | "." => continue,
            ".." => {
                parts.pop();
            }
            other => parts.push(other),
        }
    }
    parts.join("/")
}

fn epub_segments(path: &Path) -> Result<Vec<Segment>, ApiError> {
    let file = std::fs::File::open(path)?;
    let mut archive = ZipArchive::new(file).map_err(|e| ApiError::local(format!("open EPUB: {e}")))?;

    let container = zip_entry_text(&mut archive, "META-INF/container.xml")
        .ok_or_else(|| ApiError::local("EPUB has no container"))?;
    let container_doc =
        roxmltree::Document::parse(&container).map_err(|e| ApiError::local(format!("Invalid EPUB container: {e}")))?;
    let rootfile = container_doc
        .descendants()
        .find(|n| n.has_tag_name("rootfile"))
        .and_then(|n| n.attribute("full-path"))
        .ok_or_else(|| ApiError::local("EPUB has no package document"))?
        .trim_start_matches('/')
        .to_string();

    let opf = zip_entry_text(&mut archive, &rootfile).ok_or_else(|| ApiError::local("EPUB package is missing"))?;
    let doc = roxmltree::Document::parse(&opf).map_err(|e| ApiError::local(format!("Invalid EPUB package: {e}")))?;

    // manifest id → zip path, mirroring the frontend's opfDir join.
    let mut items: std::collections::HashMap<&str, String> = std::collections::HashMap::new();
    for item in doc.descendants().filter(|n| n.has_tag_name("item")) {
        let (Some(id), Some(href)) = (item.attribute("id"), item.attribute("href")) else {
            continue;
        };
        if href.starts_with("http://") || href.starts_with("https://") {
            continue;
        }
        items.insert(id, resolve_zip_path(&rootfile, href));
    }

    let mut segments = Vec::new();
    let mut budget = MAX_BOOK_BYTES;
    let mut ordinal = 0i64;
    for itemref in doc.descendants().filter(|n| n.has_tag_name("itemref")) {
        // `linear="no"` items are outside the reading order on both sides.
        if itemref.attribute("linear") == Some("no") {
            continue;
        }
        let Some(href) = itemref.attribute("idref").and_then(|id| items.get(id)).cloned() else {
            continue;
        };
        let lower = href.to_ascii_lowercase();
        if !(lower.ends_with(".xhtml") || lower.ends_with(".html") || lower.ends_with(".htm")) {
            continue;
        }
        let Some(raw) = zip_entry_text(&mut archive, &href) else {
            continue;
        };
        let label = document_label(&raw).unwrap_or_else(|| href.rsplit('/').next().unwrap_or(&href).to_string());
        let text = strip_markup(&raw);
        let total = text.chars().count().max(1) as f64;
        for (offset, body) in chunk_text(&text) {
            if body.len() > budget {
                budget = 0;
                break;
            }
            budget -= body.len();
            let highlight: String = body.chars().take(60).collect();
            segments.push(Segment {
                ordinal,
                kind: "locator",
                target: locator_json(&href, (offset as f64 / total).clamp(0.0, 1.0), &highlight),
                label: label.clone(),
                body,
            });
            ordinal += 1;
        }
        if budget == 0 {
            break;
        }
    }
    Ok(segments)
}

/// PDF text is extracted page by page so a result can deep-link to the exact
/// page. `lopdf` handles the common (compressed) content streams; a document it
/// cannot parse simply yields nothing rather than failing the whole run — the
/// reader's own pdf.js search still covers that book in-book.
fn pdf_segments(path: &Path) -> Result<Vec<Segment>, ApiError> {
    if std::fs::metadata(path).map(|meta| meta.len()).unwrap_or(0) > MAX_PDF_SOURCE_BYTES {
        log::info!("skipping large PDF in background search index: {}", path.display());
        return Ok(Vec::new());
    }
    let doc = lopdf::Document::load(path).map_err(|e| ApiError::local(format!("open PDF: {e}")))?;
    let mut segments = Vec::new();
    let mut budget = MAX_BOOK_BYTES;
    let mut ordinal = 0i64;
    for (page_number, _) in doc.get_pages() {
        let Ok(text) = doc.extract_text(&[page_number]) else {
            continue;
        };
        let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
        if text.is_empty() {
            continue;
        }
        // Page indexes the reader consumes are 0-based; labels are 1-based.
        let index = page_number.saturating_sub(1);
        for (_, body) in chunk_text(&text) {
            if body.len() > budget {
                budget = 0;
                break;
            }
            budget -= body.len();
            segments.push(Segment {
                ordinal,
                kind: "page",
                target: index.to_string(),
                label: format!("Page {page_number}"),
                body,
            });
            ordinal += 1;
        }
        if budget == 0 {
            break;
        }
    }
    Ok(segments)
}

fn extract(path: &Path, ext: &str) -> Result<Vec<Segment>, ApiError> {
    match ext {
        "epub" => epub_segments(path),
        "pdf" => pdf_segments(path),
        _ => Ok(Vec::new()),
    }
}

// -------------------------------------------------------------- the queue

/// Mark the index stale. Cheap by design: it is called from every catalog
/// mutation, and the actual work is worked out later by reconciling
/// fingerprints, so a burst of edits costs one rebuild, not one per edit.
pub(crate) fn invalidate_index(state: &AppState) {
    state.search.stale.store(true, Ordering::SeqCst);
}

/// Start the background indexer if it is not already running. Safe to call from
/// anywhere and often — a second call while a run is in flight only re-arms the
/// stale flag, which makes the running worker loop once more.
pub fn kick<R: Runtime>(app: &AppHandle<R>, state: &AppState) {
    if !read_stored(state).enabled {
        return;
    }
    let flags = state.search.clone();
    if flags
        .indexing
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }
    flags.cancel.store(false, Ordering::SeqCst);

    let app = app.clone();
    let library_dir = state.library_dir.clone();
    let store = state.catalog_store.clone();
    // A plain thread, not the async runtime: this is unapologetically blocking
    // work (zip reads, PDF parsing) and must never sit on a runtime worker.
    std::thread::spawn(move || {
        drop_legacy_sidecar(&library_dir);
        let report = |done: u64, total: u64, current: Option<&str>| {
            let _ = app.emit(
                PROGRESS_EVENT,
                serde_json::json!({ "indexing": true, "done": done, "total": total, "currentBook": current }),
            );
        };
        loop {
            flags.stale.store(false, Ordering::SeqCst);
            if let Err(err) = reconcile(&library_dir, &store, &flags, &report) {
                log::warn!("local search index: {}", err.message);
                break;
            }
            if flags.cancel.load(Ordering::SeqCst) || !flags.stale.load(Ordering::SeqCst) {
                break;
            }
        }
        *flags.progress.lock().unwrap_or_else(|e| e.into_inner()) = (0, 0);
        flags.indexing.store(false, Ordering::SeqCst);
        *flags.current_book.lock().unwrap_or_else(|e| e.into_inner()) = None;
        let _ = app.emit(
            PROGRESS_EVENT,
            serde_json::json!({ "indexing": false, "done": 0, "total": 0, "currentBook": null }),
        );
    });
}

/// Drop every row for one book, returning the byte budget it was holding.
fn forget_book(conn: &Connection, book_id: i64) -> Result<i64, ApiError> {
    let bytes: i64 = conn
        .query_row(
            "SELECT bytes FROM search_books WHERE book_id = ?1",
            params![book_id],
            |r| r.get(0),
        )
        .optional()?
        .unwrap_or(0);
    conn.execute(
        "DELETE FROM search_fts WHERE rowid IN (SELECT id FROM search_segments WHERE book_id = ?1)",
        params![book_id],
    )?;
    conn.execute("DELETE FROM search_segments WHERE book_id = ?1", params![book_id])?;
    conn.execute("DELETE FROM search_books WHERE book_id = ?1", params![book_id])?;
    Ok(bytes)
}

/// One pass over the catalog: forget books that left, (re)index books whose
/// file changed, leave everything else alone.
fn reconcile(
    library_dir: &Path,
    store: &CatalogStore,
    flags: &SearchFlags,
    report: &dyn Fn(u64, u64, Option<&str>),
) -> Result<(), ApiError> {
    let catalog = store
        .load()
        .map_err(|e| ApiError::local(format!("read catalog: {e}")))?;
    let mut conn = open_db(library_dir)?;

    let known: Vec<i64> = conn
        .prepare("SELECT book_id FROM search_books")?
        .query_map([], |row| row.get(0))?
        .collect::<Result<_, _>>()?;
    for id in known {
        if !catalog.books.iter().any(|book| book.id == id) {
            forget_book(&conn, id)?;
        }
    }

    let mut work: Vec<(LocalBook, PathBuf, String)> = Vec::new();
    for book in &catalog.books {
        if !supported(&book.ext) {
            continue;
        }
        let path = book_path(library_dir, book);
        // A missing file (unplugged drive, moved linked book) keeps whatever we
        // already indexed: losing search results is worse than a stale hit.
        let Some(fp) = fingerprint(&path) else { continue };
        let current: Option<String> = conn
            .query_row(
                "SELECT fingerprint FROM search_books WHERE book_id = ?1",
                params![book.id],
                |row| row.get(0),
            )
            .optional()?;
        if current.as_deref() == Some(fp.as_str()) {
            continue;
        }
        work.push((book.clone(), path, fp));
    }

    let total = work.len() as u64;
    if total == 0 {
        return Ok(());
    }
    let mut used: i64 = conn.query_row("SELECT COALESCE(SUM(bytes), 0) FROM search_books", [], |r| r.get(0))?;
    let mut done = 0u64;
    progress(flags, report, done, total, None);

    for (book, path, fp) in work {
        if flags.cancel.load(Ordering::SeqCst) {
            break;
        }
        *flags.current_book.lock().unwrap_or_else(|e| e.into_inner()) = Some(book.title.clone());
        report(done, total, Some(&book.title));
        used -= forget_book(&conn, book.id)?;

        let (mut status, mut segments) = match extract(&path, &book.ext) {
            Ok(segments) if segments.is_empty() => ("empty", Vec::new()),
            Ok(segments) => ("indexed", segments),
            Err(err) => {
                log::warn!("search index: {} — {}", book.title, err.message);
                ("failed", Vec::new())
            }
        };
        let mut bytes: i64 = segments.iter().map(|s| s.body.len() as i64).sum();
        if used + bytes > MAX_INDEX_BYTES {
            // Recorded, not retried: the fingerprint is stored either way, so a
            // full index does not re-extract the same book on every pass.
            status = "capped";
            segments = Vec::new();
            bytes = 0;
        }

        let tx = conn.transaction()?;
        {
            let mut insert_segment = tx.prepare(
                "INSERT INTO search_segments(book_id, ordinal, kind, target, label) VALUES (?1, ?2, ?3, ?4, ?5)",
            )?;
            let mut insert_body = tx.prepare("INSERT INTO search_fts(rowid, body) VALUES (?1, ?2)")?;
            for segment in &segments {
                insert_segment.execute(params![
                    book.id,
                    segment.ordinal,
                    segment.kind,
                    segment.target,
                    segment.label
                ])?;
                insert_body.execute(params![tx.last_insert_rowid(), segment.body])?;
            }
        }
        tx.execute(
            "INSERT OR REPLACE INTO search_books(book_id, title, fingerprint, bytes, status, indexed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![book.id, book.title, fp, bytes, status, now_ms()],
        )?;
        tx.commit()?;

        used += bytes;
        done += 1;
        progress(flags, report, done, total, None);
        // The worker is deliberately cooperative: a short pause after each
        // book keeps indexing off the foreground path without making a large
        // library feel abandoned. Cancellation is checked on the next pass.
        std::thread::sleep(INDEX_PAUSE);
    }
    Ok(())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn progress(
    flags: &SearchFlags,
    report: &dyn Fn(u64, u64, Option<&str>),
    done: u64,
    total: u64,
    current: Option<&str>,
) {
    *flags.progress.lock().unwrap_or_else(|e| e.into_inner()) = (done, total);
    *flags.current_book.lock().unwrap_or_else(|e| e.into_inner()) = current.map(str::to_string);
    report(done, total, current);
}

// ------------------------------------------------------------- the queries

/// Turn free-typed text into an FTS5 MATCH expression.
///
/// Every token is quoted (so punctuation, `AND`, `-` and friends are data, not
/// syntax) and the last one gets a prefix `*` so results appear while typing.
fn fts_query(raw: &str) -> Option<String> {
    let mut tokens: Vec<String> = raw
        .split_whitespace()
        .map(|word| {
            word.chars()
                .filter(|c| c.is_alphanumeric() || *c == '\'' || *c == '-')
                .collect::<String>()
        })
        .filter(|word| !word.is_empty())
        .map(|word| format!("\"{word}\""))
        .collect();
    let last = tokens.last_mut()?;
    last.push('*');
    Some(tokens.join(" AND "))
}

fn search_index(library_dir: &Path, query: &str) -> Result<Vec<LocalSearchHit>, ApiError> {
    let Some(expression) = fts_query(query) else {
        return Ok(Vec::new());
    };
    let conn = open_db(library_dir)?;
    let mut stmt = conn.prepare(
        "SELECT s.book_id, b.title, s.kind, s.target, s.label,
                snippet(search_fts, 0, '', '', '…', 20)
         FROM search_fts
         JOIN search_segments s ON s.id = search_fts.rowid
         JOIN search_books b ON b.book_id = s.book_id
         WHERE search_fts MATCH ?1
         ORDER BY rank
         LIMIT 200",
    )?;
    let rows = stmt.query_map(params![expression], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, String>(5)?,
        ))
    })?;

    // Group by book, best-ranked first, so one chatty book cannot crowd the
    // list out — while still offering a few passages to jump straight to.
    let mut order: Vec<i64> = Vec::new();
    let mut per_book: std::collections::HashMap<i64, Vec<LocalSearchHit>> = std::collections::HashMap::new();
    for row in rows {
        let (id, title, kind, target, label, snippet) = row?;
        if !per_book.contains_key(&id) {
            if order.len() >= MAX_RESULT_BOOKS {
                continue;
            }
            order.push(id);
        }
        let hits = per_book.entry(id).or_default();
        if hits.len() >= MAX_RESULT_SEGMENTS {
            continue;
        }
        let target = if kind == "page" {
            serde_json::Value::from(target.parse::<i64>().unwrap_or(0))
        } else {
            serde_json::Value::String(target)
        };
        hits.push(LocalSearchHit {
            id,
            title,
            label,
            snippet,
            target,
        });
    }
    Ok(order
        .into_iter()
        .filter_map(|id| per_book.remove(&id))
        .flatten()
        .collect())
}

fn read_settings(state: &AppState) -> SearchSettings {
    let enabled = read_stored(state).enabled;
    let (done, total) = *state.search.progress.lock().unwrap_or_else(|e| e.into_inner());
    let current_book = state
        .search
        .current_book
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let (indexed_books, indexed_bytes, capped_books) = open_db(&state.library_dir)
        .and_then(|conn| {
            let indexed: i64 =
                conn.query_row("SELECT COUNT(*) FROM search_books WHERE status = 'indexed'", [], |r| {
                    r.get(0)
                })?;
            let bytes: i64 = conn.query_row("SELECT COALESCE(SUM(bytes), 0) FROM search_books", [], |r| r.get(0))?;
            let capped: i64 = conn.query_row("SELECT COUNT(*) FROM search_books WHERE status = 'capped'", [], |r| {
                r.get(0)
            })?;
            Ok((indexed, bytes, capped))
        })
        .unwrap_or((0, 0, 0));

    SearchSettings {
        enabled,
        indexed_bytes: indexed_bytes.max(0) as u64,
        indexed_books: indexed_books.max(0) as u64,
        max_bytes: MAX_INDEX_BYTES as u64,
        capped_books: capped_books.max(0) as u64,
        indexing: state.search.indexing.load(Ordering::SeqCst),
        done,
        total,
        current_book,
    }
}

pub(crate) fn clear_index(state: &AppState) -> Result<(), ApiError> {
    let conn = open_db(&state.library_dir)?;
    conn.execute_batch(
        "DELETE FROM search_fts;
         DELETE FROM search_segments;
         DELETE FROM search_books;",
    )?;
    Ok(())
}

// ------------------------------------------------------------------ commands

#[tauri::command]
pub async fn local_search_settings<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
) -> Result<SearchSettings, ApiError> {
    // Opening the panel may discover pending work, but reading settings must
    // not itself restart a completed pass. The panel reloads after the final
    // progress event, so an unconditional kick here creates an indexing loop.
    if state.search.stale.load(Ordering::SeqCst) {
        kick(&app, &state);
    }
    Ok(read_settings(&state))
}

#[tauri::command]
pub async fn local_set_search_enabled<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<SearchSettings, ApiError> {
    write_stored(&state, &StoredSettings { enabled })?;
    if enabled {
        invalidate_index(&state);
        kick(&app, &state);
    } else {
        // Turning search off gives the storage back, not just the feature.
        state.search.cancel.store(true, Ordering::SeqCst);
        clear_index(&state)?;
    }
    Ok(read_settings(&state))
}

#[tauri::command]
pub async fn local_reindex_search<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
) -> Result<SearchSettings, ApiError> {
    state.search.cancel.store(true, Ordering::SeqCst);
    clear_index(&state)?;
    invalidate_index(&state);
    kick(&app, &state);
    Ok(read_settings(&state))
}

#[tauri::command]
pub async fn local_search<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    query: String,
) -> Result<Vec<LocalSearchHit>, ApiError> {
    if query.trim().is_empty() || !read_stored(&state).enabled {
        return Ok(Vec::new());
    }
    // Never block the query on the index: answer from what is already there and
    // let the background pass fill in the rest (the UI shows its progress).
    if state.search.stale.load(Ordering::SeqCst) {
        kick(&app, &state);
    }
    search_index(&state.library_dir, &query)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cb8-search-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn index_segments(dir: &Path, book_id: i64, title: &str, segments: &[Segment]) {
        let mut conn = open_db(dir).unwrap();
        let tx = conn.transaction().unwrap();
        for segment in segments {
            tx.execute(
                "INSERT INTO search_segments(book_id, ordinal, kind, target, label) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![book_id, segment.ordinal, segment.kind, segment.target, segment.label],
            )
            .unwrap();
            tx.execute(
                "INSERT INTO search_fts(rowid, body) VALUES (?1, ?2)",
                params![tx.last_insert_rowid(), segment.body],
            )
            .unwrap();
        }
        tx.execute(
            "INSERT OR REPLACE INTO search_books(book_id, title, fingerprint, bytes, status, indexed_at)
             VALUES (?1, ?2, 'fp', 0, 'indexed', 0)",
            params![book_id, title],
        )
        .unwrap();
        tx.commit().unwrap();
    }

    /// A minimal but real EPUB: container → OPF → two spine documents, laid out
    /// with an `OEBPS/` root so the resolved hrefs exercise the same path join
    /// the frontend does.
    fn write_epub(path: &Path) {
        let file = std::fs::File::create(path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let options: zip::write::FileOptions<()> = zip::write::FileOptions::default();
        let mut add = |name: &str, body: &str| {
            zip.start_file(name, options).unwrap();
            std::io::Write::write_all(&mut zip, body.as_bytes()).unwrap();
        };
        add(
            "META-INF/container.xml",
            r#"<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>"#,
        );
        add(
            "OEBPS/content.opf",
            r#"<package><manifest>
                 <item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
                 <item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
                 <item id="skip" href="text/ads.xhtml" media-type="application/xhtml+xml"/>
               </manifest>
               <spine>
                 <itemref idref="c1"/>
                 <itemref idref="c2"/>
                 <itemref idref="skip" linear="no"/>
               </spine></package>"#,
        );
        add(
            "OEBPS/text/ch1.xhtml",
            "<html><head><title>The Lighthouse</title></head><body><p>A keeper walked the stair.</p></body></html>",
        );
        add(
            "OEBPS/text/ch2.xhtml",
            "<html><head><title>The Harbour</title></head><body><p>Fog settled on the quay.</p></body></html>",
        );
        add(
            "OEBPS/text/ads.xhtml",
            "<html><head><title>Ads</title></head><body><p>Fog of advertising.</p></body></html>",
        );
        zip.finish().unwrap();
    }

    fn catalog_with_book(dir: &Path, file: &str, ext: &str) -> CatalogStore {
        let (store, mut catalog) = CatalogStore::open(dir).unwrap();
        catalog.books.push(
            serde_json::from_value(serde_json::json!({
                "id": 1, "title": "Test Book", "file": file, "ext": ext,
                "mediaType": "book", "bytes": 1, "addedAt": 1,
            }))
            .unwrap(),
        );
        catalog.next_id = 2;
        store.persist(&crate::local::Catalog::default(), &catalog).unwrap();
        store
    }

    #[test]
    fn indexes_an_epub_into_deep_linkable_passages() {
        let dir = temp_dir("epub");
        std::fs::create_dir_all(dir.join("books")).unwrap();
        write_epub(&dir.join("books/a.epub"));
        let store = catalog_with_book(&dir, "books/a.epub", "epub");
        let flags = SearchFlags::default();

        reconcile(&dir, &store, &flags, &|_, _| {}).unwrap();

        let hits = search_index(&dir, "lighthouse").unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].label, "The Lighthouse");
        let locator: serde_json::Value = serde_json::from_str(hits[0].target.as_str().unwrap()).unwrap();
        assert_eq!(locator["href"], "OEBPS/text/ch1.xhtml");

        // `linear="no"` is outside the reading order, so it is not searchable —
        // matching what the reader would navigate to.
        assert_eq!(search_index(&dir, "advertising").unwrap().len(), 0);
        assert_eq!(search_index(&dir, "fog").unwrap()[0].label, "The Harbour");

        // Unchanged files are not re-extracted, and a removed book is forgotten.
        let conn = open_db(&dir).unwrap();
        let indexed_at: i64 = conn
            .query_row("SELECT indexed_at FROM search_books WHERE book_id = 1", [], |r| {
                r.get(0)
            })
            .unwrap();
        reconcile(&dir, &store, &flags, &|_, _| {}).unwrap();
        let again: i64 = conn
            .query_row("SELECT indexed_at FROM search_books WHERE book_id = 1", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(indexed_at, again);

        let before = store.load().unwrap();
        store.persist(&before, &crate::local::Catalog::default()).unwrap();
        reconcile(&dir, &store, &flags, &|_, _| {}).unwrap();
        assert!(search_index(&dir, "lighthouse").unwrap().is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_cancelled_run_stops_and_leaves_the_rest_queued() {
        let dir = temp_dir("cancel");
        std::fs::create_dir_all(dir.join("books")).unwrap();
        write_epub(&dir.join("books/a.epub"));
        let store = catalog_with_book(&dir, "books/a.epub", "epub");
        let flags = SearchFlags::default();
        flags.cancel.store(true, Ordering::SeqCst);

        reconcile(&dir, &store, &flags, &|_, _| {}).unwrap();
        assert!(search_index(&dir, "lighthouse").unwrap().is_empty());

        // The book was never fingerprinted, so the next pass still picks it up.
        flags.cancel.store(false, Ordering::SeqCst);
        reconcile(&dir, &store, &flags, &|_, _| {}).unwrap();
        assert_eq!(search_index(&dir, "lighthouse").unwrap().len(), 1);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn strips_markup_and_collapses_whitespace() {
        assert_eq!(strip_markup("<p>Hello <em>world</em></p>\nnext"), "Hello world next");
    }

    #[test]
    fn document_label_prefers_the_title_element() {
        let raw = "<html><head><title>Chapter Four</title></head><body><h1>Ignored</h1></body></html>";
        assert_eq!(document_label(raw).as_deref(), Some("Chapter Four"));
    }

    #[test]
    fn user_text_becomes_a_safe_prefix_match() {
        assert_eq!(fts_query("local search").as_deref(), Some("\"local\" AND \"search\"*"));
        // Operators and punctuation are data, never syntax.
        assert_eq!(fts_query("NOT (a)").as_deref(), Some("\"NOT\" AND \"a\"*"));
        assert!(fts_query("   ").is_none());
    }

    #[test]
    fn chunks_are_bounded_and_cover_the_text() {
        let text = "word ".repeat(1200);
        let chunks = chunk_text(text.trim());
        assert!(chunks.len() > 1);
        assert!(chunks.iter().all(|(_, body)| body.chars().count() <= SEGMENT_CHARS));
        assert_eq!(chunks[0].0, 0);
        assert!(chunks[1].0 > 0);
    }

    #[test]
    fn spine_paths_resolve_like_the_frontend() {
        assert_eq!(
            resolve_zip_path("OEBPS/content.opf", "text/ch1.xhtml"),
            "OEBPS/text/ch1.xhtml"
        );
        assert_eq!(resolve_zip_path("OEBPS/content.opf", "../ch1.xhtml"), "ch1.xhtml");
        assert_eq!(resolve_zip_path("content.opf", "ch1.xhtml"), "ch1.xhtml");
    }

    #[test]
    fn hits_carry_the_deep_link_and_group_by_book() {
        let dir = temp_dir("hits");
        index_segments(
            &dir,
            1,
            "A Book",
            &[
                Segment {
                    ordinal: 0,
                    kind: "locator",
                    target: locator_json("OEBPS/ch1.xhtml", 0.5, "the lighthouse"),
                    label: "Chapter One".into(),
                    body: "the lighthouse kept turning".into(),
                },
                Segment {
                    ordinal: 1,
                    kind: "locator",
                    target: locator_json("OEBPS/ch2.xhtml", 0.0, "lighthouse again"),
                    label: "Chapter Two".into(),
                    body: "lighthouse again at dawn".into(),
                },
            ],
        );
        index_segments(
            &dir,
            2,
            "Other",
            &[Segment {
                ordinal: 0,
                kind: "page",
                target: "11".into(),
                label: "Page 12".into(),
                body: "a lighthouse on page twelve".into(),
            }],
        );

        let hits = search_index(&dir, "lighthouse").unwrap();
        assert_eq!(hits.len(), 3);
        assert!(hits.iter().any(|h| h.label == "Chapter Two"));
        let page_hit = hits.iter().find(|h| h.id == 2).unwrap();
        assert_eq!(page_hit.target, serde_json::Value::from(11));
        let epub_hit = hits.iter().find(|h| h.label == "Chapter One").unwrap();
        let locator: serde_json::Value = serde_json::from_str(epub_hit.target.as_str().unwrap()).unwrap();
        assert_eq!(locator["href"], "OEBPS/ch1.xhtml");
        assert_eq!(locator["locations"]["progression"], 0.5);
        assert!(epub_hit.snippet.to_lowercase().contains("lighthouse"));

        // Forgetting a book takes its passages with it.
        let conn = open_db(&dir).unwrap();
        forget_book(&conn, 1).unwrap();
        assert!(search_index(&dir, "lighthouse").unwrap().iter().all(|h| h.id == 2));
        let _ = std::fs::remove_dir_all(dir);
    }
}
