//! `cb8` custom URI scheme handler + on-disk media cache.
//!
//! The frontend loads binary media (covers, comic pages, book files) through a
//! custom scheme instead of `fetch`, so the Rust side can attach the session
//! cookie and cache large blobs on disk. URLs arrive as:
//!
//! - `cb8://localhost/api/...` on macOS / iOS / Linux
//! - `http://cb8.localhost/api/...` on Windows / Android
//!
//! In both cases only the path+query matter (the host is synthetic), so we key
//! purely off `uri.path()` / `uri.query()`.
//!
//! Caching is cache-first: a hit is served straight from disk without touching
//! the network. Only 200 responses for "heavy" paths (`/pages/`, `/thumbnail`,
//! `/file`) are cached, keyed by `sha256(server_url + path_and_query)` with a
//! `<key>.bin` blob plus a `<key>.json` sidecar holding the content type.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::http::{header, Method, Request, Response, StatusCode};
use tauri::{Manager, Runtime, UriSchemeContext, UriSchemeResponder};
use tokio::sync::Notify;

use crate::downloads;
use crate::error::{ApiError, ApiResult};
use crate::local;
use crate::state::{AppState, CacheInflight};

/// Custom scheme name registered with the Tauri builder.
pub const SCHEME: &str = "cb8";

/// Soft cap on the on-disk media cache (768 MiB).
const CACHE_CAP: u64 = 768 * 1024 * 1024;
/// After the cap is exceeded we evict down to this watermark (90% of the cap).
const EVICT_TARGET: u64 = CACHE_CAP / 10 * 9;

const HDR_CACHE_CONTROL: &str = "public, max-age=3600";
const CT_OCTET: &str = "application/octet-stream";
const CT_TEXT: &str = "text/plain; charset=utf-8";

/// Sidecar metadata stored next to each cached blob.
#[derive(Serialize, Deserialize)]
struct Sidecar {
    content_type: String,
}

/// Register the `cb8` scheme on the Tauri builder. Each request is handled on
/// the async runtime so the (blocking-ish) network + disk work never stalls the
/// webview's protocol thread.
pub fn register<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let app = ctx.app_handle().clone();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>();
        handle(&state, request, responder).await;
    });
}

