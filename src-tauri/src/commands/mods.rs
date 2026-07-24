use crate::commands::config::read_config;
use crate::commands::join::{is_managed, mod_dir, mod_link, ModRef};
use crate::commands::steamcmd::download_workshop_item;
use crate::commands::system::{dayz_dir, workshop_dir};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::Emitter;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InstalledMod {
    pub workshop_id: String,
    pub name: String,
    pub size_bytes: u64,
    /// Build timestamp from meta.cpp, when the mod declares one.
    pub timestamp: Option<i64>,
    /// Installed by this launcher (has our marker file) rather than by a Steam
    /// Workshop subscription.
    pub managed: bool,
    /// Has a working `@id` symlink in the DayZ directory.
    pub linked: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ModLibrary {
    pub mods: Vec<InstalledMod>,
    pub total_size_bytes: u64,
    pub workshop_path: String,
    pub linked_count: usize,
    pub managed_count: usize,
}

/// Reads a `key = value;` pair out of a meta.cpp, ignoring surrounding class
/// blocks, quotes and whitespace.
pub(crate) fn parse_meta_value(content: &str, key: &str) -> Option<String> {
    content.lines().find_map(|line| {
        let (raw_key, raw_value) = line.split_once('=')?;
        if !raw_key.trim().eq_ignore_ascii_case(key) {
            return None;
        }
        let value = raw_value
            .trim()
            .trim_end_matches(';')
            .trim()
            .trim_matches('"')
            .trim();
        if value.is_empty() {
            None
        } else {
            Some(value.to_string())
        }
    })
}

pub(crate) fn parse_meta_cpp(content: &str) -> Option<String> {
    parse_meta_value(content, "name")
}

pub(crate) fn parse_meta_timestamp(content: &str) -> Option<i64> {
    parse_meta_value(content, "timestamp")?
        .trim_start_matches('-')
        .parse()
        .ok()
}

pub(crate) fn dir_size(path: &std::path::Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(path) else {
        return 0;
    };
    entries
        .filter_map(|e| e.ok())
        .map(|e| {
            let p = e.path();
            // Never follow symlinks out of the mod directory when sizing.
            match e.file_type() {
                Ok(t) if t.is_dir() => dir_size(&p),
                Ok(t) if t.is_symlink() => 0,
                _ => std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0),
            }
        })
        .sum()
}

/// Cheap fingerprint of the workshop directory — entry names plus modification
/// times. Summing directory sizes across dozens of mods is slow, so a rescan
/// only happens when this changes. Same idea as dayz-ctl's md5 checksum, but
/// it also notices in-place updates.
pub(crate) fn library_signature(steam_path: &str) -> String {
    let Ok(entries) = std::fs::read_dir(workshop_dir(steam_path)) else {
        return String::new();
    };
    let mut parts: Vec<String> = entries
        .filter_map(|e| e.ok())
        .map(|e| {
            let modified = e
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            format!("{}:{}", e.file_name().to_string_lossy(), modified)
        })
        .collect();
    parts.sort();
    parts.join(",")
}

static SCAN_CACHE: Mutex<Option<(String, String, Vec<InstalledMod>)>> = Mutex::new(None);

pub(crate) fn scan_mods(steam_path: &str) -> Vec<InstalledMod> {
    let Ok(entries) = std::fs::read_dir(workshop_dir(steam_path)) else {
        return Vec::new();
    };

    let mut mods: Vec<InstalledMod> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .map(|e| {
            let path = e.path();
            let workshop_id = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();

            let meta = std::fs::read_to_string(path.join("meta.cpp")).unwrap_or_default();

            InstalledMod {
                name: parse_meta_cpp(&meta).unwrap_or_else(|| workshop_id.clone()),
                timestamp: parse_meta_timestamp(&meta),
                size_bytes: dir_size(&path),
                managed: is_managed(steam_path, &workshop_id),
                linked: mod_link(steam_path, &workshop_id).canonicalize().ok()
                    == path.canonicalize().ok(),
                workshop_id,
            }
        })
        .collect();

    mods.sort_by_key(|m| m.name.to_lowercase());
    mods
}

