//! OPDS catalog browsing as an acquisition source.
//!
//! The user adds a catalog URL (Standard Ebooks, Project Gutenberg,
//! Calibre-Web, or CB8's own `/api/opds`). Rust fetches and parses both
//! OPDS 2 JSON and OPDS 1 Atom, then downloads an acquisition link through
//! the same stream-to-disk + catalog path as a local import.
//!
//! Networking stays in this module: the webview never fetches a catalog
//! or an acquisition URL. The OPDS HTTP client is deliberately *not* the
//! CB8 session client — a third-party catalog must not see the cookie jar.

use std::path::Path;
use std::time::Duration;

use futures_util::StreamExt;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Runtime, State};
use tokio::io::AsyncWriteExt;
use url::Url;

use crate::error::{ApiError, ApiResult};
use crate::local::{
    catalog_owned_file, find_by_acquired_from, is_importable_ext, prepare_owned_dest, write_cover_bytes, LocalBook,
    OwnedIngest,
};
use crate::state::{AppState, OpdsCatalogStored};

/// Accept both OPDS 2 JSON and OPDS 1 Atom; JSON is preferred when a server
/// (Standard Ebooks) can speak either.
const ACCEPT: &str = "application/opds+json, application/atom+xml;profile=opds-catalog, \
     application/atom+xml, application/json, */*;q=0.8";

const FEED_TIMEOUT: Duration = Duration::from_secs(30);
const FEED_MAX_BYTES: usize = 8 * 1024 * 1024;

const ACQ_REL: &str = "http://opds-spec.org/acquisition";
const ACQ_OPEN: &str = "http://opds-spec.org/acquisition/open-access";
const IMAGE_REL: &str = "http://opds-spec.org/image";
const THUMB_REL: &str = "http://opds-spec.org/image/thumbnail";

/* ----------------------------------------------------------------- types */

/// Catalog as the frontend sees it (no password).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpdsCatalogInfo {
    pub id: String,
    pub name: String,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    pub has_auth: bool,
}

/// One navigation / subsection entry (a folder in the catalog).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpdsNavEntry {
    pub title: String,
    pub href: String,
}

/// One downloadable format for a publication.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpdsAcquisition {
    pub href: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime: Option<String>,
    /// Lowercase extension we would import as (`epub` / `pdf` / `cbz` / `cbr`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ext: Option<String>,
}

/// A book (or comic) the catalog is offering.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpdsPublication {
    pub title: String,
    pub authors: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub identifier: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_href: Option<String>,
    pub acquisitions: Vec<OpdsAcquisition>,
}

/// Normalized feed (either OPDS 1 or 2).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpdsFeed {
    pub title: String,
    pub href: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_href: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_template: Option<String>,
    pub navigation: Vec<OpdsNavEntry>,
    pub publications: Vec<OpdsPublication>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpdsDownloadResult {
    pub book: LocalBook,
    pub already_owned: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    comic_id: i64,
    received: u64,
    total: Option<u64>,
    done: bool,
}

/* ---------------------------------------------------------- url helpers */

/// Require http(s). Bare hosts get `https://`.
pub fn parse_http_url(input: &str) -> ApiResult<Url> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(ApiError::local("Enter a catalog address"));
    }
    let with_scheme = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let url = Url::parse(&with_scheme).map_err(|err| ApiError::local(format!("Invalid catalog address: {err}")))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(ApiError::local("Catalog address must be http or https"));
    }
    Ok(url)
}

fn resolve_href(base: &Url, href: &str) -> Option<String> {
    let href = href.trim();
    if href.is_empty() {
        return None;
    }
    base.join(href).ok().and_then(|u| {
        if matches!(u.scheme(), "http" | "https") {
            Some(u.to_string())
        } else {
            None
        }
    })
}

fn apply_search_template(template: &str, query: &str) -> String {
    let encoded: String = url::form_urlencoded::byte_serialize(query.as_bytes()).collect();
    template
        .replace("{searchTerms}", &encoded)
        .replace("{query}", &encoded)
        .replace("{?query}", &format!("?query={encoded}"))
        .replace("{?searchTerms}", &format!("?q={encoded}"))
}

/* ---------------------------------------------------------- mime / rels */

