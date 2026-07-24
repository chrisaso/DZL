use serde::{Deserialize, Serialize};

/// DayZ needs a large mmap allowance on Linux or it crashes shortly after
/// joining a modded server. Same value dayz-ctl enforces.
pub(crate) const REQUIRED_MAX_MAP_COUNT: u64 = 1_048_576;
const SYSCTL_FILE: &str = "/etc/sysctl.d/50-dayz.conf";

/// Steam's DayZ app id.
pub(crate) const DAYZ_APP_ID: &str = "221100";

/// Pattern matching the running game process (a Windows binary under Proton).
const DAYZ_PROCESS_PATTERN: &str = "DayZ.*exe";

pub(crate) fn find_first_valid_dir(candidates: &[String]) -> Option<String> {
    candidates
        .iter()
        .find(|p| std::path::Path::new(p.as_str()).is_dir())
        .cloned()
}

/// Standard Steam library locations: native, alternate native, and Flatpak.
pub(crate) fn steam_path_candidates(home: &str) -> Vec<String> {
    vec![
        format!("{}/.steam/steam/steamapps", home),
        format!("{}/.local/share/Steam/steamapps", home),
        format!(
            "{}/.var/app/com.valvesoftware.Steam/data/Steam/steamapps",
            home
        ),
    ]
}

pub(crate) fn detect_steam_path() -> Option<String> {
    let home = std::env::var("HOME").ok()?;
    find_first_valid_dir(&steam_path_candidates(&home))
}

/// The game directory inside a `steamapps` path — this is where mod symlinks
/// live and what proves DayZ is actually installed.
pub(crate) fn dayz_dir(steam_path: &str) -> std::path::PathBuf {
    std::path::Path::new(steam_path).join("common/DayZ")
}

/// The workshop content directory for DayZ inside a `steamapps` path.
pub(crate) fn workshop_dir(steam_path: &str) -> std::path::PathBuf {
    std::path::Path::new(steam_path).join(format!("workshop/content/{}", DAYZ_APP_ID))
}

/// Locates an executable by walking `PATH`. Avoids spawning a shell just to
/// answer "is this installed?".
pub(crate) fn find_in_path(name: &str, path_var: &str) -> Option<String> {
    path_var
        .split(':')
        .filter(|dir| !dir.is_empty())
        .map(|dir| std::path::Path::new(dir).join(name))
        .find(|candidate| candidate.is_file())
        .map(|p| p.to_string_lossy().to_string())
}

pub(crate) fn binary_exists(name: &str) -> bool {
    std::env::var("PATH")
        .ok()
        .and_then(|path| find_in_path(name, &path))
        .is_some()
}

pub(crate) fn read_max_map_count() -> u64 {
    std::fs::read_to_string("/proc/sys/vm/max_map_count")
        .ok()
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0)
}

