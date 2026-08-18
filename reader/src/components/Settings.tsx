import { useEffect, useState, type ReactNode } from "react";
import * as api from "../lib/api";
import type { ReaderFormat } from "../lib/format";
import { useSession, type SettingsSection } from "../store/session";
import { ACCENTS, type AccentName } from "../lib/fonts";
import { currentDeviceClass, displayFor, isDisplayCustomized, useDisplay, type DeviceClass } from "../store/display";
import { usePrefs } from "../store/prefs";
import { useLibraryPrefs } from "../store/libraryPrefs";
import { usePrivacyPrefs } from "../store/privacyPrefs";
import SettingsDrawer from "./SettingsDrawer";
import LinkedFoldersPanel from "./library/LinkedFoldersPanel";
import ServersPanel from "./library/ServersPanel";
import SearchIndexPanel from "./library/SearchIndexPanel";
import OpdsPanel from "./opds/OpdsPanel";
import { BackIcon, CloseIcon } from "./icons";
import { subscribeOutbox, type OutboxSnapshot } from "../lib/progressOutbox";
import { clearReadingData } from "../lib/readingData";
import { initPlatform, type PlatformInfo } from "../lib/platform";

const SECTIONS: { id: SettingsSection; label: string; hint: string }[] = [
  { id: "reading", label: "Reading", hint: "Defaults and reader behavior" },
  { id: "appearance", label: "Appearance", hint: "Accent and shelf presentation" },
  { id: "library", label: "Library", hint: "Your on-device shelf" },
  { id: "sources", label: "Sources", hint: "Folders, servers and catalogs" },
  { id: "account", label: "Account", hint: "Identity and saved servers" },
  { id: "storage", label: "Storage", hint: "Space used on this device" },
  { id: "privacy", label: "Privacy", hint: "Data and network choices" },
  { id: "about", label: "About", hint: "Version and diagnostics" },
];

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return <section className="settings-section"><header className="settings-section-head"><h3 className="settings-section-title">{title}</h3>{hint && <p className="settings-section-hint">{hint}</p>}</header><div className="settings-section-body">{children}</div></section>;
}