fn split_rels(rel: &str) -> impl Iterator<Item = &str> {
    rel.split(|c: char| c.is_whitespace() || c == ',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

fn is_acquisition_rel(rel: &str) -> bool {
    split_rels(rel).any(|r| {
        r == ACQ_REL
            || r == ACQ_OPEN
            || r == "acquisition"
            || r == "download"
            || r.ends_with("/acquisition")
            || r.ends_with("/acquisition/open-access")
    })
}

fn is_nav_rel(rel: &str) -> bool {
    split_rels(rel)
        .any(|r| r == "subsection" || r == "http://opds-spec.org/subsection" || r == "http://opds-spec.org/crawlable")
}

fn is_cover_rel(rel: &str) -> bool {
    split_rels(rel).any(|r| r == "cover" || r == "http://opds-spec.org/cover" || r == IMAGE_REL || r == THUMB_REL)
}

fn is_search_rel(rel: &str) -> bool {
    split_rels(rel).any(|r| r == "search")
}

fn is_next_rel(rel: &str) -> bool {
    split_rels(rel).any(|r| r == "next")
}

fn mime_to_ext(mime: &str) -> Option<&'static str> {
    let mime = mime.split(';').next().unwrap_or(mime).trim().to_ascii_lowercase();
    match mime.as_str() {
        "application/epub+zip" | "application/kepub+zip" => Some("epub"),
        "application/pdf" => Some("pdf"),
        "application/x-cbz" | "application/vnd.comicbook+zip" | "application/vnd.comicbook-zip" => Some("cbz"),
        "application/x-cbr" | "application/vnd.comicbook+rar" | "application/vnd.comicbook-rar" => Some("cbr"),
        _ => None,
    }
}

fn ext_from_path(path: &str) -> Option<String> {
    let path = path.split('?').next().unwrap_or(path);
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())?;
    if is_importable_ext(&ext) {
        Some(ext)
    } else {
        None
    }
}

fn acquisition_ext(mime: Option<&str>, href: &str) -> Option<String> {
    mime.and_then(mime_to_ext)
        .map(str::to_string)
        .or_else(|| ext_from_path(href))
}

/// Rank importable formats so we prefer EPUB over PDF over comics.
fn ext_rank(ext: &str) -> u8 {
    match ext {
        "epub" => 0,
        "pdf" => 1,
        "cbz" => 2,
        "cbr" => 3,
        _ => 9,
    }
}

fn pick_best_acquisition(mut acqs: Vec<OpdsAcquisition>) -> Vec<OpdsAcquisition> {
    acqs.retain(|a| a.ext.as_deref().is_some_and(is_importable_ext));
    acqs.sort_by_key(|a| ext_rank(a.ext.as_deref().unwrap_or("")));
    acqs
}

fn cover_ext_from_mime(mime: &str) -> &'static str {
    match mime.split(';').next().unwrap_or(mime).trim() {
        "image/png" => "png",
        "image/webp" => "webp",
        "image/gif" => "gif",
        _ => "jpg",
    }
}

/* ---------------------------------------------------------- json parse */

fn json_rel(value: &Value) -> String {
    match value.get("rel") {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(arr)) => arr.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(" "),
        _ => String::new(),
    }
}

fn json_str(value: &Value, key: &str) -> Option<String> {
    match value.get(key) {
        Some(Value::String(s)) if !s.is_empty() => Some(s.clone()),
        Some(Value::Object(obj)) => obj
            .get("name")
            .or_else(|| obj.get("value"))
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_string),
        _ => None,
    }
}

fn json_authors(metadata: &Value) -> Vec<String> {
    let mut out = Vec::new();
    let mut push = |v: &Value| {
        if let Some(s) = v.as_str().filter(|s| !s.is_empty()) {
            out.push(s.to_string());
        } else if let Some(s) = json_str(v, "name") {
            out.push(s);
        }
    };
    match metadata.get("author").or_else(|| metadata.get("authors")) {
        Some(Value::Array(arr)) => arr.iter().for_each(&mut push),
        Some(other) => push(other),
        None => {}
    }
    out
}