/// Core request handler: validate, serve from cache, else forward + cache.
async fn handle(state: &AppState, request: Request<Vec<u8>>, responder: UriSchemeResponder) {
    if request.method() != Method::GET {
        return respond_error(responder, StatusCode::METHOD_NOT_ALLOWED, "Only GET is supported");
    }

    let uri = request.uri();
    let path = uri.path().to_string();

    // --- Local library media: never touches the network or the cache. ---
    // `<img src="cb8://localhost/local/3/page/7">` works unchanged whether the
    // book came from a server or a file import, which is the point of routing
    // local media through the same scheme.
    if path.starts_with("/local/") {
        return serve_local(state, responder, &path).await;
    }

    if !path.starts_with("/api/") {
        return respond_error(responder, StatusCode::NOT_FOUND, "Path must start with /api/");
    }

    let server = match state.config.read().await.server_url.clone() {
        Some(server) => server,
        None => {
            return respond_error(
                responder,
                StatusCode::SERVICE_UNAVAILABLE,
                "No server configured",
            )
        }
    };

    let has_query = matches!(uri.query(), Some(query) if !query.is_empty());
    let path_and_query = match uri.query() {
        Some(query) if !query.is_empty() => format!("{path}?{query}"),
        _ => path.clone(),
    };
    let cacheable = is_cacheable(&path);
    let key = cache_key(&server, &path_and_query);

    // --- Ranged requests stream straight through, uncached. ---
    // pdf.js fetches a large PDF one byte-range per visible page (see
    // lib/pdf.ts's PDFDataRangeTransport). Buffering the whole upstream body to
    // answer a range would defeat the point — a 500 MB textbook would download
    // in full and blow past the webview's memory limit. So a request carrying a
    // Range header is forwarded with that header and its 206 returned verbatim;
    // partial bodies are never cached or pinned.
    if let Some(range) = request
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
    {
        let url = format!("{server}{path_and_query}");
        return forward_range(state, responder, &url, range).await;
    }

    // --- Cache-first: serve an LRU hit without any network access. ---
    if cacheable {
        if let Some((body, content_type)) = read_cache(&state.cache_dir, &key) {
            return respond_bytes(responder, StatusCode::OK, &content_type, body);
        }
    }

    // --- Pinned, exact-path requests: serve offline-first (before the network).
    // A width-hinted request keeps a query, so it prefers the network for a
    // crisper-per-byte result and only falls back to the pinned full-res copy
    // when the network errors (handled below). ---
    if cacheable && !has_query {
        if let Some((body, content_type)) = downloads::lookup_pinned(state, &server, &path).await {
            return respond_pinned(responder, &content_type, body);
        }
    }

    // --- Coalesce concurrent misses for the same cache key. ---
    // Grid + continue card + thumb strip + preloader often request the same
    // cold image together; only one fetch should hit the network.
    if cacheable {
        let waiter = {
            let mut map = state.cache_inflight.lock().await;
            if let Some(existing) = map.get(&key) {
                Some(existing.notify.clone())
            } else {
                let notify = Arc::new(Notify::new());
                map.insert(
                    key.clone(),
                    CacheInflight {
                        notify: notify.clone(),
                    },
                );
                // Leader: None means we own the fill.
                drop(map);
                None
            }
        };

        if let Some(notify) = waiter {
            notify.notified().await;
            if let Some((body, content_type)) = read_cache(&state.cache_dir, &key) {
                return respond_bytes(responder, StatusCode::OK, &content_type, body);
            }
            // Leader failed or wrote nothing — fall through and try ourselves
            // (register as a new leader if still missing).
            let mut map = state.cache_inflight.lock().await;
            if let Some(existing) = map.get(&key) {
                let n = existing.notify.clone();
                drop(map);
                n.notified().await;
                if let Some((body, content_type)) = read_cache(&state.cache_dir, &key) {
                    return respond_bytes(responder, StatusCode::OK, &content_type, body);
                }
            } else {
                let notify = Arc::new(Notify::new());
                map.insert(
                    key.clone(),
                    CacheInflight {
                        notify: notify.clone(),
                    },
                );
            }
        }
    }

    // --- Miss: forward upstream with the session cookie attached. ---
    let url = format!("{server}{path_and_query}");
    let fetch_result = async {
        let response = state.client.get(&url).send().await.map_err(ApiError::from)?;
        let status = response.status();
        let content_type = response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string)
            .unwrap_or_else(|| CT_OCTET.to_string());
        let body = response.bytes().await.map_err(ApiError::from)?.to_vec();
        Ok::<_, ApiError>((status, content_type, body))
    }
    .await;

    let finish_inflight = async {
        if cacheable {
            let mut map = state.cache_inflight.lock().await;
            if let Some(entry) = map.remove(&key) {
                entry.notify.notify_waiters();
            }
        }
    };

    let (status, content_type, body) = match fetch_result {
        Ok(triple) => triple,
        Err(err) => {
            finish_inflight.await;
            // Transport error → fall back to a pinned copy if we have one (this
            // is the offline path for width-hinted requests too).
            if cacheable {
                if let Some((body, content_type)) =
                    downloads::lookup_pinned(state, &server, &path).await
                {
                    return respond_pinned(responder, &content_type, body);
                }
            }
            return respond_error(responder, StatusCode::BAD_GATEWAY, &err.message);
        }
    };

    // Cache only successful, cacheable payloads.
    if cacheable && status.as_u16() == 200 {
        match write_cache(&state.cache_dir, &key, &body, &content_type) {
            Ok(added) => record_write(state, added).await,
            Err(err) => log::warn!("media cache write failed for {path}: {}", err.message),
        }
    }

    finish_inflight.await;

    let out_status = StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    respond_bytes(responder, out_status, &content_type, body);
}

/// Heavy binary endpoints worth caching on disk. `path` is the query-less path.
fn is_cacheable(path: &str) -> bool {
    path.contains("/pages/") || path.ends_with("/thumbnail") || path.ends_with("/file")
}