function AppearancePane() {
  const accent = usePrefs((s) => s.accent);
  const setAccent = usePrefs((s) => s.setAccent);
  const flourishes = usePrefs((s) => s.typographicFlourishes);
  const setFlourishes = usePrefs((s) => s.setTypographicFlourishes);
  const [device, setDevice] = useState<DeviceClass>(currentDeviceClass);
  const byDevice = useDisplay((s) => s.byDevice);
  const setDisplay = useDisplay((s) => s.set);
  const resetDisplay = useDisplay((s) => s.reset);
  useEffect(() => {
    const onResize = () => setDevice(currentDeviceClass());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const display = displayFor(byDevice, device);
  const update = (patch: Parameters<typeof setDisplay>[1]) => setDisplay(device, patch);
  return <>
    <Section title="Accent" hint="App-wide color for controls and shelf surfaces">
      <div className="accent-grid">{ACCENTS.map((a) => <button key={a.name} type="button" className={`accent-swatch${accent === a.name ? " active" : ""}`} style={{ background: a.hex }} aria-label={a.label} title={a.label} onClick={() => setAccent(a.name as AccentName)} />)}</div>
      <div className="setting-scope-note">App</div>
    </Section>
    <Section title="Shelf layout" hint={`This ${device} only — your other devices keep their own.`}>
      <div className="setting-label">Layout</div>
      <div className="segmented">{(["grid", "list"] as const).map((value) => <button key={value} type="button" className={`seg-btn small${display.layout === value ? " active" : ""}`} onClick={() => update({ layout: value })}>{value === "grid" ? "Grid" : "List"}</button>)}</div>
      <div className="setting-label">Density</div>
      <div className="segmented">{(["comfortable", "compact"] as const).map((value) => <button key={value} type="button" className={`seg-btn small${display.density === value ? " active" : ""}`} onClick={() => update({ density: value })}>{value === "comfortable" ? "Comfortable" : "Compact"}</button>)}</div>
      <label className="setting-toggle"><div><div className="setting-label">Show details</div><div className="setting-hint">Display metadata below each title</div></div><input type="checkbox" checked={display.showMeta} onChange={(e) => update({ showMeta: e.target.checked })} /></label>
      <button type="button" className="settings-reset-btn" disabled={!isDisplayCustomized(display)} onClick={() => resetDisplay(device)}>Reset this device’s layout</button>
      <div className="setting-scope-note">App · per device class</div>
    </Section>
    <Section title="Typography" hint="Optional chapter-level reading details">
      <label className="setting-toggle"><div><div className="setting-label">Typographic flourishes</div><div className="setting-hint">Drop caps, small caps and hanging punctuation</div></div><input type="checkbox" checked={flourishes} onChange={(e) => setFlourishes(e.target.checked)} /></label>
    </Section>
  </>;
}

function BookOverrideIndex() {
  const bookFonts = usePrefs((s) => s.bookFonts);
  const resetBookOverrides = usePrefs((s) => s.resetBookOverrides);
  const clearBookFonts = usePrefs((s) => s.clearBookFonts);
  const [books, setBooks] = useState<api.WebComicRecord[]>([]);
  useEffect(() => { let alive = true; void api.listLocal().then((items) => { if (alive) setBooks(items); }).catch(() => {}); return () => { alive = false; }; }, [bookFonts]);
  const entries = Object.entries(bookFonts);
  return <Section title="Typeface overrides" hint={`${entries.length} ${entries.length === 1 ? "book uses" : "books use"} a typeface other than your default`}>
    {entries.length === 0 ? <p className="panel-sub">No per-book typeface overrides.</p> : <div className="settings-override-list">{entries.map(([id, font]) => { const book = books.find((b) => b.id === Number(id)); return <div className="settings-override-row" key={id}><div><strong>{book?.title ?? `Book ${id}`}</strong><span>{font}</span></div><button type="button" className="btn-ghost" onClick={() => resetBookOverrides(Number(id))}>Clear</button></div>; })}</div>}
    {entries.length > 0 && <button type="button" className="settings-reset-btn" onClick={clearBookFonts}>Clear all overrides</button>}
  </Section>;
}

function SourcesPane({ onLibraryChanged, onImported }: { onLibraryChanged?: () => void; onImported?: () => void }) {
  const [localCount, setLocalCount] = useState(0);
  const [linkedCount, setLinkedCount] = useState(0);
  const [folderCount, setFolderCount] = useState(0);
  const [serverCount, setServerCount] = useState(0);
  const [catalogCount, setCatalogCount] = useState(0);
  const reload = () => {
    void Promise.all([
      api.listLocal().then((books) => { setLocalCount(books.length); setLinkedCount(books.filter((book) => book.linked).length); }),
      api.localLinkedFolders().then((folders) => setFolderCount(folders.length)),
      api.listServers().then((servers) => setServerCount(servers.length)),
      api.opdsListCatalogs().then((catalogs) => setCatalogCount(catalogs.length)),
    ]).catch(() => {});
  };
  useEffect(() => { reload(); }, []);
  return <>
    <Section title="Sources" hint="Everything that can feed this shelf">
      <div className="settings-source-list">
        <div className="settings-source-row"><div><strong>On this device</strong><span>Imported copies · {localCount} books</span></div><em>Available offline</em></div>
        <div className="settings-source-row"><div><strong>Linked folders</strong><span>Read in place · {folderCount} folders, {linkedCount} books</span></div><em>{api.localSupported ? "Desktop" : "Unavailable"}</em></div>
        <div className="settings-source-row"><div><strong>Servers</strong><span>CB8 libraries · {serverCount} saved</span></div><em>{serverCount ? "Configured" : "None saved"}</em></div>
        <div className="settings-source-row"><div><strong>OPDS catalogs</strong><span>Catalog feeds · {catalogCount} saved</span></div><em>{api.opdsSupported ? "Configured" : "Unavailable"}</em></div>
      </div>
    </Section>
    <ImportDefaultsPane />
    {api.localSupported && <div className="settings-pane-stack"><LinkedFoldersPanel onChanged={() => { reload(); onLibraryChanged?.(); }} onClose={() => {}} /><OpdsPanel onClose={() => {}} onImported={() => { reload(); onImported?.(); }} /></div>}
  </>;
}

function ImportDefaultsPane() {
  const mode = useLibraryPrefs((s) => s.importMode);
  const duplicate = useLibraryPrefs((s) => s.duplicatePolicy);
  const setMode = useLibraryPrefs((s) => s.setImportMode);
  const setDuplicate = useLibraryPrefs((s) => s.setDuplicatePolicy);
  return <Section title="Import defaults" hint="The choices used when adding books">
    <div className="setting-label">Store books</div>
    <div className="segmented">{(["copy", "link"] as const).map((value) => <button key={value} type="button" className={`seg-btn small${mode === value ? " active" : ""}`} onClick={() => setMode(value)}>{value === "copy" ? "Copy into library" : "Link in place"}</button>)}</div>
    <div className="setting-hint">Copy is the default and works offline. Linking keeps files in their existing folder and is available on desktop.</div>
    <div className="setting-label">When a duplicate is found</div>
    <div className="segmented">{(["skip", "keep", "replace"] as const).map((value) => <button key={value} type="button" className={`seg-btn small${duplicate === value ? " active" : ""}`} onClick={() => setDuplicate(value)}>{value === "skip" ? "Skip" : value === "keep" ? "Keep both" : "Replace"}</button>)}</div>
  </Section>;
}

function MetadataPane() {
  const readEmbeddedMetadata = useLibraryPrefs((s) => s.readEmbeddedMetadata);
  const protectEditedMetadata = useLibraryPrefs((s) => s.protectEditedMetadata);
  const setReadEmbeddedMetadata = useLibraryPrefs((s) => s.setReadEmbeddedMetadata);
  const setProtectEditedMetadata = useLibraryPrefs((s) => s.setProtectEditedMetadata);
  return <Section title="Metadata behavior" hint="What happens during import and rescan">
    <label className="setting-toggle"><div><div className="setting-label">Read embedded metadata</div><div className="setting-hint">Use title, author, series and volume fields found inside a file when it is added.</div></div><input type="checkbox" checked={readEmbeddedMetadata} onChange={(e) => setReadEmbeddedMetadata(e.target.checked)} /></label>
    <label className="setting-toggle"><div><div className="setting-label">Protect manual edits</div><div className="setting-hint">A later linked-folder rescan will not overwrite metadata you edited here.</div></div><input type="checkbox" checked={protectEditedMetadata} onChange={(e) => setProtectEditedMetadata(e.target.checked)} /></label>
  </Section>;
}

function CollectionsPane() {
  const [books, setBooks] = useState<api.WebComicRecord[]>([]);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const reload = () => { void api.listLocal().then(setBooks).catch(() => setBooks([])); };
  useEffect(() => { reload(); }, []);
  const collections = new Map<string, number>();
  const tags = new Map<string, number>();
  books.forEach((book) => { (book.collections ?? []).forEach((name) => collections.set(name, (collections.get(name) ?? 0) + 1)); (book.tags ?? []).forEach((name) => tags.set(name, (tags.get(name) ?? 0) + 1)); });
  const rename = async (from: string) => { const to = draft.trim(); setRenaming(null); if (!to || to === from) return; await api.localRenameCollection(from, to).catch(() => {}); reload(); };
  return <Section title="Collections and tags" hint="Keep local organization tidy">
    <div className="setting-label">Collections</div>
    {collections.size === 0 ? <p className="panel-sub">No collections yet.</p> : <div className="settings-maintenance-list">{[...collections].map(([name, count]) => <div className="settings-maintenance-row" key={name}>{renaming === name ? <input className="search-input" value={draft} autoFocus onChange={(e) => setDraft(e.target.value)} onBlur={() => void rename(name)} onKeyDown={(e) => { if (e.key === "Enter") void rename(name); if (e.key === "Escape") setRenaming(null); }} /> : <><span>{name} <small>{count} books</small></span><button type="button" className="btn-ghost" onClick={() => { setRenaming(name); setDraft(name); }}>Rename</button></>}</div>)}</div>}
    <div className="setting-label">Tags</div>
    {tags.size === 0 ? <p className="panel-sub">No tags yet.</p> : <div className="settings-tag-cloud">{[...tags].map(([name, count]) => <span key={name} className="tag-chip">{name} · {count}</span>)}</div>}
    <div className="setting-hint">Collections can be renamed here. Tags are shown with counts; deleting or renaming tags is intentionally deferred until the catalog has a dedicated tag command.</div>
  </Section>;
}

function SyncPane() {
  const [snapshot, setSnapshot] = useState<OutboxSnapshot>(() => api.getOutboxSnapshot());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => subscribeOutbox(setSnapshot), []);
  const syncNow = async () => { setBusy(true); setMessage(null); try { const next = await api.syncProgressOutbox(); setSnapshot(next); setMessage(next.pendingCount ? "Some positions are still waiting." : "Everything is up to date."); } catch { setMessage("Sync could not finish. Your positions remain on this device."); } finally { setBusy(false); } };
  const conflicts = snapshot.entries.filter((entry) => entry.conflict);
  return <Section title="Sync status" hint="Reading positions waiting for your server">
    <div className="settings-sync-summary"><strong>{snapshot.pendingCount}</strong><span>{snapshot.pendingCount === 1 ? "position" : "positions"} pending · {snapshot.status}</span></div>
    <button type="button" className="btn-accent" onClick={() => void syncNow()} disabled={busy || snapshot.pendingCount === 0}>{busy ? "Syncing…" : "Sync now"}</button>
    {message && <div className="setting-hint">{message}</div>}
    {conflicts.length > 0 && <div className="settings-conflict-list"><div className="setting-label">Needs a choice</div>{conflicts.map((entry) => <div className="settings-conflict-row" key={`${entry.serverUrl}-${entry.userId}-${entry.comicId}`}><span>Book {entry.comicId}<small>Server and this device have different positions.</small></span><div><button type="button" className="btn-ghost" onClick={() => void api.resolveConflictPush(entry, (id, body) => api.putServerProgress(id, body))}>Keep mine</button><button type="button" className="btn-ghost" onClick={() => api.resolveConflictDrop(entry)}>Keep server</button></div></div>)}</div>}
  </Section>;
}

function AccountPane({ onSwitchServer, onAddServer, onSignOut, onSignIn, onServersChanged }: { onSwitchServer?: (url: string) => void; onAddServer?: () => void; onSignOut?: () => void; onSignIn?: () => void; onServersChanged?: (servers: api.SavedServer[]) => void }) {
  const user = useSession((s) => s.user);
  const guest = useSession((s) => s.guest);
  const serverUrl = useSession((s) => s.serverUrl);
  const [adopted, setAdopted] = useState<number | null>(null);
  const adopt = () => { if (!user || !serverUrl) return; setAdopted(api.adoptGuestBookmarkData(serverUrl, user.id)); void api.syncBookmarksOutbox(); };
  return <>
    <Section title="Account" hint="Identity and the server currently in use">
      <div className="settings-account-card"><strong>{user?.username ?? (guest ? "Guest" : "On this device")}</strong><span>{serverUrl || "No server connected"}</span></div>
      {user ? <button type="button" className="btn-ghost" onClick={onSignOut}>Sign out</button> : serverUrl ? <button type="button" className="btn-accent" onClick={onSignIn}>Sign in</button> : <button type="button" className="btn-accent" onClick={onAddServer}>Connect a server</button>}
      {user && <><button type="button" className="btn-ghost" onClick={adopt}>Adopt guest bookmarks</button>{adopted != null && <div className="setting-hint">Adopted {adopted} bookmark{adopted === 1 ? "" : "s"} from guest browsing.</div>}</>}
    </Section>
    <SyncPane />
    <ServersPanel active={serverUrl} onSwitch={onSwitchServer ?? (() => {})} onAdd={onAddServer ?? (() => {})} onClose={() => {}} onChanged={onServersChanged} />
  </>;
}

function bytesLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function localStorageBytes(): number {
  let total = 0;
  try { for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i) ?? ""; total += key.length + (localStorage.getItem(key) ?? "").length; } } catch { /* browser privacy mode */ }
  return total * 2;
}

