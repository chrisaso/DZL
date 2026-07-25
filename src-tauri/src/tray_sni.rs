//! System tray over the StatusNotifierItem protocol.
//!
//! Tauri's tray goes through libappindicator, whose backend never emits click
//! events; `tray-icon` documents Linux clicks as "the event is not emitted
//! even though the icon is shown". That means a left click can only ever open
//! the context menu, so opening the window took two actions.
//!
//! Talking StatusNotifierItem directly fixes that: a left click is an
//! `Activate` call, which we handle by showing the window. Modern trays
//! (KDE, quickshell, waybar, Ayatana hosts) all speak it. If no host is
//! listening we fall back to Tauri's tray so the icon never disappears.

use ksni::TrayMethods;
use tauri::{AppHandle, Manager};

/// Converts Tauri's RGBA window icon into the ARGB32 network-byte-order
/// pixmap the SNI spec asks for.
pub(crate) fn rgba_to_argb(rgba: &[u8]) -> Vec<u8> {
    let mut argb = Vec::with_capacity(rgba.len());
    for pixel in rgba.chunks_exact(4) {
        argb.extend_from_slice(&[pixel[3], pixel[0], pixel[1], pixel[2]]);
    }
    argb
}

pub struct SniTray {
    app: AppHandle,
    icon: Vec<ksni::Icon>,
}

/// The window icon Tauri hands back is only 32×32, which looks soft on a
/// HiDPI bar, so the larger source icon is embedded too and offered alongside
/// it. Hosts pick whichever size suits their panel.
const ICON_128: &[u8] = include_bytes!("../icons/128x128.png");

fn to_pixmap(image: &tauri::image::Image<'_>) -> ksni::Icon {
    ksni::Icon {
        width: image.width() as i32,
        height: image.height() as i32,
        data: rgba_to_argb(image.rgba()),
    }
}

impl SniTray {
    fn new(app: AppHandle) -> Self {
        let mut icon = Vec::new();

        if let Ok(large) = tauri::image::Image::from_bytes(ICON_128) {
            icon.push(to_pixmap(&large));
        }
        if let Some(window_icon) = app.default_window_icon() {
            icon.push(to_pixmap(window_icon));
        }

        Self { app, icon }
    }
}

impl ksni::Tray for SniTray {
    fn id(&self) -> String {
        "dzl".into()
    }

    fn title(&self) -> String {
        "DZL".into()
    }

    /// Deliberately empty. Hosts that see a name look it up in the icon theme
    /// and draw a "missing icon" placeholder when it is not there, which is
    /// exactly what happens before the app is installed, or when the host has
    /// not rescanned the theme. The embedded pixmap below always works.
    fn icon_name(&self) -> String {
        String::new()
    }

    fn icon_pixmap(&self) -> Vec<ksni::Icon> {
        self.icon.clone()
    }

    fn tool_tip(&self) -> ksni::ToolTip {
        ksni::ToolTip {
            title: "DZL".into(),
            description: "DayZ launcher".into(),
            icon_name: String::new(),
            icon_pixmap: self.icon.clone(),
        }
    }

    /// Left click. Deliberately only ever shows the window, because "Hide to tray"
    /// is an explicit menu choice, so a stray click can never make the
    /// launcher vanish.
    fn activate(&mut self, _x: i32, _y: i32) {
        crate::tray::show_window(&self.app);
    }

    fn menu(&self) -> Vec<ksni::MenuItem<Self>> {
        use ksni::menu::{MenuItem, StandardItem};

        vec![
            StandardItem {
                label: "Show DZL".into(),
                activate: Box::new(|this: &mut Self| crate::tray::show_window(&this.app)),
                ..Default::default()
            }
            .into(),
            StandardItem {
                label: "Hide to tray".into(),
                activate: Box::new(|this: &mut Self| crate::tray::hide_window(&this.app)),
                ..Default::default()
            }
            .into(),
            MenuItem::Separator,
            StandardItem {
                label: "Quit".into(),
                activate: Box::new(|this: &mut Self| this.app.exit(0)),
                ..Default::default()
            }
            .into(),
        ]
    }
}

/// Publishes the tray, falling back to Tauri's own if no StatusNotifier host
/// answers (a bare X11 session with only a legacy system tray, say).
pub fn build(app: &AppHandle) {
    let app = app.clone();

    tauri::async_runtime::spawn(async move {
        match SniTray::new(app.clone()).spawn().await {
            Ok(handle) => {
                // The tray lives as long as its handle, so hand it to Tauri
                // rather than letting it drop at the end of this task.
                app.manage(handle);
            }
            Err(error) => {
                eprintln!("StatusNotifier tray unavailable ({error}); using the GTK tray");
                // GTK objects must be created on the main thread.
                let fallback = app.clone();
                let _ = app.run_on_main_thread(move || {
                    if let Err(e) = crate::tray::build(&fallback) {
                        eprintln!("could not create a tray icon at all: {e}");
                    }
                });
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::rgba_to_argb;

    #[test]
    fn reorders_channels_to_argb() {
        // One opaque red pixel, one half-transparent blue pixel.
        let rgba = [255, 0, 0, 255, 0, 0, 255, 128];
        assert_eq!(rgba_to_argb(&rgba), vec![255, 255, 0, 0, 128, 0, 0, 255]);
    }

    #[test]
    fn empty_input_yields_empty_output() {
        assert!(rgba_to_argb(&[]).is_empty());
    }

    #[test]
    fn a_trailing_partial_pixel_is_dropped_rather_than_panicking() {
        let rgba = [255, 0, 0, 255, 1, 2];
        assert_eq!(rgba_to_argb(&rgba).len(), 4);
    }
}
