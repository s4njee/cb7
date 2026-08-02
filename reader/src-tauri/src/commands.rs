use serde_json::Value;
use tauri::State;

use crate::error::{ApiError, ApiResult};
use crate::proxy;
use crate::state::{AppState, Config};

/// Normalize user input like `192.168.1.20:8080/` → `http://192.168.1.20:8080`.
fn normalize_server_url(input: &str) -> ApiResult<String> {
    let trimmed = input.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err(ApiError::local("Enter a server address"));
    }
    let with_scheme = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("http://{trimmed}")
    };
    let parsed = url::Url::parse(&with_scheme)
        .map_err(|err| ApiError::local(format!("Invalid server address: {err}")))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(ApiError::local("Server address must be http or https"));
    }
    Ok(with_scheme.trim_end_matches('/').to_string())
}

fn join_api_path(server: &str, path: &str) -> ApiResult<String> {
    if !path.starts_with("/api/") {
        return Err(ApiError::local(format!("Refusing non-API path: {path}")));
    }
    Ok(format!("{server}{path}"))
}

/// Parse a CB8 response into JSON, mapping non-2xx to the `{message|error, code}` envelope.
async fn parse_response(response: reqwest::Response) -> ApiResult<Value> {
    let status = response.status();
    let bytes = response.bytes().await?;
    if status.is_success() {
        if bytes.is_empty() {
            return Ok(Value::Null);
        }
        return Ok(serde_json::from_slice(&bytes).unwrap_or(Value::Null));
    }
    let envelope: Option<Value> = serde_json::from_slice(&bytes).ok();
    let message = envelope
        .as_ref()
        .and_then(|v| {
            v.get("message")
                .or_else(|| v.get("error"))
                .and_then(Value::as_str)
        })
        .map(str::to_string)
        .unwrap_or_else(|| format!("API error {}", status.as_u16()));
    let code = envelope
        .as_ref()
        .and_then(|v| v.get("code"))
        .and_then(Value::as_str)
        .map(str::to_string);
    Err(ApiError { status: status.as_u16(), code, message })
}

async fn request_json(
    state: &AppState,
    method: reqwest::Method,
    path: &str,
    body: Option<&Value>,
) -> ApiResult<Value> {
    let server = state.server_url().await?;
    let url = join_api_path(&server, path)?;
    let is_write = method != reqwest::Method::GET;
    let mut req = state
        .client
        .request(method, &url)
        .header(reqwest::header::ACCEPT, "application/json")
        // better-auth validates Origin on state-changing requests when present;
        // presenting the server's own origin marks us as a first-party client.
        .header(reqwest::header::ORIGIN, server.clone());
    if let Some(json) = body {
        req = req.json(json);
    }
    let result = parse_response(req.send().await?).await;
    if is_write {
        // Auth endpoints rotate/set cookies on writes; persist so sign-in survives restarts.
        if let Err(err) = state.save_cookies() {
            log::warn!("failed to persist cookies: {}", err.message);
        }
    }
    result
}

#[tauri::command]
pub async fn get_config(state: State<'_, AppState>) -> Result<Config, ApiError> {
    Ok(state.config.read().await.clone())
}

/// Probe + persist the server address. Returns the server's session payload
/// (`{ authenticated, user, guestAccess, ... }`) so the UI can route.
#[tauri::command]
pub async fn set_server(state: State<'_, AppState>, url: String) -> Result<Value, ApiError> {
    let normalized = normalize_server_url(&url)?;
    let probe_url = format!("{normalized}/api/auth/session");
    let response = state
        .client
        .get(&probe_url)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await?;
    let status = response.status();
    let payload = parse_response(response).await.map_err(|mut err| {
        err.message = format!("Not a CB8 server ({}): {}", status.as_u16(), err.message);
        err
    })?;
    if !payload.is_object() || payload.get("authenticated").is_none() {
        return Err(ApiError::local("That address responded, but not like a CB8 server"));
    }
    {
        let mut config = state.config.write().await;
        config.server_url = Some(normalized);
    }
    state.save_config().await?;
    Ok(payload)
}

/// Sign in via CB8's own wrapper endpoint (`POST /api/auth/login`), which does
/// no Origin/CSRF checking and returns `{ ok: true, user }` or 401.
#[tauri::command]
pub async fn login(
    state: State<'_, AppState>,
    username: String,
    password: String,
) -> Result<Value, ApiError> {
    let body = serde_json::json!({ "username": username.trim(), "password": password });
    request_json(&state, reqwest::Method::POST, "/api/auth/login", Some(&body)).await
}

#[tauri::command]
pub async fn logout(state: State<'_, AppState>) -> Result<(), ApiError> {
    // Best-effort server-side sign-out; always drop local cookies.
    let _ = request_json(&state, reqwest::Method::POST, "/api/auth/logout", None).await;
    state.clear_cookies()?;
    Ok(())
}

