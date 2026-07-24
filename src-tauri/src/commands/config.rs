use serde::{Deserialize, Serialize};
use tauri_plugin_store::StoreExt;

const STORE_PATH: &str = "config.json";
const CONFIG_KEY: &str = "config";

/// A single DayZ launch parameter, mirroring the option set dayz-ctl exposes.
///
/// `takes_value` distinguishes bare flags (`-nosplash`) from key/value
/// parameters (`-world=empty`).
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LaunchOption {
    pub key: String,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub takes_value: bool,
}

impl LaunchOption {
    fn flag(key: &str, enabled: bool, description: &str) -> Self {
        Self {
            key: key.to_string(),
            enabled,
            value: None,
            description: description.to_string(),
            takes_value: false,
        }
    }

    fn valued(key: &str, enabled: bool, value: Option<&str>, description: &str) -> Self {
        Self {
            key: key.to_string(),
            enabled,
            value: value.map(String::from),
            description: description.to_string(),
            takes_value: true,
        }
    }

    /// Renders this option as a DayZ command line argument, or `None` when it
    /// is disabled or is a value option with nothing filled in.
    pub fn to_arg(&self) -> Option<String> {
        if !self.enabled {
            return None;
        }
        if !self.takes_value {
            return Some(format!("-{}", self.key));
        }
        match self.value.as_deref().map(str::trim) {
            Some(v) if !v.is_empty() => Some(format!("-{}={}", self.key, v)),
            _ => None,
        }
    }
}

/// The stock option set. Defaults match dayz-ctl's baseProfile: a quiet,
/// fast-starting client that skips the splash and intro.
pub(crate) fn default_launch_options() -> Vec<LaunchOption> {
    vec![
        LaunchOption::flag("nosplash", true, "Skip the splash screen on startup"),
        LaunchOption::flag("skipintro", true, "Skip the intro cinematic on startup"),
        LaunchOption::flag("high", true, "Give the game process higher CPU priority"),
        LaunchOption::flag("USEALLAVAILABLECORES", true, "Use every available CPU core"),
        LaunchOption::valued(
            "world",
            true,
            Some("empty"),
            "World loaded behind the main menu — 'empty' starts the menu faster",
        ),
        LaunchOption::flag("window", false, "Run in windowed mode"),
        LaunchOption::flag("noborder", false, "Run in borderless windowed mode"),
        LaunchOption::flag("noBenchmark", false, "Skip the startup benchmark"),
        LaunchOption::flag("filePatching", false, "Allow loading unpacked local data"),
        LaunchOption::flag("doLogs", false, "Force crash and script logging"),
        LaunchOption::flag("buldozer", false, "Start in Buldozer (terrain editor) mode"),
        LaunchOption::flag("winxp", false, "Force Direct3D 9 rendering only"),
        LaunchOption::valued("maxMem", false, None, "Maximum RAM in megabytes"),
        LaunchOption::valued("maxVRAM", false, None, "Maximum video RAM in megabytes"),
        LaunchOption::valued("cpuCount", false, None, "Number of CPU cores to use"),
        LaunchOption::valued(
            "exThreads",
            false,
            None,
            "Extra worker threads: 0, 1, 3, 5 or 7",
        ),
        LaunchOption::valued(
            "noPause",
            false,
            None,
            "Keep running unfocused: -1 default, 0 graphics only, 1 graphics and sound",
        ),
        LaunchOption::valued("par", false, None, "Path to a parameters file"),
        LaunchOption::valued("profiles", false, None, "Path to the profiles directory"),
        LaunchOption::valued("malloc", false, None, "Custom memory allocator"),
        LaunchOption::valued(
            "scriptDebug",
            false,
            Some("true"),
            "Enable script debugging",
        ),
    ]
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AppConfig {
    /// Steam `steamapps` directory, e.g. `~/.steam/steam/steamapps`.
    pub steam_path: Option<String>,
    /// In-game player name passed as `-name=`.
    pub player_name: Option<String>,
    /// steamcmd account name. Credentials are never stored here — steamcmd
    /// keeps its own cached login token after a one-time terminal sign-in.
    pub steam_login: Option<String>,
    /// When false the launcher never shells out to steamcmd and instead sends
    /// the user to the Steam Workshop to subscribe manually.
    pub use_steamcmd: bool,
    /// Kill a running DayZ process before launching a new session.
    pub kill_running_dayz: bool,
    /// Update every mod a server requires on join, not just the missing ones.
    pub update_mods_on_join: bool,
    /// Hide the window to the system tray once the game is running.
    pub hide_to_tray_on_launch: bool,
    pub launch_options: Vec<LaunchOption>,
    /// Free-form extra arguments appended verbatim to the launch command.
    pub custom_args: Vec<String>,
    pub setup_complete: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            steam_path: None,
            player_name: None,
            steam_login: None,
            use_steamcmd: true,
            kill_running_dayz: true,
            update_mods_on_join: false,
            // Off by default: a launcher that vanishes unprompted is
            // surprising, so the user opts in.
            hide_to_tray_on_launch: false,
            launch_options: default_launch_options(),
            custom_args: Vec::new(),
            setup_complete: false,
        }
    }
}