function ConfirmAction({ text, confirmLabel = "Confirm", onConfirm, onCancel }: { text: string; confirmLabel?: string; onConfirm: () => void; onCancel: () => void }) {
  return <div className="settings-confirm"><p className="settings-confirm-text">{text}</p><div className="settings-confirm-row"><button type="button" className="settings-confirm-btn" onClick={onCancel}>Cancel</button><button type="button" className="settings-confirm-btn danger" onClick={onConfirm}>{confirmLabel}</button></div></div>;
}

function StoragePane() {
  const [localBytes, setLocalBytes] = useState(0);
  const [downloadBytes, setDownloadBytes] = useState(0);
  const [downloads, setDownloads] = useState<api.DownloadInfo[]>([]);
  const [cache, setCache] = useState({ bytes: 0, ceiling: 768 * 1024 * 1024 });
  const [search, setSearch] = useState<api.LocalSearchSettings | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"downloads" | "cache" | null>(null);
  const [readingConfirm, setReadingConfirm] = useState(false);
  const reload = async () => {
    const [local, dls, cacheInfo, index] = await Promise.all([api.localSize(), api.listDownloads(), api.mediaCacheInfo(), api.localSearchSettings()]);
    setLocalBytes(local); setDownloads(dls.filter((d) => d.complete)); setDownloadBytes(dls.reduce((sum, d) => sum + d.bytes, 0)); setCache(cacheInfo); setSearch(index);
  };
  useEffect(() => { void reload().catch(() => setMessage("Storage details are unavailable right now.")); }, []);
  const readingBytes = localStorageBytes();
  const total = localBytes + downloadBytes + cache.bytes + (search?.indexedBytes ?? 0) + readingBytes;
  const selectedBytes = downloads.filter((download) => selected.has(download.comicId)).reduce((sum, download) => sum + download.bytes, 0);
  const removeSelected = async () => { const ids = [...selected]; await Promise.all(ids.map((id) => api.removeDownload(id).catch(() => 0))); setSelected(new Set()); setConfirm(null); setMessage(`Removed ${ids.length} download${ids.length === 1 ? "" : "s"} and freed ${bytesLabel(selectedBytes)}.`); await reload(); };
  const clearCache = async () => { const freed = await api.clearMediaCache(); setConfirm(null); setMessage(`Freed ${bytesLabel(freed)} of cached media.`); await reload(); };
  const setCeiling = async (ceiling: number) => { setCache(await api.setMediaCacheCeiling(ceiling)); };
  return <>
    <Section title="Storage" hint="A breakdown of what CB8 holds on this device">
      <div className="settings-storage-total"><span>Total accounted storage</span><strong>{bytesLabel(total)}</strong></div>
      <div className="settings-storage-list">
        {[['Books on device', localBytes, 'Files and covers owned by CB8'], ['Downloads from servers', downloadBytes, 'Offline server copies'], ['Image cache', cache.bytes, 'Remote thumbnails and pages'], ['Search index', search?.indexedBytes ?? 0, 'Rebuildable full-text index'], ['Reading data', readingBytes, 'Preferences, progress, bookmarks and notes']].map(([label, bytes, hint]) => <div className="settings-storage-row" key={String(label)}><div><strong>{label}</strong><span>{hint}</span></div><b>{bytesLabel(Number(bytes))}</b></div>)}
      </div>
      {message && <div className="setting-hint">{message}</div>}
    </Section>
    <Section title="Downloads" hint="Stored server copies you can remove and re-download">
      {downloads.length === 0 ? <p className="panel-sub">No stored downloads.</p> : <><div className="settings-download-list">{[...downloads].sort((a, b) => b.bytes - a.bytes).map((download) => <label className="settings-download-row" key={download.comicId}><input type="checkbox" checked={selected.has(download.comicId)} onChange={(e) => { setConfirm(null); setSelected((current) => { const next = new Set(current); if (e.target.checked) next.add(download.comicId); else next.delete(download.comicId); return next; }); }} /><span><strong>{download.title}</strong><small>{bytesLabel(download.bytes)}</small></span></label>)}</div><button type="button" className="settings-reset-btn" disabled={selected.size === 0} onClick={() => setConfirm("downloads")}>Remove selected downloads <span className="settings-reset-sub">{selected.size > 0 ? `· ${bytesLabel(selectedBytes)}` : ""}</span></button>{confirm === "downloads" && <ConfirmAction text={`This removes ${selected.size} stored server ${selected.size === 1 ? "copy" : "copies"} and frees ${bytesLabel(selectedBytes)}. You can download ${selected.size === 1 ? "it" : "them"} again later.`} confirmLabel="Remove downloads" onConfirm={() => void removeSelected()} onCancel={() => setConfirm(null)} />}</>}
    </Section>
    <Section title="Media cache" hint={`Currently ${bytesLabel(cache.bytes)} · ceiling ${bytesLabel(cache.ceiling)}`}>
      <div className="segmented">{([256, 768, 1536] as const).map((mb, index) => { const ceiling = mb * 1024 * 1024; const label = index === 0 ? "Small" : index === 1 ? "Medium" : "Large"; return <button key={mb} type="button" className={`seg-btn small${cache.ceiling === ceiling ? " active" : ""}`} onClick={() => void setCeiling(ceiling)}>{label}<span className="seg-sub">{mb} MB</span></button>; })}</div>
      <button type="button" className="settings-reset-btn" onClick={() => setConfirm("cache")}>Clear image cache <span className="settings-reset-sub">· frees up to {bytesLabel(cache.bytes)}</span></button>
      {confirm === "cache" && <ConfirmAction text={`This removes ${bytesLabel(cache.bytes)} of cached remote thumbnails and pages. Nothing in your library is deleted; media can be fetched again when needed.`} confirmLabel="Clear image cache" onConfirm={() => void clearCache()} onCancel={() => setConfirm(null)} />}
    </Section>
    <Section title="Reading data" hint="Progress, bookmarks, highlights, stats and unsent sync positions">
      <button type="button" className="settings-reset-btn" onClick={() => setReadingConfirm(true)}>Clear reading data</button>
      {readingConfirm && <ConfirmAction text={`This removes local progress, bookmarks, highlights, reading statistics and unsent sync positions (${api.getOutboxSnapshot().pendingCount} pending). Synced server data remains available for books that support sync.`} confirmLabel="Clear reading data" onConfirm={() => { clearReadingData(); setReadingConfirm(false); setMessage("Cleared local reading data."); }} onCancel={() => setReadingConfirm(false)} />}
    </Section>
    <SearchIndexPanel onClose={() => {}} />
  </>;
}

