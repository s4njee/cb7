//! Android Wi-Fi multicast lock bridge for mDNS discovery (DISC-5).
//!
//! On physical Android devices, the Wi-Fi stack drops multicast packets unless
//! a [`WifiManager.MulticastLock`](https://developer.android.com/reference/android/net/wifi/WifiManager.MulticastLock)
//! is held. Pure-Rust `mdns-sd` cannot reach that API, so a tiny Kotlin plugin
//! (`com.cb8.shelf.MulticastPlugin` in `gen/android`) does the acquire/release
//! and this module calls it for the lifetime of a browse window only.
//!
//! Non-Android targets are no-ops so discovery code can call these freely.

use tauri::{AppHandle, Runtime};

/// Plugin name registered with Tauri (not exposed to JS).
pub const PLUGIN_NAME: &str = "multicast";

#[cfg(target_os = "android")]
use tauri::plugin::PluginHandle;

/// Held on the app when the Android plugin registered successfully.
#[cfg(target_os = "android")]
pub struct MulticastLockHandle<R: Runtime>(PluginHandle<R>);

/// Build the in-app multicast plugin. Safe to register on every platform;
/// only Android loads the Kotlin class.
pub fn init<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    use tauri::plugin::Builder;

    Builder::new(PLUGIN_NAME)
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                use tauri::Manager;
                match api.register_android_plugin("com.cb8.shelf", "MulticastPlugin") {
                    Ok(handle) => {
                        app.manage(MulticastLockHandle(handle));
                        log::info!("Android MulticastLock plugin registered");
                    }
                    Err(err) => {
                        // Browse will stay empty without the lock; manual entry works.
                        log::warn!("Android MulticastLock plugin unavailable: {err}");
                    }
                }
            }
            #[cfg(not(target_os = "android"))]
            {
                let _ = (app, api);
            }
            Ok(())
        })
        .build()
}

/// Acquire the Wi-Fi multicast lock for the current browse window.
/// No-op off Android; never fails discovery if the lock cannot be taken.
pub fn acquire<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        if let Some(handle) = app.try_state::<MulticastLockHandle<R>>() {
            match handle.0.run_mobile_plugin::<serde_json::Value>("acquire", ()) {
                Ok(_) => log::debug!("multicast lock acquire ok"),
                Err(err) => log::warn!("multicast lock acquire failed: {err}"),
            }
        } else {
            log::warn!("multicast lock handle missing — mDNS may stay empty on this device");
        }
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
    }
}

/// Release the Wi-Fi multicast lock when the browse window ends.
pub fn release<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        if let Some(handle) = app.try_state::<MulticastLockHandle<R>>() {
            match handle.0.run_mobile_plugin::<serde_json::Value>("release", ()) {
                Ok(_) => log::debug!("multicast lock release ok"),
                Err(err) => log::warn!("multicast lock release failed: {err}"),
            }
        }
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
    }
}

/// RAII guard: releases the lock when dropped (browse window exit / cancel).
pub struct MulticastGuard<R: Runtime> {
    app: AppHandle<R>,
    active: bool,
}

impl<R: Runtime> MulticastGuard<R> {
    /// Acquire and return a guard that releases on drop.
    pub fn acquire(app: AppHandle<R>) -> Self {
        acquire(&app);
        Self { app, active: true }
    }
}

impl<R: Runtime> Drop for MulticastGuard<R> {
    fn drop(&mut self) {
        if self.active {
            release(&self.app);
            self.active = false;
        }
    }
}
