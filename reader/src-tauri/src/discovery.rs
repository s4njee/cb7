//! LAN discovery of CB8 servers over mDNS.
//!
//! A CB8 server advertises `_cb8._tcp.local.` on its HTTP port with TXT records
//! `ver` (package version), `name` (display name), and `path` (always `/api`,
//! reserved). [`start_discovery`] opens a browse window, streams every resolved
//! instance to the frontend as [`DISCOVERED_EVENT`], and closes itself after
//! [`WINDOW`]; [`stop_discovery`] closes it early (connect-screen unmount).
//!
//! Two rules shape the whole module:
//!
//! * **Discovery is never an error path.** A host with no multicast, a denied
//!   iOS local-network prompt, or a daemon that will not start resolves as a
//!   normal, empty browse — manual entry is the mandatory path, this is the
//!   convenience one. Every failure below is a `log::warn!` + `Ok(())`.
//! * **`url` is the identity.** It is de-duplicated within a browse window and
//!   never persisted across runs: a stale IP is worse than a rescan.

use std::collections::{HashMap, HashSet};
use std::net::{IpAddr, Ipv4Addr};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use mdns_sd::{Receiver, ScopedIp, ServiceDaemon, ServiceEvent};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::error::ApiError;
use crate::state::{AppState, DiscoveryHandle};

/// Service type CB8 servers advertise (DISC-1, webui side).
const SERVICE_TYPE: &str = "_cb8._tcp.local.";

/// Instance-name suffix on a resolved fullname, e.g.
/// `Living Room._cb8._tcp.local.` → `Living Room`.
const FULLNAME_SUFFIX: &str = "._cb8._tcp.local.";

/// Tauri event carrying one newly-discovered server.
pub const DISCOVERED_EVENT: &str = "shelf://discovered-server";

/// How long a browse window stays open before it stops itself. Long enough for
/// a phone waking its Wi-Fi radio, short enough not to hold a multicast socket
/// (and, on Android, a multicast lock) for the life of the app.
const WINDOW: Duration = Duration::from_secs(15);

/// Payload of [`DISCOVERED_EVENT`] (camelCase keys per the contract).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredServer {
    /// TXT `name`, else the mDNS instance name. Display string only.
    pub name: String,
    /// `http://<ipv4>:<port>` — **the identity**, de-duplicated on.
    pub url: String,
    /// TXT `ver`, or `""` when absent.
    pub version: String,
    /// The bare resolved IPv4, for the card subtitle.
    pub addr: String,
}

/// Case-insensitive TXT lookup: RFC 6763 keys are case-insensitive, and
/// advertisers do not all agree on the casing.
fn txt_get<'a>(txt: &'a HashMap<String, String>, key: &str) -> Option<&'a str> {
    txt.iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(key))
        .map(|(_, v)| v.as_str())
}

/// The first usable IPv4 in `addrs`, or `None` if the instance has none.
///
/// IPv6 is skipped wholesale (the contract's call: a link-local v6 address
/// confuses more than it helps), as is IPv4 link-local (`169.254.0.0/16`) —
/// an APIPA address means the server never got a DHCP lease and is not
/// reachable at it — and the unspecified address. Loopback is kept on purpose:
/// a server on the same machine as a desktop dev build is genuinely reachable.
///
/// Callers pass a sorted slice, so "first" is deterministic across runs even
/// though the resolver hands back an unordered set.
fn pick_ipv4(addrs: &[IpAddr]) -> Option<Ipv4Addr> {
    addrs.iter().find_map(|ip| match ip {
        IpAddr::V4(v4) if !v4.is_link_local() && !v4.is_unspecified() => Some(*v4),
        _ => None,
    })
}

fn build_url(addr: Ipv4Addr, port: u16) -> String {
    // `http` is assumed: a TLS server is reached by QR or manual entry.
    format!("http://{addr}:{port}")
}

/// Display name from the mDNS fullname, used when TXT `name` is absent:
/// `Living Room._cb8._tcp.local.` → `Living Room`. A fullname that does not
/// carry our suffix is passed through rather than mangled.
fn instance_name(fullname: &str) -> String {
    fullname.strip_suffix(FULLNAME_SUFFIX).unwrap_or(fullname).to_string()
}

