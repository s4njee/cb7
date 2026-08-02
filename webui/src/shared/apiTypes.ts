export interface OkResponse {
  ok: true;
}

/**
 * Response of `POST /api/auth/pair-token` — a freshly minted QR pairing token.
 *
 * This is the **only** place the plaintext token ever appears: the server stores
 * `sha256(token)` and nothing else. Treat the value as a live credential — it
 * signs in as the minting user until `expiresAt` or until it is redeemed once,
 * whichever comes first. Don't log it, don't persist it, don't put it in a URL
 * that could land in history or a Referer header.
 */
export interface PairTokenResponse {
  /** Opaque, single-use, base64url. 32 bytes of CSPRNG entropy. */
  token: string;
  /** ISO-8601 instant the token stops being redeemable (~120 s out). */
  expiresAt: string;
}

/**
 * Response of `GET /api/settings/pair-info` — the addresses this server believes
 * a phone could reach it on, best candidate first.
 *
 * Exists because `window.location.origin` is a lie for the common case: the admin
 * has the web UI open on the server box, so the origin is `localhost` and a QR of
 * it would send the phone to itself. Only the server can enumerate its own LAN
 * interfaces. No secrets here — just addresses of the host the caller is already
 * connected to.
 */
export interface PairInfoResponse {
  /** Bare http(s) origins, most-likely-reachable first. May be empty. */
  origins: string[];
}

export interface InitialCredentialsResponse {
  username: string;
  password: string | null;
  /** Renderer-normalized alias for older/newer callers. */
  initial_password?: string | null;
}

/**
 * A saved spot in a book. Anchored by exactly one of `page` or `location`:
 * comics/PDFs carry a `page` index, reflowable EPUBs carry an EPUB CFI in
 * `location`. The other field is always null.
 */
export interface BookmarkResponse {
  id: number;
  /** Page index for comics/PDFs; null for EPUB (CFI-anchored) bookmarks. */
  page: number | null;
  /** EPUB CFI for reflowable books; null for page-anchored bookmarks. */
  location: string | null;
  note: string | null;
  createdAt: string;
}

export interface HistoryEntryResponse {
  id: number;
  comicId: number;
  comicTitle: string;
  action: string;
  page: number | null;
  timestamp: string;
}

export interface HistoryResponse {
  entries: HistoryEntryResponse[];
  totalCount: number;
}

export interface IngestErrorLogEntryResponse {
  ts: string;
  path: string;
  ext: string;
  errorClass: string;
  message: string;
}

export interface IngestErrorLogResponse {
  count: number;
  recent: IngestErrorLogEntryResponse[];
}
