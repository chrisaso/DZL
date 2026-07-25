//! Workshop update checking.
//!
//! Steam's published-file endpoint reports when each workshop item was last
//! updated, and needs no API key. Comparing that against the newest file in the
//! local mod directory is the closest thing to a reliable "is my copy stale?"
//! signal; DayZ's own meta.cpp timestamp is in an undocumented format that
//! cannot be compared to a unix time.

use crate::commands::join::MANAGED_MARKER;
use crate::commands::mods::scan_mods;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const DETAILS_URL: &str =
    "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/";
/// Steam accepts large batches, but keep requests modest.
const BATCH_SIZE: usize = 100;
const REQUEST_TIMEOUT_SECS: u64 = 20;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModUpdateStatus {
    pub workshop_id: String,
    pub name: String,
    /// Newest content file in the local mod directory, unix seconds.
    pub local_updated: Option<i64>,
    /// When the author last published, unix seconds.
    pub remote_updated: Option<i64>,
    pub update_available: bool,
    /// Workshop title, which can differ from the name in meta.cpp.
    pub remote_title: Option<String>,
    pub remote_size_bytes: Option<u64>,
}

#[derive(Debug, PartialEq, Clone)]
pub(crate) struct RemoteDetail {
    pub time_updated: Option<i64>,
    pub title: Option<String>,
    pub file_size: Option<u64>,
}

/// Newest modification time of a mod's content, ignoring the marker file this
/// launcher writes after a download, which would otherwise always look newer
/// than the content itself.
pub(crate) fn newest_content_mtime(dir: &std::path::Path) -> Option<i64> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut newest: Option<i64> = None;

    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.file_name().map(|n| n == MANAGED_MARKER).unwrap_or(false) {
            continue;
        }

        let candidate = match entry.file_type() {
            Ok(t) if t.is_dir() => newest_content_mtime(&path),
            Ok(t) if t.is_symlink() => None,
            _ => entry
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64),
        };

        if let Some(value) = candidate {
            newest = Some(newest.map_or(value, |current: i64| current.max(value)));
        }
    }

    newest
}

/// True when Steam has a newer publish time than the local copy. Unknown on
/// either side means "don't claim an update", because a false alarm that triggers a
/// multi-gigabyte download is worse than a missed one.
pub(crate) fn is_outdated(local: Option<i64>, remote: Option<i64>) -> bool {
    match (local, remote) {
        (Some(local), Some(remote)) => remote > local,
        _ => false,
    }
}

/// Pulls the fields we care about out of Steam's response, tolerating the
/// numbers-as-strings the endpoint sometimes returns.
pub(crate) fn parse_details(body: &serde_json::Value) -> HashMap<String, RemoteDetail> {
    let mut map = HashMap::new();

    let Some(items) = body
        .get("response")
        .and_then(|r| r.get("publishedfiledetails"))
        .and_then(|d| d.as_array())
    else {
        return map;
    };

    for item in items {
        let Some(id) = item.get("publishedfileid").and_then(number_or_string) else {
            continue;
        };

        map.insert(
            id,
            RemoteDetail {
                time_updated: item
                    .get("time_updated")
                    .and_then(number_or_string)
                    .and_then(|v| v.parse().ok()),
                title: item
                    .get("title")
                    .and_then(|t| t.as_str())
                    .filter(|t| !t.is_empty())
                    .map(String::from),
                file_size: item
                    .get("file_size")
                    .and_then(number_or_string)
                    .and_then(|v| v.parse().ok()),
            },
        );
    }

    map
}

fn number_or_string(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

async fn fetch_details(ids: &[String]) -> Result<HashMap<String, RemoteDetail>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("http-client-failed: {}", e))?;

    let mut details = HashMap::new();

    for chunk in ids.chunks(BATCH_SIZE) {
        let mut form: Vec<(String, String)> =
            vec![("itemcount".to_string(), chunk.len().to_string())];
        for (i, id) in chunk.iter().enumerate() {
            form.push((format!("publishedfileids[{}]", i), id.clone()));
        }

        let response = client
            .post(DETAILS_URL)
            .form(&form)
            .send()
            .await
            .map_err(|e| format!("steam-api-unreachable: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("steam-api-error: HTTP {}", response.status()));
        }

        let body: serde_json::Value = response
            .json()
            .await
            .map_err(|e| format!("steam-api-bad-response: {}", e))?;

        details.extend(parse_details(&body));
    }

    Ok(details)
}