function ClearLibraryPane({ onLibraryChanged, onServersChanged }: { onLibraryChanged?: () => void; onServersChanged?: (servers: api.SavedServer[]) => void }) {
  const [count, setCount] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [stage, setStage] = useState<"idle" | "review" | "confirm">("idle");
  const [typed, setTyped] = useState("");
  const [includeDownloads, setIncludeDownloads] = useState(false);
  const [includeReading, setIncludeReading] = useState(false);
  const [forgetServers, setForgetServers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { void Promise.all([api.listLocal(), api.localSize()]).then(([books, size]) => { setCount(books.length); setBytes(size); }).catch(() => {}); }, [stage]);
  const clear = async () => {
    setBusy(true);
    try {
      const result = await api.localClearAll();
      let downloadsRemoved = 0;
      if (includeDownloads) { const downloads = await api.listDownloads(); await Promise.all(downloads.map((download) => api.removeDownload(download.comicId).catch(() => 0))); downloadsRemoved = downloads.length; }
      if (includeReading) clearReadingData();
      if (forgetServers) { const servers = await api.listServers(); let remaining = servers; for (const server of servers) remaining = await api.forgetServer(server.url); onServersChanged?.(remaining); }
      setMessage(`Removed ${result.removed} book${result.removed === 1 ? "" : "s"} · freed ${bytesLabel(result.freed)}${result.linkedUnlinked ? ` · ${result.linkedUnlinked} linked folder book${result.linkedUnlinked === 1 ? "" : "s"} unlinked, files untouched` : ""}${downloadsRemoved ? ` · ${downloadsRemoved} download${downloadsRemoved === 1 ? "" : "s"} removed` : ""}.`);
      setStage("idle"); setTyped(""); onLibraryChanged?.();
    } catch { setMessage("The library could not be cleared completely. No linked files were deleted."); }
    finally { setBusy(false); }
  };
  return <Section title="Clear library" hint="Remove every on-device book and its catalog entry">
    {message && <div className="setting-hint">{message}</div>}
    {stage === "idle" && <><p className="panel-sub">{count} {count === 1 ? "book" : "books"} · {bytesLabel(bytes)}. Linked originals remain in their folders; only the link is removed.</p><button type="button" className="settings-reset-btn danger-text" onClick={() => setStage("review")}>Clear library</button></>}
    {stage === "review" && <div className="settings-confirm"><p className="settings-confirm-text">This removes {count} on-device book{count === 1 ? "" : "s"} and frees {bytesLabel(bytes)}. Linked originals are not deleted — they are only unlinked. Your server library and saved servers survive unless selected below.</p><label className="setting-toggle"><span>Also remove server downloads</span><input type="checkbox" checked={includeDownloads} onChange={(e) => setIncludeDownloads(e.target.checked)} /></label><label className="setting-toggle"><span>Also clear reading data</span><input type="checkbox" checked={includeReading} onChange={(e) => setIncludeReading(e.target.checked)} /></label><label className="setting-toggle"><span>Also forget saved servers</span><input type="checkbox" checked={forgetServers} onChange={(e) => setForgetServers(e.target.checked)} /></label><div className="settings-confirm-row"><button type="button" className="settings-confirm-btn" onClick={() => setStage("idle")}>Cancel</button><button type="button" className="settings-confirm-btn danger" onClick={() => setStage("confirm")}>Continue</button></div></div>}
    {stage === "confirm" && <div className="settings-confirm"><p className="settings-confirm-text">This cannot be undone. Type <strong>CLEAR</strong> to remove the library.</p><input className="search-input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type CLEAR" autoFocus /><div className="settings-confirm-row"><button type="button" className="settings-confirm-btn" onClick={() => setStage("review")}>Back</button><button type="button" className="settings-confirm-btn danger filled" disabled={typed !== "CLEAR" || busy} onClick={() => void clear()}>{busy ? "Clearing…" : "Clear library"}</button></div></div>}
  </Section>;
}

