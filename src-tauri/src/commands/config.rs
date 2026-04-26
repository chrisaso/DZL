use serde::{Deserialize, Serialize};
use tauri_plugin_store::StoreExt;

const STORE_PATH: &str = "config.json";
const CONFIG_KEY: &str = "config";

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub steam_path: Option<String>,
    pub player_name: Option<String>,
}

pub(crate) fn read_config(app: &tauri::AppHandle) -> AppConfig {
    app.store(STORE_PATH)
        .ok()
        .and_then(|store| store.get(CONFIG_KEY))
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

fn write_config(app: &tauri::AppHandle, config: &AppConfig) -> Result<(), String> {
    let store = app.store(STORE_PATH).map_err(|e| e.to_string())?;
    store.set(
        CONFIG_KEY,
        serde_json::to_value(config).map_err(|e| e.to_string())?,
    );
    store.save().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_config(app: tauri::AppHandle) -> AppConfig {
    read_config(&app)
}

#[tauri::command]
pub fn set_steam_path(app: tauri::AppHandle, steam_path: String) -> Result<(), String> {
    let mut config = read_config(&app);
    config.steam_path = Some(steam_path);
    write_config(&app, &config)
}

#[tauri::command]
pub fn set_player_name(app: tauri::AppHandle, player_name: String) -> Result<(), String> {
    let mut config = read_config(&app);
    config.player_name = Some(player_name);
    write_config(&app, &config)
}
