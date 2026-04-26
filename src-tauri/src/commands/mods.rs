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
}