/// Deterministic cache key: `sha256(server_url + path_and_query)` as hex.
fn cache_key(server_url: &str, path_and_query: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(server_url.as_bytes());
    hasher.update(path_and_query.as_bytes());
    hex::encode(hasher.finalize())
}

fn bin_path(dir: &Path, key: &str) -> PathBuf {
    dir.join(format!("{key}.bin"))
}

fn meta_path(dir: &Path, key: &str) -> PathBuf {
    dir.join(format!("{key}.json"))
}

/// Read a cached entry (blob + content type). Requires both files present.
fn read_cache(dir: &Path, key: &str) -> Option<(Vec<u8>, String)> {
    let body = fs::read(bin_path(dir, key)).ok()?;
    let meta = fs::read(meta_path(dir, key)).ok()?;
    let sidecar: Sidecar = serde_json::from_slice(&meta).ok()?;
    Some((body, sidecar.content_type))
}

/// Persist a blob + sidecar. Returns the total bytes written (blob + sidecar).
fn write_cache(dir: &Path, key: &str, body: &[u8], content_type: &str) -> ApiResult<u64> {
    let sidecar = serde_json::to_vec(&Sidecar { content_type: content_type.to_string() })
        .map_err(|err| ApiError::local(format!("serialize sidecar: {err}")))?;
    fs::write(bin_path(dir, key), body)?;
    fs::write(meta_path(dir, key), &sidecar)?;
    Ok(body.len() as u64 + sidecar.len() as u64)
}

/// Update the in-memory byte counter after a write and evict if over cap.
async fn record_write(state: &AppState, added: u64) {
    let mut guard = state.cache_size.lock().await;
    // If the counter was never initialized, a fresh scan already reflects the
    // just-written file, so don't double-count `added`.
    let mut total = match *guard {
        Some(current) => current + added,
        None => scan_dir_size(&state.cache_dir),
    };
    if total > CACHE_CAP {
        total = evict(&state.cache_dir, EVICT_TARGET);
    }
    *guard = Some(total);
}

/// Sum of every file's length under `dir` (non-recursive; cache is flat).
fn scan_dir_size(dir: &Path) -> u64 {
    let mut total = 0;
    if let Ok(entries) = fs::read_dir(dir) {
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

/// One cached blob + its sidecar, tracked for LRU eviction.
struct CacheEntry {
    key: String,
    mtime: SystemTime,
    size: u64,
}

/// Evict oldest-mtime entries until the cache is at or below `target` bytes.
/// Returns the resulting on-disk size (self-correcting, recomputed from scratch).
fn evict(dir: &Path, target: u64) -> u64 {
    let mut entries: Vec<CacheEntry> = Vec::new();
    let mut total = 0u64;

    if let Ok(read) = fs::read_dir(dir) {
        for entry in read.flatten() {
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("bin") {
                continue;
            }
            let Some(key) = path.file_stem().and_then(|s| s.to_str()).map(str::to_string) else {
                continue;
            };
            let bin_meta = match entry.metadata() {
                Ok(meta) => meta,
                Err(_) => continue,
            };
            let mtime = bin_meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
            let meta_len = fs::metadata(meta_path(dir, &key)).map(|m| m.len()).unwrap_or(0);
            let size = bin_meta.len() + meta_len;
            total += size;
            entries.push(CacheEntry { key, mtime, size });
        }
    }

    if total <= target {
        return total;
    }

    // Oldest first.
    entries.sort_by_key(|entry| entry.mtime);
    for entry in entries {
        if total <= target {
            break;
        }
        let _ = fs::remove_file(bin_path(dir, &entry.key));
        let _ = fs::remove_file(meta_path(dir, &entry.key));
        total = total.saturating_sub(entry.size);
    }
    total
}

/// Wipe the entire media cache. Returns bytes freed.
pub async fn clear_cache(state: &AppState) -> ApiResult<u64> {
    let dir = state.cache_dir.clone();
    let mut guard = state.cache_size.lock().await;

    let mut freed = 0u64;
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let len = entry.metadata().map(|meta| meta.len()).unwrap_or(0);
            if fs::remove_file(&path).is_ok() {
                freed += len;
            }
        }
    }
    *guard = Some(0);
    Ok(freed)
}