fn scan_mods_cached(steam_path: &str) -> Vec<InstalledMod> {
    let signature = library_signature(steam_path);

    if let Ok(cache) = SCAN_CACHE.lock() {
        if let Some((cached_path, cached_sig, mods)) = cache.as_ref() {
            if cached_path == steam_path && *cached_sig == signature {
                return mods.clone();
            }
        }
    }

    let mods = scan_mods(steam_path);
    if let Ok(mut cache) = SCAN_CACHE.lock() {
        *cache = Some((steam_path.to_string(), signature, mods.clone()));
    }
    mods
}

fn invalidate_cache() {
    if let Ok(mut cache) = SCAN_CACHE.lock() {
        *cache = None;
    }
}

pub(crate) fn build_library(steam_path: &str, mods: Vec<InstalledMod>) -> ModLibrary {
    ModLibrary {
        total_size_bytes: mods.iter().map(|m| m.size_bytes).sum(),
        linked_count: mods.iter().filter(|m| m.linked).count(),
        managed_count: mods.iter().filter(|m| m.managed).count(),
        workshop_path: workshop_dir(steam_path).to_string_lossy().to_string(),
        mods,
    }
}

fn resolve_steam_path(app: &tauri::AppHandle, provided: Option<String>) -> Result<String, String> {
    provided
        .filter(|p| !p.is_empty())
        .or_else(|| read_config(app).steam_path)
        .or_else(crate::commands::system::detect_steam_path)
        .ok_or_else(|| "no-steam-path: could not find your Steam library".to_string())
}

#[tauri::command]
pub fn list_mods(app: tauri::AppHandle, steam_path: Option<String>) -> Result<ModLibrary, String> {
    let steam_path = resolve_steam_path(&app, steam_path)?;
    Ok(build_library(&steam_path, scan_mods_cached(&steam_path)))
}

pub(crate) fn remove_mod(steam_path: &str, workshop_id: &str) -> Result<u64, String> {
    let dir = mod_dir(steam_path, workshop_id);
    let link = mod_link(steam_path, workshop_id);

    let freed = if dir.is_dir() { dir_size(&dir) } else { 0 };

    if dir.exists() {
        std::fs::remove_dir_all(&dir)
            .map_err(|e| format!("delete-failed: {}: {}", workshop_id, e))?;
    }

    if link.symlink_metadata().is_ok() {
        std::fs::remove_file(&link)
            .map_err(|e| format!("delete-symlink-failed: {}: {}", workshop_id, e))?;
    }

    Ok(freed)
}

#[tauri::command]
pub fn delete_mod(
    app: tauri::AppHandle,
    steam_path: Option<String>,
    workshop_id: String,
) -> Result<u64, String> {
    let steam_path = resolve_steam_path(&app, steam_path)?;
    let freed = remove_mod(&steam_path, &workshop_id)?;
    invalidate_cache();
    Ok(freed)
}

/// Deletes several mods, reporting how much space came back.
#[tauri::command]
pub fn delete_mods(
    app: tauri::AppHandle,
    steam_path: Option<String>,
    workshop_ids: Vec<String>,
) -> Result<u64, String> {
    let steam_path = resolve_steam_path(&app, steam_path)?;
    let mut freed = 0;
    for id in &workshop_ids {
        freed += remove_mod(&steam_path, id)?;
    }
    invalidate_cache();
    Ok(freed)
}

/// Removes every mod this launcher installed, leaving Workshop subscriptions
/// alone — dayz-ctl's "Remove managed mods".
#[tauri::command]
pub fn delete_managed_mods(
    app: tauri::AppHandle,
    steam_path: Option<String>,
) -> Result<u64, String> {
    let steam_path = resolve_steam_path(&app, steam_path)?;
    let managed: Vec<String> = scan_mods(&steam_path)
        .into_iter()
        .filter(|m| m.managed)
        .map(|m| m.workshop_id)
        .collect();

    let mut freed = 0;
    for id in &managed {
        freed += remove_mod(&steam_path, id)?;
    }
    invalidate_cache();
    Ok(freed)
}

