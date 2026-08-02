/**
 * QR pairing payload — the v1 wire format (docs/CONTRACT.md § "QR pairing payload").
 *
 *     cb8pair://v1?url=<urlencoded origin>[&token=<opaque>]
 *
 * This module is **pure**: no I/O, no globals beyond `URL`/`URLSearchParams`, so
 * it is unit-testable in node and mirrors webui's `pairPayload.test.ts` vectors
 * byte for byte. The two must not drift.
 */

export type PairReason = "not-shelf" | "bad-version" | "bad-url";

export type PairPayload =
  | { ok: true; url: string; token?: string }
  | { ok: false; reason: PairReason };

/** The only version this client speaks. Anything else is a newer/older CB8. */
const VERSION = "v1";

/**
 * The outer payload is parsed by hand rather than with `new URL`: `cb8pair:` is
 * a non-special scheme, so host/path parsing is implementation-flavoured (opaque
 * hosts, no lowercasing) and we would be encoding those quirks into the wire
 * contract. The inner `url` param *is* handed to `URL` — there it is a real
 * http(s) URL and WHATWG normalization is exactly what we want.
 */
const PAYLOAD_RE = /^([A-Za-z][A-Za-z0-9+.-]*):(?:\/\/)?([^?#]*)(?:\?([^#]*))?(?:#.*)?$/;

/**
 * Parse a scanned string into a server URL (+ optional pairing token).
 *
 * Rules:
 * - scheme must be `cb8pair` (case-insensitive) — else `not-shelf`;
 * - version segment must be `v1` — else `bad-version`;
 * - `url` is required and must be an http(s) **origin**: scheme + host +
 *   optional port. No path (other than a bare `/`), no query, no fragment, no
 *   credentials — else `bad-url`;
 * - unknown query params are ignored (forward compatibility);
 * - `token` is an opaque passthrough; never logged, never persisted.
 *
 * The returned `url` is normalized to a bare origin (no trailing slash, default
 * port dropped, host lowercased).
 */
export function parsePairPayload(text: string): PairPayload {
  const raw = typeof text === "string" ? text.trim() : "";
  if (!raw) return { ok: false, reason: "not-shelf" };

  const m = PAYLOAD_RE.exec(raw);
  if (!m) return { ok: false, reason: "not-shelf" };

  const [, scheme, segment, query] = m;
  if (scheme.toLowerCase() !== "cb8pair") return { ok: false, reason: "not-shelf" };

  // `cb8pair://v1?…` (authority form) and `cb8pair:v1?…` both land here; a
  // trailing slash on the version segment is tolerated.
  const version = segment.replace(/\/+$/, "").toLowerCase();
  if (version !== VERSION) return { ok: false, reason: "bad-version" };

  const params = new URLSearchParams(query ?? "");
  const url = normalizeOrigin(params.get("url"));
  if (!url) return { ok: false, reason: "bad-url" };

  const token = params.get("token");
  return token ? { ok: true, url, token } : { ok: true, url };
}

/** An http(s) origin, normalized — or null when the input is anything more. */
function normalizeOrigin(value: string | null): string | null {
  if (!value) return null;

  let u: URL;
  try {
    u = new URL(value.trim());
  } catch {
    return null;
  }

  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!u.hostname) return null;
  if (u.username || u.password) return null;
  if (u.search || u.hash) return null;
  if (u.pathname !== "" && u.pathname !== "/") return null;

  // `origin` drops the default port and lowercases the host; it never carries a
  // trailing slash, which is precisely the normalization the client wants.
  return u.origin;
}
