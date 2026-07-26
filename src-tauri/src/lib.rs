mod commands;
mod steam_vdf;
mod tray;
#[cfg(target_os = "linux")]
mod tray_sni;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be the first plugin registered: a second launch hands its
        // arguments to the running instance and exits, and this callback is
        // what makes that visible: the window comes back even when the
        // launcher was sitting in the tray.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            tray::show_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            // Linux gets a StatusNotifierItem tray so a left click can open
            // the window; every other platform uses Tauri's own.
            #[cfg(target_os = "linux")]
            tray_sni::build(app.handle());
            #[cfg(not(target_os = "linux"))]
            tray::build(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::config::get_config,
            commands::config::set_config,
            commands::config::set_steam_path,
            commands::config::set_player_name,
            commands::config::reset_config,
            commands::system::check_environment,
            commands::system::fix_max_map_count,
            commands::system::get_system_status,
            commands::system::kill_dayz,
            commands::system::shutdown_steam,
            commands::system::start_steam,
            commands::system::lookup_country,
            commands::steamcmd::check_steamcmd_login,
            commands::join::check_join_requirements,
            commands::join::join_server,
            commands::join::launch_game,
            commands::join::get_workshop_urls,
            commands::mods::list_mods,
            commands::mods::list_mod_refs,
            commands::mods::delete_mod,
            commands::mods::delete_mods,
            commands::mods::delete_managed_mods,
            commands::mods::remove_all_links,
            commands::mods::relink_all_mods,
            commands::mods::update_mods,
            commands::wrapper::get_wrapper_status,
            commands::wrapper::install_wrapper_hook,
            commands::wrapper::remove_wrapper_hook,
            commands::updates::check_mod_updates,
            commands::a2s::query_servers,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
