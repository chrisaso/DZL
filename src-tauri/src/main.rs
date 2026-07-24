// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// WebKitGTK is unreliable on a Wayland session: it dies at startup with
/// "Error 71 (Protocol error) dispatching to Wayland display" and never opens a
/// window, and on some GPUs it renders a blank page through the DMA-BUF path.
///
/// Running through XWayland avoids both, so set that up before GTK initialises
/// — but only when the user has not chosen a backend themselves, so
/// `GDK_BACKEND=wayland dzl` still does what it says.
#[cfg(target_os = "linux")]
fn apply_linux_rendering_workarounds() {
    let on_wayland = std::env::var_os("WAYLAND_DISPLAY").is_some();
    let backend_chosen = std::env::var_os("GDK_BACKEND").is_some();
    let has_x11 = std::env::var_os("DISPLAY").is_some();

    if on_wayland && !backend_chosen && has_x11 {
        std::env::set_var("GDK_BACKEND", "x11");
    }

    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
}

fn main() {
    #[cfg(target_os = "linux")]
    apply_linux_rendering_workarounds();

    dzl_lib::run()
}
