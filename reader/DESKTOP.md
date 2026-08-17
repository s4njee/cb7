# CB8 for desktop

The same CB8 reader you get on iOS/Android, packaged as a native desktop app
for **macOS, Windows, and Linux**. Everything here is optional-serve: the app
is local-first, so you can install it, import books from this device, and read
them fully offline — no account, no network, no server.

For the release plan, architecture decisions, and the checked support matrix,
see [plan-desktop.md](plan-desktop.md) and
[docs/desktop-support-matrix.md](docs/desktop-support-matrix.md).

## Install

| Platform | What you get |
| --- | --- |
| macOS 10.13+ | `CB8_<ver>_universal.dmg` (Apple Silicon + Intel in one) |
| Windows 10/11 x64 | `CB8_<ver>_x64_en-US.msi` or the NSIS `CB8_<ver>_x64-setup.exe` |
| Linux x64 | `cb8_<ver>_amd64.deb` or `CB8_<ver>_x86_64.AppImage` |

- **macOS**: mount the `.dmg`, drag CB8 to Applications. First launch may need
  a right-click → Open if the build is not yet notarized.
- **Windows**: run the MSI or setup exe. On Windows 10 1803+ the WebView2
  runtime is already present; otherwise the installer bootstraps it.
- **Linux**: `.deb` for Debian/Ubuntu (needs `libwebkit2gtk-4.1-0`,
  `libgtk-3-0`); AppImage runs on most x64 distros without installing.

## The local library

Imported books live **inside the app's own storage** — they are *copies*, and
the app never modifies or deletes the files you picked:

| Platform | Library directory |
| --- | --- |
| macOS | `~/Library/Application Support/com.cb8.shelf/library/` |
| Windows | `%APPDATA%\com.cb8.shelf\library\` |
| Linux | `~/.local/share/com.cb8.shelf/library/` |

Each book is a file under `library/books/`; `library/catalog.json` is the
index. Because books are copies, you can move, rename, or delete the originals
after importing — the shelf keeps working.

### Backup / restore

Back up (or move to a new machine) the whole data directory — for macOS that
is `~/Library/Application Support/com.cb8.shelf/`. It holds the library,
catalog, cookies, preferences, reading progress, downloads, and window state.
Restore by quitting CB8, replacing that directory, and relaunching.

## Adding books

Every way of adding a book funnels through the same importer:

- **File > Add Books…** (or `Cmd/Ctrl+O`) opens the picker.
- **Drag and drop** book files anywhere onto the window.
- **Double-click an associated file** (EPUB/PDF/CBZ/CBR) — if CB8 is closed it
  launches and imports; if it's running, the file arrives in the shelf.

Unsupported files, folders, and corrupt archives are reported per-file without
blocking the rest of the batch.

## File associations

CB8 registers EPUB, PDF, CBZ, and CBR. Double-clicking an associated file
launches or focuses CB8, imports it exactly once, and opens it. If you're
reading another book, the new one lands on the shelf rather than interrupting
your session.

## Menus and shortcuts

| Menu | Items |
| --- | --- |
| File | Add Books… (`Cmd/Ctrl+O`), Back to Library, Close Window / Quit |
| Edit | Undo/Redo/Cut/Copy/Paste/Select All, Find in Library… (`Cmd/Ctrl+F`) |
| View | Toggle Full Screen (F11 / `Cmd+Ctrl+F`), Reader Settings… (while reading) |
| Window | Minimize, Maximize, Close |
| Help | About CB8, Open Logs… |

Menu items that only make sense while reading (Back to Library, Reader
Settings) enable and disable with the current screen. The window title reads
`CB8` in the library and `Book title — CB8` while reading. Window size,
position, and maximized state persist across launches; fullscreen does not.

## Connecting to a CB8 server (optional)

The app works fully offline with local books. To browse a server library,
log in from the shelf: your server's address is discovered on the LAN, or you
can enter it manually. Sign-in uses a session cookie that survives restarts.
Connected, you get the remote catalog, downloads/offline pinning, bookmarks,
and cross-device progress.

## Updates

Updates are delivered as a fresh installer from the release page (the in-app
signed updater is planned but not yet shipped). **Upgrades preserve all your
data** — the installer replaces the app bundle and never touches the data
directory. To check for a new version, visit the project's release page.

## Logs

App logs are written to the OS log directory (`tauri-plugin-log` default).
Open them from **Help > Open Logs…**:

| Platform | Log directory |
| --- | --- |
| macOS | `~/Library/Logs/com.cb8.shelf/` |
| Windows | `%LOCALAPPDATA%\com.cb8.shelf\logs\` |
| Linux | `~/.local/share/com.cb8.shelf/logs/` |

Logs contain no passwords, session cookies, or tokens.

## Uninstalling

Uninstalling removes the app but **never deletes your imported books** — they
are copies inside the app data directory, and the original files you added are
never touched by the app. On macOS, drag CB8 to Trash; on Windows, use Add or
Remove Programs; on Linux, remove the package or the AppImage file.

If you also want to remove your local library and settings, delete the data
directory listed above (back it up first if you may want it back).