/// Serve a local-library asset: `/local/<id>/cover`, `/local/<id>/page/<n>`, or
/// `/local/<id>/file`. Responses are `no-store`: a local cover can be replaced
/// the moment the client renders a better one, and re-reading a file on disk is
/// cheap enough that a stale webview cache is pure downside.
async fn serve_local(state: &AppState, responder: UriSchemeResponder, path: &str) {
    let parts: Vec<&str> = path.trim_matches('/').split('/').collect();
    let id = parts.get(1).and_then(|s| s.parse::<i64>().ok());
    let Some(id) = id else {
        return respond_error(responder, StatusCode::NOT_FOUND, "Malformed local path");
    };

    let result = match parts.get(2).copied() {
        Some("cover") => local::read_cover(state, id).await,
        Some("file") => local::read_file(state, id).await,
        Some("page") => match parts.get(3).and_then(|s| s.parse::<usize>().ok()) {
            Some(index) => local::read_page(state, id, index).await,
            None => Err(ApiError::local("Malformed page index")),
        },
        _ => Err(ApiError::local("Unknown local resource")),
    };

    match result {
        Ok((body, content_type)) => {
            let response = Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, content_type)
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .header(header::CACHE_CONTROL, "no-store")
                .body(body)
                .unwrap_or_else(|_| Response::new(Vec::new()));
            responder.respond(response);
        }
        Err(err) => respond_error(responder, StatusCode::NOT_FOUND, &err.message),
    }
}

/// Forward a Range request upstream and return the partial response verbatim.
///
/// The response body is bounded by the client's requested range (a page's worth
/// of bytes, not the whole file), so buffering it is fine. `Content-Range`,
/// `Content-Length`, and `Accept-Ranges` are passed through so pdf.js can drive
/// its own paging; nothing here is cached (a partial body is not a cacheable
/// asset). A server that ignores the range and answers 200 is passed through
/// too — pdf.js copes, it just won't stream.
async fn forward_range(
    state: &AppState,
    responder: UriSchemeResponder,
    url: &str,
    range: &str,
) {
    let upstream = state
        .client
        .get(url)
        .header(header::RANGE, range)
        .send()
        .await;
    let response = match upstream {
        Ok(response) => response,
        Err(err) => {
            return respond_error(responder, StatusCode::BAD_GATEWAY, &ApiError::from(err).message)
        }
    };

    let status = StatusCode::from_u16(response.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let header_str = |name: header::HeaderName| {
        response
            .headers()
            .get(&name)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string)
    };
    let content_type = header_str(header::CONTENT_TYPE).unwrap_or_else(|| CT_OCTET.to_string());
    let content_range = header_str(header::CONTENT_RANGE);
    let content_length = header_str(header::CONTENT_LENGTH);

    let body = match response.bytes().await {
        Ok(bytes) => bytes.to_vec(),
        Err(err) => {
            return respond_error(responder, StatusCode::BAD_GATEWAY, &ApiError::from(err).message)
        }
    };

    let mut builder = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CACHE_CONTROL, "no-store");
    if let Some(cr) = content_range {
        builder = builder.header(header::CONTENT_RANGE, cr);
    }
    if let Some(cl) = content_length {
        builder = builder.header(header::CONTENT_LENGTH, cl);
    }
    let response = builder.body(body).unwrap_or_else(|_| Response::new(Vec::new()));
    responder.respond(response);
}

/// Build a response with the invariant headers (Content-Type, permissive CORS
/// so WKWebView `fetch` succeeds, and a modest cache hint).
fn respond_bytes(responder: UriSchemeResponder, status: StatusCode, content_type: &str, body: Vec<u8>) {
    // Only successes may be cached by the webview; a cached 401/502 image
    // would otherwise survive a re-login or a server coming back up.
    let cache_control = if status.is_success() { HDR_CACHE_CONTROL } else { "no-store" };
    let response = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CACHE_CONTROL, cache_control)
        .body(body)
        .unwrap_or_else(|_| Response::new(Vec::new()));
    responder.respond(response);
}

