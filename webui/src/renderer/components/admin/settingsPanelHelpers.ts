import type { ThemeType } from '@/store/uiStore';

/**
 * @module
 * Settings Panel Constants & Validation Helpers
 *
 * Architecture overview for Junior Devs:
 * The settings panel offers theme swatches and a few numeric inputs (auto-rescan
 * interval, web-server port) plus some confirmation messages. The static option
 * list, input validation, and message wording are factored out here so the React
 * component stays declarative and the parsing/range rules can be unit tested.
 */

/** A selectable theme option: its id, display label, and accent colour. */
export type ThemeSwatch = { id: ThemeType; label: string; color: string };

/** The accent themes offered in the settings panel. */
export const THEME_LIST: ThemeSwatch[] = [
  { id: 'red', label: 'Red', color: '#e15b47' },
  { id: 'blue', label: 'Blue', color: '#5b93c7' },
  { id: 'green', label: 'Green', color: '#6fa368' },
  { id: 'purple', label: 'Purple', color: '#9b7bc0' },
  { id: 'orange', label: 'Orange', color: '#ffbf00' },
  { id: 'teal', label: 'Teal', color: '#5ba79c' },
];

/**
 * Parse and validate the auto-rescan interval input.
 * @param raw The raw text from the input field.
 * @returns The number of minutes (0 disables), or `null` if invalid/negative.
 */
export function parseAutoRescanMinutes(raw: string): number | null {
  const minutes = parseInt(raw, 10);
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : null;
}

/**
 * Build the confirmation message after saving the auto-rescan interval.
 * @param minutes The saved interval in minutes (0 means disabled).
 * @returns A message describing the rescan cadence, pluralised correctly.
 */
export function autoRescanSavedMessage(minutes: number): string {
  return minutes > 0
    ? `Folders will rescan every ${minutes} minute${minutes === 1 ? '' : 's'}.`
    : 'Auto-rescan disabled.';
}

/**
 * Parse and validate the web-server port input.
 * Accepts only non-privileged ports in the 1024–65535 range.
 * @param raw The raw text from the input field.
 * @returns The port number, or `null` if out of range/invalid.
 */
export function parseWebServerPort(raw: string): number | null {
  const port = parseInt(raw, 10);
  return Number.isFinite(port) && port >= 1024 && port <= 65535 ? port : null;
}

/**
 * Build the confirmation message after clearing the library.
 * @param removedComics How many items were removed.
 * @returns A message with a locale-formatted, correctly pluralised count.
 */
export function clearLibraryRemovedMessage(removedComics: number): string {
  return `Library cleared (${removedComics.toLocaleString()} item${removedComics === 1 ? '' : 's'} removed).`;
}

/* -------------------------------------------------------------- QR pairing */

/**
 * Build the v1 QR pairing payload:
 *
 *     cb8pair://v1?url=<urlencoded origin>[&token=<opaque>]
 *
 * The renderer's mirror of `main/webServer/pairPayload.ts`. It is duplicated
 * rather than imported because the renderer is a separate browser bundle and
 * cannot reach into `main/` (a node module tree) — the same reason the Shelf
 * client carries its own `parsePairPayload`. `reader/docs/CONTRACT.md` § "QR
 * pairing payload" is the shared source of truth, and all three implementations
 * are pinned by mirrored test vectors. Do not change this without changing the
 * other two.
 *
 * Unlike the server's copy this does not validate the origin: the origins it is
 * given come from `/api/settings/pair-info`, which the server already normalized.
 *
 * @param origin The server origin the phone should connect to.
 * @param token Optional single-use pairing token for one-tap sign-in.
 * @returns The `cb8pair://v1?…` string to encode into the QR.
 */
export function buildPairPayload(origin: string, token?: string): string {
  const params = new URLSearchParams({ url: origin });
  if (token) params.set('token', token);
  return `cb8pair://v1?${params.toString()}`;
}

/**
 * How often the pair panel re-mints its token, in milliseconds.
 *
 * Deliberately under the server's 120 s TTL: refreshing *at* the TTL would leave
 * a window where the QR on screen is already dead, and the first thing the user
 * would know about it is a failed scan. 90 s leaves 30 s of slack for clock skew
 * and the round trip. Keep this strictly below the server's `PAIR_TOKEN_TTL_MS`.
 */