/// True when a process matching `pattern` is running. Returns false when
/// `pgrep` itself is unavailable rather than pretending nothing is running.
pub(crate) fn process_running(pattern: &str, full_match: bool) -> bool {
    let mut cmd = std::process::Command::new("pgrep");
    if full_match {
        cmd.arg("-f");
    } else {
        cmd.arg("-x");
    }
    cmd.arg(pattern)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

pub(crate) fn dayz_running() -> bool {
    process_running(DAYZ_PROCESS_PATTERN, true)
}

pub(crate) fn steam_running() -> bool {
    process_running("steam", false)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentReport {
    pub steam_installed: bool,
    pub steamcmd_installed: bool,
    /// Configured or auto-detected `steamapps` path.
    pub steam_path: Option<String>,
    /// True when the configured path was picked up automatically.
    pub steam_path_detected: bool,
    pub dayz_path: Option<String>,
    pub dayz_installed: bool,
    pub max_map_count: u64,
    pub required_max_map_count: u64,
    pub max_map_count_ok: bool,
    pub can_fix_max_map_count: bool,
    pub sysctl_fix_command: String,
    pub steam_running: bool,
    pub dayz_running: bool,
    pub geo_lookup_available: bool,
}

/// The exact shell command a user can run themselves if they would rather not
/// let the launcher call pkexec.
pub(crate) fn sysctl_fix_command() -> String {
    format!(
        "echo 'vm.max_map_count={0}' | sudo tee {1} && sudo sysctl -w vm.max_map_count={0}",
        REQUIRED_MAX_MAP_COUNT, SYSCTL_FILE
    )
}

#[tauri::command]
pub fn check_environment(app: tauri::AppHandle) -> EnvironmentReport {
    let config = crate::commands::config::read_config(&app);

    let configured = config
        .steam_path
        .filter(|p| std::path::Path::new(p).is_dir());
    let detected = configured.is_none();
    let steam_path = configured.or_else(detect_steam_path);

    let dayz_path = steam_path
        .as_deref()
        .map(|p| dayz_dir(p).to_string_lossy().to_string());
    let dayz_installed = dayz_path
        .as_deref()
        .map(|p| std::path::Path::new(p).is_dir())
        .unwrap_or(false);

    let max_map_count = read_max_map_count();

    EnvironmentReport {
        steam_installed: binary_exists("steam"),
        steamcmd_installed: binary_exists("steamcmd"),
        steam_path,
        steam_path_detected: detected,
        dayz_path,
        dayz_installed,
        max_map_count,
        required_max_map_count: REQUIRED_MAX_MAP_COUNT,
        // A zero reading means /proc was unreadable (non-Linux); don't nag.
        max_map_count_ok: max_map_count == 0 || max_map_count >= REQUIRED_MAX_MAP_COUNT,
        can_fix_max_map_count: binary_exists("pkexec"),
        sysctl_fix_command: sysctl_fix_command(),
        steam_running: steam_running(),
        dayz_running: dayz_running(),
        geo_lookup_available: binary_exists("geoiplookup") || binary_exists("whois"),
    }
}

/// Raises `vm.max_map_count` persistently and for the current boot. Uses
/// pkexec so the user gets their desktop's normal password prompt.
#[tauri::command]
pub fn fix_max_map_count() -> Result<u64, String> {
    if !binary_exists("pkexec") {
        return Err(format!(
            "pkexec-missing: run this in a terminal instead:\n{}",
            sysctl_fix_command()
        ));
    }

    let script = format!(
        "echo 'vm.max_map_count={0}' > {1} && sysctl -w vm.max_map_count={0}",
        REQUIRED_MAX_MAP_COUNT, SYSCTL_FILE
    );

    let status = std::process::Command::new("pkexec")
        .args(["sh", "-c", &script])
        .status()
        .map_err(|e| format!("pkexec-failed: {}", e))?;

    if !status.success() {
        return Err(format!(
            "pkexec-cancelled: run this in a terminal instead:\n{}",
            sysctl_fix_command()
        ));
    }

    Ok(read_max_map_count())
}

#[tauri::command]
pub fn get_system_status() -> serde_json::Value {
    serde_json::json!({
        "steamRunning": steam_running(),
        "dayzRunning": dayz_running(),
    })
}

#[tauri::command]
pub fn kill_dayz() -> Result<(), String> {
    if !dayz_running() {
        return Ok(());
    }
    std::process::Command::new("pkill")
        .args(["-f", DAYZ_PROCESS_PATTERN])
        .status()
        .map_err(|e| format!("kill-failed: {}", e))?;
    Ok(())
}

/// Asks Steam to shut down cleanly and waits for it to actually exit, because
/// steamcmd downloads are unreliable while the client holds the content lock.
#[tauri::command]
pub async fn shutdown_steam() -> Result<(), String> {
    if !steam_running() {
        return Ok(());
    }

    let _ = tokio::process::Command::new("steam")
        .arg("-shutdown")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await;

    for _ in 0..20 {
        if !steam_running() {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }

    Err("steam-shutdown-timeout: Steam is still running".to_string())
}

/// Starts the Steam client detached and waits until the process shows up so a
/// following `-applaunch` isn't swallowed.
#[tauri::command]
pub async fn start_steam() -> Result<(), String> {
    if steam_running() {
        return Ok(());
    }

    std::process::Command::new("steam")
        .args(["-nofriendsui", "-silent"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("steam-launch-failed: {}", e))?;

    for _ in 0..30 {
        if steam_running() {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }

    Err("steam-start-timeout: Steam did not start".to_string())
}

pub(crate) fn parse_geoiplookup(output: &str) -> Option<String> {
    let line = output.lines().find(|l| !l.contains("not found"))?;
    let value = line.split_once(':')?.1.trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

pub(crate) fn parse_whois_country(output: &str) -> Option<String> {
    output.lines().find_map(|line| {
        let (key, value) = line.split_once(':')?;
        if key.trim().eq_ignore_ascii_case("country") {
            let value = value.trim();
            if value.is_empty() {
                None
            } else {
                Some(value.to_string())
            }
        } else {
            None
        }
    })
}

/// Best-effort country lookup for a server IP, mirroring dayz-ctl: geoiplookup
/// when available, whois as the fallback, nothing if neither is installed.
#[tauri::command]
pub async fn lookup_country(ip: String) -> Option<String> {
    if binary_exists("geoiplookup") {
        if let Ok(out) = tokio::process::Command::new("geoiplookup")
            .arg(&ip)
            .output()
            .await
        {
            if let Some(country) = parse_geoiplookup(&String::from_utf8_lossy(&out.stdout)) {
                return Some(country);
            }
        }
    }

    if binary_exists("whois") {
        if let Ok(out) = tokio::process::Command::new("whois")
            .arg(&ip)
            .output()
            .await
        {
            return parse_whois_country(&String::from_utf8_lossy(&out.stdout));
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("zld-sys-test-{}", name));
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
    fn steam_path_candidates_cover_native_and_flatpak() {
        let candidates = steam_path_candidates("/home/tester");
        assert_eq!(candidates.len(), 3);
        assert!(candidates[0].starts_with("/home/tester/.steam"));
        assert!(candidates.iter().any(|c| c.contains("com.valvesoftware")));
        assert!(candidates.iter().all(|c| c.ends_with("steamapps")));
    }

    #[test]
    fn dayz_and_workshop_dirs_are_derived_from_steamapps() {
        assert_eq!(
            dayz_dir("/steamapps").to_str().unwrap(),
            "/steamapps/common/DayZ"
        );
        assert_eq!(
            workshop_dir("/steamapps").to_str().unwrap(),
            "/steamapps/workshop/content/221100"
        );
    }

    #[test]
    fn find_in_path_locates_executable() {
        let dir = tmp_dir("path");
        fs::write(dir.join("steamcmd"), "#!/bin/sh\n").unwrap();
        let path_var = format!("/nonexistent:{}", dir.to_str().unwrap());

        assert_eq!(
            find_in_path("steamcmd", &path_var),
            Some(dir.join("steamcmd").to_string_lossy().to_string())
        );
        assert_eq!(find_in_path("definitely-not-here", &path_var), None);

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn find_in_path_ignores_empty_segments() {
        assert_eq!(find_in_path("anything", ""), None);
        assert_eq!(find_in_path("anything", "::"), None);
    }

    #[test]
    fn sysctl_fix_command_mentions_required_value() {
        let cmd = sysctl_fix_command();
        assert!(cmd.contains("1048576"));
        assert!(cmd.contains("/etc/sysctl.d/50-dayz.conf"));
    }

    #[test]
    fn parse_geoiplookup_extracts_country() {
        let out = "GeoIP Country Edition: DE, Germany\n";
        assert_eq!(parse_geoiplookup(out), Some("DE, Germany".to_string()));
    }

    #[test]
    fn parse_geoiplookup_returns_none_when_not_found() {
        let out = "GeoIP Country Edition: IP Address not found\n";
        assert_eq!(parse_geoiplookup(out), None);
    }

    #[test]
    fn parse_whois_country_is_case_insensitive() {
        let out = "inetnum: 1.2.3.0 - 1.2.3.255\nCountry:      NL\n";
        assert_eq!(parse_whois_country(out), Some("NL".to_string()));
    }

    #[test]
    fn parse_whois_country_returns_none_without_country_line() {
        assert_eq!(parse_whois_country("inetnum: 1.2.3.0\n"), None);
    }
}
