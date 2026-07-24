use crate::commands::config::{build_launch_args, read_config, AppConfig};
use crate::commands::steamcmd::download_workshop_item;
use crate::commands::system::{
    dayz_dir, dayz_running, detect_steam_path, read_max_map_count, steam_running, workshop_dir,
    DAYZ_APP_ID, REQUIRED_MAX_MAP_COUNT,
};
use serde::{Deserialize, Serialize};
use tauri::Emitter;

/// Marker dropped inside every mod directory this launcher installs, so mod
/// cleanup can tell our downloads apart from Steam Workshop subscriptions.
pub(crate) const MANAGED_MARKER: &str = ".dzl";

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModRef {
    pub workshop_id: String,
    pub name: String,
}

pub(crate) fn mod_dir(steam_path: &str, workshop_id: &str) -> std::path::PathBuf {
    workshop_dir(steam_path).join(workshop_id)
}

pub(crate) fn mod_link(steam_path: &str, workshop_id: &str) -> std::path::PathBuf {
    dayz_dir(steam_path).join(format!("@{}", workshop_id))
}

pub(crate) fn missing_mods(steam_path: &str, mods: &[ModRef]) -> Vec<ModRef> {
    mods.iter()
        .filter(|m| !mod_dir(steam_path, &m.workshop_id).is_dir())
        .cloned()
        .collect()
}

/// Steam Workshop page for a mod, used by the subscribe-instead-of-steamcmd
/// flow.
pub(crate) fn workshop_url(workshop_id: &str) -> String {
    format!(
        "https://steamcommunity.com/sharedfiles/filedetails/?id={}",
        workshop_id
    )
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JoinRequirements {
    pub steam_path: Option<String>,
    pub dayz_installed: bool,
    pub missing_mods: Vec<ModRef>,
    pub player_name: Option<String>,
    pub player_name_needed: bool,
    pub use_steamcmd: bool,
    pub steam_login: Option<String>,
    pub steam_login_needed: bool,
    pub update_mods_on_join: bool,
    pub max_map_count_ok: bool,
    /// Whether Steam is up, so the UI knows to ask for approval first.
    pub steam_running: bool,
}

pub(crate) fn check_requirements_logic(
    config: &AppConfig,
    mods: &[ModRef],
    max_map_count: u64,
    steam_is_running: bool,
) -> JoinRequirements {
    let steam_path = config
        .steam_path
        .clone()
        .filter(|p| std::path::Path::new(p).is_dir())
        .or_else(detect_steam_path);

    let missing = steam_path
        .as_deref()
        .map(|p| missing_mods(p, mods))
        .unwrap_or_else(|| mods.to_vec());

    let dayz_installed = steam_path
        .as_deref()
        .map(|p| dayz_dir(p).is_dir())
        .unwrap_or(false);

    let login = config
        .steam_login
        .clone()
        .filter(|l| !l.trim().is_empty() && l.trim() != "anonymous");

    JoinRequirements {
        steam_path,
        dayz_installed,
        // Only a steamcmd download needs an account; subscribing does not.
        steam_login_needed: config.use_steamcmd && login.is_none() && !missing.is_empty(),
        missing_mods: missing,
        player_name_needed: config
            .player_name
            .as_deref()
            .map(|n| n.trim().is_empty())
            .unwrap_or(true),
        player_name: config.player_name.clone(),
        use_steamcmd: config.use_steamcmd,
        steam_login: login,
        update_mods_on_join: config.update_mods_on_join,
        max_map_count_ok: max_map_count == 0 || max_map_count >= REQUIRED_MAX_MAP_COUNT,
        steam_running: steam_is_running,
    }
}

#[tauri::command]
pub fn check_join_requirements(app: tauri::AppHandle, mods: Vec<ModRef>) -> JoinRequirements {
    let config = read_config(&app);
    check_requirements_logic(&config, &mods, read_max_map_count(), steam_running())
}

/// Relative link target for a mod, matching the `ln -sr` style links dayz-ctl
/// creates. Relative links survive the Steam library being moved or mounted
/// somewhere else.
pub(crate) fn relative_link_target(workshop_id: &str) -> String {
    format!("../../workshop/content/{}/{}", DAYZ_APP_ID, workshop_id)
}

/// Creates `common/DayZ/@<id>` pointing at the workshop directory.
///
/// An existing link is left alone when it already resolves to the right place,
/// whether it was written as a relative or absolute path — that keeps links
/// made by dayz-ctl or a previous launcher version intact.
pub(crate) fn ensure_symlink(steam_path: &str, workshop_id: &str) -> Result<(), String> {
    let target = mod_dir(steam_path, workshop_id);
    let link = mod_link(steam_path, workshop_id);

    if link.symlink_metadata().is_ok() {
        let resolves_correctly = match (link.canonicalize(), target.canonicalize()) {
            (Ok(a), Ok(b)) => a == b,
            _ => false,
        };
        if resolves_correctly {
            return Ok(());
        }
        std::fs::remove_file(&link)
            .map_err(|e| format!("symlink-failed: {}: {}", workshop_id, e))?;
    }

    if let Some(parent) = link.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("symlink-failed: {}: {}", workshop_id, e))?;
    }

    #[cfg(unix)]
    std::os::unix::fs::symlink(relative_link_target(workshop_id), &link)
        .map_err(|e| format!("symlink-failed: {}: {}", workshop_id, e))?;

    #[cfg(windows)]
    std::os::windows::fs::symlink_dir(&target, &link)
        .map_err(|e| format!("symlink-failed: {}: {}", workshop_id, e))?;

    Ok(())
}