function ResetEverythingPane({ onServersChanged }: { onServersChanged?: (servers: api.SavedServer[]) => void }) {
  const [confirm, setConfirm] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const reset = async () => {
    setBusy(true);
    try {
      await api.localClearAll();
      const downloads = await api.listDownloads();
      await Promise.all(downloads.map((download) => api.removeDownload(download.comicId).catch(() => 0)));
      await api.clearMediaCache();
      clearReadingData();
      const servers = await api.listServers();
      let remaining = servers;
      for (const server of servers) remaining = await api.forgetServer(server.url);
      onServersChanged?.(remaining);
      setConfirm(false); setTyped("");
    } finally { setBusy(false); }
  };
  return <Section title="Reset this app to first launch" hint="Clear the library, reading data, settings, downloads and saved servers">
    {!confirm ? <button type="button" className="settings-reset-btn danger-text" onClick={() => setConfirm(true)}>Reset everything</button> : <div className="settings-confirm"><p className="settings-confirm-text">This removes all books, reading data, downloads, cached media, settings and saved servers. Linked originals are not deleted. Type <strong>RESET</strong> to continue.</p><input className="search-input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type RESET" autoFocus /><div className="settings-confirm-row"><button type="button" className="settings-confirm-btn" onClick={() => setConfirm(false)}>Cancel</button><button type="button" className="settings-confirm-btn danger" disabled={typed !== "RESET" || busy} onClick={() => void reset()}>{busy ? "Resetting…" : "Reset app"}</button></div></div>}
  </Section>;
}

