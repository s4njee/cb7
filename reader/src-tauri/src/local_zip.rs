//! CBZ/CBR archive helpers for the local library.
//!
//! Page listing, natural sort, and entry extraction live here so `local.rs`
//! can own catalog commands without also being an archive library.
//!
//! One bounded abstraction with two backends:
//! - **ZIP** (CBZ) via the `zip` crate;
//! - **RAR** (CBR) via the `unrar` crate (RARLAB's UnRAR C library, wrapped
//!   under MIT/Apache). Only *listing* and *entry reads* are used — a page is
//!   extracted on demand, never the whole comic, and nothing is written to
//!   disk from the archive, so path traversal is structurally impossible.
//!
//! The desktop build compiles both backends; mobile keeps the old
//! "CBR needs a server" behavior (see `local.rs`), so phone bundles stay lean.

use std::io::Read;
use std::path::Path;

use crate::error::{ApiError, ApiResult};

const IMAGE_EXTS: [&str; 7] = ["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp"];

pub(crate) fn is_image(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    // Skip macOS resource forks, which otherwise show up as phantom page 0.
    if lower.contains("__macosx/") || lower.rsplit('/').next().is_some_and(|f| f.starts_with("._")) {
        return false;
    }
    // Path-traversal hardening: an entry like `../evil.png` or
    // `a/../../evil.png` must never be treated as a page. The reader never
    // resolves entry names to disk paths, so this is belt-and-suspenders, but
    // a `..` segment is never a legitimate page name anyway.
    if lower.split('/').any(|seg| seg == "..") {
        return false;
    }
    IMAGE_EXTS.iter().any(|ext| lower.ends_with(&format!(".{ext}")))
}

/// Compare names the way a human reads page numbers: `page2` before `page10`.
/// Archives from different scanners pad inconsistently, so plain lexicographic
/// ordering shuffles a comic's pages.
pub(crate) fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let (a, b) = (a.to_ascii_lowercase(), b.to_ascii_lowercase());
    let (mut ai, mut bi) = (a.chars().peekable(), b.chars().peekable());
    loop {
        match (ai.peek().copied(), bi.peek().copied()) {
            (None, None) => return std::cmp::Ordering::Equal,
            (None, Some(_)) => return std::cmp::Ordering::Less,
            (Some(_), None) => return std::cmp::Ordering::Greater,
            (Some(x), Some(y)) => {
                if x.is_ascii_digit() && y.is_ascii_digit() {
                    let take = |it: &mut std::iter::Peekable<std::str::Chars>| {
                        let mut s = String::new();
                        while let Some(c) = it.peek().copied() {
                            if !c.is_ascii_digit() {
                                break;
                            }
                            s.push(c);
                            it.next();
                        }
                        s.trim_start_matches('0').to_string()
                    };
                    let (xs, ys) = (take(&mut ai), take(&mut bi));
                    // Longer digit run (after stripping zeros) = larger number.
                    let ord = xs.len().cmp(&ys.len()).then_with(|| xs.cmp(&ys));
                    if ord != std::cmp::Ordering::Equal {
                        return ord;
                    }
                } else {
                    if x != y {
                        return x.cmp(&y);
                    }
                    ai.next();
                    bi.next();
                }
            }
        }
    }
}

/// Ordered list of image entry names inside a CBZ.
pub(crate) fn zip_page_names(path: &Path) -> ApiResult<Vec<String>> {
    let file = std::fs::File::open(path)?;
    let archive =
        zip::ZipArchive::new(file).map_err(|err| ApiError::local(format!("Not a readable archive: {err}")))?;
    let mut names: Vec<String> = archive
        .file_names()
        .filter(|name| is_image(name))
        .map(str::to_string)
        .collect();
    names.sort_by(|a, b| natural_cmp(a, b));
    Ok(names)
}

/// Ordered list of image entry names inside a CBR (RAR). On-demand, like the
/// ZIP side: only entry headers are read, nothing is extracted to disk.
#[cfg(desktop)]
fn rar_page_names(path: &Path) -> ApiResult<Vec<String>> {
    let archive = unrar::Archive::new(path)
        .open_for_listing()
        .map_err(|err| ApiError::local(format!("Not a readable archive: {err}")))?;
    let mut names: Vec<String> = Vec::new();
    for entry in archive {
        let entry = entry.map_err(|err| ApiError::local(format!("Corrupt archive: {err}")))?;
        if entry.is_directory() {
            continue;
        }
        let name = entry.filename.to_string_lossy().into_owned();
        if is_image(&name) {
            names.push(name);
        }
    }
    names.sort_by(|a, b| natural_cmp(a, b));
    Ok(names)
}