/// Build the event payload from the parts of a resolved service, or `None` if
/// it cannot be reached: no usable IPv4, or a meaningless SRV port.
///
/// Split out from the browse loop so it is testable without a network.
fn build_payload(
    fullname: &str,
    txt: &HashMap<String, String>,
    addrs: &[IpAddr],
    port: u16,
) -> Option<DiscoveredServer> {
    if port == 0 {
        return None;
    }
    let addr = pick_ipv4(addrs)?;
    let name = txt_get(txt, "name")
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| instance_name(fullname));

    Some(DiscoveredServer {
        name,
        url: build_url(addr, port),
        version: txt_get(txt, "ver").unwrap_or_default().to_string(),
        addr: addr.to_string(),
    })
}

/// Drain the browse channel until the window elapses, the daemon goes away
/// (`stop_discovery` shut it down), or the cancel flag flips; emit one event
/// per never-before-seen `url`; then tear the window down.
///
/// Holds an Android MulticastLock for the whole window (DISC-5) and releases
/// it on every exit path via [`android_multicast::MulticastGuard`].
async fn run_browse(app: AppHandle, receiver: Receiver<ServiceEvent>, cancel: Arc<AtomicBool>, daemon: ServiceDaemon) {
    // Acquire for this window only — battery cost must not outlive the browse.
    // Drop (and thus release) runs on timeout, cancel, channel death, and panic.
    let _multicast = crate::android_multicast::MulticastGuard::acquire(app.clone());

    let deadline = Instant::now() + WINDOW;
    let mut seen: HashSet<String> = HashSet::new();

    while !cancel.load(Ordering::SeqCst) {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break;
        }
        // A timeout is the 15 s auto-stop; a channel error means the daemon is
        // gone (stop_discovery, or a daemon that failed to open its sockets).
        let event = match tokio::time::timeout(remaining, receiver.recv_async()).await {
            Ok(Ok(event)) => event,
            Ok(Err(_)) | Err(_) => break,
        };

        let ServiceEvent::ServiceResolved(info) = event else {
            continue;
        };
        let mut addrs: Vec<IpAddr> = info.get_addresses().iter().map(ScopedIp::to_ip_addr).collect();
        addrs.sort();
        let txt = info.get_properties().clone().into_property_map_str();
        let Some(server) = build_payload(info.get_fullname(), &txt, &addrs, info.get_port()) else {
            continue;
        };
        // The identity check: one card per url per window, however many times
        // the responder re-announces or however many interfaces answer.
        if !seen.insert(server.url.clone()) {
            continue;
        }
        if let Err(err) = app.emit(DISCOVERED_EVENT, server) {
            log::warn!("failed to emit discovered server: {err}");
        }
    }

    let _ = daemon.shutdown();
    // Clear the slot only if it is still ours: a `stop_discovery` + immediate
    // `start_discovery` may already have installed a newer window.
    let state = app.state::<AppState>();
    let mut slot = state.discovery.lock().await;
    if slot.as_ref().is_some_and(|handle| Arc::ptr_eq(&handle.cancel, &cancel)) {
        *slot = None;
    }
    // `_multicast` drops here → MulticastLock released (Android).
}

/// Start (or keep) a browse window; results arrive as [`DISCOVERED_EVENT`].
///
/// Idempotent: a second call while a window is live is a no-op success.
/// Returns immediately — the browse runs on the async runtime and stops itself
/// after [`WINDOW`].
#[tauri::command]
pub async fn start_discovery(app: AppHandle, state: State<'_, AppState>) -> Result<(), ApiError> {
    let mut slot = state.discovery.lock().await;
    if slot.is_some() {
        return Ok(());
    }

    // Both failures below mean "this host cannot browse" (no multicast, no
    // permission). Never an error path: warn and resolve with no results.
    let daemon = match ServiceDaemon::new() {
        Ok(daemon) => daemon,
        Err(err) => {
            log::warn!("mDNS daemon unavailable, skipping discovery: {err}");
            return Ok(());
        }
    };
    let receiver = match daemon.browse(SERVICE_TYPE) {
        Ok(receiver) => receiver,
        Err(err) => {
            log::warn!("mDNS browse failed, skipping discovery: {err}");
            let _ = daemon.shutdown();
            return Ok(());
        }
    };

    let cancel = Arc::new(AtomicBool::new(false));
    *slot = Some(DiscoveryHandle {
        cancel: cancel.clone(),
        daemon: daemon.clone(),
    });
    drop(slot);

    // MulticastLock (DISC-5) is acquired inside `run_browse` for the window
    // lifetime and released on every exit path via MulticastGuard.
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        run_browse(app_handle, receiver, cancel, daemon).await;
    });
    Ok(())
}