function PrivacyPane() {
  const dictionaryLookups = usePrivacyPrefs((s) => s.dictionaryLookups);
  const readingStats = usePrivacyPrefs((s) => s.readingStats);
  const localDiscovery = usePrivacyPrefs((s) => s.localDiscovery);
  const reducedMotion = usePrivacyPrefs((s) => s.reducedMotion);
  const highContrast = usePrivacyPrefs((s) => s.highContrast);
  const nightWarmth = usePrivacyPrefs((s) => s.nightWarmth);
  const setDictionaryLookups = usePrivacyPrefs((s) => s.setDictionaryLookups);
  const setReadingStats = usePrivacyPrefs((s) => s.setReadingStats);
  const setLocalDiscovery = usePrivacyPrefs((s) => s.setLocalDiscovery);
  const setReducedMotion = usePrivacyPrefs((s) => s.setReducedMotion);
  const setHighContrast = usePrivacyPrefs((s) => s.setHighContrast);
  const setNightWarmth = usePrivacyPrefs((s) => s.setNightWarmth);
  const [statsMessage, setStatsMessage] = useState<string | null>(null);
  const clearStats = () => {
    let count = 0;
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key?.startsWith("shelf.stats.")) keys.push(key); }
      keys.forEach((key) => { localStorage.removeItem(key); count++; });
    } catch { /* storage may be unavailable */ }
    setStatsMessage(`Deleted statistics from ${count} server scope${count === 1 ? "" : "s"}.`);
  };
  return <>
    <Section title="Privacy" hint="Choose what may leave or be discovered from this device">
      <label className="setting-toggle"><div><div className="setting-label">Dictionary lookups</div><div className="setting-hint">When enabled, selected words are sent to dictionaryapi.dev. Turn this off for fully local reading.</div></div><input type="checkbox" checked={dictionaryLookups} onChange={(e) => setDictionaryLookups(e.target.checked)} /></label>
      <label className="setting-toggle"><div><div className="setting-label">Reading statistics</div><div className="setting-hint">Keep reading time and page-turn totals only on this device. Nothing is sent by this setting.</div></div><input type="checkbox" checked={readingStats} onChange={(e) => setReadingStats(e.target.checked)} /></label>
      <button type="button" className="settings-reset-btn" onClick={clearStats}>Delete my statistics</button>
      {statsMessage && <div className="setting-hint">{statsMessage}</div>}
      <label className="setting-toggle"><div><div className="setting-label">Local network discovery</div><div className="setting-hint">Browse your Wi-Fi for CB8 servers on the connect screen. No discovery runs when this is off.</div></div><input type="checkbox" checked={localDiscovery} onChange={(e) => setLocalDiscovery(e.target.checked)} /></label>
    </Section>
    <Section title="Accessibility" hint="Make the interface easier to see and operate">
      <label className="setting-toggle"><div><div className="setting-label">Reduced motion</div><div className="setting-hint">Shorten interface transitions and disable decorative animation.</div></div><input type="checkbox" checked={reducedMotion} onChange={(e) => setReducedMotion(e.target.checked)} /></label>
      <label className="setting-toggle"><div><div className="setting-label">High contrast</div><div className="setting-hint">Increase borders, muted text contrast and keyboard focus visibility.</div></div><input type="checkbox" checked={highContrast} onChange={(e) => setHighContrast(e.target.checked)} /></label>
      <label className="setting-toggle"><div><div className="setting-label">Night warmth</div><div className="setting-hint">Add a subtle warm filter for darker reading sessions.</div></div><input type="checkbox" checked={nightWarmth} onChange={(e) => setNightWarmth(e.target.checked)} /></label>
    </Section>
  </>;
}

