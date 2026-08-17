//! Best-effort embedded metadata extraction for local books.
//!
//! This module deliberately returns partial metadata. A malformed or unusual
//! book must still import; filename-derived values remain the fallback.

use std::io::Read;
use std::path::Path;

use roxmltree::Document;
use serde::{Deserialize, Serialize};

use crate::error::{ApiError, ApiResult};
use crate::local_zip::{entry_bytes, zip_entry_bytes};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EmbeddedMetadata {
    pub title: Option<String>,
    pub authors: Vec<String>,
    pub description: Option<String>,
    pub language: Option<String>,
    pub publisher: Option<String>,
    pub published_at: Option<String>,
    pub series: Option<String>,
    pub volume: Option<String>,
}

/// Filename fallback for common comic naming: `Series v02 #013 (2019)`.
pub(crate) fn filename_heuristics(name: &str) -> EmbeddedMetadata {
    let stem = Path::new(name).file_stem().and_then(|s| s.to_str()).unwrap_or(name);
    let normalized = stem.replace(['_', '.'], " ");
    let tokens = normalized.split_whitespace().collect::<Vec<_>>();
    let mut series_end = tokens.len();
    let mut volume = None;
    for (i, token) in tokens.iter().enumerate() {
        let lower = token.to_ascii_lowercase();
        let value = lower.strip_prefix("vol").or_else(|| lower.strip_prefix('v'));
        if let Some(value) = value.filter(|v| !v.is_empty() && v.chars().all(|c| c.is_ascii_digit())) {
            volume = Some(value.to_string());
            series_end = i;
            break;
        }
        if let Some(value) = lower
            .strip_prefix('#')
            .filter(|v| !v.is_empty() && v.chars().all(|c| c.is_ascii_digit()))
        {
            volume = Some(value.to_string());
            series_end = i;
            break;
        }
    }
    let series = (series_end > 0).then(|| tokens[..series_end].join(" "));
    EmbeddedMetadata {
        title: Some(
            stem.replace(['_', '.'], " ")
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" "),
        ),
        series,
        volume,
        ..Default::default()
    }
}

fn clean(value: Option<&str>) -> Option<String> {
    let value = value?.split_whitespace().collect::<Vec<_>>().join(" ");
    (!value.is_empty()).then_some(value)
}

fn child_text<'a>(node: roxmltree::Node<'a, 'a>, local: &str) -> Option<String> {
    node.children()
        .find(|child| child.is_element() && child.tag_name().name() == local)
        .and_then(|child| clean(child.text()))
}

fn metadata_value<'a>(metadata: roxmltree::Node<'a, 'a>, local: &str) -> Option<String> {
    metadata
        .children()
        .filter(|n| n.is_element() && n.tag_name().name() == "meta")
        .find(|n| n.attribute("property").is_some_and(|p| p == local))
        .and_then(|n| clean(n.text()))
}

