use std::collections::HashMap;
use std::fs;
use std::io::{BufReader, BufWriter};
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use mdns_sd::ServiceDaemon;
use reqwest_cookie_store::CookieStoreMutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};
use tokio::sync::{Mutex, RwLock};

use crate::downloads::PinnedManifest;
use crate::error::{ApiError, ApiResult};
use crate::local::Catalog;

/// Persisted app configuration (server connection).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Config {
    /// Normalized origin of the CB8 server, e.g. `http://192.168.1.20:8080`.
    pub server_url: Option<String>,
}

/// Live handle to an in-flight pin, kept in `AppState.downloads` while the
/// spawned task runs. Flipping `cancel` asks the task to stop after the current
/// unit; the task removes its own entry when it finishes.
pub struct DownloadHandle {
    pub cancel: Arc<AtomicBool>,
}

/// Live handle to the open mDNS browse window, kept in `AppState.discovery`
/// while the spawned task runs. Flipping `cancel` asks the task to stop after
/// the current event; shutting the daemon down wakes it out of its recv. The
/// task clears the entry when its window closes.
pub struct DiscoveryHandle {
    pub cancel: Arc<AtomicBool>,
    pub daemon: ServiceDaemon,
}

pub struct AppState {
    pub client: reqwest::Client,
    pub cookies: Arc<CookieStoreMutex>,
    pub config: RwLock<Config>,
    pub config_path: PathBuf,
    pub cookies_path: PathBuf,
    pub cache_dir: PathBuf,
    /// Approximate media-cache size in bytes; `None` until first scanned.
    pub cache_size: Mutex<Option<u64>>,
    /// Root of the pinned (offline) tree, a sibling of `cache_dir`. Exempt from
    /// LRU eviction and `clear_media_cache`.
    pub pinned_dir: PathBuf,
    /// In-flight pins, keyed by comic id, so `cancel_download` can reach them.
    pub downloads: Mutex<HashMap<i64, DownloadHandle>>,
    /// Lazily-built, comic-id-keyed view of the pinned manifests, so the proxy
    /// never re-reads every manifest per request. `None` = needs a rebuild;
    /// invalidated whenever a pin is written or removed.
    pub pinned_index: Mutex<Option<HashMap<i64, PinnedManifest>>>,
    /// Root of the local library (`<app_data>/library`). **Data dir, not
    /// cache**: iOS evicts caches under pressure, and a library that can
    /// evaporate is not a library.
    pub library_dir: PathBuf,
    /// The local library index. Held in memory because every shelf render and
    /// every media request consults it; written through to `catalog.json` on
    /// each mutation.
    pub catalog: Mutex<Catalog>,
    /// Serializes catalog mutation → snapshot → disk write so concurrent
    /// progress/favorite/cover updates cannot finish out of order (each
    /// rename is atomic, but unordered snapshots would still clobber fields).
    pub catalog_write: Mutex<()>,
    /// In-flight media-cache fetches keyed by cache key. Concurrent misses for
    /// the same cold URL await the leader instead of downloading N times.
    pub cache_inflight: Mutex<HashMap<String, CacheInflight>>,
    /// The open LAN browse window, if any, so `start_discovery` can be
    /// idempotent and `stop_discovery` can reach it. `None` = no browse running;
    /// results are never cached here across windows (a stale IP is worse than a
    /// rescan).
    pub discovery: Mutex<Option<DiscoveryHandle>>,
}

/// Shared handle for one in-flight cache fill. Waiters park on `notify` and
/// re-read the disk cache (or the leader's error) after it fires.
pub struct CacheInflight {
    pub notify: Arc<tokio::sync::Notify>,
}

