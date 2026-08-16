//! Native desktop menu — the shell of a real desktop app.
//!
//! **File > Add Books…** is the local-first entry point; **View** carries the
//! full-screen and reader-settings toggles; **Window** and **Help** are the
//! standard shell menus. Every action is **routed to the frontend** as a
//! `shelf://menu-command` event rather than being handled in Rust — navigation
//! and import live in React, and Rust only knows "the user picked command X".
//!
//! Item enable/disable is driven from the frontend via {@link set_menu_enabled},
//! so the menu always reflects the current screen (e.g. Reader Settings is only
//! meaningful while a book is open) without Rust duplicating navigation state.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{App, AppHandle, Emitter, Runtime};

const MENU_COMMAND_EVENT: &str = "shelf://menu-command";

/// Menu item ids the frontend can route on and enable/disable.
pub const ADD_BOOKS: &str = "add-books";
pub const BACK_TO_LIBRARY: &str = "back-library";
pub const TOGGLE_FULLSCREEN: &str = "toggle-fullscreen";
pub const READER_SETTINGS: &str = "reader-settings";
pub const LIBRARY_SEARCH: &str = "library-search";

/// Register the native menu and wire its actions to the frontend.
pub fn setup<R: Runtime>(app: &App<R>) -> tauri::Result<()> {
    let add_books = MenuItem::with_id(app, ADD_BOOKS, "Add Books…", true, Some("CmdOrCtrl+O"))?;
    let back_library =
        MenuItem::with_id(app, BACK_TO_LIBRARY, "Back to Library", false, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let close_window = PredefinedMenuItem::close_window(app, None)?;

    // File: Add Books… + Back to Library are the local-first entry points.
    // Close/Quit differ per OS (macOS quits from the app menu, Windows/Linux
    // from File). Back to Library starts disabled — enabled by the frontend
    // when the reader is open.
    #[cfg(target_os = "macos")]
    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[&add_books, &back_library, &separator, &close_window],
    )?;
    #[cfg(not(target_os = "macos"))]
    let file = {
        let quit = PredefinedMenuItem::quit(app, None)?;
        Submenu::with_items(
            app,
            "File",
            true,
            &[&add_books, &back_library, &separator, &close_window, &quit],
        )?
    };

    // View: full screen + reader settings. Full screen uses the platform
    // shortcut (Cmd+Ctrl+F on macOS, F11 elsewhere); Reader Settings starts
    // disabled and is enabled by the frontend while a book is open.
    #[cfg(target_os = "macos")]
    let fullscreen_accel = Some("Cmd+Ctrl+F");
    #[cfg(not(target_os = "macos"))]
    let fullscreen_accel = Some("F11");
    let toggle_fullscreen =
        MenuItem::with_id(app, TOGGLE_FULLSCREEN, "Toggle Full Screen", true, fullscreen_accel)?;
    let reader_settings =
        MenuItem::with_id(app, READER_SETTINGS, "Reader Settings…", false, None::<&str>)?;
    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[&toggle_fullscreen, &reader_settings],
    )?;

    let undo = PredefinedMenuItem::undo(app, None)?;
    let redo = PredefinedMenuItem::redo(app, None)?;
    let edit_sep = PredefinedMenuItem::separator(app)?;
    let cut = PredefinedMenuItem::cut(app, None)?;
    let copy = PredefinedMenuItem::copy(app, None)?;
    let paste = PredefinedMenuItem::paste(app, None)?;
    let select_all = PredefinedMenuItem::select_all(app, None)?;
    // Cmd/Ctrl+F focuses the library search box (routed to the frontend).
    let library_search =
        MenuItem::with_id(app, LIBRARY_SEARCH, "Find in Library…", true, Some("CmdOrCtrl+F"))?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[&undo, &redo, &edit_sep, &cut, &copy, &paste, &select_all, &edit_sep, &library_search],
    )?;

    let minimize = PredefinedMenuItem::minimize(app, None)?;
    let maximize = PredefinedMenuItem::maximize(app, None)?;
    let window_sep = PredefinedMenuItem::separator(app)?;
    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[&minimize, &maximize, &window_sep, &close_window],
    )?;

    let about = PredefinedMenuItem::about(app, None, None)?;
    let help = Submenu::with_items(app, "Help", true, &[&about])?;

    // macOS convention: the first menu is the app menu (About/Quit etc.).
    #[cfg(target_os = "macos")]
    let menu = {
        let app_sep1 = PredefinedMenuItem::separator(app)?;
        let services = PredefinedMenuItem::services(app, None)?;
        let app_sep2 = PredefinedMenuItem::separator(app)?;
        let hide = PredefinedMenuItem::hide(app, None)?;
        let hide_others = PredefinedMenuItem::hide_others(app, None)?;
        let app_sep3 = PredefinedMenuItem::separator(app)?;
        let quit = PredefinedMenuItem::quit(app, None)?;
        let app_menu = Submenu::with_items(
            app,
            app.package_info().name.clone(),
            true,
            &[&about, &app_sep1, &services, &app_sep2, &hide, &hide_others, &app_sep3, &quit],
        )?;
        Menu::with_items(app, &[&app_menu, &file, &edit, &view, &window, &help])?
    };
    #[cfg(not(target_os = "macos"))]
    let menu = Menu::with_items(app, &[&file, &edit, &view, &window, &help])?;

    app.set_menu(menu)?;

    // Route menu actions to the frontend. Rust never navigates or imports;
    // it tells React which command the user picked.
    app.on_menu_event(move |app, event| {
        let id = event.id().0.as_str();
        if matches!(
            id,
            ADD_BOOKS
                | BACK_TO_LIBRARY
                | TOGGLE_FULLSCREEN
                | READER_SETTINGS
                | LIBRARY_SEARCH
        ) {
            let _ = app.emit(MENU_COMMAND_EVENT, id);
        }
    });

    Ok(())
}

/// Recursively find a menu item by id anywhere in the menu tree (top-level
/// items and their submenus). `Menu::get` / `Submenu::get` only search one
/// level, and our commands live one level deep inside File/View.
fn find_item<'a, R: Runtime>(
    items: &'a [tauri::menu::MenuItemKind<R>],
    id: &str,
) -> tauri::Result<Option<tauri::menu::MenuItem<R>>> {
    for item in items {
        if item.id().as_ref() == id {
            return Ok(item.as_menuitem().cloned());
        }
        if let Some(submenu) = item.as_submenu() {
            if let Some(found) = find_item(&submenu.items()?, id)? {
                return Ok(Some(found));
            }
        }
    }
    Ok(None)
}

/// Enable/disable a menu item by id. The frontend calls this as the screen
/// changes, so the menu always matches React's navigation state (e.g. Reader
/// Settings only while a book is open) without Rust knowing the screen.
#[tauri::command]
pub fn set_menu_enabled<R: Runtime>(
    app: AppHandle<R>,
    id: &str,
    enabled: bool,
) -> tauri::Result<()> {
    let Some(menu) = app.menu() else {
        return Ok(());
    };
    let items = menu.items()?;
    if let Some(item) = find_item(&items, id)? {
        item.set_enabled(enabled)?;
    }
    Ok(())
}
