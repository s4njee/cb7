//! Local full-text search for standalone books.
//!
//! The index is deliberately a boring JSON sidecar for now. It keeps the
//! feature available on mobile and desktop without adding a native database
//! dependency, while retaining the important product properties: text is
//! extracted off the UI thread, storage is capped, and indexing can be opted
//! out of. The sidecar is disposable and is rebuilt from the catalog/files.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::State;
use zip::ZipArchive;

use crate::error::ApiError;
use crate::local::LocalBook;
use crate::state::AppState;

const INDEX_FILE: &str = "search-index.json";
const MAX_INDEX_BYTES: usize = 64 * 1024 * 1024;
const MAX_BOOK_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSettings {
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub indexed_bytes: u64,
    #[serde(default)]
    pub indexed_books: u64,
}

fn default_enabled() -> bool {
    true
}

impl Default for SearchSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            indexed_bytes: 0,
            indexed_books: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct SearchIndex {
    #[serde(default)]
    books: Vec<IndexedBook>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IndexedBook {
    id: i64,
    title: String,
    ext: String,
    text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSearchHit {
    pub id: i64,
    pub title: String,
    pub snippet: String,
    pub count: u32,
}

fn index_path(state: &AppState) -> PathBuf {
    state.library_dir.join(INDEX_FILE)
}

/// The sidecar is disposable. Any catalog membership or file-content change
/// invalidates it so the next search rebuilds from the current library.
pub(crate) fn invalidate_index(state: &AppState) {
    let _ = std::fs::remove_file(index_path(state));
}

fn book_path(state: &AppState, book: &LocalBook) -> PathBuf {
    if book.source.as_deref() == Some("linked") {
        book.external_path.as_deref().map(PathBuf::from).unwrap_or_default()
    } else {
        state.library_dir.join(&book.file)
    }
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

fn epub_text(path: &Path) -> Result<String, ApiError> {
    let file = std::fs::File::open(path)?;
    let mut archive = ZipArchive::new(file).map_err(|e| ApiError::local(format!("open EPUB: {e}")))?;
    let mut chunks = Vec::new();
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| ApiError::local(format!("read EPUB: {e}")))?;
        let name = entry.name().to_ascii_lowercase();
        if !(name.ends_with(".xhtml") || name.ends_with(".html") || name.ends_with(".htm") || name.ends_with(".xml")) {
            continue;
        }
        let mut raw = String::new();
        std::io::Read::read_to_string(&mut entry, &mut raw).ok();
        chunks.push(strip_markup(&raw));
        if chunks.iter().map(String::len).sum::<usize>() >= MAX_BOOK_BYTES {
            break;
        }
    }
    Ok(chunks.join(" ").chars().take(MAX_BOOK_BYTES).collect())
}

/// PDF strings are often compressed or encoded, so this intentionally
/// best-effort extractor only indexes plain literal strings. The reader's
/// pdf.js path remains the authoritative in-book search implementation.
fn pdf_text(path: &Path) -> Result<String, ApiError> {
    let bytes = std::fs::read(path)?;
    let raw = String::from_utf8_lossy(&bytes);
    let mut out = String::new();
    let mut chars = raw.chars();
    while let Some(ch) = chars.next() {
        if ch != '(' {
            continue;
        }
        let mut part = String::new();
        let mut escaped = false;
        for c in chars.by_ref() {
            if escaped {
                part.push(c);
                escaped = false;
                continue;
            }
            if c == '\\' {
                escaped = true;
                continue;
            }
            if c == ')' {
                break;
            }
            if !c.is_control() {
                part.push(c);
            }
        }
        if part.len() > 2 {
            out.push_str(&part);
            out.push(' ');
        }
        if out.len() >= MAX_BOOK_BYTES {
            break;
        }
    }
    Ok(out.chars().take(MAX_BOOK_BYTES).collect())
}

fn extract(path: &Path, ext: &str) -> Result<String, ApiError> {
    match ext {
        "epub" => epub_text(path),
        "pdf" => pdf_text(path),
        _ => Ok(String::new()),
    }
}

fn load_index(path: &Path) -> SearchIndex {
    std::fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn save_index(path: &Path, index: &SearchIndex) -> Result<(), ApiError> {
    let tmp = path.with_extension("tmp");
    let bytes = serde_json::to_vec(index).map_err(|e| ApiError::local(format!("serialize search index: {e}")))?;
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(tmp, path)?;
    Ok(())
}

fn snippet(text: &str, query: &str) -> Option<(String, u32)> {
    let lower = text.to_lowercase();
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return None;
    }
    let first = lower.find(&needle)?;
    let count = lower.match_indices(&needle).count() as u32;
    let start = first.saturating_sub(90);
    let end = (first + needle.len() + 180).min(text.len());
    Some((
        format!(
            "{}{}{}",
            if start > 0 { "…" } else { "" },
            text.get(start..end)?.trim(),
            if end < text.len() { "…" } else { "" }
        ),
        count,
    ))
}

fn rebuild(state: &AppState) -> Result<SearchSettings, ApiError> {
    let settings_path = state.library_dir.join("search-settings.json");
    let mut settings: SearchSettings = std::fs::read(&settings_path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    if !settings.enabled {
        return Ok(settings);
    }
    let books = std::fs::read(state.library_dir.join("catalog.json"))
        .ok()
        .and_then(|b| serde_json::from_slice::<crate::local::Catalog>(&b).ok())
        .map(|c| c.books)
        .unwrap_or_default();
    let mut index = SearchIndex::default();
    let mut bytes = 0usize;
    for book in books {
        if bytes >= MAX_INDEX_BYTES || (book.ext != "epub" && book.ext != "pdf") {
            continue;
        }
        let path = book_path(state, &book);
        let Ok(text) = extract(&path, &book.ext) else {
            continue;
        };
        if text.is_empty() {
            continue;
        }
        let remaining = MAX_INDEX_BYTES.saturating_sub(bytes);
        let text: String = text.chars().take(remaining).collect();
        bytes += text.len();
        index.books.push(IndexedBook {
            id: book.id,
            title: book.title,
            ext: book.ext,
            text,
        });
    }
    save_index(&index_path(state), &index)?;
    settings.indexed_bytes = bytes as u64;
    settings.indexed_books = index.books.len() as u64;
    std::fs::write(settings_path, serde_json::to_vec_pretty(&settings).unwrap())?;
    Ok(settings)
}

#[tauri::command]
pub async fn local_search_settings(state: State<'_, AppState>) -> Result<SearchSettings, ApiError> {
    Ok(read_settings(&state))
}

fn read_settings(state: &AppState) -> SearchSettings {
    std::fs::read(state.library_dir.join("search-settings.json"))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub async fn local_set_search_enabled(state: State<'_, AppState>, enabled: bool) -> Result<SearchSettings, ApiError> {
    let path = state.library_dir.join("search-settings.json");
    let mut settings: SearchSettings = std::fs::read(&path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    settings.enabled = enabled;
    std::fs::write(path, serde_json::to_vec_pretty(&settings).unwrap())?;
    if !enabled {
        let _ = std::fs::remove_file(index_path(&state));
    }
    Ok(settings)
}

#[tauri::command]
pub async fn local_reindex_search(state: State<'_, AppState>) -> Result<SearchSettings, ApiError> {
    rebuild(&state)
}

#[tauri::command]
pub async fn local_search(state: State<'_, AppState>, query: String) -> Result<Vec<LocalSearchHit>, ApiError> {
    let q = query.trim().to_string();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let settings = read_settings(&state);
    if !settings.enabled {
        return Ok(Vec::new());
    }
    let path = index_path(&state);
    if !path.exists() {
        let _ = rebuild(&state)?;
    }
    let index = load_index(&path);
    Ok(index
        .books
        .into_iter()
        .filter_map(|b| {
            snippet(&b.text, &q).map(|(snippet, count)| LocalSearchHit {
                id: b.id,
                title: b.title,
                snippet,
                count,
            })
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::{snippet, strip_markup};

    #[test]
    fn strips_markup_and_collapses_whitespace() {
        assert_eq!(strip_markup("<p>Hello <em>world</em></p>\nnext"), "Hello world next");
    }

    #[test]
    fn returns_context_and_match_count() {
        let (text, count) = snippet(
            "A long introduction about local search. Local search is fast.",
            "local search",
        )
        .unwrap();
        assert_eq!(count, 2);
        assert!(text.to_lowercase().contains("local search"));
    }
}