fn parse_opds2(value: &Value, base: &Url) -> OpdsFeed {
    let metadata = value.get("metadata").unwrap_or(value);
    let title = json_str(metadata, "title").unwrap_or_else(|| "Catalog".into());

    let mut navigation = Vec::new();
    let mut next_href = None;
    let mut search_template = None;
    let mut self_href = base.to_string();

    let take_link = |link: &Value,
                     navigation: &mut Vec<OpdsNavEntry>,
                     next_href: &mut Option<String>,
                     search_template: &mut Option<String>,
                     self_href: &mut String| {
        let rel = json_rel(link);
        let href = match json_str(link, "href").and_then(|h| resolve_href(base, &h)) {
            Some(h) => h,
            None => return,
        };
        let typ = json_str(link, "type").unwrap_or_default();
        if is_next_rel(&rel) && next_href.is_none() {
            *next_href = Some(href);
        } else if split_rels(&rel).any(|r| r == "self") {
            *self_href = href;
        } else if is_search_rel(&rel) {
            if href.contains("{searchTerms}") || href.contains("{query}") {
                *search_template = Some(href);
            } else {
                *search_template = Some(href); // OpenSearch description; resolved later
            }
        } else if is_nav_rel(&rel) || typ.contains("opds") && !typ.contains("publication") {
            let title = json_str(link, "title").unwrap_or_else(|| "Untitled".into());
            if !navigation.iter().any(|n| n.href == href) {
                navigation.push(OpdsNavEntry { title, href });
            }
        }
    };

    if let Some(Value::Array(links)) = value.get("links") {
        for link in links {
            take_link(
                link,
                &mut navigation,
                &mut next_href,
                &mut search_template,
                &mut self_href,
            );
        }
    }
    if let Some(Value::Array(nav)) = value.get("navigation") {
        for entry in nav {
            // Compact collection: { title, href } or { title, links: [...] }
            if let Some(href) = json_str(entry, "href").and_then(|h| resolve_href(base, &h)) {
                let title = json_str(entry, "title").unwrap_or_else(|| "Untitled".into());
                if !navigation.iter().any(|n| n.href == href) {
                    navigation.push(OpdsNavEntry { title, href });
                }
            } else if let Some(Value::Array(links)) = entry.get("links") {
                for link in links {
                    let rel = json_rel(link);
                    if is_nav_rel(&rel) || rel.is_empty() || split_rels(&rel).any(|r| r == "self") {
                        if let Some(href) = json_str(link, "href").and_then(|h| resolve_href(base, &h)) {
                            let title = json_str(entry, "title")
                                .or_else(|| json_str(link, "title"))
                                .unwrap_or_else(|| "Untitled".into());
                            if !navigation.iter().any(|n| n.href == href) {
                                navigation.push(OpdsNavEntry { title, href });
                            }
                        }
                    }
                }
            }
        }
    }

    let mut publications = Vec::new();
    let mut collect_pubs = |arr: &[Value]| {
        for pubn in arr {
            if let Some(p) = parse_opds2_publication(pubn, base) {
                publications.push(p);
            }
        }
    };
    if let Some(Value::Array(arr)) = value.get("publications") {
        collect_pubs(arr);
    }
    if let Some(Value::Array(groups)) = value.get("groups") {
        for group in groups {
            if let Some(Value::Array(arr)) = group.get("publications") {
                collect_pubs(arr);
            }
            if let Some(Value::Array(arr)) = group.get("navigation") {
                for entry in arr {
                    if let Some(href) = json_str(entry, "href").and_then(|h| resolve_href(base, &h)) {
                        let title = json_str(entry, "title").unwrap_or_else(|| "Untitled".into());
                        if !navigation.iter().any(|n| n.href == href) {
                            navigation.push(OpdsNavEntry { title, href });
                        }
                    }
                }
            }
        }
    }

    OpdsFeed {
        title,
        href: self_href,
        next_href,
        search_template,
        navigation,
        publications,
    }
}

fn parse_opds2_publication(value: &Value, base: &Url) -> Option<OpdsPublication> {
    let metadata = value.get("metadata").unwrap_or(value);
    let title = json_str(metadata, "title")?;
    let authors = json_authors(metadata);
    let summary = json_str(metadata, "description")
        .or_else(|| json_str(metadata, "subtitle"))
        .or_else(|| json_str(metadata, "summary"));
    let identifier = json_str(metadata, "identifier");

    let mut cover_href = None;
    let mut acqs = Vec::new();

    let take = |link: &Value, cover_href: &mut Option<String>, acqs: &mut Vec<OpdsAcquisition>| {
        let rel = json_rel(link);
        let href = match json_str(link, "href").and_then(|h| resolve_href(base, &h)) {
            Some(h) => h,
            None => return,
        };
        let mime = json_str(link, "type");
        if is_cover_rel(&rel) && cover_href.is_none() {
            *cover_href = Some(href);
        } else if is_acquisition_rel(&rel) {
            let ext = acquisition_ext(mime.as_deref(), &href);
            acqs.push(OpdsAcquisition { href, mime, ext });
        }
    };

    if let Some(Value::Array(links)) = value.get("links") {
        for link in links {
            take(link, &mut cover_href, &mut acqs);
        }
    }
    if let Some(Value::Array(images)) = value.get("images") {
        for img in images {
            if cover_href.is_none() {
                if let Some(href) = json_str(img, "href").and_then(|h| resolve_href(base, &h)) {
                    cover_href = Some(href);
                }
            }
        }
    }

    Some(OpdsPublication {
        title,
        authors,
        summary,
        identifier,
        cover_href,
        acquisitions: pick_best_acquisition(acqs),
    })
}

/* ---------------------------------------------------------- atom parse */