/// Serve bytes from the pinned (offline) store. Same invariant headers as a
/// normal hit, plus `X-Cache: PINNED` so callers can tell it came from a pin.
fn respond_pinned(responder: UriSchemeResponder, content_type: &str, body: Vec<u8>) {
    let response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CACHE_CONTROL, HDR_CACHE_CONTROL)
        .header("X-Cache", "PINNED")
        .body(body)
        .unwrap_or_else(|_| Response::new(Vec::new()));
    responder.respond(response);
}

fn respond_error(responder: UriSchemeResponder, status: StatusCode, message: &str) {
    respond_bytes(responder, status, CT_TEXT, message.as_bytes().to_vec());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cacheable_paths_are_classified() {
        assert!(is_cacheable("/api/comics/5/pages/0"));
        assert!(is_cacheable("/api/comics/5/pages/123"));
        assert!(is_cacheable("/api/comics/5/thumbnail"));
        assert!(is_cacheable("/api/comics/5/file"));
    }

    #[test]
    fn non_cacheable_paths_are_rejected() {
        assert!(!is_cacheable("/api/comics"));
        assert!(!is_cacheable("/api/comics/5"));
        assert!(!is_cacheable("/api/auth/session"));
        assert!(!is_cacheable("/api/comics/5/bookmarks"));
    }

    #[test]
    fn cache_key_is_deterministic_and_query_sensitive() {
        let a = cache_key("http://host:8008", "/api/comics/5/pages/0");
        let b = cache_key("http://host:8008", "/api/comics/5/pages/0");
        assert_eq!(a, b);
        assert_eq!(a.len(), 64); // sha256 hex

        let with_width = cache_key("http://host:8008", "/api/comics/5/pages/0?width=800");
        assert_ne!(a, with_width);

        let other_server = cache_key("http://other:8008", "/api/comics/5/pages/0");
        assert_ne!(a, other_server);
    }

    #[test]
    fn cache_paths_use_key_and_extension() {
        let dir = Path::new("/cache");
        assert_eq!(bin_path(dir, "abc"), Path::new("/cache/abc.bin"));
        assert_eq!(meta_path(dir, "abc"), Path::new("/cache/abc.json"));
    }

    #[tokio::test]
    async fn inflight_map_coalesces_waiters_onto_one_notify() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use tokio::sync::Mutex;

        let map: Mutex<std::collections::HashMap<String, CacheInflight>> =
            Mutex::new(std::collections::HashMap::new());
        let key = "same-key".to_string();
        let fetches = Arc::new(AtomicUsize::new(0));

        let leader_notify = {
            let mut g = map.lock().await;
            let n = Arc::new(Notify::new());
            g.insert(
                key.clone(),
                CacheInflight {
                    notify: n.clone(),
                },
            );
            n
        };

        let map = Arc::new(map);
        let map1 = map.clone();
        let map2 = map.clone();
        let key1 = key.clone();
        let key2 = key.clone();

        let waiter1 = async move {
            let n = {
                let g = map1.lock().await;
                g.get(&key1).map(|e| e.notify.clone())
            };
            if let Some(n) = n {
                n.notified().await;
            }
        };
        let waiter2 = async move {
            let n = {
                let g = map2.lock().await;
                g.get(&key2).map(|e| e.notify.clone())
            };
            if let Some(n) = n {
                n.notified().await;
            }
        };

        let map_l = map.clone();
        let key_l = key.clone();
        let fetches_l = fetches.clone();
        let leader = async move {
            fetches_l.fetch_add(1, Ordering::SeqCst);
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            let mut g = map_l.lock().await;
            if let Some(e) = g.remove(&key_l) {
                e.notify.notify_waiters();
            }
            let _ = &leader_notify;
        };

        tokio::join!(leader, waiter1, waiter2);
        assert_eq!(fetches.load(Ordering::SeqCst), 1);
        assert!(map.lock().await.is_empty());
    }
}
