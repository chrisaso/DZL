mod commands;
mod tray;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
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
            commands::updates::check_mod_updates,
            commands::a2s::query_servers,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