export const PAIR_TOKEN_REFRESH_MS = 90_000;

/**
 * Whether an origin is one a phone cannot reach.
 *
 * The renderer's copy of the server-side check (`isLoopbackHostname` in
 * `main/webServer/pairPayload.ts`) — the panel needs it to decide whether to warn
 * *before* it has the server's origin list, and the renderer can't import from
 * `main/`. Kept deliberately small so the duplication stays obvious and cheap.
 *
 * @param origin An absolute origin, e.g. `window.location.origin`.
 * @returns `true` when the origin only means "this machine".
 */
export function isUnreachableOrigin(origin: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(origin).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return true;
  }
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
  if (hostname === '::1' || hostname === '::' || hostname === '0.0.0.0') return true;
  return /^127\./.test(hostname);
}

/**
 * The origins worth offering, best first: the page's own origin, then whatever
 * the server detected, de-duplicated.
 *
 * The page's origin leads because it is the only candidate *proven* to work —
 * you are reading this page over it. The server's list comes from its own
 * interfaces, which in the default Docker deployment are the container's
 * (`172.17.x.x`): routable-looking, unreachable from a phone, and impossible
 * for the server to tell apart from a real LAN address. When CB8 is reached
 * through a reverse proxy or a tunnel, the page origin is likewise the only
 * one that means anything.
 *
 * Loopback is the exception — "this machine" is the one address that provably
 * *cannot* work from a phone, so it sinks below the server's suggestions.
 *
 * @param origins The server's candidate origins.
 * @param currentOrigin The page's own origin (`window.location.origin`).
 * @returns Candidate origins, best first, without duplicates.
 */
export function pairOriginCandidates(origins: string[], currentOrigin: string): string[] {
  const all = currentOrigin ? [currentOrigin, ...origins] : [...origins];
  const seen = new Set<string>();
  const unique = all.filter((origin) => {
    if (!origin || seen.has(origin)) return false;
    seen.add(origin);
    return true;
  });
  const reachable = unique.filter((origin) => !isUnreachableOrigin(origin));
  const loopback = unique.filter((origin) => isUnreachableOrigin(origin));
  return [...reachable, ...loopback];
}

/**
 * Choose which origin the pair panel should show a QR for by default.
 *
 * The first candidate (see {@link pairOriginCandidates}). Falls back to the
 * page's own origin — a QR of localhost plus the warning beats an empty panel,
 * because the address is still readable by a human who can type it in.
 *
 * @param origins The server's candidate origins.
 * @param currentOrigin The page's own origin (`window.location.origin`).
 * @returns The origin to encode into the QR.
 */
export function defaultPairOrigin(origins: string[], currentOrigin: string): string {
  return pairOriginCandidates(origins, currentOrigin)[0] ?? currentOrigin;
}

/**
 * The warning to show above the QR, or `null` when the chosen address is fine.
 *
 * Two distinct problems, two distinct messages:
 *  - the selected address is loopback — the QR is genuinely unusable from a
 *    phone, and we know it;
 *  - the selected address is routable but the page is on localhost — nothing is
 *    wrong, but the address in the QR is *not* the one in the URL bar, which is
 *    surprising enough to be worth a line of explanation.
 *
 * @param selectedOrigin The origin currently encoded in the QR.
 * @param currentOrigin The page's own origin.
 * @param originCount How many candidates the server offered.
 * @returns The warning text, or `null` if there is nothing to warn about.
 */
export function pairOriginWarning(
  selectedOrigin: string,
  currentOrigin: string,
  originCount: number,
): string | null {
  if (isUnreachableOrigin(selectedOrigin)) {
    return originCount > 1
      ? 'This is a localhost address — a phone scanning it would try to reach itself. Pick one of the other addresses below.'
      : "This is a localhost address, so a phone can't reach it. The server didn't detect a LAN address — connect it to your network, or set BETTER_AUTH_TRUSTED_ORIGINS and reach CB8 on that address.";
  }
  if (isUnreachableOrigin(currentOrigin)) {
    return `You're viewing CB8 on ${currentOrigin}, which a phone can't reach, so this code points at ${selectedOrigin} instead. Make sure your phone is on the same network.`;
  }
  return null;
}
