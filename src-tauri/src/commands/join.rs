use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModRef {
    pub workshop_id: String,
    pub name: String,
}

pub(crate) fn find_first_valid_dir(candidates: &[String]) -> Option<String> {
    candidates
        .iter()
        .find(|p| std::path::Path::new(p.as_str()).is_dir())
        .cloned()
}

pub(crate) fn detect_steam_path() -> Option<String> {
    let home = std::env::var("HOME").ok()?;
    find_first_valid_dir(&[
        format!("{}/.steam/steam/steamapps", home),
        format!("{}/.local/share/Steam/steamapps", home),
        format!(
            "{}/.var/app/com.valvesoftware.Steam/data/Steam/steamapps",
            home
        ),
    ])
}

pub(crate) fn missing_mods(steam_path: &str, mods: &[ModRef]) -> Vec<ModRef> {
    mods.iter()
        .filter(|m| {
            !std::path::Path::new(&format!(
                "{}/workshop/content/221100/{}",
                steam_path, m.workshop_id
            ))
            .is_dir()
        })
        .cloned()
        .collect()
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinRequirements {
    pub steam_path: Option<String>,
    pub missing_mods: Vec<ModRef>,
    pub player_name_needed: bool,
    pub player_name: Option<String>,
}

pub(crate) fn check_requirements_logic(
    stored_steam_path: Option<String>,
    stored_player_name: Option<String>,
    mods: &[ModRef],
) -> JoinRequirements {
    let steam_path = stored_steam_path
        .filter(|p| std::path::Path::new(p).is_dir())
        .or_else(detect_steam_path);

    let missing = steam_path
        .as_deref()
        .map(|p| missing_mods(p, mods))
        .unwrap_or_default();

    JoinRequirements {
        steam_path,
        missing_mods: missing,
        player_name_needed: stored_player_name.is_none(),
        player_name: stored_player_name,
    }
}

#[tauri::command]
pub fn check_join_requirements(app: tauri::AppHandle, mods: Vec<ModRef>) -> JoinRequirements {
    let config = crate::commands::config::read_config(&app);
    check_requirements_logic(config.steam_path, config.player_name, &mods)
}

pub(crate) fn ensure_symlink(steam_path: &str, workshop_id: &str) -> Result<(), String> {
    let target = std::path::PathBuf::from(format!(
        "{}/workshop/content/221100/{}",
        steam_path, workshop_id
    ));
    let link = std::path::PathBuf::from(format!("{}/common/DayZ/@{}", steam_path, workshop_id));

    // Check if symlink already exists (use symlink_metadata to detect broken symlinks too)
    if link.symlink_metadata().is_ok() {
        if std::fs::read_link(&link).ok().as_deref() == Some(&target) {
            return Ok(()); // already correct
        }
        std::fs::remove_file(&link)
            .map_err(|e| format!("symlink-failed: {}: {}", workshop_id, e))?;
    }

    if let Some(parent) = link.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("symlink-failed: {}: {}", workshop_id, e))?;
    }

    std::os::unix::fs::symlink(&target, &link)
        .map_err(|e| format!("symlink-failed: {}: {}", workshop_id, e))
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinParams {
    pub ip: String,
    pub game_port: u16,
    pub mods: Vec<ModRef>,
    pub steam_path: String,
    pub player_name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct JoinProgress {
    pub step: String,
    pub detail: Option<String>,
    pub current: u32,
    pub total: u32,
}

fn emit_progress(
    app: &tauri::AppHandle,
    step: &str,
    detail: Option<&str>,
    current: u32,
    total: u32,
) -> Result<(), String> {
    use tauri::Emitter;
    app.emit(
        "join-progress",
        JoinProgress {
            step: step.to_string(),
            detail: detail.map(String::from),
            current,
            total,
        },
    )
    .map_err(|e| e.to_string())
}

async fn run_steamcmd(workshop_id: &str) -> Result<(), String> {
    use tokio::io::AsyncBufReadExt;

    let mut child = tokio::process::Command::new("steamcmd")
        .args([
            "+@ShutdownOnFailedCommand",
            "1",
            "+login",
            "anonymous",
            "+workshop_download_item",
            "221100",
            workshop_id,
            "validate",
            "+quit",
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|_| "steamcmd-not-found: steamcmd is not installed or not on PATH".to_string())?;

    if let Some(stdout) = child.stdout.take() {
        let mut lines = tokio::io::BufReader::new(stdout).lines();
        while let Ok(Some(_)) = lines.next_line().await {}
    }

    let status = child.wait().await.map_err(|e| e.to_string())?;
    if !status.success() {
        return Err(format!(
            "steamcmd-failed: {} (workshop_id: {})",
            status.code().unwrap_or(-1),
            workshop_id
        ));
    }
    Ok(())
}

fn launch_dayz(params: &JoinParams) -> Result<(), String> {
    let mod_string = params
        .mods
        .iter()
        .map(|m| format!("@{}", m.workshop_id))
        .collect::<Vec<_>>()
        .join(";");

    let mut args = vec![
        "-applaunch".to_string(),
        "221100".to_string(),
        "-nolauncher".to_string(),
        format!("-name={}", params.player_name),
        format!("-connect={}", params.ip),
        format!("-port={}", params.game_port),
    ];

    if !mod_string.is_empty() {
        args.push(format!("-mod={}", mod_string));
    }

    std::process::Command::new("steam")
        .args(&args)
        .spawn()
        .map_err(|e| format!("launch-failed: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn join_server(app: tauri::AppHandle, params: JoinParams) -> Result<(), String> {
    let missing = missing_mods(&params.steam_path, &params.mods);

    let total = missing.len() as u32;
    for (i, m) in missing.iter().enumerate() {
        emit_progress(&app, "downloading", Some(&m.name), i as u32 + 1, total)?;
        run_steamcmd(&m.workshop_id).await.map_err(|e| {
            let _ = emit_progress(&app, "error", Some(&e), 0, 0);
            e
        })?;
    }

    let mod_total = params.mods.len() as u32;
    for (i, m) in params.mods.iter().enumerate() {
        emit_progress(
            &app,
            "creating-symlinks",
            Some(&m.name),
            i as u32 + 1,
            mod_total,
        )?;
        ensure_symlink(&params.steam_path, &m.workshop_id).map_err(|e| {
            let _ = emit_progress(&app, "error", Some(&e), 0, 0);
            e
        })?;
    }

    emit_progress(&app, "launching", None, 0, 0)?;
    launch_dayz(&params).map_err(|e| {
        let _ = emit_progress(&app, "error", Some(&e), 0, 0);
        e
    })?;

    emit_progress(&app, "done", None, 0, 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("zld-test-{}", name));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn find_first_valid_dir_returns_first_existing() {
        let d = tmp_dir("fvd");
        let candidates = vec![
            "/does/not/exist/at/all".to_string(),
            d.to_str().unwrap().to_string(),
            "/also/missing".to_string(),
        ];
        assert_eq!(
            find_first_valid_dir(&candidates),
            Some(d.to_str().unwrap().to_string())
        );
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn find_first_valid_dir_returns_none_when_all_missing() {
        let candidates = vec!["/no/such/path/a".to_string(), "/no/such/path/b".to_string()];
        assert_eq!(find_first_valid_dir(&candidates), None);
    }

    #[test]
    fn missing_mods_returns_absent_mods_only() {
        let base = tmp_dir("mm");
        let present_path = base.join("workshop/content/221100/111");
        fs::create_dir_all(&present_path).unwrap();

        let mods = vec![
            ModRef {
                workshop_id: "111".into(),
                name: "ModA".into(),
            },
            ModRef {
                workshop_id: "222".into(),
                name: "ModB".into(),
            },
        ];

        let missing = missing_mods(base.to_str().unwrap(), &mods);
        assert_eq!(missing.len(), 1);
        assert_eq!(missing[0].workshop_id, "222");

        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn missing_mods_returns_empty_when_all_present() {
        let base = tmp_dir("mm2");
        for id in &["333", "444"] {
            fs::create_dir_all(base.join(format!("workshop/content/221100/{}", id))).unwrap();
        }
        let mods = vec![
            ModRef {
                workshop_id: "333".into(),
                name: "ModC".into(),
            },
            ModRef {
                workshop_id: "444".into(),
                name: "ModD".into(),
            },
        ];
        assert!(missing_mods(base.to_str().unwrap(), &mods).is_empty());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn check_requirements_logic_finds_missing_and_flags_player_name() {
        let base = tmp_dir("crl");
        fs::create_dir_all(base.join("workshop/content/221100/100")).unwrap();

        let mods = vec![
            ModRef {
                workshop_id: "100".into(),
                name: "Present".into(),
            },
            ModRef {
                workshop_id: "200".into(),
                name: "Missing".into(),
            },
        ];

        let result = check_requirements_logic(
            Some(base.to_str().unwrap().to_string()),
            None, // no player name
            &mods,
        );

        assert_eq!(result.steam_path, Some(base.to_str().unwrap().to_string()));
        assert_eq!(result.missing_mods.len(), 1);
        assert_eq!(result.missing_mods[0].workshop_id, "200");
        assert!(result.player_name_needed);
        assert!(result.player_name.is_none());

        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn check_requirements_logic_returns_player_name_when_set() {
        let base = tmp_dir("crl2");
        let result = check_requirements_logic(
            Some(base.to_str().unwrap().to_string()),
            Some("Survivor".into()),
            &[],
        );
        assert!(!result.player_name_needed);
        assert_eq!(result.player_name, Some("Survivor".into()));
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn ensure_symlink_creates_symlink() {
        let base = tmp_dir("sl");
        let target_dir = base.join("workshop/content/221100/999");
        fs::create_dir_all(&target_dir).unwrap();

        ensure_symlink(base.to_str().unwrap(), "999").unwrap();

        let link = base.join("common/DayZ/@999");
        assert!(link.exists());
        assert_eq!(fs::read_link(&link).unwrap(), target_dir);

        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn ensure_symlink_is_idempotent() {
        let base = tmp_dir("sl2");
        let target_dir = base.join("workshop/content/221100/888");
        fs::create_dir_all(&target_dir).unwrap();

        ensure_symlink(base.to_str().unwrap(), "888").unwrap();
        ensure_symlink(base.to_str().unwrap(), "888").unwrap(); // second call must not error

        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn ensure_symlink_replaces_stale_symlink() {
        let base = tmp_dir("sl3");
        let target_dir = base.join("workshop/content/221100/777");
        fs::create_dir_all(&target_dir).unwrap();
        fs::create_dir_all(base.join("common/DayZ")).unwrap();

        let link_path = base.join("common/DayZ/@777");
        std::os::unix::fs::symlink("/totally/wrong/path", &link_path).unwrap();

        ensure_symlink(base.to_str().unwrap(), "777").unwrap();
        assert_eq!(fs::read_link(&link_path).unwrap(), target_dir);

        fs::remove_dir_all(&base).unwrap();
    }
}
