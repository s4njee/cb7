//! CBZ/CBR archive helpers for the local library.
//!
//! Page listing, natural sort, and entry extraction live here so `local.rs`
//! can own catalog commands without also being an archive library.

use std::io::Read;
use std::path::Path;

use crate::error::{ApiError, ApiResult};

const IMAGE_EXTS: [&str; 7] = ["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp"];

pub(crate) fn is_image(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    // Skip macOS resource forks, which otherwise show up as phantom page 0.
    if lower.contains("__macosx/") || lower.rsplit('/').next().is_some_and(|f| f.starts_with("._"))
    {
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
    let archive = zip::ZipArchive::new(file)
        .map_err(|err| ApiError::local(format!("Not a readable archive: {err}")))?;
    let mut names: Vec<String> = archive
        .file_names()
        .filter(|name| is_image(name))
        .map(str::to_string)
        .collect();
    names.sort_by(|a, b| natural_cmp(a, b));
    Ok(names)
}

/// Read one entry out of a zip by name.
pub(crate) fn zip_entry_bytes(path: &Path, name: &str) -> ApiResult<Vec<u8>> {
    let file = std::fs::File::open(path)?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|err| ApiError::local(format!("Not a readable archive: {err}")))?;
    let mut entry = archive
        .by_name(name)
        .map_err(|err| ApiError::local(format!("Missing page in archive: {err}")))?;
    let mut buf = Vec::with_capacity(entry.size() as usize);
    entry.read_to_end(&mut buf)?;
    Ok(buf)
}