/// Compares every installed mod against the Workshop.
#[tauri::command]
pub async fn check_mod_updates(
    app: tauri::AppHandle,
    steam_path: Option<String>,
) -> Result<Vec<ModUpdateStatus>, String> {
    let steam_path = steam_path
        .filter(|p| !p.is_empty())
        .or_else(|| crate::commands::config::read_config(&app).steam_path)
        .or_else(crate::commands::system::detect_steam_path)
        .ok_or_else(|| "no-steam-path: could not find your Steam library".to_string())?;

    let installed = scan_mods(&steam_path);
    if installed.is_empty() {
        return Ok(Vec::new());
    }

    let ids: Vec<String> = installed.iter().map(|m| m.workshop_id.clone()).collect();
    let details = fetch_details(&ids).await?;

    Ok(installed
        .into_iter()
        .map(|m| {
            let remote = details.get(&m.workshop_id);
            let local_updated = newest_content_mtime(
                &crate::commands::join::mod_dir(&steam_path, &m.workshop_id),
            );
            let remote_updated = remote.and_then(|r| r.time_updated);

            ModUpdateStatus {
                update_available: is_outdated(local_updated, remote_updated),
                remote_title: remote.and_then(|r| r.title.clone()),
                remote_size_bytes: remote.and_then(|r| r.file_size),
                workshop_id: m.workshop_id,
                name: m.name,
                local_updated,
                remote_updated,
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn outdated_only_when_remote_is_strictly_newer() {
        assert!(is_outdated(Some(100), Some(200)));
        assert!(!is_outdated(Some(200), Some(100)));
        assert!(!is_outdated(Some(100), Some(100)));
    }

    #[test]
    fn unknown_timestamps_never_claim_an_update() {
        assert!(!is_outdated(None, Some(200)));
        assert!(!is_outdated(Some(100), None));
        assert!(!is_outdated(None, None));
    }

    #[test]
    fn parses_steam_response() {
        let body = serde_json::json!({
            "response": {
                "result": 1,
                "resultcount": 2,
                "publishedfiledetails": [
                    {
                        "publishedfileid": "1559212036",
                        "time_updated": 1_700_000_000u64,
                        "title": "CF",
                        "file_size": "527656"
                    },
                    {
                        "publishedfileid": "2545327648",
                        "time_updated": 1_600_000_000u64,
                        "title": "Dabs Framework",
                        "file_size": 12345
                    }
                ]
            }
        });

        let details = parse_details(&body);
        assert_eq!(details.len(), 2);

        let cf = &details["1559212036"];
        assert_eq!(cf.time_updated, Some(1_700_000_000));
        assert_eq!(cf.title.as_deref(), Some("CF"));
        assert_eq!(cf.file_size, Some(527656), "string sizes must parse");
        assert_eq!(details["2545327648"].file_size, Some(12345));
    }

    #[test]
    fn parses_numeric_published_file_ids() {
        let body = serde_json::json!({
            "response": { "publishedfiledetails": [
                { "publishedfileid": 999u64, "time_updated": 5u64 }
            ]}
        });
        assert!(parse_details(&body).contains_key("999"));
    }

    #[test]
    fn missing_or_malformed_response_yields_nothing() {
        assert!(parse_details(&serde_json::json!({})).is_empty());
        assert!(parse_details(&serde_json::json!({ "response": {} })).is_empty());
        assert!(parse_details(&serde_json::json!({
            "response": { "publishedfiledetails": [{ "result": 9 }] }
        }))
        .is_empty());
    }

    #[test]
    fn item_without_timestamp_is_not_flagged() {
        let body = serde_json::json!({
            "response": { "publishedfiledetails": [
                { "publishedfileid": "42", "result": 9 }
            ]}
        });
        let details = parse_details(&body);
        assert_eq!(details["42"].time_updated, None);
        assert!(!is_outdated(Some(100), details["42"].time_updated));
    }

    #[test]
    fn newest_mtime_ignores_the_launcher_marker() {
        let base = std::env::temp_dir().join("zld-updates-mtime");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(base.join("sub")).unwrap();

        fs::write(base.join("sub/data.bin"), b"content").unwrap();
        let content_time = newest_content_mtime(&base).expect("content mtime");

        // The marker is written after the download, so it is always newer.
        fs::write(base.join(MANAGED_MARKER), b"123").unwrap();
        assert_eq!(
            newest_content_mtime(&base),
            Some(content_time),
            "the marker must not count as content"
        );

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn newest_mtime_of_missing_dir_is_none() {
        assert_eq!(
            newest_content_mtime(std::path::Path::new("/no/such/mod/dir")),
            None
        );
    }
}
