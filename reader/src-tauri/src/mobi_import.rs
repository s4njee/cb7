//! DRM-free MOBI/KF8 (AZW3) import support.
//!
//! Readium already handles EPUB well, so the native import boundary converts
//! parsed Kindle HTML into a small, standards-compliant EPUB. This keeps MOBI
//! and AZW3 out of the reader surface and makes the converted copy portable
//! across desktop and mobile. Parser failures are reported as an honest
//! unsupported/encrypted-file error; this module never attempts DRM removal.

use std::io::Write;
use std::path::Path;

use mobi::Mobi;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

use crate::error::{ApiError, ApiResult};

fn xml_escape(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn title_from(path: &Path, book: &Mobi) -> String {
    let title_value = book.title();
    let title = title_value.trim();
    if title.is_empty() {
        path.file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Untitled")
            .to_string()
    } else {
        title.to_string()
    }
}

/// Convert one DRM-free MOBI/AZW3 file to EPUB bytes.
pub fn to_epub(path: &Path) -> ApiResult<Vec<u8>> {
    let book = Mobi::from_path(path).map_err(|_| {
        ApiError::local("This MOBI/AZW3 file is encrypted or unreadable. DRM-protected books are not supported.")
    })?;
    let title = title_from(path, &book);
    let author = book.author().unwrap_or_default().trim().to_string();
    let description = book.description().unwrap_or_default().trim().to_string();
    let html = book
        .content_as_string()
        .map_err(|_| ApiError::local("The MOBI/AZW3 file contains unreadable text."))?;
    if html.trim().is_empty() {
        return Err(ApiError::local("The MOBI/AZW3 file contains no readable text."));
    }

    let opf = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:cb8:{}</dc:identifier>
    <dc:title>{}</dc:title>
    <dc:creator>{}</dc:creator>
    <dc:description>{}</dc:description>
  </metadata>
  <manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="chapter"/></spine>
</package>
"#,
        xml_escape(&title),
        xml_escape(&title),
        xml_escape(&author),
        xml_escape(&description),
    );
    let chapter = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>{}</title></head><body>{}</body></html>
"#,
        xml_escape(&title),
        html,
    );

    let mut bytes = Vec::new();
    {
        let mut epub = ZipWriter::new(std::io::Cursor::new(&mut bytes));
        epub.start_file(
            "mimetype",
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored),
        )
        .map_err(|e| ApiError::local(format!("create EPUB: {e}")))?;
        epub.write_all(b"application/epub+zip")?;
        epub.start_file("META-INF/container.xml", SimpleFileOptions::default())
            .map_err(|e| ApiError::local(format!("create EPUB: {e}")))?;
        epub.write_all(br#"<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#)?;
        epub.start_file("OEBPS/content.opf", SimpleFileOptions::default())
            .map_err(|e| ApiError::local(format!("create EPUB: {e}")))?;
        epub.write_all(opf.as_bytes())?;
        epub.start_file("OEBPS/chapter.xhtml", SimpleFileOptions::default())
            .map_err(|e| ApiError::local(format!("create EPUB: {e}")))?;
        epub.write_all(chapter.as_bytes())?;
        epub.finish()
            .map_err(|e| ApiError::local(format!("finish EPUB: {e}")))?;
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::xml_escape;

    #[test]
    fn escapes_metadata_for_epub_xml() {
        assert_eq!(xml_escape("A & B <C>"), "A &amp; B &lt;C&gt;");
    }
}
