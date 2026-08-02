# QR pairing — status, architecture, and residual plan

> **TL;DR:** QR pairing is already implemented end-to-end in this monorepo
> (web UI mint + phone scan + one-tap sign-in). This doc is a map of what
> exists, how to find it, how to verify it, and the small residual gaps — not a
> greenfield build plan. If you opened Settings and didn't see a code, jump to
> [Where it lives in the UI](#where-it-lives-in-the-ui).

---

## Goal

A phone user points the CB8 / Shelf camera at a QR shown by the **web UI** and
ends up connected to that library **and signed in as the user who revealed the
code** — no password typing on the phone.

There are two levels of the contract:

| Level | Payload | Result on the phone |
|---|---|---|
| **v1** | `cb8pair://v1?url=<origin>` | Server address only; user still signs in |
| **v2** (what the panel ships) | `…&token=<opaque>` | Address **and** session for the minting user |

The mobile client always accepts both. The web UI always mints v2 tokens.

---

## Current status

| Layer | Status | Location |
|---|---|---|
| Wire format | Done | `reader/docs/CONTRACT.md` § "QR pairing payload" |
| Server mint / redeem / origins | Done | `webui/src/main/webServer/routes/auth.ts` |
| Token table (hashed, single-use) | Done | `webui/src/main/db/pairTokens.ts` |
| Payload builder (server) | Done | `webui/src/main/webServer/pairPayload.ts` |
| Session establishment (server-only) | Done | `webui/src/main/webServer/auth.ts` (`PAIR_SESSION_PATH`) |
| Settings "Pair a device" panel | Done | `webui/src/renderer/components/admin/SettingsPanel.tsx` + `SettingsPanelSections.tsx` |
| Panel helpers + tests | Done | `settingsPanelHelpers.ts` / `.test.ts` |
| Client parse + vectors | Done | `reader/src/lib/pair.ts` / `pair.test.ts` |
| Client scan + redeem | Done | `Connect.tsx`, `ScanButton.tsx`, `api.pairWithToken` |
| Epic checklist | Done | `reader/tasks.md` Epic 2 (QR-1…QR-6) |

What is **still open by nature** (called out in `reader/tasks.md`):

- Physical-device camera scan on a real phone/iPad (simulators have no camera).
- Everything either side of the lens is unit/live-tested (payload round-trip,
  mint, redeem, session cookie, no-oracle failures).

---

## Where it lives in the UI

**Web UI (producer)**

1. Sign in to the CB8 web app as a real user (not guest).
2. Open **Settings**.
3. Section **Pair a device** (available to every signed-in user, not admin-only).
4. Click **Show code** — the QR is blurred by default because it is a bearer
   credential while live.
5. Optionally pick a LAN origin if the page is on `localhost` (phone can't reach
   that); the panel warns and offers addresses from `/api/settings/pair-info`.

**Mobile app (consumer)**

1. Connect screen → **Scan code** (only rendered when the barcode-scanner
   plugin is available — mobile builds).
2. Scan → parse → probe server → `POST /api/auth/pair` with the token → land in
   the library signed in.

If the panel is missing on a running server, you are almost certainly on an
older deploy that predates the feature, not an unimplemented path in this tree.

---

## Architecture

```
 ┌──────────────────────── webui (signed-in browser) ────────────────────────┐
 │  Settings → Pair a device                                                 │
 │    GET  /api/settings/pair-info  → candidate origins (LAN, host, …)       │
 │    POST /api/auth/pair-token     → { token, expiresAt }  (TTL 120 s)      │
 │    buildPairPayload(origin, token)                                        │
 │    QR encode: cb8pair://v1?url=…&token=…                                  │
 │    Re-mint every 90 s + on tab focus                                      │
 └───────────────────────────────────┬───────────────────────────────────────┘
                                     │  camera scan
 ┌───────────────────────────────────▼───────────────────────────────────────┐
 │  Shelf / CB8 mobile (Connect → Scan code)                                 │
 │    parsePairPayload(text)                                                 │
 │    set_server(url) / session probe                                        │
 │    POST /api/auth/pair { token }  → session cookie + user                 │
 │    enter library as that user                                             │
 └───────────────────────────────────────────────────────────────────────────┘
```

### HTTP surface (contract)

All three are rate-limited on the login limiter.

| Method | Path | Auth | Response |
|---|---|---|---|
| `POST` | `/api/auth/pair-token` | Signed-in user | `{ token, expiresAt }` — plaintext only here |
| `POST` | `/api/auth/pair` | **Anonymous** | `{ ok, user }` or opaque `401` |
| `GET` | `/api/settings/pair-info` | Signed-in user | `{ origins: string[] }` |

Rules (load-bearing):

- Token ≥ 32 bytes CSPRNG, base64url; DB stores **only** `sha256(token)`.
- Consume is a single `DELETE … RETURNING` (single-use + expiry atomic).
- Every pair failure is the same message: `"Invalid or expired pairing code"`.
- Guests cannot mint (no identity to bind).
- Session is established through a **server-only** better-auth path
  (`/pair/establish-session` is disabled over HTTP) so there is no
  "sign-in-as-anyone" public endpoint.

### Payload format

```
cb8pair://v1?url=<urlencoded origin>[&token=<opaque>]
```

- `url` — http(s) **origin** only (scheme + host + optional port; no path,
  query, or credentials).
- `token` — optional for v1 address-only; always present from the current panel.
- Unknown query params ignored; unknown scheme/version rejected by the client.

Three independent implementations must not drift (mirrored test vectors):

1. Server: `webui/src/main/webServer/pairPayload.ts`
2. Renderer: `webui/src/renderer/components/admin/settingsPanelHelpers.ts`
3. Client: `reader/src/lib/pair.ts`

Source of truth: `reader/docs/CONTRACT.md`.

---

## Security model (do not weaken)

| Threat | Mitigation in code |
|---|---|
| Shoulder-surf / screenshot | 120 s TTL; panel re-mints at 90 s; blur until reveal |
| Token in DB dump | Hash only |
| Replay / double scan | Atomic DELETE on consume |
| Oracle (expired vs wrong) | Single 401 message for all failures |
| Guest minting | `requireCurrentUser` on pair-token |
| Public "sign in as userId" | Session path not exposed on the HTTP router |
| Logging the secret | Token never written to logs / `app_meta` |

A pairing QR is a **password for two minutes**. Treat UI copy and ops docs
accordingly.

---

## Residual work (if something still feels "missing")

These are the only honest remaining stories. None require re-building the
feature from scratch.

### R-1 · Physical-device verification (S–M)

Prove the camera path on real hardware (iPad Air / iPhone):

1. Run webui on a machine reachable from the tablet (LAN IP, not only
   `localhost`).
2. Settings → Pair a device → Show code → pick the LAN origin if offered.
3. On the tablet: Connect → Scan code → grant camera → scan.
4. Expect: library opens signed in as the minting user, no password form.
5. Negative checks:
   - Scan again after success → "Code expired…" / sign-in form.
   - Wait > 2 min without refresh → same.
   - Deny camera permission → "Camera unavailable — type the address instead."

### R-2 · Discoverability polish (S, optional)

People miss the panel because it sits in Settings behind a reveal control.

Candidates (pick one, don't stack):

- First-run / empty-library tip: "Pair a phone → Settings → Pair a device".
- Library header secondary action on desktop web: "Pair phone".
- Docs: wiki usage page + `webui/features.md` checkbox (currently absent).

### R-3 · Product checklist / docs hygiene (S)

- [ ] Check off a "QR device pairing" line in `webui/features.md`.
- [ ] Wiki usage section: screenshot of Pair a device + origin warning.
- [ ] Deploy notes already mention QR as the Docker-bridge fallback
      (`webui/docs/DEPLOYMENT.md`); keep them linked from Settings help text.

### R-4 · Regression suite on CI (M, if not already green)

Already present; keep them in the default test run:

| Suite | Path |
|---|---|
| Payload vectors (server) | `pairPayload.test.ts` |
| Payload vectors (renderer) | `settingsPanelHelpers.test.ts` |
| Payload vectors (client) | `reader/src/lib/pair.test.ts` |
| Token DB semantics | `pairTokens.test.ts` |
| Auth guard / session path | `authPairGuard.test.ts` |

Client vectors can be run without a full Vitest setup (see comment in
`pair.test.ts`). Prefer wiring them into whatever CI already runs for the
reader so a CONTRACT.md change fails both sides.

### R-5 · Do **not** implement (anti-scope)

- Public QR without sign-in (would mint as whom?).
- Long-lived tokens / printable stickers.
- Encoding passwords or session cookies into the QR.
- Sharing one QR across users (token is bound to the minter).

---

## Manual smoke (no camera)

When you only have a laptop:

```bash
# 1. Mint as a signed-in user (cookie jar from browser or curl login)
curl -sS -b cookies.txt -c cookies.txt -X POST \
  "$SERVER/api/auth/pair-token"

# 2. Redeem anonymously (fresh client — no cookie)
TOKEN=…  # from step 1
curl -sS -c phone.txt -X POST "$SERVER/api/auth/pair" \
  -H 'content-type: application/json' \
  -d "{\"token\":\"$TOKEN\"}"

# 3. Session should now be authenticated
curl -sS -b phone.txt "$SERVER/api/auth/session"
```

For a payload-level check without HTTP, feed a string through the client's
parser (vectors in `reader/src/lib/pair.test.ts`).

---

## If you truly need a greenfield implementation

Only if you are standing up a **new** server surface that does not have the
files above. Sequence (from `reader/tasks.md`):

1. **QR-1** — Write `CONTRACT.md` payload + pure parse/build + mirrored tests.
2. **QR-2** — Settings panel: QR of origin (v1, no token yet) + localhost
   warning + LAN origin list.
3. **QR-3** — Mobile scan button → parse → `set_server` → sign-in form.
4. **QR-4** — Token table, mint/redeem routes, session establishment, panel
   re-mint, client redeem after probe. Security review before merge.
5. **QR-5** — Connect screen composition (discovery → scan → manual).
6. **QR-6** — E2E verification (curl loop + physical camera).

In **this** repo those boxes are already checked. Prefer R-1…R-4 over
rewriting.

---

## See also

- `reader/docs/CONTRACT.md` — payload + pair-token HTTP contract
- `reader/tasks.md` — original epic (QR-1…QR-6), acceptance bullets
- `reader/src/lib/pair.ts` — client parser
- `reader/src/components/Connect.tsx` — scan → pair flow
- `webui/src/main/webServer/routes/auth.ts` — mint / redeem / pair-info
- `webui/src/renderer/components/admin/SettingsPanel.tsx` — panel orchestration
- `webui/docs/DEPLOYMENT.md` — QR as the Docker-bridge discovery fallback