/// End the browse window early (connect-screen unmount). Always succeeds,
/// including when no window is open.
#[tauri::command]
pub async fn stop_discovery(state: State<'_, AppState>) -> Result<(), ApiError> {
    if let Some(handle) = state.discovery.lock().await.take() {
        handle.cancel.store(true, Ordering::SeqCst);
        // Closes the browse channel, which wakes `run_browse` out of its recv.
        let _ = handle.daemon.shutdown();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn txt(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    const FULLNAME: &str = "Living Room._cb8._tcp.local.";

    #[test]
    fn payload_uses_txt_records() {
        let server = build_payload(
            FULLNAME,
            &txt(&[("ver", "1.0.5"), ("name", "Basement NAS"), ("path", "/api")]),
            &[ip("192.168.1.20")],
            4218,
        )
        .expect("resolvable");
        assert_eq!(
            server,
            DiscoveredServer {
                name: "Basement NAS".to_string(),
                url: "http://192.168.1.20:4218".to_string(),
                version: "1.0.5".to_string(),
                addr: "192.168.1.20".to_string(),
            }
        );
    }

    #[test]
    fn txt_lookup_is_case_insensitive() {
        let server = build_payload(
            FULLNAME,
            &txt(&[("Ver", "2.0.0"), ("NAME", "Loft")]),
            &[ip("10.0.0.5")],
            80,
        )
        .expect("resolvable");
        assert_eq!(server.name, "Loft");
        assert_eq!(server.version, "2.0.0");
    }

    #[test]
    fn missing_version_is_empty_string() {
        let server = build_payload(FULLNAME, &txt(&[("name", "Loft")]), &[ip("10.0.0.5")], 80).expect("resolvable");
        assert_eq!(server.version, "");
    }

    #[test]
    fn name_falls_back_to_instance_name() {
        let server = build_payload(FULLNAME, &txt(&[("ver", "1.0.5")]), &[ip("10.0.0.5")], 80).expect("resolvable");
        assert_eq!(server.name, "Living Room");
    }

    #[test]
    fn blank_txt_name_falls_back_to_instance_name() {
        let server = build_payload(FULLNAME, &txt(&[("name", "   ")]), &[ip("10.0.0.5")], 80).expect("resolvable");
        assert_eq!(server.name, "Living Room");
    }

    #[test]
    fn instance_name_strips_only_our_suffix() {
        assert_eq!(instance_name("Living Room._cb8._tcp.local."), "Living Room");
        // A dotted display name survives: only the trailing suffix goes.
        assert_eq!(instance_name("bob.local._cb8._tcp.local."), "bob.local");
        // Foreign or already-stripped names pass through untouched.
        assert_eq!(
            instance_name("Living Room._http._tcp.local."),
            "Living Room._http._tcp.local."
        );
        assert_eq!(instance_name("Living Room"), "Living Room");
    }

    #[test]
    fn url_is_http_scheme_with_srv_port() {
        assert_eq!(
            build_url("192.168.1.20".parse().unwrap(), 4218),
            "http://192.168.1.20:4218"
        );
        assert_eq!(build_url("10.0.0.1".parse().unwrap(), 80), "http://10.0.0.1:80");
    }

    #[test]
    fn ipv4_selection_prefers_first_and_skips_ipv6() {
        let addrs = [ip("fe80::1"), ip("2001:db8::1"), ip("192.168.1.20"), ip("192.168.1.21")];
        assert_eq!(pick_ipv4(&addrs), Some("192.168.1.20".parse().unwrap()));
    }

    #[test]
    fn ipv4_selection_skips_link_local_and_unspecified() {
        let addrs = [ip("169.254.13.7"), ip("0.0.0.0"), ip("192.168.1.20")];
        assert_eq!(pick_ipv4(&addrs), Some("192.168.1.20".parse().unwrap()));
    }

    #[test]
    fn ipv4_selection_keeps_loopback() {
        assert_eq!(pick_ipv4(&[ip("127.0.0.1")]), Some("127.0.0.1".parse().unwrap()));
    }

    #[test]
    fn ipv6_only_service_is_skipped() {
        assert_eq!(pick_ipv4(&[ip("fe80::1"), ip("2001:db8::1")]), None);
        assert!(build_payload(FULLNAME, &txt(&[("ver", "1.0.5")]), &[ip("fe80::1")], 4218).is_none());
    }

    #[test]
    fn link_local_only_service_is_skipped() {
        assert!(build_payload(FULLNAME, &txt(&[]), &[ip("169.254.13.7")], 4218).is_none());
    }

    #[test]
    fn service_without_addresses_is_skipped() {
        assert!(build_payload(FULLNAME, &txt(&[]), &[], 4218).is_none());
    }

    #[test]
    fn zero_port_is_skipped() {
        assert!(build_payload(FULLNAME, &txt(&[]), &[ip("192.168.1.20")], 0).is_none());
    }

    /// The browse loop's dedupe rule: the same `url` never emits twice in one
    /// window, even from a different instance name or a re-announcement.
    #[test]
    fn dedupe_is_by_url_only() {
        let mut seen: HashSet<String> = HashSet::new();
        let emit = |seen: &mut HashSet<String>, name: &str, addr: &str, port: u16| {
            let server = build_payload(FULLNAME, &txt(&[("name", name)]), &[ip(addr)], port).expect("resolvable");
            seen.insert(server.url)
        };

        assert!(emit(&mut seen, "Loft", "192.168.1.20", 4218), "first sighting emits");
        assert!(
            !emit(&mut seen, "Loft", "192.168.1.20", 4218),
            "re-announcement is dropped"
        );
        assert!(
            !emit(&mut seen, "Renamed", "192.168.1.20", 4218),
            "same url, new name is dropped"
        );
        assert!(
            emit(&mut seen, "Loft", "192.168.1.20", 9000),
            "a different port is a new server"
        );
        assert!(
            emit(&mut seen, "Loft", "192.168.1.21", 4218),
            "a different host is a new server"
        );
        assert_eq!(seen.len(), 3);
    }

    /// Live half of DISC-7: browse the real network and build a payload from a
    /// genuinely resolved `_cb8._tcp` service. This is the only test that
    /// proves our parsing agrees with what the server's advertiser actually
    /// puts on the wire — the pure tests above can only prove we agree with
    /// ourselves. Opt-in (needs a CB8 advertising on this LAN):
    ///
    /// ```sh
    /// SHELF_TEST_MDNS=1 cargo test --lib discovery::tests::live -- --nocapture
    /// ```
    #[test]
    fn live_browse_resolves_a_real_server() {
        if std::env::var("SHELF_TEST_MDNS").ok().as_deref() != Some("1") {
            eprintln!("SHELF_TEST_MDNS != 1 — skipping live mDNS browse");
            return;
        }

        let daemon = ServiceDaemon::new().expect("mDNS daemon");
        let receiver = daemon.browse(SERVICE_TYPE).expect("browse");
        let deadline = std::time::Instant::now() + Duration::from_secs(10);

        while std::time::Instant::now() < deadline {
            let left = deadline.saturating_duration_since(std::time::Instant::now());
            match receiver.recv_timeout(left) {
                Ok(ServiceEvent::ServiceResolved(info)) => {
                    // Mirror the production loop exactly (see `run_browse`), so
                    // this test can't pass on a path real discovery never takes.
                    let mut addrs: Vec<IpAddr> = info.get_addresses().iter().map(ScopedIp::to_ip_addr).collect();
                    addrs.sort();
                    let txt = info.get_properties().clone().into_property_map_str();
                    let payload = build_payload(info.get_fullname(), &txt, &addrs, info.get_port())
                        .expect("a resolved CB8 must produce a payload");

                    eprintln!("live payload: {payload:?}");
                    assert!(payload.url.starts_with("http://"), "url: {}", payload.url);
                    assert!(payload.url.ends_with(&format!(":{}", info.get_port())));
                    assert!(!payload.name.is_empty(), "name must never be blank");
                    assert!(
                        payload.addr.parse::<Ipv4Addr>().is_ok(),
                        "addr must be a bare IPv4: {}",
                        payload.addr
                    );
                    let _ = daemon.shutdown();
                    return;
                }
                Ok(_) => continue,
                Err(err) => panic!("no _cb8._tcp resolved within 10s: {err}"),
            }
        }
        panic!("no _cb8._tcp service resolved within 10s — is a CB8 advertising?");
    }
}
