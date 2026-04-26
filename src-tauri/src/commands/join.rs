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
}