fn atom_child_text(node: roxmltree::Node<'_, '_>, name: &str) -> Option<String> {
    node.children()
        .find(|c| c.is_element() && c.tag_name().name() == name)
        .and_then(|c| c.text().or_else(|| c.tail()))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn atom_authors(entry: roxmltree::Node<'_, '_>) -> Vec<String> {
    let mut out = Vec::new();
    for author in entry
        .children()
        .filter(|c| c.is_element() && c.tag_name().name() == "author")
    {
        if let Some(name) = atom_child_text(author, "name") {
            out.push(name);
        }
    }
    out
}

fn parse_atom(xml: &str, base: &Url) -> ApiResult<OpdsFeed> {
    let doc =
        roxmltree::Document::parse(xml).map_err(|err| ApiError::local(format!("Catalog XML is unreadable: {err}")))?;
    let feed = doc
        .descendants()
        .find(|n| n.is_element() && n.tag_name().name() == "feed")
        .ok_or_else(|| ApiError::local("That address is not an OPDS catalog"))?;

    let title = atom_child_text(feed, "title").unwrap_or_else(|| "Catalog".into());
    let mut navigation = Vec::new();
    let mut publications = Vec::new();
    let mut next_href = None;
    let mut search_template = None;
    let mut self_href = base.to_string();

    for link in feed
        .children()
        .filter(|c| c.is_element() && c.tag_name().name() == "link")
    {
        let rel = link.attribute("rel").unwrap_or("");
        let href = match link.attribute("href").and_then(|h| resolve_href(base, h)) {
            Some(h) => h,
            None => continue,
        };
        if is_next_rel(rel) && next_href.is_none() {
            next_href = Some(href);
        } else if split_rels(rel).any(|r| r == "self") {
            self_href = href;
        } else if is_search_rel(rel) {
            search_template = Some(href);
        } else if is_nav_rel(rel) {
            let title = link.attribute("title").unwrap_or("Untitled").to_string();
            navigation.push(OpdsNavEntry { title, href });
        }
    }

    for entry in feed
        .children()
        .filter(|c| c.is_element() && c.tag_name().name() == "entry")
    {
        let entry_title = atom_child_text(entry, "title").unwrap_or_else(|| "Untitled".into());
        let authors = atom_authors(entry);
        let summary = atom_child_text(entry, "summary")
            .or_else(|| atom_child_text(entry, "content"))
            .or_else(|| atom_child_text(entry, "description"));
        let identifier = atom_child_text(entry, "id");

        let mut cover_href = None;
        let mut acqs = Vec::new();
        let mut subsection: Option<(String, String)> = None;

        for link in entry
            .children()
            .filter(|c| c.is_element() && c.tag_name().name() == "link")
        {
            let rel = link.attribute("rel").unwrap_or("");
            let href = match link.attribute("href").and_then(|h| resolve_href(base, h)) {
                Some(h) => h,
                None => continue,
            };
            let mime = link.attribute("type").map(str::to_string);
            if is_cover_rel(rel) && cover_href.is_none() {
                cover_href = Some(href);
            } else if is_acquisition_rel(rel) {
                let ext = acquisition_ext(mime.as_deref(), &href);
                acqs.push(OpdsAcquisition { href, mime, ext });
            } else if is_nav_rel(rel) && subsection.is_none() {
                subsection = Some((entry_title.clone(), href));
            }
        }

        let acqs = pick_best_acquisition(acqs);
        if !acqs.is_empty() {
            publications.push(OpdsPublication {
                title: entry_title,
                authors,
                summary,
                identifier,
                cover_href,
                acquisitions: acqs,
            });
        } else if let Some((title, href)) = subsection {
            if !navigation.iter().any(|n| n.href == href) {
                navigation.push(OpdsNavEntry { title, href });
            }
        }
    }

    Ok(OpdsFeed {
        title,
        href: self_href,
        next_href,
        search_template,
        navigation,
        publications,
    })
}

fn looks_like_json(content_type: &str, body: &str) -> bool {
    let ct = content_type.to_ascii_lowercase();
    if ct.contains("json") {
        return true;
    }
    if ct.contains("xml") || ct.contains("atom") {
        return false;
    }
    body.trim_start().starts_with('{')
}

fn parse_feed_body(content_type: &str, body: &str, base: &Url) -> ApiResult<OpdsFeed> {
    if looks_like_json(content_type, body) {
        let value: Value =
            serde_json::from_str(body).map_err(|err| ApiError::local(format!("Catalog JSON is unreadable: {err}")))?;
        if !value.is_object() {
            return Err(ApiError::local("That address is not an OPDS catalog"));
        }
        Ok(parse_opds2(&value, base))
    } else {
        parse_atom(body, base)
    }
}

fn parse_opensearch_template(xml: &str) -> Option<String> {
    let doc = roxmltree::Document::parse(xml).ok()?;
    let mut fallback = None;
    for url in doc
        .descendants()
        .filter(|n| n.is_element() && n.tag_name().name() == "Url")
    {
        let typ = url.attribute("type").unwrap_or("");
        let template = url.attribute("template")?;
        if typ.contains("opds+json") || typ.contains("atom+xml") || typ.contains("opds") {
            return Some(template.to_string());
        }
        if fallback.is_none() {
            fallback = Some(template.to_string());
        }
    }
    fallback
}

/* ---------------------------------------------------------- http */

fn catalog_by_id<'a>(list: &'a [OpdsCatalogStored], id: &str) -> ApiResult<&'a OpdsCatalogStored> {
    list.iter()
        .find(|c| c.id == id)
        .ok_or_else(|| ApiError::local("That catalog is no longer saved"))
}

fn apply_auth(mut req: reqwest::RequestBuilder, catalog: &OpdsCatalogStored) -> reqwest::RequestBuilder {
    if let (Some(user), Some(pass)) = (catalog.username.as_deref(), catalog.password.as_deref()) {
        req = req.basic_auth(user, Some(pass));
    }
    req
}

/// Use the CB8 session client only when the catalog is the connected server
/// *and* the user did not supply Basic credentials. Everything else goes
/// through the isolated OPDS client.
fn client_for<'a>(state: &'a AppState, catalog: &OpdsCatalogStored, server: Option<&str>) -> &'a reqwest::Client {
    if catalog.username.is_some() {
        return &state.opds_client;
    }
    if let (Some(server), Ok(cat)) = (server, Url::parse(&catalog.url)) {
        if let Ok(srv) = Url::parse(server) {
            if cat.origin() == srv.origin() {
                return &state.client;
            }
        }
    }
    &state.opds_client
}