pub(crate) fn mark_managed(steam_path: &str, workshop_id: &str) {
    let dir = mod_dir(steam_path, workshop_id);
    if dir.is_dir() {
        let _ = std::fs::write(dir.join(MANAGED_MARKER), workshop_id);
    }
}

pub(crate) fn is_managed(steam_path: &str, workshop_id: &str) -> bool {
    mod_dir(steam_path, workshop_id)
        .join(MANAGED_MARKER)
        .exists()
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct JoinRequest {
    /// Absent for a plain "launch the game" with no server.
    pub ip: Option<String>,
    pub game_port: Option<u16>,
    pub mods: Vec<ModRef>,
    pub password: Option<String>,
    /// Overrides the stored `updateModsOnJoin` preference for this launch.
    pub update_mods: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct JoinProgress {
    pub step: String,
    pub detail: Option<String>,
    pub current: u32,
    pub total: u32,
    pub percent: Option<f32>,
}

fn emit(
    app: &tauri::AppHandle,
    step: &str,
    detail: Option<&str>,
    current: u32,
    total: u32,
    percent: Option<f32>,
) {
    let _ = app.emit(
        "join-progress",
        JoinProgress {
            step: step.to_string(),
            detail: detail.map(String::from),
            current,
            total,
            percent,
        },
    );
}

/// Builds the full Steam command line for a DayZ session.
pub(crate) fn build_launch_command(
    player_name: &str,
    mods: &[ModRef],
    ip: Option<&str>,
    game_port: Option<u16>,
    password: Option<&str>,
    extra: &[String],
) -> Vec<String> {
    let mut args = vec![
        "-applaunch".to_string(),
        DAYZ_APP_ID.to_string(),
        "-nolauncher".to_string(),
    ];

    let name = player_name.trim();
    if !name.is_empty() {
        args.push(format!("-name={}", name));
    }

    if !mods.is_empty() {
        let mod_string = mods
            .iter()
            .map(|m| format!("@{}", m.workshop_id))
            .collect::<Vec<_>>()
            .join(";");
        args.push(format!("-mod={}", mod_string));
    }

    if let Some(ip) = ip {
        args.push(format!("-connect={}", ip));
        if let Some(port) = game_port {
            args.push(format!("-port={}", port));
        }
    }

    if let Some(password) = password.map(str::trim).filter(|p| !p.is_empty()) {
        args.push(format!("-password={}", password));
    }

    args.extend(extra.iter().cloned());
    args
}

fn spawn_steam(args: &[String]) -> Result<(), String> {
    crate::commands::system::external_command("steam")
        .args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("launch-failed: {}", e))?;
    Ok(())
}

/// Downloads, links and launches. Every stage reports through `join-progress`
/// so the modal can narrate what is happening.
#[tauri::command]
pub async fn join_server(app: tauri::AppHandle, request: JoinRequest) -> Result<(), String> {
    let result = run_join(&app, &request).await;
    match &result {
        Ok(()) => emit(&app, "done", None, 0, 0, None),
        Err(e) => emit(&app, "error", Some(e), 0, 0, None),
    }
    result
}

async fn run_join(app: &tauri::AppHandle, request: &JoinRequest) -> Result<(), String> {
    let config = read_config(app);

    emit(app, "preparing", None, 0, 0, None);

    let steam_path = config
        .steam_path
        .clone()
        .filter(|p| std::path::Path::new(p).is_dir())
        .or_else(detect_steam_path)
        .ok_or_else(|| "no-steam-path: could not find your Steam library".to_string())?;

    if !dayz_dir(&steam_path).is_dir() {
        return Err(format!(
            "dayz-not-installed: {} does not exist",
            dayz_dir(&steam_path).display()
        ));
    }

    let player_name = config.player_name.clone().unwrap_or_default();
    if player_name.trim().is_empty() {
        return Err("no-player-name: set your in-game name first".to_string());
    }

    // Decide what needs downloading before touching Steam.
    let update_all = request.update_mods.unwrap_or(config.update_mods_on_join);
    let missing = missing_mods(&steam_path, &request.mods);
    let to_download: Vec<ModRef> = if update_all {
        request.mods.clone()
    } else {
        missing.clone()
    };

    if !to_download.is_empty() {
        if !config.use_steamcmd {
            // Subscribe-only mode: the Steam client does the installing, so
            // there is nothing for us to do but say what is missing.
            return Err(format!(
                "mods-missing: {} mod(s) are not installed — subscribe on the Workshop first",
                missing.len()
            ));
        }

        let login = config
            .steam_login
            .clone()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty() && l != "anonymous")
            .ok_or_else(|| {
                "no-steam-login: a named Steam account is required — anonymous cannot \
                 download DayZ mods"
                    .to_string()
            })?;

        // steamcmd writes into the Steam client's own config directory, so a
        // running client will fight it: cloud sync errors and being signed out
        // of Steam. Downloading therefore always closes Steam first. The UI
        // asks for approval before we get here.
        let closed_steam = steam_running();
        if closed_steam {
            emit(app, "closing-steam", None, 0, 0, None);
            crate::commands::system::shutdown_steam().await?;
        }

        let total = to_download.len() as u32;
        for (i, m) in to_download.iter().enumerate() {
            let current = i as u32 + 1;
            emit(app, "downloading", Some(&m.name), current, total, Some(0.0));

            let app_handle = app.clone();
            let mod_name = m.name.clone();
            download_workshop_item(&login, &m.workshop_id, &steam_path, move |line, percent| {
                let detail = match percent {
                    Some(_) => mod_name.clone(),
                    None => format!("{} — {}", mod_name, line),
                };
                emit(
                    &app_handle,
                    "downloading",
                    Some(&detail),
                    current,
                    total,
                    percent,
                );
            })
            .await?;

            mark_managed(&steam_path, &m.workshop_id);
        }

        if closed_steam {
            emit(app, "starting-steam", None, 0, 0, None);
            crate::commands::system::start_steam().await?;
        }
    }

    // Everything the server needs must exist by now.
    let still_missing = missing_mods(&steam_path, &request.mods);
    if !still_missing.is_empty() {
        return Err(format!(
            "mods-missing: {} mod(s) still not installed: {}",
            still_missing.len(),
            still_missing
                .iter()
                .map(|m| m.name.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }

    let total = request.mods.len() as u32;
    for (i, m) in request.mods.iter().enumerate() {
        emit(app, "linking", Some(&m.name), i as u32 + 1, total, None);
        ensure_symlink(&steam_path, &m.workshop_id)?;
    }

    if config.kill_running_dayz && dayz_running() {
        emit(app, "closing-dayz", None, 0, 0, None);
        crate::commands::system::kill_dayz()?;
    }

    emit(app, "launching", None, 0, 0, None);
    let args = build_launch_command(
        &player_name,
        &request.mods,
        request.ip.as_deref(),
        request.game_port,
        request.password.as_deref(),
        &build_launch_args(&config),
    );
    spawn_steam(&args)?;

    // Steam accepts the command instantly but the game takes a while to show
    // up; waiting lets the UI say "running" instead of guessing.
    emit(app, "waiting", None, 0, 0, None);
    for _ in 0..60 {
        if dayz_running() {
            // Only get out of the way once the game is actually up — if the
            // launch failed the user needs to see the window, not hunt for it
            // in the tray.
            if config.hide_to_tray_on_launch {
                crate::tray::hide_window(app);
            }
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }

    Ok(())
}

/// Launches DayZ without connecting anywhere — the "Launch Game" entry from
/// dayz-ctl's main menu, plus optional hand-picked mods.
#[tauri::command]
pub async fn launch_game(app: tauri::AppHandle, mods: Vec<ModRef>) -> Result<(), String> {
    let request = JoinRequest {
        ip: None,
        game_port: None,
        mods,
        password: None,
        update_mods: Some(false),
    };
    join_server(app, request).await
}

#[tauri::command]
pub fn get_workshop_urls(mods: Vec<ModRef>) -> Vec<String> {
    mods.iter().map(|m| workshop_url(&m.workshop_id)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("zld-join-test-{}", name));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn mods(ids: &[&str]) -> Vec<ModRef> {
        ids.iter()
            .map(|id| ModRef {
                workshop_id: id.to_string(),
                name: format!("Mod {}", id),
            })
            .collect()
    }

    #[test]
    fn missing_mods_returns_absent_mods_only() {
        let base = tmp_dir("mm");
        fs::create_dir_all(workshop_dir(base.to_str().unwrap()).join("111")).unwrap();

        let missing = missing_mods(base.to_str().unwrap(), &mods(&["111", "222"]));
        assert_eq!(missing.len(), 1);
        assert_eq!(missing[0].workshop_id, "222");

        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn missing_mods_returns_empty_when_all_present() {
        let base = tmp_dir("mm2");
        for id in &["333", "444"] {
            fs::create_dir_all(workshop_dir(base.to_str().unwrap()).join(id)).unwrap();
        }
        assert!(missing_mods(base.to_str().unwrap(), &mods(&["333", "444"])).is_empty());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn check_requirements_flags_missing_mods_and_player_name() {
        let base = tmp_dir("crl");
        fs::create_dir_all(workshop_dir(base.to_str().unwrap()).join("100")).unwrap();
        fs::create_dir_all(dayz_dir(base.to_str().unwrap())).unwrap();

        let config = AppConfig {
            steam_path: Some(base.to_str().unwrap().to_string()),
            player_name: None,
            steam_login: Some("someone".into()),
            ..AppConfig::default()
        };

        let result = check_requirements_logic(&config, &mods(&["100", "200"]), 1_048_576, false);

        assert_eq!(result.missing_mods.len(), 1);
        assert_eq!(result.missing_mods[0].workshop_id, "200");
        assert!(result.player_name_needed);
        assert!(result.dayz_installed);
        assert!(result.max_map_count_ok);
        assert!(!result.steam_login_needed, "a login is configured");

        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn check_requirements_needs_login_only_when_downloads_are_required() {
        let base = tmp_dir("crl2");
        fs::create_dir_all(workshop_dir(base.to_str().unwrap()).join("100")).unwrap();

        let config = AppConfig {
            steam_path: Some(base.to_str().unwrap().to_string()),
            player_name: Some("Survivor".into()),
            steam_login: None,
            ..AppConfig::default()
        };

        let all_present = check_requirements_logic(&config, &mods(&["100"]), 1_048_576, false);
        assert!(!all_present.steam_login_needed);
        assert!(!all_present.player_name_needed);

        let needs_download = check_requirements_logic(&config, &mods(&["100", "999"]), 1_048_576, false);
        assert!(needs_download.steam_login_needed);

        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn check_requirements_treats_anonymous_login_as_unset() {
        let base = tmp_dir("crl3");
        let config = AppConfig {
            steam_path: Some(base.to_str().unwrap().to_string()),
            player_name: Some("Survivor".into()),
            steam_login: Some("anonymous".into()),
            ..AppConfig::default()
        };

        let result = check_requirements_logic(&config, &mods(&["999"]), 1_048_576, false);
        assert_eq!(result.steam_login, None);
        assert!(
            result.steam_login_needed,
            "anonymous cannot download DayZ workshop content"
        );

        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn check_requirements_flags_low_max_map_count() {
        let config = AppConfig::default();
        let low = check_requirements_logic(&config, &[], 65_530, false);
        assert!(!low.max_map_count_ok);

        let unknown = check_requirements_logic(&config, &[], 0, false);
        assert!(unknown.max_map_count_ok, "unknown value must not nag");
    }

    #[test]
    fn ensure_symlink_creates_relative_link() {
        let base = tmp_dir("sl");
        let target = workshop_dir(base.to_str().unwrap()).join("999");
        fs::create_dir_all(&target).unwrap();

        ensure_symlink(base.to_str().unwrap(), "999").unwrap();

        let link = mod_link(base.to_str().unwrap(), "999");
        assert_eq!(
            fs::read_link(&link).unwrap().to_str().unwrap(),
            "../../workshop/content/221100/999",
            "links must be relative so the library can move"
        );
        assert_eq!(link.canonicalize().unwrap(), target.canonicalize().unwrap());

        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn ensure_symlink_is_idempotent() {
        let base = tmp_dir("sl2");
        fs::create_dir_all(workshop_dir(base.to_str().unwrap()).join("888")).unwrap();

        ensure_symlink(base.to_str().unwrap(), "888").unwrap();
        ensure_symlink(base.to_str().unwrap(), "888").unwrap();

        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn ensure_symlink_replaces_stale_link() {
        let base = tmp_dir("sl3");
        let target = workshop_dir(base.to_str().unwrap()).join("777");
        fs::create_dir_all(&target).unwrap();
        fs::create_dir_all(dayz_dir(base.to_str().unwrap())).unwrap();

        let link = mod_link(base.to_str().unwrap(), "777");
        std::os::unix::fs::symlink("/totally/wrong/path", &link).unwrap();

        ensure_symlink(base.to_str().unwrap(), "777").unwrap();
        assert_eq!(link.canonicalize().unwrap(), target.canonicalize().unwrap());

        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn ensure_symlink_keeps_existing_absolute_link() {
        let base = tmp_dir("sl4");
        let target = workshop_dir(base.to_str().unwrap()).join("666");
        fs::create_dir_all(&target).unwrap();
        fs::create_dir_all(dayz_dir(base.to_str().unwrap())).unwrap();

        // A link written by an older build of the launcher.
        let link = mod_link(base.to_str().unwrap(), "666");
        std::os::unix::fs::symlink(&target, &link).unwrap();

        ensure_symlink(base.to_str().unwrap(), "666").unwrap();
        assert_eq!(
            fs::read_link(&link).unwrap(),
            target,
            "a correct absolute link should be left alone"
        );

        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn managed_marker_round_trips() {
        let base = tmp_dir("marker");
        fs::create_dir_all(workshop_dir(base.to_str().unwrap()).join("321")).unwrap();

        assert!(!is_managed(base.to_str().unwrap(), "321"));
        mark_managed(base.to_str().unwrap(), "321");
        assert!(is_managed(base.to_str().unwrap(), "321"));

        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn launch_command_includes_connection_mods_and_options() {
        let args = build_launch_command(
            "Survivor",
            &mods(&["111", "222"]),
            Some("1.2.3.4"),
            Some(2302),
            None,
            &["-nosplash".to_string()],
        );

        assert_eq!(args[0], "-applaunch");
        assert_eq!(args[1], "221100");
        assert!(args.contains(&"-nolauncher".to_string()));
        assert!(args.contains(&"-name=Survivor".to_string()));
        assert!(args.contains(&"-mod=@111;@222".to_string()));
        assert!(args.contains(&"-connect=1.2.3.4".to_string()));
        assert!(args.contains(&"-port=2302".to_string()));
        assert!(args.contains(&"-nosplash".to_string()));
        assert!(!args.iter().any(|a| a.starts_with("-password")));
    }

    #[test]
    fn launch_command_omits_mod_flag_for_vanilla() {
        let args = build_launch_command("Survivor", &[], Some("1.2.3.4"), Some(2302), None, &[]);
        assert!(!args.iter().any(|a| a.starts_with("-mod=")));
    }

    #[test]
    fn launch_command_omits_connection_for_plain_launch() {
        let args = build_launch_command("Survivor", &mods(&["1"]), None, None, None, &[]);
        assert!(!args.iter().any(|a| a.starts_with("-connect")));
        assert!(!args.iter().any(|a| a.starts_with("-port")));
    }

    #[test]
    fn launch_command_includes_password_when_set() {
        let args = build_launch_command(
            "Survivor",
            &[],
            Some("1.2.3.4"),
            Some(2302),
            Some("hunter2"),
            &[],
        );
        assert!(args.contains(&"-password=hunter2".to_string()));

        let blank = build_launch_command("Survivor", &[], None, None, Some("   "), &[]);
        assert!(!blank.iter().any(|a| a.starts_with("-password")));
    }

    #[test]
    fn workshop_url_points_at_the_item() {
        assert_eq!(
            workshop_url("1559212036"),
            "https://steamcommunity.com/sharedfiles/filedetails/?id=1559212036"
        );
    }
}
