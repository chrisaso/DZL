use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledMod {
    pub workshop_id: String,
    pub name: String,
    pub size_bytes: u64,
}

pub(crate) fn parse_meta_cpp(content: &str) -> Option<String> {
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("name") {
            if let Some(after_eq) = trimmed.splitn(2, '=').nth(1) {
                let value = after_eq
                    .trim()
                    .trim_end_matches(';')
                    .trim()
                    .trim_matches('"')
                    .trim();
                if !value.is_empty() {
                    return Some(value.to_string());
                }
            }
        }
    }
    None
}

pub(crate) fn dir_size(path: &std::path::Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(path) else {
        return 0;
    };
    entries
        .filter_map(|e| e.ok())
        .map(|e| {
            let p = e.path();
            if p.is_dir() {
                dir_size(&p)
            } else {
                std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0)
            }
        })
        .sum()
}

pub(crate) fn scan_mods(steam_path: &str) -> Vec<InstalledMod> {
    let workshop_dir = std::path::Path::new(steam_path).join("workshop/content/221100");

    let Ok(entries) = std::fs::read_dir(&workshop_dir) else {
        return Vec::new();
    };

    entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .map(|e| {
            let path = e.path();
            let workshop_id = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();

            let name = path
                .join("meta.cpp")
                .to_str()
                .and_then(|p| std::fs::read_to_string(p).ok())
                .as_deref()
                .and_then(parse_meta_cpp)
                .unwrap_or_else(|| workshop_id.clone());

            let size_bytes = dir_size(&path);

            InstalledMod {
                workshop_id,
                name,
                size_bytes,
            }
        })
        .collect()
}

pub(crate) fn remove_mod(steam_path: &str, workshop_id: &str) -> Result<(), String> {
    let mod_dir = std::path::PathBuf::from(format!(
        "{}/workshop/content/221100/{}",
        steam_path, workshop_id
    ));
    let link_path =
        std::path::PathBuf::from(format!("{}/common/DayZ/@{}", steam_path, workshop_id));

    if mod_dir.exists() {
        std::fs::remove_dir_all(&mod_dir)
            .map_err(|e| format!("delete-failed: {}: {}", workshop_id, e))?;
    }

    if link_path.exists() || link_path.symlink_metadata().is_ok() {
        std::fs::remove_file(&link_path)
            .map_err(|e| format!("delete-symlink-failed: {}: {}", workshop_id, e))?;
    }

    Ok(())
}

#[tauri::command]
pub fn list_mods(steam_path: String) -> Vec<InstalledMod> {
    scan_mods(&steam_path)
}

#[tauri::command]
pub fn delete_mod(steam_path: String, workshop_id: String) -> Result<(), String> {
    remove_mod(&steam_path, &workshop_id)
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

    #[test]
    fn parse_meta_cpp_extracts_name() {
        let content = r#"
class CfgMods {
    name = "CF";
    author = "Someone";
};
"#;
        assert_eq!(parse_meta_cpp(content), Some("CF".to_string()));
    }

    #[test]
    fn parse_meta_cpp_handles_semicolon_suffix() {
        let content = "name = \"My Mod\";";
        assert_eq!(parse_meta_cpp(content), Some("My Mod".to_string()));
    }

    #[test]
    fn parse_meta_cpp_returns_none_when_no_name() {
        let content = "author = \"Someone\";";
        assert_eq!(parse_meta_cpp(content), None);
    }

    #[test]
    fn parse_meta_cpp_returns_none_for_empty_string() {
        assert_eq!(parse_meta_cpp(""), None);
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
    fn dir_size_returns_zero_for_empty_dir() {
        let base = tmp_dir("ds2");
        assert_eq!(dir_size(&base), 0);
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn list_mods_returns_installed_mods() {
        let base = tmp_dir("lm");
        let mod_dir = base.join("workshop/content/221100/12345");
        fs::create_dir_all(&mod_dir).unwrap();
        fs::write(mod_dir.join("meta.cpp"), r#"name = "TestMod";"#).unwrap();
        fs::write(mod_dir.join("data.bin"), vec![0u8; 512]).unwrap();

        let mods = scan_mods(base.to_str().unwrap());
        assert_eq!(mods.len(), 1);
        assert_eq!(mods[0].workshop_id, "12345");
        assert_eq!(mods[0].name, "TestMod");
        assert!(mods[0].size_bytes > 512); // Includes meta.cpp + data.bin

        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn list_mods_falls_back_to_id_when_no_meta_cpp() {
        let base = tmp_dir("lm2");
        let mod_dir = base.join("workshop/content/221100/99999");
        fs::create_dir_all(&mod_dir).unwrap();

        let mods = scan_mods(base.to_str().unwrap());
        assert_eq!(mods.len(), 1);
        assert_eq!(mods[0].name, "99999");

        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn list_mods_returns_empty_for_missing_workshop_dir() {
        let base = tmp_dir("lm3");
        let mods = scan_mods(base.to_str().unwrap());
        assert!(mods.is_empty());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn delete_mod_removes_folder_and_symlink() {
        let base = tmp_dir("dm");
        let mod_dir = base.join("workshop/content/221100/55555");
        fs::create_dir_all(&mod_dir).unwrap();
        let link_dir = base.join("common/DayZ");
        fs::create_dir_all(&link_dir).unwrap();
        std::os::unix::fs::symlink(&mod_dir, link_dir.join("@55555")).unwrap();

        remove_mod(base.to_str().unwrap(), "55555").unwrap();

        assert!(!mod_dir.exists());
        assert!(!link_dir.join("@55555").exists());

        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn delete_mod_succeeds_when_symlink_absent() {
        let base = tmp_dir("dm2");
        let mod_dir = base.join("workshop/content/221100/44444");
        fs::create_dir_all(&mod_dir).unwrap();

        remove_mod(base.to_str().unwrap(), "44444").unwrap();
        assert!(!mod_dir.exists());

        fs::remove_dir_all(&base).unwrap();
    }
}