impl AppState {
    pub fn init<R: Runtime>(app: &AppHandle<R>) -> Result<Self, Box<dyn std::error::Error>> {
        let data_dir = app.path().app_data_dir()?;
        let cache_root = app.path().app_cache_dir()?;
        fs::create_dir_all(&data_dir)?;
        let cache_dir = cache_root.join("media");
        fs::create_dir_all(&cache_dir)?;
        let pinned_dir = cache_root.join("pinned");
        fs::create_dir_all(&pinned_dir)?;

        // On iOS the library lives under Documents so UIFileSharingEnabled can
        // surface it in the Files app. Elsewhere (and for config/cookies) we
        // keep using Application Support / app_data_dir.
        let library_dir = resolve_library_dir(app, &data_dir)?;
        fs::create_dir_all(library_dir.join("books"))?;
        fs::create_dir_all(library_dir.join("covers"))?;
        let catalog = Catalog::load(&library_dir.join("catalog.json"));

        let config_path = data_dir.join("config.json");
        let cookies_path = data_dir.join("cookies.json");

        let config: Config = fs::read(&config_path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();

        let store = fs::File::open(&cookies_path)
            .ok()
            .and_then(|file| {
                cookie_store::serde::json::load_all(BufReader::new(file))
                    .map_err(|err| log::warn!("failed to load cookie store: {err}"))
                    .ok()
            })
            .unwrap_or_default();
        let cookies = Arc::new(CookieStoreMutex::new(store));

        let client = reqwest::Client::builder()
            .cookie_provider(cookies.clone())
            .connect_timeout(std::time::Duration::from_secs(10))
            .timeout(std::time::Duration::from_secs(120))
            .build()?;

        Ok(Self {
            client,
            cookies,
            config: RwLock::new(config),
            config_path,
            cookies_path,
            cache_dir,
            cache_size: Mutex::new(None),
            pinned_dir,
            downloads: Mutex::new(HashMap::new()),
            pinned_index: Mutex::new(None),
            library_dir,
            catalog: Mutex::new(catalog),
            catalog_write: Mutex::new(()),
            cache_inflight: Mutex::new(HashMap::new()),
            discovery: Mutex::new(None),
        })
    }

    pub async fn server_url(&self) -> ApiResult<String> {
        self.config
            .read()
            .await
            .server_url
            .clone()
            .ok_or_else(|| ApiError::local("No server configured"))
    }

    pub async fn save_config(&self) -> ApiResult<()> {
        let config = self.config.read().await.clone();
        let bytes = serde_json::to_vec_pretty(&config)
            .map_err(|err| ApiError::local(format!("serialize config: {err}")))?;
        tokio::fs::write(&self.config_path, bytes).await?;
        Ok(())
    }

    /// Persist cookies (incl. session cookies, so sign-in survives restarts).
    pub fn save_cookies(&self) -> ApiResult<()> {
        let file = fs::File::create(&self.cookies_path)?;
        let mut writer = BufWriter::new(file);
        let store = self
            .cookies
            .lock()
            .map_err(|_| ApiError::local("cookie store poisoned"))?;
        cookie_store::serde::json::save_incl_expired_and_nonpersistent(&store, &mut writer)
            .map_err(|err| ApiError::local(format!("save cookies: {err}")))?;
        Ok(())
    }

    pub fn clear_cookies(&self) -> ApiResult<()> {
        {
            let mut store = self
                .cookies
                .lock()
                .map_err(|_| ApiError::local("cookie store poisoned"))?;
            store.clear();
        }
        self.save_cookies()
    }
}

/// Pick the on-device library root and migrate once from the old Application
/// Support location on iOS (pre–Files integration).
fn resolve_library_dir<R: Runtime>(
    app: &AppHandle<R>,
    data_dir: &std::path::Path,
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let legacy = data_dir.join("library");

    #[cfg(target_os = "ios")]
    {
        let docs = app.path().document_dir()?;
        let primary = docs.join("library");
        migrate_library_if_needed(&legacy, &primary)?;
        return Ok(primary);
    }

    #[cfg(not(target_os = "ios"))]
    {
        let _ = app;
        Ok(legacy)
    }
}

/// If `to` has no catalog yet and `from` does, move the library tree so existing
/// books survive the iOS Documents relocation. Best-effort: failures log and
/// leave the legacy tree in place rather than stranding the user with nothing.
fn migrate_library_if_needed(
    from: &std::path::Path,
    to: &std::path::Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let from_catalog = from.join("catalog.json");
    let to_catalog = to.join("catalog.json");
    if !from_catalog.is_file() || to_catalog.is_file() {
        return Ok(());
    }
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent)?;
    }
    // Prefer atomic rename when both sides share a volume; fall back to copy.
    match fs::rename(from, to) {
        Ok(()) => {
            log::info!(
                "migrated local library {} → {}",
                from.display(),
                to.display()
            );
            Ok(())
        }
        Err(rename_err) => {
            log::warn!(
                "library rename failed ({rename_err}); copying {} → {}",
                from.display(),
                to.display()
            );
            copy_dir_recursive(from, to)?;
            // Leave the old tree; a later clean install removes it. Deleting
            // mid-migration would be worse if the copy was partial.
            Ok(())
        }
    }
}

fn copy_dir_recursive(from: &std::path::Path, to: &std::path::Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let src = entry.path();
        let dest = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&src, &dest)?;
        } else {
            fs::copy(&src, &dest)?;
        }
    }
    Ok(())
}