const LICENSES = [
  ["Newsreader", "SIL Open Font License 1.1"],
  ["Instrument Sans", "SIL Open Font License 1.1"],
  ["Literata", "SIL Open Font License 1.1"],
  ["EB Garamond", "SIL Open Font License 1.1"],
  ["Inter", "SIL Open Font License 1.1"],
  ["Atkinson Hyperlegible", "SIL Open Font License 1.1"],
  ["OpenDyslexic", "SIL Open Font License 1.1"],
  ["Rust and JavaScript dependencies", "See bundled package metadata and upstream licenses"],
] as const;

function AboutPane() {
  const [info, setInfo] = useState<PlatformInfo | null>(null);
  const [diagnostics, setDiagnostics] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { void initPlatform().then(setInfo).catch(() => {}); }, []);
  const copyDiagnostics = async () => {
    const [books, localBytes, downloads, cache, search] = await Promise.all([api.listLocal(), api.localSize(), api.listDownloads(), api.mediaCacheInfo(), api.localSearchSettings()]);
    const text = [
      "CB8 diagnostics",
      `Version: ${info?.version ?? "unknown"}`,
      `Platform: ${info?.os ?? "unknown"}`,
      `Books: ${books.length}`,
      `Storage: ${bytesLabel(localBytes + downloads.reduce((sum, d) => sum + d.bytes, 0) + cache.bytes + (search.indexedBytes ?? 0) + localStorageBytes())}`,
      `Search index: ${search.enabled ? `${search.indexedBooks} books indexed` : "disabled"}`,
      `Pending sync positions: ${api.getOutboxSnapshot().pendingCount}`,
    ].join("\n");
    try { await navigator.clipboard.writeText(text); setCopied(true); setDiagnostics(text); } catch { setDiagnostics(text); setCopied(false); }
  };
  return <>
    <Section title="About CB8" hint="Version, platform and local data locations">
      <div className="settings-account-card"><strong>CB8 Reader</strong><span>Version {info?.version ?? "Loading…"} · {info?.os ?? "Detecting platform…"}</span><span>Library: {info?.libraryDir ?? "Loading…"}</span></div>
      <div className="linked-folder-actions"><button type="button" className="btn-ghost" onClick={() => void api.openLibraryDir()}>Reveal library folder</button><button type="button" className="btn-ghost" onClick={() => void api.openLogs()}>Open logs</button><button type="button" className="btn-ghost" onClick={() => void copyDiagnostics()}>{copied ? "Diagnostics copied" : "Copy diagnostics"}</button></div>
      {diagnostics && <pre className="settings-diagnostics">{diagnostics}</pre>}
    </Section>
    <Section title="Licenses" hint="Bundled fonts and open-source dependencies">
      <div className="settings-license-list">{LICENSES.map(([name, license]) => <div className="settings-license-row" key={name}><strong>{name}</strong><span>{license}</span></div>)}</div>
    </Section>
  </>;
}