fn parse_epub(path: &Path) -> ApiResult<EmbeddedMetadata> {
    let file = std::fs::File::open(path)?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| ApiError::local(format!("Unreadable EPUB: {e}")))?;
    let container = {
        let mut entry = archive
            .by_name("META-INF/container.xml")
            .map_err(|e| ApiError::local(format!("EPUB has no container: {e}")))?;
        let mut bytes = Vec::new();
        std::io::Read::read_to_end(&mut entry, &mut bytes)?;
        bytes
    };
    let container_doc =
        Document::parse(std::str::from_utf8(&container).map_err(|_| ApiError::local("EPUB container is not UTF-8"))?)
            .map_err(|e| ApiError::local(format!("Invalid EPUB container: {e}")))?;
    let rootfile = container_doc
        .descendants()
        .find(|n| n.has_tag_name("rootfile"))
        .and_then(|n| n.attribute("full-path"))
        .ok_or_else(|| ApiError::local("EPUB has no package document"))?;
    let mut opf = archive
        .by_name(rootfile)
        .map_err(|e| ApiError::local(format!("EPUB package is missing: {e}")))?;
    let mut opf_bytes = Vec::new();
    std::io::Read::read_to_end(&mut opf, &mut opf_bytes)?;
    let doc =
        Document::parse(std::str::from_utf8(&opf_bytes).map_err(|_| ApiError::local("EPUB package is not UTF-8"))?)
            .map_err(|e| ApiError::local(format!("Invalid EPUB package: {e}")))?;
    let metadata = doc
        .descendants()
        .find(|n| n.is_element() && n.tag_name().name() == "metadata")
        .ok_or_else(|| ApiError::local("EPUB has no metadata"))?;
    let mut result = EmbeddedMetadata {
        title: child_text(metadata, "title"),
        description: child_text(metadata, "description"),
        language: child_text(metadata, "language"),
        publisher: child_text(metadata, "publisher"),
        published_at: child_text(metadata, "date"),
        series: metadata_value(metadata, "belongs-to-collection"),
        volume: metadata_value(metadata, "group-position"),
        ..Default::default()
    };
    result.authors = metadata
        .children()
        .filter(|n| n.is_element() && n.tag_name().name() == "creator")
        .filter_map(|n| clean(n.text()))
        .collect();
    if result.series.is_none() {
        result.series = metadata_value(metadata, "calibre:series");
    }
    if result.volume.is_none() {
        result.volume = metadata_value(metadata, "calibre:series_index");
    }
    Ok(result)
}

fn parse_comic_info(bytes: &[u8]) -> ApiResult<EmbeddedMetadata> {
    let text = std::str::from_utf8(bytes).map_err(|_| ApiError::local("ComicInfo.xml is not UTF-8"))?;
    let doc = Document::parse(text).map_err(|e| ApiError::local(format!("Invalid ComicInfo.xml: {e}")))?;
    let root = doc.root_element();
    let get = |name: &str| {
        root.children()
            .find(|n| n.is_element() && n.tag_name().name() == name)
            .and_then(|n| clean(n.text()))
    };
    let mut result = EmbeddedMetadata {
        title: get("Title"),
        description: get("Summary"),
        language: get("LanguageISO"),
        publisher: get("Publisher"),
        published_at: get("Year"),
        series: get("Series"),
        volume: get("Number"),
        ..Default::default()
    };
    result.authors = ["Writer", "Penciller", "Inker", "Colorist", "Letterer", "CoverArtist"]
        .into_iter()
        .filter_map(get)
        .collect();
    Ok(result)
}

fn parse_pdf(path: &Path) -> ApiResult<EmbeddedMetadata> {
    let bytes = std::fs::read(path)?;
    // PDF Info strings are intentionally parsed conservatively. This is not a
    // PDF renderer and never interprets embedded content as executable data.
    let text = String::from_utf8_lossy(&bytes);
    let field = |key: &str| {
        let marker = format!("/{key}");
        text.find(&marker).and_then(|start| {
            let rest = text[start + marker.len()..].trim_start();
            let rest = rest.strip_prefix('(')?;
            let end = rest.find(')')?;
            clean(Some(&rest[..end]))
        })
    };
    Ok(EmbeddedMetadata {
        title: field("Title"),
        authors: field("Author").into_iter().collect(),
        description: field("Subject"),
        publisher: field("Publisher"),
        published_at: field("CreationDate"),
        ..Default::default()
    })
}

pub(crate) fn extract(path: &Path, ext: &str) -> ApiResult<EmbeddedMetadata> {
    match ext {
        "epub" => parse_epub(path),
        "pdf" => parse_pdf(path),
        "cbz" | "cb7" | "cbr" => {
            let bytes = if ext == "cbz" {
                zip_entry_bytes(path, "ComicInfo.xml")
            } else {
                entry_bytes(path, ext, "ComicInfo.xml")
            }?;
            parse_comic_info(&bytes)
        }
        _ => Ok(EmbeddedMetadata::default()),
    }
}

