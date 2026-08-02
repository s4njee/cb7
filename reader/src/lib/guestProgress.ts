/** Guest sessions can't write progress to the server (every write 401s), so
 *  positions are kept on-device instead, keyed per server. After a real
 *  sign-in the stash can be offered for upload and cleared (see the sync flow
 *  in the reading-flows components).
 */

export interface GuestProgress {
  page?: number;
  location?: string;
  percent?: number;
  /** epoch ms of the last local write — used for "newest wins" on sync. */
  ts: number;
}

type Stash = Record<string, GuestProgress>;

function storageKey(serverUrl: string): string {
  return `shelf.guestProgress.${serverUrl}`;
}

function read(serverUrl: string): Stash {
  try {
    const raw = localStorage.getItem(storageKey(serverUrl));
    return raw ? (JSON.parse(raw) as Stash) : {};
  } catch {
    return {};
  }
}

function write(serverUrl: string, stash: Stash): void {
  try {
    localStorage.setItem(storageKey(serverUrl), JSON.stringify(stash));
  } catch {
    /* storage full/blocked — guest progress is best-effort */
  }
}

export function saveGuestProgress(
  serverUrl: string,
  comicId: number,
  body: { page?: number; location?: string; percent?: number },
): void {
  const stash = read(serverUrl);
  const prev = stash[comicId] ?? {};
  stash[comicId] = {
    ...prev,
    ...(body.page !== undefined ? { page: body.page } : {}),
    ...(body.location !== undefined ? { location: body.location } : {}),
    ...(body.percent !== undefined ? { percent: body.percent } : {}),
    ts: Date.now(),
  };
  write(serverUrl, stash);
}

export function loadGuestProgress(serverUrl: string, comicId: number): GuestProgress | null {
  return read(serverUrl)[comicId] ?? null;
}

export function allGuestProgress(serverUrl: string): Record<string, GuestProgress> {
  return read(serverUrl);
}

export function clearGuestProgress(serverUrl: string): void {
  try {
    localStorage.removeItem(storageKey(serverUrl));
  } catch {
    /* ignore */
  }
}
