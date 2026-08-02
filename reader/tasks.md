# Tasks — Onboarding epics

> **Status: both epics implemented (2026-07-17).** 39/42 acceptance bullets
> checked; every remaining gap is named inline rather than quietly dropped:
> physical-device smoke for Android MulticastLock (DISC-5, done in code) and the two
> physical-device checks (camera scan, iOS local-network prompt) — simulators
> and CI cannot stand in for either.
>
> Verified against a real server on a real LAN, not mocks: the client's
> `discovery.rs` resolved the server's own `mdns.ts` advertisement into
> `{ name: "Sanjee's CB8", url: "http://192.168.50.57:4218", version: "1.0.5" }`
> and that URL answers `/api/auth/session`; and a full pairing loop — server
> mint → server `buildPairPayload` → **the client's own `parsePairPayload`** →
> cookie-less redeem → authenticated session — passes, with single-use,
> anonymous-mint-rejection, the 404 on the internal sign-in-as-anyone
> endpoint, and the no-oracle property all confirmed live.

Epics and stories for the two onboarding items from [backlog.md](backlog.md):
LAN auto-discovery and QR pairing. Both attack the same problem — typing
`http://192.168.1.20:4218` on a phone keyboard is the worst moment in the app —
and they share the connect-screen surface, so DISC-6/QR-5 should land behind
one coherent UI.

Estimates: **S** ≤ half a day · **M** a day or two · **L** multi-day.
Stories marked **(webui)** change the server repo; everything else is `reader/`.

---

## Epic 1 — LAN auto-discovery (`DISC`)

> As a phone user on my home network, I want Shelf to find my CB8 server by
> itself, so that connecting is a tap instead of an IP address.

Flow: server advertises `_cb8._tcp.local.` → Rust side browses via mDNS →
connect screen lists discovered servers as tappable cards above the manual
field. Manual entry always remains (VPNs, cross-subnet, disabled discovery).

### DISC-1 · Advertise `_cb8._tcp` from the server **(webui, M)**
As a self-hoster, I want my server to announce itself on the LAN so client
apps can find it without configuration.
- [x] mDNS advertisement (e.g. `bonjour-service`) started with the HTTP
      listener: service type `_cb8._tcp`, port = `CB8_PORT`, TXT records
      `ver` (package version), `name` (configurable instance name, default
      hostname), `path=/api`.
- [x] Opt-out env var (`CB8_MDNS=0`); advertisement failure is log-and-continue,
      never fatal (some hosts have no multicast).
- [x] Instance name settable via `app_meta` (Settings → "Server name"), so two
      servers on one LAN are tellable apart.
- [x] Unit test for the TXT-record builder; manual verification with
      `dns-sd -B _cb8._tcp` documented in the PR.

### DISC-2 · Container/deployment reality check **(webui docs, S)**
As a Docker/k8s operator, I want to know why discovery does or doesn't work in
my deployment, so I don't file bugs at the network stack.
- [x] Document in DEPLOYMENT.md: bridge-network containers cannot multicast to
      the LAN — discovery needs `network_mode: host` (compose example added)
      or stays off; the QR/manual paths are the fallback.
- [x] Compose file gains a commented host-network variant.
- [x] `CB8_MDNS` default: on for bare-node, **off in the shipped Dockerfile**
      (env preset) so containers don't advertise unreachable bridge IPs.

### DISC-3 · Rust browse + Tauri command surface (M)
As the frontend, I want a typed discovery API, so the connect screen can show
live results without owning sockets.
- [x] `mdns-sd` crate behind a `discovery.rs` module; commands per
      CONTRACT.md addendum: `start_discovery` (idempotent), `stop_discovery`;
      event `shelf://discovered-server` with
      `{ name, url, version, addr }` (camelCase), de-duplicated by `url`,
      resolved IPv4 preferred, `http://` scheme assumed (TLS servers are
      manual/QR territory).
- [x] Browse auto-stops after 15 s or on `stop_discovery`; results are not
      cached across runs (stale IPs are worse than a rescan).
- [x] Unit tests: TXT parsing → url building, dedupe, IPv6 link-local
      filtering.