/// Soft cap on a single entry read (one page image or a cover). Reading an
/// entry is inherently a whole-page memory operation, but a corrupt or
/// malicious archive can declare a huge uncompressed size up front — trusting
/// that claim for a `Vec::with_capacity` would abort on a bogus allocation, and
/// a zip-bomb entry would OOM the reader. 512 MiB is far beyond any real page
/// image while still bounding the damage.
const MAX_ENTRY_BYTES: u64 = 512 * 1024 * 1024;

/// Read one entry out of a zip by name.
pub(crate) fn zip_entry_bytes(path: &Path, name: &str) -> ApiResult<Vec<u8>> {
    let file = std::fs::File::open(path)?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|err| ApiError::local(format!("Not a readable archive: {err}")))?;
    let entry = archive
        .by_name(name)
        .map_err(|err| ApiError::local(format!("Missing page in archive: {err}")))?;
    // Don't pre-allocate from `entry.size()` (untrusted archive metadata) and
    // bound the read so an oversized entry fails loudly instead of crashing.
    let mut buf = Vec::new();
    entry.take(MAX_ENTRY_BYTES + 1).read_to_end(&mut buf)?;
    if buf.len() as u64 > MAX_ENTRY_BYTES {
        return Err(ApiError::local("Archive entry is too large to read as one page"));
    }
    Ok(buf)
}

/// Read one entry out of a CBR (RAR) by name, on demand.
#[cfg(desktop)]
fn rar_entry_bytes(path: &Path, name: &str) -> ApiResult<Vec<u8>> {
    let mut archive = unrar::Archive::new(path)
        .open_for_processing()
        .map_err(|err| ApiError::local(format!("Not a readable archive: {err}")))?;
    loop {
        let header = archive
            .read_header()
            .map_err(|err| ApiError::local(format!("Corrupt archive: {err}")))?
            .ok_or_else(|| ApiError::local("Missing page in archive"))?;
        let entry = header.entry();
        if entry.is_file() && entry.filename.to_string_lossy() == name {
            let (bytes, _) = header
                .read()
                .map_err(|err| ApiError::local(format!("Corrupt archive: {err}")))?;
            if bytes.len() as u64 > MAX_ENTRY_BYTES {
                return Err(ApiError::local("Archive entry is too large to read as one page"));
            }
            return Ok(bytes);
        }
        archive = header
            .skip()
            .map_err(|err| ApiError::local(format!("Corrupt archive: {err}")))?;
    }
}

/// Dispatch to the right backend by extension. `cbr` is desktop-only; on mobile
/// the caller must have rejected it already (see `local.rs`).
pub(crate) fn page_names(path: &Path, ext: &str) -> ApiResult<Vec<String>> {
    match ext {
        #[cfg(desktop)]
        "cbr" => rar_page_names(path),
        _ => zip_page_names(path),
    }
}

/// Dispatch to the right backend by extension.
pub(crate) fn entry_bytes(path: &Path, ext: &str, name: &str) -> ApiResult<Vec<u8>> {
    match ext {
        #[cfg(desktop)]
        "cbr" => rar_entry_bytes(path, name),
        _ => zip_entry_bytes(path, name),
    }
}

// Desktop-only: the RAR (CBR) tests reference `rar_*` helpers that only exist
// on desktop (unrar is desktop-gated). The zip-side tests would also compile on
// mobile, but keeping the whole module desktop-consistent is simpler and mobile
// never runs `cargo test` for the reader crate in CI anyway.
#[cfg(all(test, desktop))]
mod tests {
    use super::*;
    use std::io::Write;

