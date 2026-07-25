// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// True when GDK would land on Wayland and we should steer it to XWayland
/// instead.
///
/// Desktop sessions commonly export a *priority list* such as
/// `GDK_BACKEND=wayland,x11,*`. That is the session stating a preference, not
/// the user demanding Wayland for this app, so a list still gets overridden.
/// Otherwise the window comes up blank for anyone launching from their app
/// menu. A single explicit value like `GDK_BACKEND=wayland` is honoured.
#[cfg(target_os = "linux")]
fn should_force_x11(backend: Option<&str>, on_wayland: bool, has_x11: bool) -> bool {
    if !on_wayland || !has_x11 {
        return false;
    }
    match backend.map(str::trim).filter(|b| !b.is_empty()) {
        None => true,
        Some(value) => value.contains(','),
    }
}

/// WebKitGTK is unreliable on a Wayland session: it dies at startup with
/// "Error 71 (Protocol error) dispatching to Wayland display" and never opens a
/// window, and on some GPUs it renders a blank page through the DMA-BUF path.
/// Running through XWayland avoids both, so set that up before GTK initialises.
#[cfg(target_os = "linux")]
fn apply_linux_rendering_workarounds() {
    let backend = std::env::var("GDK_BACKEND").ok();
    let on_wayland = std::env::var_os("WAYLAND_DISPLAY").is_some();
    let has_x11 = std::env::var_os("DISPLAY").is_some();

    if should_force_x11(backend.as_deref(), on_wayland, has_x11) {
        std::env::set_var("GDK_BACKEND", "x11");
    }

    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::should_force_x11;

    #[test]
    fn unset_backend_on_wayland_is_redirected() {
        assert!(should_force_x11(None, true, true));
    }

    #[test]
    fn session_priority_lists_are_redirected() {
        // What a GNOME/KDE session typically exports.
        assert!(should_force_x11(Some("wayland,x11,*"), true, true));
        assert!(should_force_x11(Some("x11,wayland"), true, true));
    }

    #[test]
    fn an_explicit_single_backend_is_respected() {
        assert!(!should_force_x11(Some("wayland"), true, true));
        assert!(!should_force_x11(Some("x11"), true, true));
    }

    #[test]
    fn nothing_is_forced_without_wayland_or_an_x_display() {
        assert!(!should_force_x11(None, false, true));
        assert!(!should_force_x11(None, true, false));
    }

    #[test]
    fn a_blank_backend_counts_as_unset() {
        assert!(should_force_x11(Some("   "), true, true));
    }
}

fn main() {
    #[cfg(target_os = "linux")]
    apply_linux_rendering_workarounds();

    dzl_lib::run()
}
