//! System tray icon.
//!
//! On Linux the tray goes through libappindicator, which only supports a menu —
//! click events are never delivered to the app. Every action is therefore
//! reachable from the menu rather than relying on clicking the icon.

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime,
};

const WINDOW_LABEL: &str = "main";

pub fn show_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn hide_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        let _ = window.hide();
    }
}

fn toggle_window<R: Runtime>(app: &AppHandle<R>) {
    let visible = app
        .get_webview_window(WINDOW_LABEL)
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);

    if visible {
        hide_window(app);
    } else {
        show_window(app);
    }
}

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show DZL", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "Hide to tray", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &hide, &quit])?;

    let mut builder = TrayIconBuilder::with_id(WINDOW_LABEL)
        .tooltip("DZL")
        .menu(&menu)
        // The menu belongs on right-click; left-click toggles the window on the
        // platforms that report clicks at all.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_window(app),
            "hide" => hide_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    Ok(())
}
