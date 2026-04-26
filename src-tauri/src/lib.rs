mod commands;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            greet,
            commands::config::get_config,
            commands::config::set_steam_path,
            commands::config::set_player_name,
            commands::join::check_join_requirements,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