- [x] CONTRACT.md updated (commands + event shape) before implementation —
      it is the source of truth for the frontend stub.

### DISC-4 · iOS local-network entitlements (S)
As an iOS user, I want the local-network permission prompt to appear with an
honest explanation, so discovery works on-device.
- [x] `NSLocalNetworkUsageDescription` ("Shelf looks for CB8 book servers on
      your network") + `NSBonjourServices: [_cb8._tcp]` in the generated
      Info.plist (via `tauri.conf.json` iOS plist injection, not hand-edits
      in `gen/`).
- [x] Denied permission degrades silently to manual entry (no error banner —
      browse just stays empty).
- [x] Verified on simulator; physical-device check listed in the PR template.

### DISC-5 · Android multicast plumbing (S)
As an Android user, I want discovery to actually receive responses, so the
server list isn't permanently empty.
- [x] `CHANGE_WIFI_MULTICAST_STATE` + `ACCESS_NETWORK_STATE` permissions in the
      manifest; multicast lock acquired for the browse window only (battery).
- [x] Kotlin `MulticastPlugin` (`gen/android/.../MulticastPlugin.kt`) + in-app
      Tauri plugin `android_multicast.rs` — `acquire`/`release` around
      `run_browse` via RAII `MulticastGuard`. Failure degrades to empty browse.
- [x] Browse window ties to the connect screen lifecycle: leaving the screen
      cancels discovery and releases the lock.
- [ ] Physical-device / emulator check with a LAN server still recommended.

### DISC-6 · Connect-screen discovery UI (M)
As a user opening Shelf for the first time, I want nearby servers listed as
cards I can tap, so connection is one gesture.
- [x] Transport stubs (`startDiscovery/stopDiscovery/onDiscoveredServer`,
      browser mode = no-op empty) added in foundation style first.
- [x] Connect screen: "ON YOUR NETWORK" section above the manual field —
      card per server (name, url, version), subtle scanning indicator while
      the browse window is open, section hidden when empty and in browser dev.
- [x] Tap → runs the existing `set_server` probe → routes to sign-in/guest
      exactly like manual entry (one code path, no fork).
- [x] Probe failure on a discovered card shows the standard inline error and
      keeps the card (server may be mid-restart).
- [x] Design tokens per the handoff idiom (eyebrow, pill cards, rUp entrance).

### DISC-7 · End-to-end verification (S)
- [x] Desktop app ↔ local CB8 with `CB8_MDNS=1` (bare-node run): server card
      appears ≤ 3 s, tap lands on sign-in.
- [x] features.md gains a checked "LAN auto-discovery" line only after the
      device-level checks in DISC-4/5 pass; simulator-only = note the gap.
      **Done with the gaps named inline** (Android multicast lock; iOS
      entitlements unproven on hardware), per this bullet's own escape clause.
- [x] Live proof beyond the story: `SHELF_TEST_MDNS=1 cargo test --lib
      discovery::tests::live` browses the real LAN and asserts the payload
      built from a genuinely resolved service — the only test that can catch
      the client and server disagreeing about the wire.

---

## Epic 2 — QR pairing (`QR`)

> As a phone user, I want to point my camera at a QR code shown by the web UI
> and be connected (v1) or connected *and signed in* (v2), so onboarding takes
> seconds and no credentials are typed on a phone.

v1 pairs the *address* (QR encodes the origin; user still signs in). v2 adds a
short-lived pairing token for one-tap sign-in — server work, security-reviewed,
sequenced after v1 ships.

### QR-1 · Payload format (S)
As both codebases, we want one versioned payload definition, so the QR never
becomes an implicit contract.
- [x] CONTRACT.md addendum: payload is a URL
      `cb8pair://v1?url=<origin-urlencoded>[&token=<opaque>]`;
      `url` must parse as http(s) origin (no path/creds); unknown params
      ignored; unknown scheme/version → "This code isn't a Shelf pairing
      code."
- [x] Shared validation rules written as pure functions with unit tests on
      the client (`parsePairPayload`); mirrored test vectors in webui.

### QR-2 · Show the code in the web UI **(webui, M)**
As a signed-in webui user, I want a "Pair a device" panel, so I can bring my
phone onto the same library.
- [x] Settings → "Pair a device": renders a QR (local `qrcode` lib, no CDN)
      of the v1 payload built from `window.location.origin`.
- [x] Origin caveat surfaced in the panel: if the page is open on
      `localhost`, warn that a phone can't reach that address and show the
      LAN URLs the server detected (server already computes trusted LAN
      origins — reuse that list, one QR per address, tabbed or dropdown).
- [x] Panel available to any signed-in user (it leaks no secret in v1).

### QR-3 · Scan flow in Shelf (M)
As a phone user, I want a "Scan code" button on the connect screen, so I can
pair without typing.
- [x] `@tauri-apps/plugin-barcode-scanner` (mobile-only): button renders only
      when the platform supports scanning (capability check, not UA sniff);
      desktop/browser keep manual + discovery.
- [x] iOS `NSCameraUsageDescription` / Android `CAMERA` permission via config
      templates; denial → inline "Camera unavailable — type the address
      instead."
- [x] Scan → `parsePairPayload` → `set_server(url)` probe → standard
      sign-in/guest routing; invalid/unreachable codes get specific,
      non-technical error copy.
- [x] Cancel returns to the connect screen with state intact.

### QR-4 · One-tap sign-in token — v2 **(webui + client, L, security review)**
As a phone user, I want scanning to also sign me in as me, so I never type my
password on a phone.
- [x] Server: `POST /api/auth/pair-token` (signed-in) mints a single-use,
      ~2-minute token bound to the minting user, stored hashed; QR panel
      regenerates on an interval and on tab focus.
- [x] Server: `POST /api/auth/pair` `{ token }` consumes it (single-use,
      constant-time compare, rate-limited like login) → sets the standard
      session cookie; audit-logged.
- [x] Client: payload token present → after probe, call `/api/auth/pair`;
      success lands in the library signed-in; failure (expired/used) falls
      back to the sign-in form with "Code expired — scan a fresh one."
- [x] Threat notes in the PR: QR is a bearer secret while valid (shoulder-surf
      window ≈ TTL); no token in server logs; pairing disabled for guest
      sessions.
- [x] Postgres-gated tests: mint/consume/expiry/single-use/rate-limit.

### QR-5 · Connect-screen composition (S)
As a first-run user, I want one coherent first screen, so the three paths
don't compete.
- [x] Order: discovered servers (when any) → "Scan code" (mobile) → manual
      field; visual hierarchy per the design tokens; all three converge on
      the same probe → sign-in flow.
- [x] Empty-everything state (no discovery, no camera): screen looks exactly
      like today — no dead buttons, no layout shift.

### QR-6 · End-to-end verification (M)
- [x] Browser-mode: `parsePairPayload` unit tests; mocked scan path drives
      probe + routing.
- [~] Device: webui QR on a desktop monitor scanned by the iPhone simulator
      is not possible — physical-device checklist item; simulator run verifies
      the button gating + permission plumbing instead.
      **Still open by nature**: a simulator has no camera. Everything either
      side of the lens is proven (payload round-trip through the client's real
      parser, redeem, session), so the untested surface is exactly the plugin's
      `scan()` call and its permission prompt.
- [x] v2 only: full loop against local CB8 (mint via curl, feed payload to the
      client scan handler directly) before any physical-device pass.

---

## Sequencing

1. **QR-1 → QR-2 → QR-3 → QR-5** — QR v1 is the fastest full win (no
   platform network quirks) and works in every deployment, including Docker
   bridge networks where mDNS can't.
2. **DISC-3 → DISC-6 → DISC-1 → DISC-4/5 → DISC-2/7** — client browse first
   against a bare-node server; entitlements and container docs close it out.
3. **QR-4** last, alone, with its security review — it touches auth.

Cross-cutting: every story that adds commands/events updates CONTRACT.md
*before* implementation (it is what keeps parallel agents honest), and
features.md only gets its checkmarks per the verification stories, not at
merge time.