#[tauri::command]
pub async fn api_get(state: State<'_, AppState>, path: String) -> Result<Value, ApiError> {
    request_json(&state, reqwest::Method::GET, &path, None).await
}

#[tauri::command]
pub async fn api_send(
    state: State<'_, AppState>,
    method: String,
    path: String,
    body: Option<Value>,
) -> Result<Value, ApiError> {
    let method: reqwest::Method = method
        .to_uppercase()
        .parse()
        .map_err(|_| ApiError::local(format!("Bad method: {method}")))?;
    if method == reqwest::Method::GET {
        return request_json(&state, method, &path, None).await;
    }
    request_json(&state, method, &path, body.as_ref()).await
}

#[tauri::command]
pub async fn clear_media_cache(state: State<'_, AppState>) -> Result<u64, ApiError> {
    proxy::clear_cache(&state).await
}

/// Total byte length of a server file (`/api/comics/:id/file`).
///
/// Used by the PDF range reader to size its transport. A `Range: bytes=0-0`
/// probe returns `Content-Range: bytes 0-0/<total>` when the server supports
/// ranges (CB8 does); we parse the total from there and fall back to
/// `Content-Length`. Doing this in Rust — rather than a webview `fetch` — is
/// deliberate: WKWebView does not reliably forward a `Range` header to the
/// custom scheme handler, so a browser-side probe can silently miss range
/// support and trigger a whole-file download (a 500 MB PDF → OOM kill).
#[tauri::command]
pub async fn file_byte_length(state: State<'_, AppState>, path: String) -> Result<u64, ApiError> {
    let server = state.server_url().await?;
    let url = join_api_path(&server, &path)?;
    let resp = state
        .client
        .get(&url)
        .header(reqwest::header::RANGE, "bytes=0-0")
        .header(reqwest::header::ORIGIN, server.clone())
        .send()
        .await?;
    if let Some(total) = resp
        .headers()
        .get(reqwest::header::CONTENT_RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.rsplit('/').next())
        .and_then(|t| t.trim().parse::<u64>().ok())
    {
        return Ok(total);
    }
    resp.headers()
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
        .ok_or_else(|| ApiError::local("Server did not report a file size"))
}

/// Read one byte range of a server file, returning the raw bytes.
///
/// `begin`/`end` are a half-open `[begin, end)` range (pdf.js's convention);
/// the HTTP `Range` header is inclusive, so we request `end - 1`. The response
/// is a page's worth of a PDF, never the whole file — this is what keeps a huge
/// book off the heap. Returned as a raw `Response` so it reaches JS as an
/// `ArrayBuffer` rather than a JSON number array.
#[tauri::command]
pub async fn read_file_range(
    state: State<'_, AppState>,
    path: String,
    begin: u64,
    end: u64,
) -> Result<tauri::ipc::Response, ApiError> {
    if end <= begin {
        return Ok(tauri::ipc::Response::new(Vec::new()));
    }
    let server = state.server_url().await?;
    let url = join_api_path(&server, &path)?;
    let resp = state
        .client
        .get(&url)
        .header(reqwest::header::RANGE, format!("bytes={begin}-{}", end - 1))
        .header(reqwest::header::ORIGIN, server.clone())
        .send()
        .await?;
    let status = resp.status();
    if !status.is_success() {
        return Err(ApiError::status(status.as_u16(), "Range request failed"));
    }
    let bytes = resp.bytes().await?;
    Ok(tauri::ipc::Response::new(bytes.to_vec()))
}

/// Whether this build can produce haptics.
///
/// True exactly where `tauri-plugin-haptics` is compiled in (see the
/// mobile-only dependency in Cargo.toml) — one compile-time fact rather than a
/// user-agent sniff. The alternative, probing the plugin from JS, only answers
/// by *firing a buzz*, which would make opening the settings drawer vibrate the
/// phone of someone who had just turned haptics off.
#[tauri::command]
pub fn haptics_supported() -> bool {
    cfg!(any(target_os = "android", target_os = "ios"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_adds_default_scheme_and_trims() {
        assert_eq!(
            normalize_server_url("192.168.1.20:8080/").unwrap(),
            "http://192.168.1.20:8080"
        );
        assert_eq!(
            normalize_server_url("  example.com  ").unwrap(),
            "http://example.com"
        );
    }

    #[test]
    fn normalize_preserves_explicit_scheme() {
        assert_eq!(
            normalize_server_url("https://shelf.example.com/").unwrap(),
            "https://shelf.example.com"
        );
    }

    #[test]
    fn normalize_rejects_empty_and_bad_scheme() {
        assert!(normalize_server_url("   ").is_err());
        assert!(normalize_server_url("ftp://host").is_err());
    }

    #[test]
    fn join_api_path_requires_api_prefix() {
        assert_eq!(
            join_api_path("http://host:8008", "/api/comics").unwrap(),
            "http://host:8008/api/comics"
        );
        assert!(join_api_path("http://host:8008", "/comics").is_err());
        assert!(join_api_path("http://host:8008", "../etc").is_err());
    }
}
