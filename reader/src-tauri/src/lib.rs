mod android_multicast;
mod commands;
mod discovery;
mod download_policy;
mod downloads;
mod error;
mod local;
mod local_zip;
#[cfg(desktop)]
mod menu;
mod opens;
mod platform;
mod proxy;
mod state;

use tauri::Manager;

use state::AppState;

/// Deliver one normalized open request (or a batch) from any source:
/// macOS/iOS/Android `RunEvent::Opened`, Windows/Linux startup argv, or a
/// second single-instance forwarding. See `opens.rs` for the channel rules.
fn record_opens(app: &tauri::AppHandle, sources: Vec<String>) {
    opens::record_opens(app, sources);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        // The file picker is how books get into the library without a server —
        // the local-first half of "Add books".
        .plugin(tauri_plugin_dialog::init())
        .manage(opens::OpenRequests::default());

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

    // Windows and Linux deliver "Open with CB8" as a command-line argument, not
    // a RunEvent::Opened. Single-instance support makes a second double-click
    // forward to the already-running app instead of starting a fresh one; the
    // callback runs in the *first* process, so we record the paths there and
    // restore/focus the window so the import is visible.
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(
        |app, args, _cwd| {
            // `args` includes the executable path; skip it, then filter to books.
            let sources: Vec<String> = args.into_iter().skip(1).collect();
            record_opens(app, sources);
            opens::focus_main_window(app);
        },
    ));

    // Desktop-only: persist normal window size/position/maximized state and
    // restore it on launch. Reader fullscreen is deliberately *not* persisted —
    // a transient fullscreen should never be the next launch state.
    #[cfg(desktop)]
    let builder = builder.plugin(
        tauri_plugin_window_state::Builder::new()
            .with_state_flags(
                tauri_plugin_window_state::StateFlags::SIZE
                    | tauri_plugin_window_state::StateFlags::POSITION
                    | tauri_plugin_window_state::StateFlags::MAXIMIZED,
            )
            .build(),
    );

    let app = builder
        .register_asynchronous_uri_scheme_protocol(proxy::SCHEME, proxy::register)
        .setup(|app| {
            // Native menu (File > Add Books… etc.); desktop only.
            #[cfg(desktop)]
            menu::setup(app)?;

            let state = AppState::init(app.handle())?;
            app.manage(state);

            // Cold-start "Open with CB8" on Windows/Linux: the file path is in
            // argv (argv[0] is the executable). Single-instance handles the
            // "already running" case; this is the fresh-launch case.
            #[cfg(any(target_os = "windows", target_os = "linux"))]
            {
                let sources: Vec<String> = std::env::args().skip(1).collect();
                record_opens(app.handle(), sources);
            }

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
            opens::take_opened_paths,
            platform::platform_info,
            #[cfg(desktop)]
            menu::set_menu_enabled,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        // Open In / share sheet / Files "Open with CB8" — macOS, iOS, Android.
        // Delivered as URLs; the pipeline normalizes and channels them.
        #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
        if let tauri::RunEvent::Opened { urls } = event {
            let sources: Vec<String> = urls.into_iter().map(|u| u.to_string()).collect();
            record_opens(app_handle, sources);
        }
    });
}