export default function Settings({
  format,
  bookId,
  onClose,
  onSwitchServer,
  onAddServer,
  onLibraryChanged,
  onImported,
  readerMode = false,
  onSignOut,
  onSignIn,
  onServersChanged,
}: {
  format?: ReaderFormat;
  bookId?: number;
  onClose: () => void;
  onSwitchServer?: (url: string) => void;
  onAddServer?: () => void;
  onLibraryChanged?: () => void;
  onImported?: () => void;
  readerMode?: boolean;
  onSignOut?: () => void;
  onSignIn?: () => void;
  onServersChanged?: (servers: api.SavedServer[]) => void;
}) {
  const section = useSession((s) => s.settingsSection);
  const setSection = (id: SettingsSection) => useSession.getState().openSettings(id);
  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];

  const panel = () => {
    if (section === "reading") return <><SettingsDrawer format={format} bookId={bookId} embedded readerMode={readerMode} /><BookOverrideIndex /></>;
    if (section === "sources") return <SourcesPane onLibraryChanged={onLibraryChanged} onImported={onImported} />;
    if (section === "account") return <AccountPane onSwitchServer={onSwitchServer} onAddServer={onAddServer} onSignOut={onSignOut} onSignIn={onSignIn} onServersChanged={onServersChanged} />;
    if (section === "library") return <><MetadataPane /><CollectionsPane /></>;
    if (section === "appearance") return <AppearancePane />;
    if (section === "storage") return <><StoragePane /><ClearLibraryPane onLibraryChanged={onLibraryChanged} onServersChanged={onServersChanged} /><ResetEverythingPane onServersChanged={onServersChanged} /></>;
    if (section === "privacy") return <PrivacyPane />;
    return <AboutPane />;
  };

  return <div className="settings-modal-backdrop" onClick={onClose}>
    <div className="settings-modal" role="dialog" aria-modal="true" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
      <header className="settings-modal-head"><div><div className="drawer-title">Settings</div><div className="settings-modal-context">{bookId != null ? "This book and the app" : "This app"}</div></div><button className="close-btn" onClick={onClose} aria-label="Close"><CloseIcon size={17} /></button></header>
      <div className="settings-layout">
        <nav className="settings-rail" aria-label="Settings sections">{SECTIONS.map((s) => <button key={s.id} className={`settings-rail-item${s.id === section ? " active" : ""}`} onClick={() => setSection(s.id)}><span>{s.label}</span><small>{s.hint}</small></button>)}</nav>
        <main className="settings-panel"><button className="settings-mobile-back" onClick={() => setSection("reading")}><BackIcon size={16} /> Settings</button><div className="settings-panel-head"><h2>{current.label}</h2><p>{current.hint}</p></div>{panel()}</main>
      </div>
    </div>
  </div>;
}
