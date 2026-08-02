//! Pure offline-pin policy (no I/O, no Tauri).
//!
//! Status derivation, cache keys, path keys, resume skip rules, and unit
//! planning live here so `downloads.rs` owns the async pin loop without
//! burying policy tests inside a large I/O module.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// High-level pin lifecycle for the UI (queued/active/paused/failed/complete).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DownloadStatus {
    Queued,
    Active,
    Paused,
    Failed,
    Complete,
}

/// Deterministic pin-directory key: `sha256(server_url + "|" + comic_id)`.
pub fn pin_key(server_url: &str, comic_id: i64) -> String {
    let mut hasher = Sha256::new();
    hasher.update(server_url.as_bytes());
    hasher.update(b"|");
    hasher.update(comic_id.to_string().as_bytes());
    hex::encode(hasher.finalize())
}

/// Strip a `?query` suffix, yielding the bare path used as a manifest key.
pub fn strip_query(path: &str) -> &str {
    match path.split_once('?') {
        Some((bare, _)) => bare,
        None => path,
    }
}

/// Parse the comic id out of a `/api/comics/{id}/...` path.
pub fn parse_comic_id(path: &str) -> Option<i64> {
    let rest = path.strip_prefix("/api/comics/")?;
    rest.split('/').next()?.parse().ok()
}

/// Skip a unit on resume when the recorded size matches a non-empty on-disk file.
pub fn should_skip(recorded_size: Option<u64>, on_disk_size: u64) -> bool {
    match recorded_size {
        Some(size) => on_disk_size > 0 && on_disk_size == size,
        None => false,
    }
}

/// Map manifest + in-flight bit to a UI status.
pub fn derive_status(
    complete: bool,
    active: bool,
    last_error: Option<&str>,
    done: i64,
) -> DownloadStatus {
    if complete {
        return DownloadStatus::Complete;
    }
    if active {
        return if done <= 0 {
            DownloadStatus::Queued
        } else {
            DownloadStatus::Active
        };
    }
    if last_error.is_some() {
        if last_error.is_some_and(|e| e.to_ascii_lowercase().contains("cancel")) {
            return DownloadStatus::Paused;
        }
        return DownloadStatus::Failed;
    }
    DownloadStatus::Paused
}

/// One work unit: the `/api` path to fetch, the on-disk file name, and whether
/// it counts toward `done` (the thumbnail does not).
#[derive(Debug, Clone)]
pub struct Unit {
    pub path: String,
    pub name: String,
    pub counted: bool,
}

pub fn plan_units(comic_id: i64, is_comic: bool, page_count: i64) -> Vec<Unit> {
    let mut units = Vec::new();
    units.push(Unit {
        path: format!("/api/comics/{comic_id}/thumbnail"),
        name: "thumbnail".to_string(),
        counted: false,
    });
    if is_comic {
        for i in 0..page_count.max(0) {
            units.push(Unit {
                path: format!("/api/comics/{comic_id}/pages/{i}"),
                name: format!("page-{i:06}"),
                counted: true,
            });
        }
    } else {
        units.push(Unit {
            path: format!("/api/comics/{comic_id}/file"),
            name: "file".to_string(),
            counted: true,
        });
    }
    units
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pin_key_is_deterministic_and_scoped() {
        let a = pin_key("http://host:8008", 5);
        assert_eq!(a, pin_key("http://host:8008", 5));
        assert_eq!(a.len(), 64);
        assert_ne!(a, pin_key("http://host:8008", 6));
        assert_ne!(a, pin_key("http://other:8008", 5));
        assert_ne!(
            pin_key("http://host:80085", 0),
            pin_key("http://host:8008", 50)
        );
    }

    #[test]
    fn strip_query_removes_only_the_query() {
        assert_eq!(strip_query("/api/comics/5/pages/0"), "/api/comics/5/pages/0");
        assert_eq!(
            strip_query("/api/comics/5/pages/0?width=800"),
            "/api/comics/5/pages/0"
        );
    }

    #[test]
    fn should_skip_only_on_matching_nonempty_size() {
        assert!(should_skip(Some(100), 100));
        assert!(!should_skip(Some(100), 0));
        assert!(!should_skip(Some(100), 99));
        assert!(!should_skip(None, 100));
    }

    #[test]
    fn derive_status_covers_lifecycle() {
        assert_eq!(derive_status(true, false, None, 10), DownloadStatus::Complete);
        assert_eq!(derive_status(false, true, None, 0), DownloadStatus::Queued);
        assert_eq!(derive_status(false, true, None, 3), DownloadStatus::Active);
        assert_eq!(
            derive_status(false, false, Some("Download cancelled — partial"), 2),
            DownloadStatus::Paused
        );
        assert_eq!(
            derive_status(false, false, Some("Server returned 500"), 1),
            DownloadStatus::Failed
        );
        assert_eq!(derive_status(false, false, None, 4), DownloadStatus::Paused);
    }

    #[test]
    fn plan_units_for_book_is_thumbnail_plus_file() {
        let u = plan_units(9, false, 0);
        assert_eq!(u.len(), 2);
        assert!(!u[0].counted);
        assert!(u[1].counted);
        assert!(u[1].path.ends_with("/file"));
    }
}