async fn fetch_bytes(
    client: &reqwest::Client,
    catalog: &OpdsCatalogStored,
    url: &str,
    timeout: Option<Duration>,
) -> ApiResult<(String, Vec<u8>)> {
    let parsed = parse_http_url(url)?;
    let mut req = client.get(parsed.clone()).header(reqwest::header::ACCEPT, ACCEPT);
    if let Some(t) = timeout {
        req = req.timeout(t);
    }
    req = apply_auth(req, catalog);
    let response = req.send().await?;
    let status = response.status();
    if status.as_u16() == 401 {
        return Err(ApiError::status(401, "This catalog asked for a username and password"));
    }
    if !status.is_success() {
        return Err(ApiError::status(
            status.as_u16(),
            format!("Catalog returned {}", status.as_u16()),
        ));
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let bytes = response.bytes().await?;
    if bytes.len() > FEED_MAX_BYTES {
        return Err(ApiError::local("Catalog feed is too large to open"));
    }
    Ok((content_type, bytes.to_vec()))
}

async fn fetch_feed(state: &AppState, catalog: &OpdsCatalogStored, href: &str) -> ApiResult<OpdsFeed> {
    let server = state.config.read().await.server_url.clone();
    let client = client_for(state, catalog, server.as_deref());
    let (content_type, bytes) = fetch_bytes(client, catalog, href, Some(FEED_TIMEOUT)).await?;
    let body = String::from_utf8_lossy(&bytes);
    let base = parse_http_url(href)?;
    let mut feed = parse_feed_body(&content_type, &body, &base)?;

    // OpenSearch description → a `{searchTerms}` template the UI can fill.
    if let Some(search) = feed.search_template.clone() {
        if !search.contains("{searchTerms}") && !search.contains("{query}") {
            if let Ok((_, desc)) = fetch_bytes(client, catalog, &search, Some(FEED_TIMEOUT)).await {
                if let Ok(xml) = String::from_utf8(desc) {
                    if let Some(template) = parse_opensearch_template(&xml) {
                        if let Some(abs) = resolve_href(&base, &template) {
                            feed.search_template = Some(abs);
                        } else {
                            feed.search_template = Some(template);
                        }
                    } else {
                        feed.search_template = None;
                    }
                }
            } else {
                feed.search_template = None;
            }
        }
    }
    Ok(feed)
}

fn catalog_info(stored: &OpdsCatalogStored) -> OpdsCatalogInfo {
    OpdsCatalogInfo {
        id: stored.id.clone(),
        name: stored.name.clone(),
        url: stored.url.clone(),
        username: stored.username.clone(),
        has_auth: stored.username.is_some() && stored.password.is_some(),
    }
}

fn new_catalog_id() -> String {
    // Same uniqueness bar as local file stems — unique within this device.
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{nanos:x}")
}

/* ------------------------------------------------------------- commands */

#[tauri::command]
pub async fn opds_list_catalogs(state: State<'_, AppState>) -> Result<Vec<OpdsCatalogInfo>, ApiError> {
    let list = state.opds_catalogs.lock().await;
    Ok(list.iter().map(catalog_info).collect())
}

#[tauri::command]
pub async fn opds_add_catalog(
    state: State<'_, AppState>,
    name: String,
    url: String,
    username: Option<String>,
    password: Option<String>,
) -> Result<OpdsCatalogInfo, ApiError> {
    let parsed = parse_http_url(&url)?;
    let username = username.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let password = password.filter(|s| !s.is_empty());
    if username.is_some() && password.is_none() {
        return Err(ApiError::local("Enter a password for this catalog"));
    }

    // Replace an existing catalog with the same origin+path so re-adding
    // (e.g. to set credentials) does not duplicate the list.
    let canonical = parsed.to_string();
    let stored = OpdsCatalogStored {
        id: new_catalog_id(),
        name: name.trim().to_string(),
        url: canonical.clone(),
        username,
        password,
    };

    let feed = fetch_feed(&state, &stored, &canonical).await?;
    let mut stored = stored;
    if stored.name.is_empty() {
        stored.name = feed.title;
    }

    {
        let mut list = state.opds_catalogs.lock().await;
        if let Some(existing) = list.iter_mut().find(|c| c.url == stored.url) {
            stored.id = existing.id.clone();
            *existing = stored.clone();
        } else {
            list.push(stored.clone());
        }
    }
    state.save_opds().await?;
    Ok(catalog_info(&stored))
}

#[tauri::command]
pub async fn opds_remove_catalog(state: State<'_, AppState>, id: String) -> Result<(), ApiError> {
    {
        let mut list = state.opds_catalogs.lock().await;
        let before = list.len();
        list.retain(|c| c.id != id);
        if list.len() == before {
            return Err(ApiError::local("That catalog is no longer saved"));
        }
    }
    state.save_opds().await?;
    Ok(())
}

#[tauri::command]
pub async fn opds_browse(
    state: State<'_, AppState>,
    catalog_id: String,
    href: Option<String>,
) -> Result<OpdsFeed, ApiError> {
    let catalog = {
        let list = state.opds_catalogs.lock().await;
        catalog_by_id(&list, &catalog_id)?.clone()
    };
    let url = match href {
        Some(h) if !h.trim().is_empty() => parse_http_url(&h)?.to_string(),
        _ => catalog.url.clone(),
    };
    fetch_feed(&state, &catalog, &url).await
}

#[tauri::command]
pub async fn opds_search(
    state: State<'_, AppState>,
    catalog_id: String,
    query: String,
    template: String,
) -> Result<OpdsFeed, ApiError> {
    let q = query.trim();
    if q.is_empty() {
        return Err(ApiError::local("Enter something to search for"));
    }
    let catalog = {
        let list = state.opds_catalogs.lock().await;
        catalog_by_id(&list, &catalog_id)?.clone()
    };
    let href = apply_search_template(&template, q);
    fetch_feed(&state, &catalog, &href).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn opds_download<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    catalog_id: String,
    href: String,
    title: String,
    mime: Option<String>,
    cover_href: Option<String>,
    progress_id: i64,
) -> Result<OpdsDownloadResult, ApiError> {
    let parsed = parse_http_url(&href)?;
    let href = parsed.to_string();

    if let Some(existing) = find_by_acquired_from(&state, &href).await {
        emit_progress(&app, progress_id, existing.bytes, Some(existing.bytes), true);
        return Ok(OpdsDownloadResult {
            book: existing,
            already_owned: true,
        });
    }

    let ext = acquisition_ext(mime.as_deref(), &href)
        .ok_or_else(|| ApiError::local("That file isn't a format CB8 can import (EPUB, PDF, CBZ, CBR)."))?;

    let catalog = {
        let list = state.opds_catalogs.lock().await;
        catalog_by_id(&list, &catalog_id)?.clone()
    };
    let server = state.config.read().await.server_url.clone();
    let client = client_for(&state, &catalog, server.as_deref());

    let (rel, dest) = prepare_owned_dest(&state, &ext).await?;
    let part = dest.with_extension(format!("{ext}.part"));

    let mut req = client.get(parsed);
    req = apply_auth(req, &catalog);
    let response = req.send().await?;
    let status = response.status();
    if status.as_u16() == 401 {
        return Err(ApiError::status(401, "This catalog asked for a username and password"));
    }
    if !status.is_success() {
        return Err(ApiError::status(status.as_u16(), "Could not download this book"));
    }
    // Content-Type can refine the extension when the href had none useful.
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let final_ext = content_type
        .as_deref()
        .and_then(mime_to_ext)
        .map(str::to_string)
        .filter(|e| is_importable_ext(e))
        .unwrap_or(ext);
    let total = response.content_length();

    emit_progress(&app, progress_id, 0, total, false);

    let mut file = tokio::fs::File::create(&part).await?;
    let mut stream = response.bytes_stream();
    let mut received: u64 = 0;
    let mut since_emit: u64 = 0;
    const EMIT_EVERY: u64 = 256 * 1024;
    while let Some(chunk) = stream.next().await {
        let chunk = match chunk {
            Ok(c) => c,
            Err(err) => {
                let _ = tokio::fs::remove_file(&part).await;
                return Err(ApiError::from(err));
            }
        };
        if let Err(err) = file.write_all(&chunk).await {
            let _ = tokio::fs::remove_file(&part).await;
            return Err(err.into());
        }
        received += chunk.len() as u64;
        since_emit += chunk.len() as u64;
        if since_emit >= EMIT_EVERY {
            since_emit = 0;
            emit_progress(&app, progress_id, received, total, false);
        }
    }
    file.flush().await?;
    drop(file);
    tokio::fs::rename(&part, &dest).await?;

    let cover = if let Some(cover_url) = cover_href.as_deref().filter(|s| !s.is_empty()) {
        fetch_opds_cover(client, &catalog, cover_url, &state).await
    } else {
        None
    };

    let ingest = catalog_owned_file(
        &state,
        OwnedIngest {
            title: if title.trim().is_empty() {
                "Untitled".into()
            } else {
                title
            },
            ext: final_ext,
            rel,
            dest,
            bytes: received,
            cover,
            acquired_from: Some(href),
        },
    )
    .await?;

    emit_progress(&app, progress_id, received, Some(received), true);
    Ok(OpdsDownloadResult {
        book: ingest.book,
        already_owned: ingest.already_owned,
    })
}

fn emit_progress<R: Runtime>(app: &AppHandle<R>, comic_id: i64, received: u64, total: Option<u64>, done: bool) {
    let _ = app.emit(
        "shelf://local-download-progress",
        DownloadProgress {
            comic_id,
            received,
            total,
            done,
        },
    );
}

async fn fetch_opds_cover(
    client: &reqwest::Client,
    catalog: &OpdsCatalogStored,
    href: &str,
    state: &AppState,
) -> Option<String> {
    let url = parse_http_url(href).ok()?;
    let mut req = client.get(url).timeout(FEED_TIMEOUT);
    req = apply_auth(req, catalog);
    let response = req.send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let ext = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(cover_ext_from_mime)
        .unwrap_or("jpg");
    let bytes = response.bytes().await.ok()?;
    write_cover_bytes(state, &bytes, ext).await
}

/* ---------------------------------------------------------------- tests */

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_http_url_requires_http() {
        assert!(parse_http_url("").is_err());
        assert!(parse_http_url("ftp://x").is_err());
        assert!(parse_http_url("file:///tmp").is_err());
        let u = parse_http_url("standardebooks.org/feeds/opds").unwrap();
        assert_eq!(u.scheme(), "https");
        let u = parse_http_url("http://192.168.1.9:8083/opds").unwrap();
        assert_eq!(u.as_str(), "http://192.168.1.9:8083/opds");
    }

    #[test]
    fn resolve_href_joins_and_rejects_non_http() {
        let base = Url::parse("https://ex.test/opds/root").unwrap();
        assert_eq!(resolve_href(&base, "all").as_deref(), Some("https://ex.test/opds/all"));
        assert_eq!(
            resolve_href(&base, "/api/opds/all").as_deref(),
            Some("https://ex.test/api/opds/all")
        );
        assert_eq!(resolve_href(&base, "javascript:alert(1)"), None);
        assert_eq!(resolve_href(&base, "file:///etc/passwd"), None);
    }

    #[test]
    fn search_template_encodes_spaces() {
        let t = "https://ex.test/search?q={searchTerms}";
        assert_eq!(
            apply_search_template(t, "war and peace"),
            "https://ex.test/search?q=war+and+peace"
        );
    }

    #[test]
    fn mime_to_ext_covers_importable_types() {
        assert_eq!(mime_to_ext("application/epub+zip"), Some("epub"));
        assert_eq!(mime_to_ext("application/epub+zip; charset=binary"), Some("epub"));
        assert_eq!(mime_to_ext("application/pdf"), Some("pdf"));
        assert_eq!(mime_to_ext("application/vnd.comicbook+zip"), Some("cbz"));
        assert_eq!(mime_to_ext("application/x-mobipocket-ebook"), None);
    }

    #[test]
    fn pick_best_acquisition_prefers_epub() {
        let picked = pick_best_acquisition(vec![
            OpdsAcquisition {
                href: "https://ex.test/a.pdf".into(),
                mime: Some("application/pdf".into()),
                ext: Some("pdf".into()),
            },
            OpdsAcquisition {
                href: "https://ex.test/a.epub".into(),
                mime: Some("application/epub+zip".into()),
                ext: Some("epub".into()),
            },
            OpdsAcquisition {
                href: "https://ex.test/a.mobi".into(),
                mime: Some("application/x-mobipocket-ebook".into()),
                ext: None,
            },
        ]);
        assert_eq!(picked.len(), 2);
        assert_eq!(picked[0].ext.as_deref(), Some("epub"));
        assert_eq!(picked[1].ext.as_deref(), Some("pdf"));
    }

    #[test]
    fn parses_cb8_opds2_root() {
        let json = r#"{
            "metadata": { "title": "CB8" },
            "links": [
                { "rel": "self", "href": "http://host:8008/api/opds", "type": "application/opds+json" },
                { "rel": "subsection", "href": "http://host:8008/api/opds/all", "type": "application/opds+json", "title": "All books" },
                { "rel": "search", "href": "http://host:8008/api/opds/search/opensearch.xml", "type": "application/opensearchdescription+xml" }
            ],
            "publications": [{
                "metadata": { "title": "N", "identifier": "cb8:comic:7" },
                "links": [
                    { "rel": "self", "type": "application/webpub+json", "href": "http://host:8008/api/comics/7/manifest" },
                    { "rel": "cover", "type": "image/jpeg", "href": "http://host:8008/api/comics/7/thumbnail" },
                    { "rel": "http://opds-spec.org/acquisition", "href": "http://host:8008/api/comics/7/file", "type": "application/epub+zip" }
                ]
            }]
        }"#;
        let base = Url::parse("http://host:8008/api/opds").unwrap();
        let feed = parse_feed_body("application/opds+json", json, &base).unwrap();
        assert_eq!(feed.title, "CB8");
        assert_eq!(feed.navigation.len(), 1);
        assert_eq!(feed.navigation[0].title, "All books");
        assert_eq!(feed.publications.len(), 1);
        assert_eq!(feed.publications[0].title, "N");
        assert_eq!(feed.publications[0].acquisitions[0].ext.as_deref(), Some("epub"));
        assert!(feed.publications[0]
            .cover_href
            .as_deref()
            .unwrap()
            .ends_with("/thumbnail"));
        assert!(feed.search_template.unwrap().ends_with("opensearch.xml"));
    }

    #[test]
    fn parses_cb8_paged_feed_next() {
        let json = r#"{
            "metadata": { "title": "All books", "numberOfItems": 2, "itemsPerPage": 1, "currentPage": 1 },
            "links": [
                { "rel": "self", "href": "http://h/api/opds/all", "type": "application/opds+json" },
                { "rel": "next", "href": "http://h/api/opds/all?page=2&limit=1", "type": "application/opds+json" }
            ],
            "publications": []
        }"#;
        let base = Url::parse("http://h/api/opds/all").unwrap();
        let feed = parse_feed_body("application/opds+json", json, &base).unwrap();
        assert_eq!(feed.next_href.as_deref(), Some("http://h/api/opds/all?page=2&limit=1"));
        assert!(feed.publications.is_empty());
    }

    #[test]
    fn comic_without_acquisition_is_listed_but_not_downloadable() {
        let json = r#"{
            "metadata": { "title": "All" },
            "links": [],
            "publications": [{
                "metadata": { "@type": "http://schema.org/ComicStory", "title": "Saga v1" },
                "links": [
                    { "rel": "self", "type": "application/webpub+json", "href": "http://h/api/comics/7/manifest" },
                    { "rel": "cover", "href": "http://h/api/comics/7/thumbnail" }
                ]
            }]
        }"#;
        let base = Url::parse("http://h/api/opds/all").unwrap();
        let feed = parse_feed_body("application/opds+json", json, &base).unwrap();
        assert_eq!(feed.publications.len(), 1);
        assert!(feed.publications[0].acquisitions.is_empty());
    }

    #[test]
    fn parses_atom_navigation_and_acquisition() {
        let xml = r#"<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Standard Ebooks</title>
  <link rel="self" href="/feeds/opds" type="application/atom+xml;profile=opds-catalog;kind=navigation"/>
  <link rel="next" href="/feeds/opds?page=2"/>
  <link rel="search" type="application/opensearchdescription+xml" href="/feeds/opds/search"/>
  <entry>
    <title>Fiction</title>
    <link rel="subsection" href="/feeds/opds/subjects/fiction" type="application/atom+xml;profile=opds-catalog;kind=acquisition"/>
  </entry>
  <entry>
    <title>Pride and Prejudice</title>
    <author><name>Jane Austen</name></author>
    <summary>A novel.</summary>
    <link rel="http://opds-spec.org/image/thumbnail" href="/images/pride.jpg" type="image/jpeg"/>
    <link rel="http://opds-spec.org/acquisition/open-access" href="/ebooks/pride.epub" type="application/epub+zip"/>
    <link rel="http://opds-spec.org/acquisition" href="/ebooks/pride.pdf" type="application/pdf"/>
  </entry>
</feed>"#;
        let base = Url::parse("https://standardebooks.org/feeds/opds").unwrap();
        let feed = parse_feed_body("application/atom+xml;profile=opds-catalog", xml, &base).unwrap();
        assert_eq!(feed.title, "Standard Ebooks");
        assert_eq!(feed.navigation.len(), 1);
        assert_eq!(feed.navigation[0].title, "Fiction");
        assert!(feed.navigation[0].href.ends_with("/subjects/fiction"));
        assert_eq!(feed.publications.len(), 1);
        let pubn = &feed.publications[0];
        assert_eq!(pubn.title, "Pride and Prejudice");
        assert_eq!(pubn.authors, vec!["Jane Austen"]);
        assert_eq!(pubn.summary.as_deref(), Some("A novel."));
        assert_eq!(pubn.acquisitions[0].ext.as_deref(), Some("epub"));
        assert_eq!(pubn.acquisitions[1].ext.as_deref(), Some("pdf"));
        assert!(pubn.cover_href.as_deref().unwrap().ends_with("/images/pride.jpg"));
        assert_eq!(
            feed.next_href.as_deref(),
            Some("https://standardebooks.org/feeds/opds?page=2")
        );
    }

    #[test]
    fn parse_opensearch_prefers_opds_type() {
        let xml = r#"<?xml version="1.0"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
  <Url type="text/html" template="https://ex.test/search?q={searchTerms}"/>
  <Url type="application/opds+json" template="https://ex.test/opds/search?q={searchTerms}"/>
</OpenSearchDescription>"#;
        assert_eq!(
            parse_opensearch_template(xml).as_deref(),
            Some("https://ex.test/opds/search?q={searchTerms}")
        );
    }

    #[test]
    fn acquisition_rel_accepts_short_and_long() {
        assert!(is_acquisition_rel("http://opds-spec.org/acquisition"));
        assert!(is_acquisition_rel("http://opds-spec.org/acquisition/open-access"));
        assert!(is_acquisition_rel("acquisition"));
        assert!(is_acquisition_rel("download"));
        assert!(!is_acquisition_rel("http://opds-spec.org/acquisition/borrow"));
        assert!(!is_acquisition_rel("subsection"));
    }

    #[test]
    fn stored_catalog_round_trip_keeps_password_off_info() {
        let stored = OpdsCatalogStored {
            id: "abc".into(),
            name: "Calibre".into(),
            url: "http://host/opds".into(),
            username: Some("me".into()),
            password: Some("secret".into()),
        };
        let info = catalog_info(&stored);
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("\"hasAuth\":true"));
        assert!(!json.contains("secret"));
        assert!(json.contains("\"username\":\"me\""));
    }
}