/// Reconciles a stored option list against the current defaults: stored
/// enabled/value state wins, descriptions and value-ness come from the
/// defaults, and options the user added by hand are preserved at the end.
pub(crate) fn merge_launch_options(stored: &[LaunchOption]) -> Vec<LaunchOption> {
    let mut merged: Vec<LaunchOption> = default_launch_options()
        .into_iter()
        .map(|mut def| {
            if let Some(found) = stored.iter().find(|s| s.key == def.key) {
                def.enabled = found.enabled;
                if def.takes_value {
                    def.value = found.value.clone().or(def.value);
                }
            }
            def
        })
        .collect();

    let known: Vec<String> = merged.iter().map(|o| o.key.clone()).collect();
    let extra: Vec<LaunchOption> = stored
        .iter()
        .filter(|s| !known.contains(&s.key))
        .cloned()
        .collect();
    merged.extend(extra);
    merged
}

/// Every enabled launch option plus any custom arguments, in launch order.
pub(crate) fn build_launch_args(config: &AppConfig) -> Vec<String> {
    config
        .launch_options
        .iter()
        .filter_map(|o| o.to_arg())
        .chain(
            config
                .custom_args
                .iter()
                .map(|a| a.trim().to_string())
                .filter(|a| !a.is_empty()),
        )
        .collect()
}

pub(crate) fn read_config(app: &tauri::AppHandle) -> AppConfig {
    let mut config: AppConfig = app
        .store(STORE_PATH)
        .ok()
        .and_then(|store| store.get(CONFIG_KEY))
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    config.launch_options = merge_launch_options(&config.launch_options);
    config
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
pub fn set_config(app: tauri::AppHandle, config: AppConfig) -> Result<AppConfig, String> {
    let mut config = config;
    config.launch_options = merge_launch_options(&config.launch_options);
    write_config(&app, &config)?;
    Ok(config)
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

#[tauri::command]
pub fn reset_config(app: tauri::AppHandle) -> Result<AppConfig, String> {
    let config = AppConfig::default();
    write_config(&app, &config)?;
    Ok(config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flag_option_renders_without_value() {
        let opt = LaunchOption::flag("nosplash", true, "");
        assert_eq!(opt.to_arg(), Some("-nosplash".to_string()));
    }

    #[test]
    fn disabled_option_renders_nothing() {
        let opt = LaunchOption::flag("nosplash", false, "");
        assert_eq!(opt.to_arg(), None);
    }

    #[test]
    fn valued_option_renders_key_equals_value() {
        let opt = LaunchOption::valued("world", true, Some("empty"), "");
        assert_eq!(opt.to_arg(), Some("-world=empty".to_string()));
    }

    #[test]
    fn valued_option_without_value_renders_nothing() {
        let opt = LaunchOption::valued("maxMem", true, None, "");
        assert_eq!(opt.to_arg(), None);

        let blank = LaunchOption::valued("maxMem", true, Some("   "), "");
        assert_eq!(blank.to_arg(), None);
    }

    #[test]
    fn merge_keeps_stored_state_and_refreshes_description() {
        let stored = vec![LaunchOption {
            key: "nosplash".into(),
            enabled: false,
            value: None,
            description: "stale text".into(),
            takes_value: false,
        }];
        let merged = merge_launch_options(&stored);
        let nosplash = merged.iter().find(|o| o.key == "nosplash").unwrap();
        assert!(!nosplash.enabled, "stored enabled state must win");
        assert_ne!(nosplash.description, "stale text");
    }

    #[test]
    fn merge_adds_missing_defaults() {
        let merged = merge_launch_options(&[]);
        assert_eq!(merged.len(), default_launch_options().len());
        assert!(merged.iter().any(|o| o.key == "skipintro"));
    }

    #[test]
    fn merge_preserves_user_defined_options() {
        let stored = vec![LaunchOption {
            key: "myCustomFlag".into(),
            enabled: true,
            value: None,
            description: "mine".into(),
            takes_value: false,
        }];
        let merged = merge_launch_options(&stored);
        assert!(merged.iter().any(|o| o.key == "myCustomFlag"));
    }

    #[test]
    fn build_launch_args_uses_enabled_options_and_custom_args() {
        let config = AppConfig {
            custom_args: vec!["-newUI".into(), "  ".into()],
            ..AppConfig::default()
        };
        let args = build_launch_args(&config);

        assert!(args.contains(&"-nosplash".to_string()));
        assert!(args.contains(&"-skipintro".to_string()));
        assert!(args.contains(&"-world=empty".to_string()));
        assert!(args.contains(&"-newUI".to_string()));
        assert!(
            !args.iter().any(|a| a.trim().is_empty()),
            "blank custom args must be dropped"
        );
        assert!(
            !args.contains(&"-window".to_string()),
            "disabled options must not appear"
        );
    }

    #[test]
    fn default_config_enables_steamcmd() {
        let config = AppConfig::default();
        assert!(config.use_steamcmd);
        assert!(!config.setup_complete);
    }

    #[test]
    fn hiding_to_tray_is_opt_in() {
        assert!(!AppConfig::default().hide_to_tray_on_launch);
    }

    #[test]
    fn config_round_trips_through_json_with_missing_fields() {
        // Simulates a config written by an older build of the launcher.
        let legacy = serde_json::json!({
            "steamPath": "/home/user/.steam/steam/steamapps",
            "playerName": "Survivor",
        });
        let config: AppConfig = serde_json::from_value(legacy).unwrap();
        assert_eq!(config.player_name.as_deref(), Some("Survivor"));
        assert!(config.use_steamcmd, "missing fields fall back to defaults");
    }
}