/// Deletes every `@mod` symlink in the DayZ directory.
#[tauri::command]
pub fn remove_all_links(
    app: tauri::AppHandle,
    steam_path: Option<String>,
) -> Result<usize, String> {
    let steam_path = resolve_steam_path(&app, steam_path)?;
    let Ok(entries) = std::fs::read_dir(dayz_dir(&steam_path)) else {
        return Ok(0);
    };

    let mut removed = 0;
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        let is_link = path
            .symlink_metadata()
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(false);
        let is_mod = path
            .file_name()
            .map(|n| n.to_string_lossy().starts_with('@'))
            .unwrap_or(false);

        if is_link && is_mod {
            std::fs::remove_file(&path).map_err(|e| format!("unlink-failed: {}", e))?;
            removed += 1;
        }
    }

    invalidate_cache();
    Ok(removed)
}

/// Recreates a symlink for every installed mod, repairing a library where the
/// links were removed or point somewhere stale.
#[tauri::command]
pub fn relink_all_mods(app: tauri::AppHandle, steam_path: Option<String>) -> Result<usize, String> {
    let steam_path = resolve_steam_path(&app, steam_path)?;
    let mods = scan_mods(&steam_path);
    for m in &mods {
        crate::commands::join::ensure_symlink(&steam_path, &m.workshop_id)?;
    }
    invalidate_cache();
    Ok(mods.len())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModProgress {
    pub step: String,
    pub detail: Option<String>,
    pub current: u32,
    pub total: u32,
    pub percent: Option<f32>,
}

/// Force-updates mods through steamcmd, emitting `mod-progress` events.
#[tauri::command]
pub async fn update_mods(
    app: tauri::AppHandle,
    steam_path: Option<String>,
    workshop_ids: Vec<String>,
    // Overrides the stored preference for this run; the UI asks when Steam is
    // actually running rather than closing it behind the user's back.
    close_steam: Option<bool>,
) -> Result<(), String> {
    let config = read_config(&app);
    let steam_path = resolve_steam_path(&app, steam_path)?;

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

    let emit =
        |step: &str, detail: Option<&str>, current: u32, total: u32, percent: Option<f32>| {
            let _ = app.emit(
                "mod-progress",
                ModProgress {
                    step: step.to_string(),
                    detail: detail.map(String::from),
                    current,
                    total,
                    percent,
                },
            );
        };

    let close_steam = close_steam.unwrap_or(config.close_steam_for_downloads);
    let closed_steam = close_steam && crate::commands::system::steam_running();

    if closed_steam {
        emit("closing-steam", None, 0, 0, None);
        crate::commands::system::shutdown_steam().await?;
    }

    let known = scan_mods(&steam_path);
    let total = workshop_ids.len() as u32;

    for (i, id) in workshop_ids.iter().enumerate() {
        let current = i as u32 + 1;
        let name = known
            .iter()
            .find(|m| &m.workshop_id == id)
            .map(|m| m.name.clone())
            .unwrap_or_else(|| id.clone());

        emit("updating", Some(&name), current, total, Some(0.0));

        let app_handle = app.clone();
        let label = name.clone();
        let result = download_workshop_item(&login, id, &steam_path, move |line, percent| {
            let detail = match percent {
                Some(_) => label.clone(),
                None => format!("{} — {}", label, line),
            };
            let _ = app_handle.emit(
                "mod-progress",
                ModProgress {
                    step: "updating".to_string(),
                    detail: Some(detail),
                    current,
                    total,
                    percent,
                },
            );
        })
        .await;

        if let Err(e) = result {
            emit("error", Some(&e), current, total, None);
            invalidate_cache();
            // Put Steam back even when the update fails — we closed it, so
            // leaving the user without it would be rude.
            if closed_steam {
                let _ = crate::commands::system::start_steam().await;
            }
            return Err(e);
        }

        crate::commands::join::mark_managed(&steam_path, id);
        let _ = crate::commands::join::ensure_symlink(&steam_path, id);
    }

    invalidate_cache();

    if closed_steam {
        emit("starting-steam", None, total, total, None);
        let _ = crate::commands::system::start_steam().await;
    }

    emit("done", None, total, total, None);
    Ok(())
}

/// Mods installed locally that the launcher can offer for a manual launch.
#[tauri::command]
pub fn list_mod_refs(
    app: tauri::AppHandle,
    steam_path: Option<String>,
) -> Result<Vec<ModRef>, String> {
    let steam_path = resolve_steam_path(&app, steam_path)?;
    Ok(scan_mods_cached(&steam_path)
        .into_iter()
        .map(|m| ModRef {
            workshop_id: m.workshop_id,
            name: m.name,
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("zld-mods-test-{}", name));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn install_mod(base: &std::path::Path, id: &str, meta: Option<&str>, bytes: usize) {
        let dir = workshop_dir(base.to_str().unwrap()).join(id);
        fs::create_dir_all(&dir).unwrap();
        if let Some(meta) = meta {
            fs::write(dir.join("meta.cpp"), meta).unwrap();
        }
        if bytes > 0 {
            fs::write(dir.join("data.bin"), vec![0u8; bytes]).unwrap();
        }
    }

    #[test]
    fn parse_meta_cpp_extracts_name() {
        let content = "class CfgMods {\n    name = \"CF\";\n    author = \"Someone\";\n};";
        assert_eq!(parse_meta_cpp(content), Some("CF".to_string()));
    }

    #[test]
    fn parse_meta_cpp_handles_semicolon_suffix() {
        assert_eq!(
            parse_meta_cpp("name = \"My Mod\";"),
            Some("My Mod".to_string())
        );
    }

    #[test]
    fn parse_meta_cpp_returns_none_when_no_name() {
        assert_eq!(parse_meta_cpp("author = \"Someone\";"), None);
        assert_eq!(parse_meta_cpp(""), None);
    }

    #[test]
    fn parse_meta_value_requires_an_exact_key() {
        let content = "nameSpace = \"wrong\";\nname = \"right\";";
        assert_eq!(parse_meta_value(content, "name"), Some("right".to_string()));
    }

    #[test]
    fn parse_meta_timestamp_reads_number() {
        let content = "name = \"CF\";\ntimestamp = 5250757174595880000;";
        assert_eq!(parse_meta_timestamp(content), Some(5250757174595880000));
    }

    #[test]
    fn parse_meta_timestamp_handles_negative_marker() {
        assert_eq!(parse_meta_timestamp("timestamp = -1234;"), Some(1234));
        assert_eq!(parse_meta_timestamp("name = \"x\";"), None);
    }

    #[test]
    fn dir_size_sums_files_recursively() {
        let base = tmp_dir("ds");
        fs::write(base.join("a.bin"), vec![0u8; 100]).unwrap();
        let sub = base.join("sub");
        fs::create_dir_all(&sub).unwrap();
        fs::write(sub.join("b.bin"), vec![0u8; 200]).unwrap();

        assert_eq!(dir_size(&base), 300);
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn dir_size_returns_zero_for_empty_or_missing_dir() {
        let base = tmp_dir("ds2");
        assert_eq!(dir_size(&base), 0);
        assert_eq!(dir_size(std::path::Path::new("/no/such/dir")), 0);
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn scan_reports_name_size_and_flags() {
        let base = tmp_dir("scan");
        install_mod(&base, "12345", Some("name = \"TestMod\";"), 512);
        crate::commands::join::ensure_symlink(base.to_str().unwrap(), "12345").unwrap();
        crate::commands::join::mark_managed(base.to_str().unwrap(), "12345");

        let mods = scan_mods(base.to_str().unwrap());
        assert_eq!(mods.len(), 1);
        assert_eq!(mods[0].workshop_id, "12345");
        assert_eq!(mods[0].name, "TestMod");
        assert!(mods[0].size_bytes >= 512);
        assert!(mods[0].linked, "symlinked mods report as linked");
        assert!(mods[0].managed, "marker file means launcher-installed");

        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn scan_falls_back_to_id_when_meta_is_absent() {
        let base = tmp_dir("scan2");
        install_mod(&base, "99999", None, 0);

        let mods = scan_mods(base.to_str().unwrap());
        assert_eq!(mods[0].name, "99999");
        assert!(!mods[0].linked);
        assert!(!mods[0].managed);

        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn scan_returns_empty_for_missing_workshop_dir() {
        let base = tmp_dir("scan3");
        assert!(scan_mods(base.to_str().unwrap()).is_empty());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn scan_sorts_by_name_case_insensitively() {
        let base = tmp_dir("scan4");
        install_mod(&base, "1", Some("name = \"zebra\";"), 0);
        install_mod(&base, "2", Some("name = \"Alpha\";"), 0);

        let names: Vec<String> = scan_mods(base.to_str().unwrap())
            .into_iter()
            .map(|m| m.name)
            .collect();
        assert_eq!(names, vec!["Alpha", "zebra"]);

        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn library_signature_changes_when_mods_change() {
        let base = tmp_dir("sig");
        install_mod(&base, "1", None, 0);
        let first = library_signature(base.to_str().unwrap());

        install_mod(&base, "2", None, 0);
        let second = library_signature(base.to_str().unwrap());

        assert_ne!(first, second);
        assert!(!first.is_empty());

        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn library_totals_are_summed() {
        let base = tmp_dir("lib");
        install_mod(&base, "1", Some("name = \"A\";"), 100);
        install_mod(&base, "2", Some("name = \"B\";"), 200);
        crate::commands::join::ensure_symlink(base.to_str().unwrap(), "1").unwrap();

        let library = build_library(base.to_str().unwrap(), scan_mods(base.to_str().unwrap()));
        assert_eq!(library.mods.len(), 2);
        assert!(library.total_size_bytes >= 300);
        assert_eq!(library.linked_count, 1);
        assert_eq!(library.managed_count, 0);
        assert!(library.workshop_path.ends_with("221100"));

        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn remove_mod_deletes_folder_and_symlink_and_reports_size() {
        let base = tmp_dir("rm");
        install_mod(&base, "55555", Some("name = \"Gone\";"), 300);
        crate::commands::join::ensure_symlink(base.to_str().unwrap(), "55555").unwrap();

        let freed = remove_mod(base.to_str().unwrap(), "55555").unwrap();

        assert!(freed >= 300);
        assert!(!mod_dir(base.to_str().unwrap(), "55555").exists());
        assert!(mod_link(base.to_str().unwrap(), "55555")
            .symlink_metadata()
            .is_err());

        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn remove_mod_succeeds_when_symlink_absent() {
        let base = tmp_dir("rm2");
        install_mod(&base, "44444", None, 0);

        remove_mod(base.to_str().unwrap(), "44444").unwrap();
        assert!(!mod_dir(base.to_str().unwrap(), "44444").exists());

        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn remove_mod_clears_a_broken_symlink() {
        let base = tmp_dir("rm3");
        install_mod(&base, "33333", None, 0);
        fs::create_dir_all(dayz_dir(base.to_str().unwrap())).unwrap();
        let link = mod_link(base.to_str().unwrap(), "33333");
        std::os::unix::fs::symlink("/nowhere", &link).unwrap();

        remove_mod(base.to_str().unwrap(), "33333").unwrap();
        assert!(link.symlink_metadata().is_err());

        fs::remove_dir_all(&base).unwrap();
    }
}
