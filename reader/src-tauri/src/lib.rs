mod android_multicast;
mod commands;
mod discovery;
mod download_policy;
mod downloads;
mod error;
mod local;
mod local_zip;
mod proxy;
mod state;

use std::sync::Mutex;

use tauri::{Emitter, Manager, Url};

use state::AppState;

/// File URLs delivered via `RunEvent::Opened` (Open In / share sheet / Files)
/// before the webview is ready to import them. Frontend drains this on boot
/// and also listens for the live `shelf://opened-files` event.
pub struct OpenedUrls(pub Mutex<Vec<Url>>);

/// Drain any cold-start open-in paths (as filesystem paths the importer can
/// `copy`). Returns `[]` when nothing is pending.
#[tauri::command]
fn take_opened_paths(app: tauri::AppHandle) -> Vec<String> {
    let state = app.state::<OpenedUrls>();
    let mut guard = match state.0.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    let urls: Vec<Url> = guard.drain(..).collect();
    urls.into_iter().filter_map(url_to_fs_path).collect()
}

/// Convert a `file://` (or bare path) URL into a filesystem path string.
fn url_to_fs_path(url: Url) -> Option<String> {
    if url.scheme() == "file" {
        url.to_file_path()
            .ok()
            .map(|p| p.to_string_lossy().into_owned())
    } else {
        // Last resort: some platforms hand a path-looking string as the URL.
        let s = url.as_str();
        if s.starts_with('/') {
            Some(s.to_string())
        } else {
            log::warn!("opened URL is not a local file path: {s}");
            None
        }
    }
}

fn record_opened_urls(app: &tauri::AppHandle, urls: Vec<Url>) {
    if urls.is_empty() {
        return;
    }
    let paths: Vec<String> = urls.iter().cloned().filter_map(url_to_fs_path).collect();
    if paths.is_empty() {
        return;
    }
    {
        let state = app.state::<OpenedUrls>();
        let mut guard = match state.0.lock() {
            Ok(g) => g,
            Err(poisoned) => poisoned.into_inner(),
        };
        // Keep originals for cold-start drain (paths re-derived there).
        guard.extend(urls);
    }
    // Live event carries paths so the frontend can call `local_import` directly.
    let _ = app.emit("shelf://opened-files", paths);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        // The file picker is how books get into the library without a server —
        // the local-first half of "Add books".
        .plugin(tauri_plugin_dialog::init())
        .manage(OpenedUrls(Mutex::new(Vec::new())));

    // The camera scanner only exists on phones; the crate is not even a
    // dependency on desktop, where QR pairing is manual-entry territory.
    #[cfg(any(target_os = "android", target_os = "ios"))]
    let builder = builder.plugin(tauri_plugin_barcode_scanner::init());

    // Likewise haptics: a desktop has nothing to buzz. Page turns fall back to
    // silence rather than gaining a stub.
    #[cfg(any(target_os = "android", target_os = "ios"))]
    let builder = builder.plugin(tauri_plugin_haptics::init());

    // DISC-5: Android MulticastLock bridge (no-op elsewhere). Registered on
    // every platform so discovery can call acquire/release without cfg noise.
    let builder = builder.plugin(android_multicast::init());

    let app = builder
        .register_asynchronous_uri_scheme_protocol(proxy::SCHEME, proxy::register)
        .setup(|app| {
            let state = AppState::init(app.handle())?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::set_server,
            commands::login,
            commands::logout,
            commands::api_get,
            commands::api_send,
            commands::clear_media_cache,
            commands::haptics_supported,
            commands::file_byte_length,
            commands::read_file_range,
            downloads::download_book,
            downloads::cancel_download,
            downloads::remove_download,
            downloads::list_downloads,
            discovery::start_discovery,
            discovery::stop_discovery,
            local::local_list,
            local::local_import,
            local::local_delete,
            local::local_download,
            local::local_file_length,
            local::local_read_range,
            local::local_page_count,
            local::local_set_progress,
            local::local_clear_progress,
            local::local_set_favorite,
            local::local_size,
            local::save_local_cover,
            take_opened_paths,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        // Open In / share sheet / Files "Open with CB8" — macOS, iOS, Android.
        #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
        if let tauri::RunEvent::Opened { urls } = event {
            record_opened_urls(app_handle, urls);
        }
    });
}