    /// Resolve a file under `src-tauri/tests/data/`.
    fn data(name: &str) -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/data")
            .join(name)
    }

    /// The CBR fixtures are generated from original PNG pages (see the scratch
    /// generator), so they are safe to commit. `fixture.cbr` holds five pages.
    #[test]
    fn cbr_lists_pages_in_natural_order() {
        let names = rar_page_names(&data("fixture.cbr")).expect("open cbr");
        assert_eq!(names.len(), 5);
        assert_eq!(names[0], "page-01.png");
        assert_eq!(names[4], "page-05.png");
    }

    #[test]
    fn cbr_reads_a_page_on_demand() {
        let bytes = rar_entry_bytes(&data("fixture.cbr"), "page-03.png").expect("read page");
        assert!(!bytes.is_empty());
        assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
    }

    #[test]
    fn cbr_missing_page_is_an_error_not_a_panic() {
        let err = rar_entry_bytes(&data("fixture.cbr"), "nope.png").unwrap_err();
        assert!(err.message.contains("Missing page"));
    }

    #[test]
    fn corrupt_archive_fails_on_read_not_list() {
        // A truncated RAR keeps enough of its first header to list; the
        // corruption surfaces when the page's bytes are actually read.
        let names = rar_page_names(&data("corrupt.cbr")).expect("list corrupt cbr");
        assert!(!names.is_empty());
        let err = rar_entry_bytes(&data("corrupt.cbr"), &names[0]).expect_err("corrupt page read");
        assert!(
            err.message.contains("Corrupt") || err.message.contains("readable"),
            "unexpected error: {}",
            err.message
        );
    }

    #[test]
    fn encrypted_archive_rejects_page_read() {
        // Headers are visible on an encrypted archive (data is what's locked),
        // so listing succeeds; reading without a password must fail cleanly
        // rather than hang or panic. No password is ever supplied.
        let names = rar_page_names(&data("encrypted.cbr")).expect("list encrypted cbr");
        assert!(!names.is_empty());
        let err = rar_entry_bytes(&data("encrypted.cbr"), &names[0]).expect_err("encrypted read");
        assert!(
            err.message.contains("password") || err.message.contains("Corrupt") || err.message.contains("readable"),
            "unexpected error: {}",
            err.message
        );
    }

    #[test]
    fn traversal_entry_names_are_rejected_as_pages() {
        // `traversal.cbr` contains an entry whose name starts with `../`. The
        // reader never writes entries to disk, so a traversal name could only
        // ever be listed and matched by exact string — never resolved as a
        // path. is_image additionally rejects any name with a `..` segment, so
        // it cannot even appear as a page.
        let names = rar_page_names(&data("traversal.cbr")).expect("list traversal cbr");
        assert!(
            names.is_empty(),
            "traversal name should not be an image page: {names:?}"
        );
    }

    #[test]
    fn dispatch_routes_cbr_to_rar_and_zip_to_zip() {
        assert!(page_names(&data("fixture.cbr"), "cbr").is_ok());
        // A .cbr mislabeled as zip should fail as an unreadable zip.
        let err = page_names(&data("fixture.cbr"), "cbz").expect_err("mislabeled");
        assert!(err.message.contains("readable"));
    }

    // ---- CBZ (zip) hardening — archives built in-memory, no fixture needed ---

    /// Write a tiny zip to a unique temp file with the given entry names (each
    /// a small PNG-like blob) and return the path. Unique per call so parallel
    /// tests can't clobber each other's archive.
    fn write_cbz(names: &[&str]) -> std::path::PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static N: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!("cb8-zip-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("book-{}.cbz", N.fetch_add(1, Ordering::Relaxed)));
        let file = std::fs::File::create(&path).unwrap();
        let mut archive = zip::ZipWriter::new(std::io::BufWriter::new(file));
        let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        for name in names {
            let blob = format!("{name}-content").into_bytes();
            archive.start_file(*name, options).unwrap();
            archive.write_all(&blob).unwrap();
        }
        archive.finish().unwrap();
        path
    }

    #[test]
    fn cbz_traversal_names_are_rejected_as_pages() {
        let path = write_cbz(&["../evil.png", "sub/../../evil.jpg", "ok.png"]);
        let names = zip_page_names(&path).expect("list cbz");
        assert_eq!(names, vec!["ok.png".to_string()], "traversal names leaked: {names:?}");
    }

    #[test]
    fn cbz_natural_sort_matches_cbr() {
        let path = write_cbz(&["page10.png", "page2.png", "page1.png", "cover.png"]);
        let names = zip_page_names(&path).expect("list cbz");
        assert_eq!(names[0], "cover.png");
        assert_eq!(&names[1..], &["page1.png", "page2.png", "page10.png"]);
    }

    #[test]
    fn cbz_decompression_bomb_is_capped() {
        // A zip whose single entry *decompresses* far beyond the 512 MiB cap:
        // the reader must fail loudly, not allocate a multi-gigabyte buffer.
        use std::sync::atomic::{AtomicU64, Ordering};
        static N: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!("cb8-bomb-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("bomb-{}.cbz", N.fetch_add(1, Ordering::Relaxed)));
        let file = std::fs::File::create(&path).unwrap();
        let mut archive = zip::ZipWriter::new(std::io::BufWriter::new(file));
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .compression_level(Some(1));
        archive.start_file("page.png", options).unwrap();
        // 600 MiB of zeros compresses to almost nothing, then explodes on read.
        let zeros = vec![0u8; 600 * 1024 * 1024];
        archive.write_all(&zeros).unwrap();
        archive.finish().unwrap();
        drop(zeros);

        let err = zip_entry_bytes(&path, "page.png").expect_err("bomb should be rejected");
        assert!(err.message.contains("too large"), "unexpected error: {}", err.message);
    }

    #[test]
    fn cbz_missing_entry_is_a_clean_error() {
        let path = write_cbz(&["page1.png"]);
        let err = zip_entry_bytes(&path, "nope.png").unwrap_err();
        assert!(err.message.contains("Missing page"));
    }
}
