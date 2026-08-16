//! Native desktop menu — the shell of a real desktop app.
//!
//! Phase 2 adds the first command (**File > Add Books…**, `Cmd/Ctrl+O`); the
//! full menu is finished in Phase 4 (View, Window, Help, dynamic enable/disable).
//! Every action is **routed to the frontend** as a `shelf://menu-command` event
//! rather than being handled in Rust — navigation and import live in React, and
//! Rust only knows "the user picked File > Add Books".

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{App, Emitter, Runtime};

const MENU_COMMAND_EVENT: &str = "shelf://menu-command";

/// Register the native menu and wire its actions to the frontend.
pub fn setup<R: Runtime>(app: &App<R>) -> tauri::Result<()> {
    let add_books = MenuItem::with_id(app, "add-books", "Add Books…", true, Some("CmdOrCtrl+O"))?;
    let separator = PredefinedMenuItem::separator(app)?;
    let close_window = PredefinedMenuItem::close_window(app, None)?;

    // File: Add Books… is the local-first entry point. Close/Quit differ per OS
    // (macOS quits from the app menu, Windows/Linux from File).
    #[cfg(target_os = "macos")]
    let file = Submenu::with_items(app, "File", true, &[&add_books, &separator, &close_window])?;
    #[cfg(not(target_os = "macos"))]
    let file = {
        let quit = PredefinedMenuItem::quit(app, None)?;
        Submenu::with_items(app, "File", true, &[&add_books, &separator, &close_window, &quit])?
    };

    let undo = PredefinedMenuItem::undo(app, None)?;
    let redo = PredefinedMenuItem::redo(app, None)?;
    let edit_sep = PredefinedMenuItem::separator(app)?;
    let cut = PredefinedMenuItem::cut(app, None)?;
    let copy = PredefinedMenuItem::copy(app, None)?;
    let paste = PredefinedMenuItem::paste(app, None)?;
    let select_all = PredefinedMenuItem::select_all(app, None)?;
    let edit =
        Submenu::with_items(app, "Edit", true, &[&undo, &redo, &edit_sep, &cut, &copy, &paste, &select_all])?;

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
        Menu::with_items(app, &[&app_menu, &file, &edit, &window, &help])?
    };
    #[cfg(not(target_os = "macos"))]
    let menu = Menu::with_items(app, &[&file, &edit, &window, &help])?;

    app.set_menu(menu)?;

    // Route menu actions to the frontend. Rust never navigates or imports;
    // it tells React which command the user picked.
    app.on_menu_event(move |app, event| {
        if *event.id() == tauri::menu::MenuId::new("add-books") {
            let _ = app.emit(MENU_COMMAND_EVENT, "add-books");
        }
    });

    Ok(())
}