/// Return the declared EPUB cover image, if one is present. Comic covers are
/// selected by the caller from the first ordered page.
pub(crate) fn extract_epub_cover(path: &Path) -> ApiResult<Option<(Vec<u8>, String)>> {
    let file = std::fs::File::open(path)?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| ApiError::local(format!("Unreadable EPUB: {e}")))?;
    let mut container = String::new();
    archive
        .by_name("META-INF/container.xml")
        .map_err(|e| ApiError::local(format!("EPUB has no container: {e}")))?
        .read_to_string(&mut container)?;
    let container_doc =
        Document::parse(&container).map_err(|e| ApiError::local(format!("Invalid EPUB container: {e}")))?;
    let rootfile = container_doc
        .descendants()
        .find(|n| n.has_tag_name("rootfile"))
        .and_then(|n| n.attribute("full-path"))
        .ok_or_else(|| ApiError::local("EPUB has no package document"))?;
    let mut opf = String::new();
    archive
        .by_name(rootfile)
        .map_err(|e| ApiError::local(format!("EPUB package is missing: {e}")))?
        .read_to_string(&mut opf)?;
    let doc = Document::parse(&opf).map_err(|e| ApiError::local(format!("Invalid EPUB package: {e}")))?;
    let metadata = doc
        .descendants()
        .find(|n| n.is_element() && n.tag_name().name() == "metadata");
    let cover_id = metadata.and_then(|m| {
        m.children()
            .find(|n| n.is_element() && n.tag_name().name() == "meta" && n.attribute("name") == Some("cover"))
            .and_then(|n| n.attribute("content"))
    });
    let item = doc.descendants().find(|n| {
        n.is_element()
            && n.tag_name().name() == "item"
            && (cover_id.is_some_and(|id| n.attribute("id") == Some(id))
                || n.attribute("properties")
                    .is_some_and(|p| p.split_whitespace().any(|v| v == "cover-image")))
    });
    let href = item
        .and_then(|n| n.attribute("href"))
        .ok_or_else(|| ApiError::local("EPUB has no declared cover"));
    let Ok(href) = href else { return Ok(None) };
    let base = rootfile
        .rsplit_once('/')
        .map(|(base, _)| format!("{base}/"))
        .unwrap_or_default();
    let entry_name = format!("{base}{href}");
    let mut bytes = Vec::new();
    archive
        .by_name(&entry_name)
        .map_err(|e| ApiError::local(format!("Declared EPUB cover is missing: {e}")))?
        .read_to_end(&mut bytes)?;
    let ext = Path::new(href)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("jpg")
        .to_ascii_lowercase();
    Ok(Some((bytes, ext)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_comic_info_fields_and_authors() {
        let metadata = parse_comic_info(br#"<ComicInfo><Title> Saga  </Title><Writer>Brian K. Vaughan</Writer><Series>Saga</Series><Number>1</Number></ComicInfo>"#).unwrap();
        assert_eq!(metadata.title.as_deref(), Some("Saga"));
        assert_eq!(metadata.authors, vec!["Brian K. Vaughan"]);
        assert_eq!(metadata.volume.as_deref(), Some("1"));
    }

    #[test]
    fn pdf_info_parser_is_best_effort() {
        let path = std::env::temp_dir().join(format!("cb8-pdf-info-{}", std::process::id()));
        std::fs::write(&path, b"<< /Title (A Book) /Author (An Author) >>").unwrap();
        let metadata = parse_pdf(&path).unwrap();
        assert_eq!(metadata.title.as_deref(), Some("A Book"));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn filename_heuristic_extracts_series_and_volume() {
        let metadata = filename_heuristics("Saga v02 #013 (2019).cbz");
        assert_eq!(metadata.series.as_deref(), Some("Saga"));
        assert_eq!(metadata.volume.as_deref(), Some("02"));
    }
}
