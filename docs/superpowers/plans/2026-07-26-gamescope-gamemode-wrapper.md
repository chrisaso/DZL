# gamescope and GameMode Wrapper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let DZL own the gamescope and GameMode wrapper for DayZ, so a user configures resolution, refresh rate, fullscreen and extra arguments in the launcher instead of in Steam's game properties.

**Architecture:** Steam's `apps/221100/LaunchOptions` is hooked once to `<app data dir>/dzl-wrap.sh %command%`. That script is DZL's own file, regenerated on every settings save, so all later changes need no Steam writes. `steam_vdf.rs` does a surgical text edit of `localconfig.vdf`; `commands/wrapper.rs` owns the script, the status and the install/remove commands.

**Tech Stack:** Rust (Tauri 2, serde, tokio), React 18 + TypeScript, Vitest, Tailwind classes via the existing `ui.tsx` primitives.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-26-gamescope-gamemode-wrapper-design.md`. Read it before starting.
- No new Rust or npm dependencies. The VDF editing is hand-rolled.
- No em dashes or en dashes in prose, comments or commit messages. They are allowed only in user-facing UI strings.
- Never reference Claude, Anthropic or AI anywhere in the repo, including commit messages.
- British spelling in prose and comments, matching the existing tree (`initialises`, `serialises`).
- `cargo clippy --all-targets -- -D warnings` must stay clean. `cargo fmt` is not gated; match surrounding style.
- Every wrapper setting defaults to off, so upgrading DZL changes nobody's launch.
- `localconfig.vdf` is written only with Steam confirmed down, atomically, after a backup.
- Commit after every task. Work happens on branch `feat/gamescope-wrapper`, which already exists and holds the spec commit. Do not push.

Verification commands used throughout:

```sh
cd src-tauri && cargo test           # Rust suite
cd src-tauri && cargo clippy --all-targets -- -D warnings
npm test                             # frontend suite
npm run build                        # typecheck plus production bundle
```

## File Structure

**Created:**
- `src-tauri/src/steam_vdf.rs`: reading and editing Steam text KeyValues files, plus locating the right `localconfig.vdf`. No Tauri types, so it is unit testable on its own.
- `src-tauri/src/commands/wrapper.rs`: `WrapperStatus`, script generation, the import parser, and the `get_wrapper_status` / `install_wrapper_hook` / `remove_wrapper_hook` commands.
- `src/components/WrapperSettings.tsx`: the Wrappers section, kept out of `SettingsPage.tsx` because that file is already 450 lines.
- `src/utils/wrapperArgs.ts`: the pure helper that spots wrapper commands pasted into the extra-arguments field.
- `src/utils/wrapperArgs.test.ts`, `src/components/wrapperSettings.test.tsx`: frontend tests.

**Modified:**
- `src-tauri/src/lib.rs`: declare the `steam_vdf` module, register three commands.
- `src-tauri/src/commands/config.rs`: `WrapperConfig`, `DisplayMode`, the `AppConfig.wrapper` field, and a script rewrite inside `set_config`.
- `src-tauri/src/commands/join.rs`: `JoinRequirements.wrapper_hook_ok`, and a script rewrite in `run_join`.
- `src-tauri/src/commands/system.rs`: `gamescope_version` and `gamemode_installed` on `EnvironmentReport`, plus a `steam_root` helper.
- `src/types/launcher.ts`: mirror the new Rust types.
- `src/components/SettingsPage.tsx`: render `<WrapperSettings>`, warn on wrapper commands in Extra arguments.
- `src/components/JoinModal.tsx`: non-blocking banner when the hook is missing but wrappers are on.
- `README.md`: document the feature.

---

### Task 1: VDF string editing

**Files:**
- Create: `src-tauri/src/steam_vdf.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod steam_vdf;`)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `pub fn read_launch_options(vdf: &str, app_id: &str) -> Option<String>`
  - `pub fn set_launch_options(vdf: &str, app_id: &str, value: &str) -> Result<String, String>`
  - `pub fn escape(value: &str) -> String`
  - `pub fn unescape(value: &str) -> String`

Format notes, verified against the real file on the reference machine: keys open a block on their own line with `{` on the following line, pairs are `"key"\t\t"value"`, indentation is tabs, and the path to the app block is `UserLocalConfigStore/Software/Valve/Steam/apps/<app id>`. Key matching is case insensitive, because Steam has shipped both `Valve` and `valve`.

- [ ] **Step 1: Write the failing tests**

Add to `src-tauri/src/steam_vdf.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    /// A cut-down localconfig.vdf with the same shape as the real thing.
    fn sample(app_body: &str) -> String {
        format!(
            "\"UserLocalConfigStore\"\n{{\n\t\"Software\"\n\t{{\n\t\t\"Valve\"\n\t\t{{\n\t\t\t\"Steam\"\n\t\t\t{{\n\t\t\t\t\"apps\"\n\t\t\t\t{{\n\t\t\t\t\t\"440\"\n\t\t\t\t\t{{\n\t\t\t\t\t\t\"LastPlayed\"\t\t\"1\"\n\t\t\t\t\t}}\n{}\t\t\t\t}}\n\t\t\t}}\n\t\t}}\n\t}}\n}}\n",
            app_body
        )
    }

    fn dayz_block(body: &str) -> String {
        format!("\t\t\t\t\t\"221100\"\n\t\t\t\t\t{{\n{}\t\t\t\t\t}}\n", body)
    }

    #[test]
    fn reads_an_existing_value() {
        let vdf = sample(&dayz_block("\t\t\t\t\t\t\"LaunchOptions\"\t\t\"gamescope -f -- %command%\"\n"));
        assert_eq!(
            read_launch_options(&vdf, "221100").as_deref(),
            Some("gamescope -f -- %command%")
        );
    }

    #[test]
    fn reads_nothing_when_the_app_is_absent() {
        assert_eq!(read_launch_options(&sample(""), "221100"), None);
    }

    #[test]
    fn unescapes_quotes_on_read() {
        let vdf = sample(&dayz_block(
            "\t\t\t\t\t\t\"LaunchOptions\"\t\t\"LD_PRELOAD=\\\"\\\" gamescope -- %command%\"\n",
        ));
        assert_eq!(
            read_launch_options(&vdf, "221100").as_deref(),
            Some("LD_PRELOAD=\"\" gamescope -- %command%")
        );
    }

    #[test]
    fn replaces_an_existing_value_and_leaves_the_rest_alone() {
        let vdf = sample(&dayz_block("\t\t\t\t\t\t\"LaunchOptions\"\t\t\"old\"\n"));
        let out = set_launch_options(&vdf, "221100", "/tmp/dzl-wrap.sh %command%").unwrap();

        assert_eq!(
            read_launch_options(&out, "221100").as_deref(),
            Some("/tmp/dzl-wrap.sh %command%")
        );
        assert!(out.contains("\"LastPlayed\"\t\t\"1\""), "other apps survive");
        assert_eq!(out.lines().count(), vdf.lines().count(), "no lines added");
    }

    #[test]
    fn inserts_into_an_app_block_that_has_no_launch_options() {
        let vdf = sample(&dayz_block("\t\t\t\t\t\t\"LastPlayed\"\t\t\"99\"\n"));
        let out = set_launch_options(&vdf, "221100", "wrap %command%").unwrap();

        assert_eq!(read_launch_options(&out, "221100").as_deref(), Some("wrap %command%"));
        assert!(out.contains("\"LastPlayed\"\t\t\"99\""));
        assert!(
            out.contains("\t\t\t\t\t\t\"LaunchOptions\"\t\t\"wrap %command%\""),
            "matches the indentation of its siblings"
        );
    }

    #[test]
    fn creates_the_app_block_when_the_game_was_never_launched() {
        let out = set_launch_options(&sample(""), "221100", "wrap %command%").unwrap();

        assert_eq!(read_launch_options(&out, "221100").as_deref(), Some("wrap %command%"));
        assert!(out.contains("\"440\""), "existing apps survive");
    }

    #[test]
    fn escapes_quotes_on_write() {
        let out = set_launch_options(&sample(""), "221100", "LD_PRELOAD=\"\" wrap %command%").unwrap();
        assert!(out.contains("LD_PRELOAD=\\\"\\\""));
        assert_eq!(
            read_launch_options(&out, "221100").as_deref(),
            Some("LD_PRELOAD=\"\" wrap %command%")
        );
    }

    #[test]
    fn writing_the_same_value_twice_changes_nothing() {
        let once = set_launch_options(&sample(""), "221100", "wrap %command%").unwrap();
        let twice = set_launch_options(&once, "221100", "wrap %command%").unwrap();
        assert_eq!(once, twice);
    }

    #[test]
    fn errors_when_there_is_no_apps_block() {
        let err = set_launch_options("\"UserLocalConfigStore\"\n{\n}\n", "221100", "x").unwrap_err();
        assert!(err.starts_with("no-apps-block"), "got {}", err);
    }

    #[test]
    fn matches_keys_case_insensitively() {
        let vdf = sample(&dayz_block("\t\t\t\t\t\t\"launchoptions\"\t\t\"old\"\n")).replace("\"Valve\"", "\"valve\"");
        let out = set_launch_options(&vdf, "221100", "new %command%").unwrap();
        assert_eq!(read_launch_options(&out, "221100").as_deref(), Some("new %command%"));
        assert_eq!(out.lines().count(), vdf.lines().count());
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-tauri && cargo test steam_vdf`
Expected: compile error, `read_launch_options` and friends do not exist.

- [ ] **Step 3: Implement the module**

Write `src-tauri/src/steam_vdf.rs` above the test module:

```rust
//! Minimal reading and editing of Steam's text KeyValues files.
//!
//! Steam's `localconfig.vdf` is a megabyte of settings that belong to Steam,
//! not to us, so nothing here reserialises the file. Edits are surgical: find
//! the one line that matters, replace or insert it, and hand back the rest
//! byte for byte.

/// Keys leading to the per-app block inside `localconfig.vdf`.
const APPS_PATH: &[&str] = &["UserLocalConfigStore", "Software", "Valve", "Steam", "apps"];
const LAUNCH_OPTIONS: &str = "LaunchOptions";

pub fn escape(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

pub fn unescape(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut chars = value.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some(next) => out.push(next),
                None => out.push('\\'),
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// A `"key"\t\t"value"` pair, with the value still escaped.
fn parse_pair(line: &str) -> Option<(&str, &str)> {
    let rest = line.trim_start().strip_prefix('"')?;
    let (key, rest) = rest.split_once('"')?;
    let rest = rest.trim_start().strip_prefix('"')?;
    let value = rest.strip_suffix('"').or_else(|| rest.split_once("\"").map(|(v, _)| v))?;
    Some((key, value))
}

/// A line holding nothing but a quoted key, which opens a block.
fn parse_key_only(line: &str) -> Option<&str> {
    let trimmed = line.trim();
    let inner = trimmed.strip_prefix('"')?.strip_suffix('"')?;
    if inner.contains('"') {
        return None;
    }
    Some(inner)
}

fn indent_of(line: &str) -> &str {
    &line[..line.len() - line.trim_start().len()]
}

fn same_key(a: &str, b: &str) -> bool {
    a.eq_ignore_ascii_case(b)
}

/// Where the interesting lines are. Indices are into the line vector.
struct Located {
    /// Line holding the `{` that opens the `apps` block.
    apps_brace: Option<usize>,
    /// Line holding the `{` that opens this app's block.
    app_brace: Option<usize>,
    /// Line holding the app's existing `LaunchOptions` pair.
    launch_line: Option<usize>,
    launch_value: Option<String>,
}

fn locate(lines: &[&str], app_id: &str) -> Located {
    let mut found = Located {
        apps_brace: None,
        app_brace: None,
        launch_line: None,
        launch_value: None,
    };

    // Keys currently open, so a match is only accepted at the right depth.
    let mut stack: Vec<String> = Vec::new();
    let mut pending: Option<String> = None;

    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();

        if trimmed == "{" {
            if let Some(key) = pending.take() {
                stack.push(key);
                let depth = stack.len();
                if depth == APPS_PATH.len() && stack_matches(&stack, APPS_PATH) {
                    found.apps_brace = Some(i);
                } else if depth == APPS_PATH.len() + 1
                    && stack_matches(&stack[..APPS_PATH.len()], APPS_PATH)
                    && same_key(&stack[APPS_PATH.len()], app_id)
                {
                    found.app_brace = Some(i);
                }
            }
            continue;
        }

        if trimmed == "}" {
            pending = None;
            stack.pop();
            continue;
        }

        if let Some((key, value)) = parse_pair(line) {
            pending = None;
            let in_app = stack.len() == APPS_PATH.len() + 1
                && stack_matches(&stack[..APPS_PATH.len()], APPS_PATH)
                && same_key(&stack[APPS_PATH.len()], app_id);
            if in_app && same_key(key, LAUNCH_OPTIONS) {
                found.launch_line = Some(i);
                found.launch_value = Some(unescape(value));
            }
            continue;
        }

        pending = parse_key_only(line).map(String::from);
    }

    found
}

fn stack_matches(stack: &[String], path: &[&str]) -> bool {
    stack.len() == path.len() && stack.iter().zip(path).all(|(a, b)| same_key(a, b))
}

pub fn read_launch_options(vdf: &str, app_id: &str) -> Option<String> {
    let lines: Vec<&str> = vdf.lines().collect();
    locate(&lines, app_id).launch_value
}

pub fn set_launch_options(vdf: &str, app_id: &str, value: &str) -> Result<String, String> {
    let lines: Vec<&str> = vdf.lines().collect();
    let found = locate(&lines, app_id);
    let escaped = escape(value);

    let mut out: Vec<String> = lines.iter().map(|l| l.to_string()).collect();

    if let Some(i) = found.launch_line {
        let indent = indent_of(lines[i]).to_string();
        out[i] = format!("{}\"{}\"\t\t\"{}\"", indent, LAUNCH_OPTIONS, escaped);
    } else if let Some(brace) = found.app_brace {
        let indent = format!("{}\t", indent_of(lines[brace]));
        out.insert(
            brace + 1,
            format!("{}\"{}\"\t\t\"{}\"", indent, LAUNCH_OPTIONS, escaped),
        );
    } else if let Some(brace) = found.apps_brace {
        let key_indent = format!("{}\t", indent_of(lines[brace]));
        let child_indent = format!("{}\t", key_indent);
        out.splice(
            brace + 1..brace + 1,
            [
                format!("{}\"{}\"", key_indent, app_id),
                format!("{}{{", key_indent),
                format!("{}\"{}\"\t\t\"{}\"", child_indent, LAUNCH_OPTIONS, escaped),
                format!("{}}}", key_indent),
            ],
        );
    } else {
        return Err(format!(
            "no-apps-block: no {} section in this Steam config",
            APPS_PATH.join("/")
        ));
    }

    let mut joined = out.join("\n");
    if vdf.ends_with('\n') {
        joined.push('\n');
    }
    Ok(joined)
}
```

Add `mod steam_vdf;` to `src-tauri/src/lib.rs` next to the existing `mod` lines.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test steam_vdf && cargo clippy --all-targets -- -D warnings`
Expected: all ten tests pass, clippy clean.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/steam_vdf.rs src-tauri/src/lib.rs
git commit -m "feat: edit Steam launch options in place"
```

---

### Task 2: Locating and writing the real file

**Files:**
- Modify: `src-tauri/src/steam_vdf.rs`
- Modify: `src-tauri/src/commands/system.rs` (add `steam_root`)

**Interfaces:**
- Consumes: `set_launch_options`, `read_launch_options` from Task 1.
- Produces:
  - `pub struct LocalConfig { pub path: PathBuf, pub account_id: String }`
  - `pub fn find_local_config(steam_root: &Path) -> Result<LocalConfig, String>`
  - `pub fn write_launch_options(config: &LocalConfig, app_id: &str, value: &str) -> Result<(), String>`
  - `pub(crate) fn steam_root(steam_path: &str) -> PathBuf` in `system.rs`, the parent of a `steamapps` directory.

Account resolution deviates from the spec on one point, and the spec's Install section should be corrected when this lands: current Steam does not write a `MostRecent` key into `loginusers.vdf` (verified on the reference machine, which has only `AccountName`, `Timestamp` and friends). Resolution is therefore: a single `userdata/<id>` directory holding `config/localconfig.vdf` wins outright; otherwise the account whose block has `MostRecent "1"` if any Steam version does write it; otherwise the newest `localconfig.vdf` by mtime.

- [ ] **Step 1: Write the failing tests**

Append to the `tests` module in `steam_vdf.rs`:

```rust
    use std::fs;

    fn tmp_root(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("dzl-vdf-test-{}", name));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn make_account(root: &std::path::Path, id: &str, body: &str) {
        let dir = root.join("userdata").join(id).join("config");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("localconfig.vdf"), body).unwrap();
    }

    #[test]
    fn finds_the_only_account() {
        let root = tmp_root("one");
        make_account(&root, "419704515", &sample(""));

        let found = find_local_config(&root).unwrap();
        assert_eq!(found.account_id, "419704515");
        assert!(found.path.ends_with("userdata/419704515/config/localconfig.vdf"));

        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn prefers_the_most_recent_account_when_steam_marks_one() {
        let root = tmp_root("recent");
        make_account(&root, "111", &sample(""));
        make_account(&root, "222", &sample(""));
        fs::create_dir_all(root.join("config")).unwrap();
        // 76561197960265728 + 222 identifies account 222.
        fs::write(
            root.join("config/loginusers.vdf"),
            "\"users\"\n{\n\t\"76561197960265950\"\n\t{\n\t\t\"MostRecent\"\t\t\"1\"\n\t}\n}\n",
        )
        .unwrap();

        assert_eq!(find_local_config(&root).unwrap().account_id, "222");

        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn errors_when_there_is_no_account_at_all() {
        let root = tmp_root("none");
        let err = find_local_config(&root).unwrap_err();
        assert!(err.starts_with("no-steam-account"), "got {}", err);
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn writing_backs_up_and_replaces_the_file() {
        let root = tmp_root("write");
        make_account(&root, "419704515", &sample(""));
        let config = find_local_config(&root).unwrap();

        write_launch_options(&config, "221100", "/tmp/dzl-wrap.sh %command%").unwrap();

        let written = fs::read_to_string(&config.path).unwrap();
        assert_eq!(
            read_launch_options(&written, "221100").as_deref(),
            Some("/tmp/dzl-wrap.sh %command%")
        );

        let backup = config.path.with_extension("vdf.dzl.bak");
        let saved = fs::read_to_string(&backup).unwrap();
        assert_eq!(read_launch_options(&saved, "221100"), None, "backup is the original");

        fs::remove_dir_all(&root).unwrap();
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-tauri && cargo test steam_vdf`
Expected: compile error, `find_local_config` and `write_launch_options` do not exist.

- [ ] **Step 3: Implement**

Add to `steam_vdf.rs`:

```rust
use std::path::{Path, PathBuf};

/// Steam's per-account settings file, and the account it belongs to.
pub struct LocalConfig {
    pub path: PathBuf,
    pub account_id: String,
}

/// Steam ids in `loginusers.vdf` are 64 bit; `userdata` directories use the
/// low 32 bits.
const STEAM_ID_BASE: u64 = 76_561_197_960_265_728;

fn most_recent_account(steam_root: &Path) -> Option<String> {
    let text = std::fs::read_to_string(steam_root.join("config/loginusers.vdf")).ok()?;
    let mut current: Option<u64> = None;
    for line in text.lines() {
        if let Some(key) = parse_key_only(line) {
            current = key.parse::<u64>().ok();
            continue;
        }
        if let Some((key, value)) = parse_pair(line) {
            if same_key(key, "MostRecent") && value == "1" {
                let id = current?;
                return id.checked_sub(STEAM_ID_BASE).map(|a| a.to_string());
            }
        }
    }
    None
}

pub fn find_local_config(steam_root: &Path) -> Result<LocalConfig, String> {
    let candidates: Vec<LocalConfig> = std::fs::read_dir(steam_root.join("userdata"))
        .map_err(|e| format!("no-steam-account: cannot read userdata: {}", e))?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let path = entry.path().join("config/localconfig.vdf");
            if !path.is_file() {
                return None;
            }
            Some(LocalConfig {
                account_id: entry.file_name().to_string_lossy().to_string(),
                path,
            })
        })
        .collect();

    if candidates.is_empty() {
        return Err(format!(
            "no-steam-account: no localconfig.vdf under {}",
            steam_root.join("userdata").display()
        ));
    }
    if candidates.len() == 1 {
        return Ok(candidates.into_iter().next().unwrap());
    }

    if let Some(wanted) = most_recent_account(steam_root) {
        if let Some(found) = candidates.iter().position(|c| c.account_id == wanted) {
            return Ok(candidates.into_iter().nth(found).unwrap());
        }
    }

    // Last resort: whichever account Steam wrote to most recently.
    let newest = candidates
        .iter()
        .enumerate()
        .max_by_key(|(_, c)| {
            std::fs::metadata(&c.path)
                .and_then(|m| m.modified())
                .ok()
        })
        .map(|(i, _)| i)
        .unwrap_or(0);
    Ok(candidates.into_iter().nth(newest).unwrap())
}

/// Replaces the app's launch options, keeping a copy of the file first and
/// swapping the new one in with a rename so a crash cannot leave a half
/// written config behind.
pub fn write_launch_options(config: &LocalConfig, app_id: &str, value: &str) -> Result<(), String> {
    let original = std::fs::read_to_string(&config.path)
        .map_err(|e| format!("read-failed: {}: {}", config.path.display(), e))?;
    let updated = set_launch_options(&original, app_id, value)?;

    let backup = config.path.with_extension("vdf.dzl.bak");
    std::fs::write(&backup, &original)
        .map_err(|e| format!("backup-failed: {}: {}", backup.display(), e))?;

    let temp = config.path.with_extension("vdf.dzl.tmp");
    std::fs::write(&temp, &updated)
        .map_err(|e| format!("write-failed: {}: {}", temp.display(), e))?;
    std::fs::rename(&temp, &config.path)
        .map_err(|e| format!("write-failed: {}: {}", config.path.display(), e))
}
```

Add to `system.rs`, next to `dayz_dir`:

```rust
/// Steam's root directory, the parent of a `steamapps` path. `userdata` and
/// `config` live here.
pub(crate) fn steam_root(steam_path: &str) -> std::path::PathBuf {
    std::path::Path::new(steam_path)
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| std::path::PathBuf::from(steam_path))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test steam_vdf && cargo clippy --all-targets -- -D warnings`
Expected: pass, clean.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/steam_vdf.rs src-tauri/src/commands/system.rs
git commit -m "feat: locate and safely rewrite Steam's localconfig"
```

---

### Task 3: Wrapper configuration

**Files:**
- Modify: `src-tauri/src/commands/config.rs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `pub struct WrapperConfig { gamemode: bool, gamescope: bool, width: Option<u32>, height: Option<u32>, refresh: Option<u32>, display_mode: DisplayMode, force_grab_cursor: bool, extra_args: String, env: Vec<String>, previous_launch_options: Option<String> }`, all fields `pub`.
  - `pub enum DisplayMode { Fullscreen, Borderless, Windowed }`, `Default` is `Fullscreen`.
  - `AppConfig.wrapper: WrapperConfig`.

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module in `config.rs`:

```rust
    #[test]
    fn wrapper_defaults_to_off() {
        let wrapper = AppConfig::default().wrapper;
        assert!(!wrapper.gamemode);
        assert!(!wrapper.gamescope);
        assert_eq!(wrapper.width, None);
        assert_eq!(wrapper.display_mode, DisplayMode::Fullscreen);
        assert!(wrapper.env.is_empty());
        assert_eq!(wrapper.previous_launch_options, None);
    }

    #[test]
    fn config_without_a_wrapper_section_still_loads() {
        let legacy = serde_json::json!({
            "playerName": "Survivor",
            "customArgs": ["-newUI"],
        });
        let config: AppConfig = serde_json::from_value(legacy).unwrap();
        assert!(!config.wrapper.gamescope, "missing section falls back to defaults");
        assert_eq!(config.custom_args, vec!["-newUI".to_string()]);
    }

    #[test]
    fn wrapper_round_trips_through_json() {
        let mut config = AppConfig::default();
        config.wrapper = WrapperConfig {
            gamemode: true,
            gamescope: true,
            width: Some(2560),
            height: Some(1440),
            refresh: Some(180),
            display_mode: DisplayMode::Borderless,
            force_grab_cursor: true,
            extra_args: "--hdr-enabled".into(),
            env: vec!["LD_PRELOAD=".into()],
            previous_launch_options: Some("old string".into()),
        };

        let json = serde_json::to_value(&config).unwrap();
        assert_eq!(json["wrapper"]["forceGrabCursor"], true);
        assert_eq!(json["wrapper"]["displayMode"], "borderless");

        let back: AppConfig = serde_json::from_value(json).unwrap();
        assert_eq!(back.wrapper, config.wrapper);
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-tauri && cargo test config::`
Expected: compile error, no `wrapper` field and no `WrapperConfig`.

- [ ] **Step 3: Implement**

Add to `config.rs`, above `AppConfig`:

```rust
/// How gamescope presents its window.
#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum DisplayMode {
    #[default]
    Fullscreen,
    Borderless,
    Windowed,
}

/// gamescope and GameMode settings, applied by the wrapper script DZL hooks
/// into Steam's launch options. Everything is off by default, so an upgrade
/// never changes how the game starts.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct WrapperConfig {
    pub gamemode: bool,
    pub gamescope: bool,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub refresh: Option<u32>,
    pub display_mode: DisplayMode,
    pub force_grab_cursor: bool,
    /// Free-form gamescope arguments, whitespace separated.
    pub extra_args: String,
    /// `KEY=value` entries exported before the wrappers run.
    pub env: Vec<String>,
    /// Whatever Steam held before DZL hooked it, so Remove can put it back.
    pub previous_launch_options: Option<String>,
}
```

Add `pub wrapper: WrapperConfig,` to `AppConfig` after `custom_args`, and `wrapper: WrapperConfig::default(),` to its `Default` impl.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test config:: && cargo clippy --all-targets -- -D warnings`
Expected: pass, clean.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/config.rs
git commit -m "feat: store gamescope and GameMode settings"
```

---

### Task 4: The wrapper script

**Files:**
- Create: `src-tauri/src/commands/wrapper.rs`
- Modify: `src-tauri/src/commands/mod.rs` (add `pub mod wrapper;`)

**Interfaces:**
- Consumes: `WrapperConfig`, `DisplayMode` from Task 3.
- Produces:
  - `pub(crate) fn gamescope_args(wrapper: &WrapperConfig) -> Vec<String>`
  - `pub(crate) fn wrapper_script(wrapper: &WrapperConfig) -> String`
  - `pub(crate) fn preview_line(wrapper: &WrapperConfig) -> String`
  - `pub(crate) fn shell_quote(value: &str) -> String`

The script branches on which binaries exist, so a missing gamescope never stops the game and never silently drops GameMode too.

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/commands/wrapper.rs` with only the test module for now:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::config::{DisplayMode, WrapperConfig};

    fn full() -> WrapperConfig {
        WrapperConfig {
            gamemode: true,
            gamescope: true,
            width: Some(2560),
            height: Some(1440),
            refresh: Some(180),
            display_mode: DisplayMode::Fullscreen,
            force_grab_cursor: true,
            extra_args: "--hdr-enabled".into(),
            env: vec!["LD_PRELOAD=".into()],
            previous_launch_options: None,
        }
    }

    #[test]
    fn gamescope_args_follow_the_settings() {
        assert_eq!(
            gamescope_args(&full()),
            vec![
                "-W", "2560", "-H", "1440", "-r", "180", "-f", "--force-grab-cursor",
                "--hdr-enabled"
            ]
        );
    }

    #[test]
    fn borderless_and_windowed_pick_the_right_flag() {
        let mut wrapper = full();
        wrapper.display_mode = DisplayMode::Borderless;
        assert!(gamescope_args(&wrapper).contains(&"-b".to_string()));
        assert!(!gamescope_args(&wrapper).contains(&"-f".to_string()));

        wrapper.display_mode = DisplayMode::Windowed;
        let args = gamescope_args(&wrapper);
        assert!(!args.contains(&"-b".to_string()) && !args.contains(&"-f".to_string()));
    }

    #[test]
    fn script_runs_both_wrappers_and_exports_the_environment() {
        let script = wrapper_script(&full());
        assert!(script.starts_with("#!/bin/sh\n"));
        assert!(script.contains("export LD_PRELOAD=''"));
        assert!(script.contains(
            "exec gamemoderun gamescope -W 2560 -H 1440 -r 180 -f --force-grab-cursor --hdr-enabled -- \"$@\""
        ));
        assert!(script.contains("exec gamescope"), "gamescope alone when GameMode is missing");
        assert!(script.contains("exec gamemoderun \"$@\""), "GameMode alone when gamescope is missing");
        assert!(script.trim_end().ends_with("exec \"$@\""), "always falls through to the game");
    }

    #[test]
    fn script_with_everything_off_just_runs_the_game() {
        let script = wrapper_script(&WrapperConfig::default());
        assert!(!script.contains("gamescope"));
        assert!(!script.contains("gamemoderun"));
        assert!(script.trim_end().ends_with("exec \"$@\""));
    }

    #[test]
    fn script_quotes_values_and_rejects_bad_variable_names() {
        let wrapper = WrapperConfig {
            gamescope: true,
            extra_args: "--filter 'nearest thing'".into(),
            env: vec![
                "PROTON_LOG=1".into(),
                "WITH SPACE=value".into(),
                "SHELL_OUT=$(id)".into(),
            ],
            ..WrapperConfig::default()
        };
        let script = wrapper_script(&wrapper);

        assert!(script.contains("export PROTON_LOG='1'"));
        assert!(!script.contains("WITH SPACE"), "invalid names are dropped");
        assert!(script.contains("export SHELL_OUT='$(id)'"), "values are never expanded");
        assert!(script.contains("'nearest thing'"), "quoted extra args stay one argument");
    }

    #[test]
    fn shell_quote_handles_embedded_quotes() {
        assert_eq!(shell_quote("it's"), "'it'\\''s'");
    }

    #[test]
    fn preview_reads_like_a_steam_launch_option() {
        assert_eq!(
            preview_line(&full()),
            "gamemoderun gamescope -W 2560 -H 1440 -r 180 -f --force-grab-cursor --hdr-enabled -- %command%"
        );
        assert_eq!(preview_line(&WrapperConfig::default()), "%command%");
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-tauri && cargo test wrapper::`
Expected: compile error, the functions do not exist.

- [ ] **Step 3: Implement**

Write above the tests in `wrapper.rs`:

```rust
//! The wrapper script DZL hooks into Steam's launch options for DayZ.
//!
//! Steam launches the game, not us: when the client is already running,
//! `steam -applaunch` hands the request over IPC and the game inherits that
//! client's environment. A wrapper therefore has to arrive through Steam's own
//! `%command%`. DZL points that at this script once and then owns the script,
//! so changing a setting never touches Steam's config again.

use crate::commands::config::{AppConfig, DisplayMode, WrapperConfig};

/// Splits a free-form argument string, honouring single and double quotes so
/// `--filter 'nearest thing'` stays one argument.
pub(crate) fn split_args(value: &str) -> Vec<String> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut started = false;

    for c in value.chars() {
        match quote {
            Some(q) if c == q => quote = None,
            Some(_) => current.push(c),
            None if c == '\'' || c == '"' => {
                quote = Some(c);
                started = true;
            }
            None if c.is_whitespace() => {
                if started || !current.is_empty() {
                    args.push(std::mem::take(&mut current));
                    started = false;
                }
            }
            None => current.push(c),
        }
    }
    if started || !current.is_empty() {
        args.push(current);
    }
    args
}

/// Wraps a value in single quotes so the shell treats it literally.
pub(crate) fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn valid_env_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .enumerate()
            .all(|(i, c)| c == '_' || c.is_ascii_alphabetic() || (i > 0 && c.is_ascii_digit()))
}

pub(crate) fn gamescope_args(wrapper: &WrapperConfig) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();
    if let Some(width) = wrapper.width {
        args.push("-W".into());
        args.push(width.to_string());
    }
    if let Some(height) = wrapper.height {
        args.push("-H".into());
        args.push(height.to_string());
    }
    if let Some(refresh) = wrapper.refresh {
        args.push("-r".into());
        args.push(refresh.to_string());
    }
    match wrapper.display_mode {
        DisplayMode::Fullscreen => args.push("-f".into()),
        DisplayMode::Borderless => args.push("-b".into()),
        DisplayMode::Windowed => {}
    }
    if wrapper.force_grab_cursor {
        args.push("--force-grab-cursor".into());
    }
    args.extend(split_args(&wrapper.extra_args));
    args
}

/// The command as a Steam user would write it, for the settings preview.
pub(crate) fn preview_line(wrapper: &WrapperConfig) -> String {
    let mut parts: Vec<String> = Vec::new();
    if wrapper.gamemode {
        parts.push("gamemoderun".into());
    }
    if wrapper.gamescope {
        parts.push("gamescope".into());
        parts.extend(gamescope_args(wrapper));
        parts.push("--".into());
    }
    parts.push("%command%".into());
    parts.join(" ")
}

pub(crate) fn wrapper_script(wrapper: &WrapperConfig) -> String {
    let mut out = String::from("#!/bin/sh\n");
    out.push_str("# Generated by DZL. Do not edit; change the launcher's settings instead.\n");

    for entry in &wrapper.env {
        let Some((name, value)) = entry.split_once('=') else {
            continue;
        };
        if !valid_env_name(name) {
            continue;
        }
        out.push_str(&format!("export {}={}\n", name, shell_quote(value)));
    }

    let scoped: Vec<String> = gamescope_args(wrapper).iter().map(|a| shell_quote(a)).collect();
    let scoped = if scoped.is_empty() {
        String::new()
    } else {
        format!(" {}", scoped.join(" "))
    };

    out.push_str("have() { command -v \"$1\" >/dev/null 2>&1; }\n");
    match (wrapper.gamemode, wrapper.gamescope) {
        (true, true) => {
            out.push_str("if have gamemoderun && have gamescope; then\n");
            out.push_str(&format!(
                "  exec gamemoderun gamescope{} -- \"$@\"\nelif have gamescope; then\n  exec gamescope{} -- \"$@\"\nelif have gamemoderun; then\n  exec gamemoderun \"$@\"\nfi\n",
                scoped, scoped
            ));
        }
        (false, true) => {
            out.push_str(&format!(
                "if have gamescope; then\n  exec gamescope{} -- \"$@\"\nfi\n",
                scoped
            ));
        }
        (true, false) => {
            out.push_str("if have gamemoderun; then\n  exec gamemoderun \"$@\"\nfi\n");
        }
        (false, false) => {}
    }
    out.push_str("exec \"$@\"\n");
    out
}
```

The `have()` helper is emitted unconditionally so the script reads the same however it is configured; the all-off case simply never calls it. Note the quoted arguments in the emitted `exec` lines: the assertion in `script_runs_both_wrappers_and_exports_the_environment` expects unquoted `-W 2560`, so keep `shell_quote` out of the way for values that need no quoting.

Adjust `shell_quote` usage accordingly: quote only when the value contains a character outside `[A-Za-z0-9_.:/=+-]`:

```rust
pub(crate) fn maybe_quote(value: &str) -> String {
    let safe = value
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || "_.:/=+-".contains(c));
    if safe && !value.is_empty() {
        value.to_string()
    } else {
        shell_quote(value)
    }
}
```

and use `maybe_quote` for the gamescope arguments while keeping `shell_quote` for environment values, which are always quoted so an empty value still parses.

Add `pub mod wrapper;` to `src-tauri/src/commands/mod.rs`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test wrapper:: && cargo clippy --all-targets -- -D warnings`
Expected: pass, clean.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/wrapper.rs src-tauri/src/commands/mod.rs
git commit -m "feat: generate the DZL wrapper script"
```

---

### Task 5: Importing existing launch options

**Files:**
- Modify: `src-tauri/src/commands/wrapper.rs`

**Interfaces:**
- Consumes: `WrapperConfig`, `DisplayMode`, `split_args`.
- Produces:
  - `pub enum ImportResult { Empty, AlreadyHooked, Parsed { wrapper: WrapperConfig, trailing_args: Vec<String> }, Unparseable(String) }`
  - `pub fn import_launch_options(value: &str, script_path: &str) -> ImportResult`

The grammar is deliberately narrow: leading `VAR=value` assignments, optional `gamemoderun`, optional `gamescope <flags> --`, then `%command%`, then trailing arguments. Anything else is refused rather than guessed at.

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module in `wrapper.rs`:

```rust
    #[test]
    fn imports_the_real_world_string() {
        let result = import_launch_options(
            "LD_PRELOAD=\"\" gamemoderun gamescope -W 2560 -H 1440 -f -r 180 --force-grab-cursor -- %command%",
            "/tmp/dzl-wrap.sh",
        );
        let ImportResult::Parsed { wrapper, trailing_args } = result else {
            panic!("expected a parse, got {:?}", result);
        };

        assert!(wrapper.gamemode);
        assert!(wrapper.gamescope);
        assert_eq!(wrapper.width, Some(2560));
        assert_eq!(wrapper.height, Some(1440));
        assert_eq!(wrapper.refresh, Some(180));
        assert_eq!(wrapper.display_mode, DisplayMode::Fullscreen);
        assert!(wrapper.force_grab_cursor);
        assert_eq!(wrapper.env, vec!["LD_PRELOAD=".to_string()]);
        assert_eq!(wrapper.extra_args, "");
        assert!(trailing_args.is_empty());
    }

    #[test]
    fn imports_gamescope_alone_and_keeps_unknown_flags() {
        let result = import_launch_options("gamescope -b --hdr-enabled -- %command%", "/tmp/w.sh");
        let ImportResult::Parsed { wrapper, .. } = result else { panic!("expected a parse") };

        assert!(!wrapper.gamemode);
        assert_eq!(wrapper.display_mode, DisplayMode::Borderless);
        assert_eq!(wrapper.extra_args, "--hdr-enabled");
    }

    #[test]
    fn imports_gamemode_alone() {
        let result = import_launch_options("gamemoderun %command%", "/tmp/w.sh");
        let ImportResult::Parsed { wrapper, .. } = result else { panic!("expected a parse") };
        assert!(wrapper.gamemode);
        assert!(!wrapper.gamescope);
    }

    #[test]
    fn trailing_arguments_are_kept_separately() {
        let result = import_launch_options("gamemoderun %command% -noSplash", "/tmp/w.sh");
        let ImportResult::Parsed { trailing_args, .. } = result else { panic!("expected a parse") };
        assert_eq!(trailing_args, vec!["-noSplash".to_string()]);
    }

    #[test]
    fn an_empty_value_imports_nothing() {
        assert!(matches!(import_launch_options("   ", "/tmp/w.sh"), ImportResult::Empty));
    }

    #[test]
    fn our_own_hook_is_recognised() {
        assert!(matches!(
            import_launch_options("/tmp/w.sh %command%", "/tmp/w.sh"),
            ImportResult::AlreadyHooked
        ));
    }

    #[test]
    fn anything_outside_the_grammar_is_refused() {
        for value in [
            "mangohud %command%",
            "sh -c 'gamescope -- %command%'",
            "gamemoderun %command% && echo done",
            "gamescope -f %command%",
            "gamescope -f -- steam-run %command%",
            "gamemoderun /usr/bin/something %command%",
            "gamemoderun gamescope -f --",
        ] {
            assert!(
                matches!(import_launch_options(value, "/tmp/w.sh"), ImportResult::Unparseable(_)),
                "should refuse: {}",
                value
            );
        }
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-tauri && cargo test wrapper::`
Expected: compile error, `ImportResult` does not exist.

- [ ] **Step 3: Implement**

Add to `wrapper.rs`:

```rust
/// What DZL made of the launch options Steam already held.
#[derive(Debug)]
pub enum ImportResult {
    Empty,
    AlreadyHooked,
    Parsed {
        wrapper: WrapperConfig,
        trailing_args: Vec<String>,
    },
    /// The original value, for the user to accept losing or keep.
    Unparseable(String),
}

/// Characters that mean the value is doing something we will not try to model.
const SHELL_METACHARS: &[&str] = &["&&", "||", ";", "|", "$(", "`", ">", "<"];

fn is_wrapper_binary(token: &str, name: &str) -> bool {
    token == name || token.ends_with(&format!("/{}", name))
}

pub fn import_launch_options(value: &str, script_path: &str) -> ImportResult {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return ImportResult::Empty;
    }
    if trimmed.starts_with(script_path) {
        return ImportResult::AlreadyHooked;
    }
    if SHELL_METACHARS.iter().any(|m| trimmed.contains(m)) {
        return ImportResult::Unparseable(trimmed.to_string());
    }

    let tokens = split_args(trimmed);
    let mut wrapper = WrapperConfig::default();
    let mut index = 0;

    while let Some(token) = tokens.get(index) {
        let Some((name, val)) = token.split_once('=') else { break };
        if !valid_env_name(name) || token.starts_with('-') {
            break;
        }
        wrapper.env.push(format!("{}={}", name, val));
        index += 1;
    }

    if tokens.get(index).is_some_and(|t| is_wrapper_binary(t, "gamemoderun")) {
        wrapper.gamemode = true;
        index += 1;
    }

    if tokens.get(index).is_some_and(|t| is_wrapper_binary(t, "gamescope")) {
        wrapper.gamescope = true;
        index += 1;
        let mut extra: Vec<String> = Vec::new();
        let mut closed = false;

        while let Some(token) = tokens.get(index) {
            index += 1;
            match token.as_str() {
                "--" => {
                    closed = true;
                    break;
                }
                "-f" => wrapper.display_mode = DisplayMode::Fullscreen,
                "-b" => wrapper.display_mode = DisplayMode::Borderless,
                "--force-grab-cursor" => wrapper.force_grab_cursor = true,
                "-W" | "-H" | "-r" => {
                    let Some(number) = tokens.get(index).and_then(|n| n.parse::<u32>().ok()) else {
                        return ImportResult::Unparseable(trimmed.to_string());
                    };
                    index += 1;
                    match token.as_str() {
                        "-W" => wrapper.width = Some(number),
                        "-H" => wrapper.height = Some(number),
                        _ => wrapper.refresh = Some(number),
                    }
                }
                other if other.starts_with('-') => extra.push(other.to_string()),
                // A bare word before `--` is another wrapper we cannot model.
                _ => return ImportResult::Unparseable(trimmed.to_string()),
            }
        }

        if !closed {
            return ImportResult::Unparseable(trimmed.to_string());
        }
        wrapper.extra_args = extra.join(" ");
    }

    // Windowed is the only mode gamescope cannot be told to use explicitly, so
    // an imported gamescope with neither -f nor -b means windowed.
    if wrapper.gamescope
        && !trimmed.contains(" -f")
        && !trimmed.contains(" -b")
    {
        wrapper.display_mode = DisplayMode::Windowed;
    }

    if tokens.get(index).map(String::as_str) != Some("%command%") {
        return ImportResult::Unparseable(trimmed.to_string());
    }
    index += 1;

    ImportResult::Parsed {
        wrapper,
        trailing_args: tokens[index..].to_vec(),
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test wrapper:: && cargo clippy --all-targets -- -D warnings`
Expected: pass, clean. If `gamescope -f -- steam-run %command%` slips through, tighten the check after `--`: only `%command%` may follow, which the `%command%` check already enforces.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/wrapper.rs
git commit -m "feat: import launch options already set in Steam"
```

---

### Task 6: Commands and wiring

**Files:**
- Modify: `src-tauri/src/commands/wrapper.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/commands/config.rs` (rewrite the script inside `set_config`)
- Modify: `src-tauri/src/commands/join.rs` (`wrapper_hook_ok`, rewrite the script in `run_join`)
- Modify: `src-tauri/src/commands/system.rs` (`gamemode_installed`, `gamescope_version` on `EnvironmentReport`)

**Interfaces:**
- Consumes: everything from Tasks 1 to 5.
- Produces:
  - `pub struct WrapperStatus { hook: HookState, launch_options: Option<String>, script_path: String, expected_hook: String, preview: String, account_id: Option<String>, steam_running: bool, gamescope_installed: bool, gamescope_version: Option<String>, gamemode_installed: bool }`
  - `pub enum HookState { NotInstalled, Installed, Changed, Unreadable }`
  - `pub(crate) fn script_path(app: &tauri::AppHandle) -> Result<PathBuf, String>`
  - `pub(crate) fn write_script(app: &tauri::AppHandle, config: &AppConfig) -> Result<PathBuf, String>`
  - commands `get_wrapper_status`, `install_wrapper_hook(replace: bool)`, `remove_wrapper_hook`
  - `JoinRequirements.wrapper_hook_ok: bool`

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module in `wrapper.rs`:

```rust
    #[test]
    fn hook_state_compares_against_the_expected_line() {
        let expected = "/home/u/.local/share/com.dzl.launcher/dzl-wrap.sh %command%";
        assert_eq!(hook_state(None, expected), HookState::NotInstalled);
        assert_eq!(hook_state(Some(""), expected), HookState::NotInstalled);
        assert_eq!(hook_state(Some(expected), expected), HookState::Installed);
        assert_eq!(
            hook_state(Some("gamescope -f -- %command%"), expected),
            HookState::Changed
        );
    }

    #[test]
    fn the_hook_is_only_needed_when_a_wrapper_is_enabled() {
        assert!(hook_satisfied(&WrapperConfig::default(), HookState::NotInstalled));

        let on = WrapperConfig { gamescope: true, ..WrapperConfig::default() };
        assert!(!hook_satisfied(&on, HookState::NotInstalled));
        assert!(!hook_satisfied(&on, HookState::Changed));
        assert!(hook_satisfied(&on, HookState::Installed));
    }
```

Add to the `tests` module in `join.rs`:

```rust
    #[test]
    fn requirements_report_the_wrapper_hook() {
        let base = tmp_dir("wrapper");
        let config = AppConfig {
            steam_path: Some(base.to_str().unwrap().to_string()),
            player_name: Some("Survivor".into()),
            ..AppConfig::default()
        };

        // Wrappers off: nothing to warn about, whatever Steam holds.
        let off = check_requirements_logic(&config, &[], 1_048_576, false, false);
        assert!(off.wrapper_hook_ok);

        let mut wants_wrapper = config.clone();
        wants_wrapper.wrapper.gamescope = true;
        let missing = check_requirements_logic(&wants_wrapper, &[], 1_048_576, false, false);
        assert!(!missing.wrapper_hook_ok, "gamescope is on but Steam has no hook");

        let hooked = check_requirements_logic(&wants_wrapper, &[], 1_048_576, false, true);
        assert!(hooked.wrapper_hook_ok);

        fs::remove_dir_all(&base).unwrap();
    }
```

`check_requirements_logic` gains a final `hook_installed: bool` parameter, so update the five existing call sites in that test module to pass `false`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-tauri && cargo test`
Expected: compile errors for `hook_state`, `hook_satisfied`, `wrapper_hook_ok` and the new parameter.

- [ ] **Step 3: Implement**

In `wrapper.rs`:

```rust
use crate::commands::system::{binary_exists, detect_steam_path, steam_root, steam_running, DAYZ_APP_ID};
use crate::steam_vdf::{find_local_config, read_launch_options, write_launch_options, LocalConfig};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Manager;

const SCRIPT_NAME: &str = "dzl-wrap.sh";

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum HookState {
    NotInstalled,
    Installed,
    /// Steam holds something else, so the user changed it outside DZL.
    Changed,
    /// Steam's config could not be read at all.
    Unreadable,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WrapperStatus {
    pub hook: HookState,
    pub launch_options: Option<String>,
    pub script_path: String,
    pub expected_hook: String,
    pub preview: String,
    pub account_id: Option<String>,
    pub steam_running: bool,
    pub gamescope_installed: bool,
    pub gamescope_version: Option<String>,
    pub gamemode_installed: bool,
}

pub(crate) fn hook_state(current: Option<&str>, expected: &str) -> HookState {
    match current.map(str::trim) {
        None | Some("") => HookState::NotInstalled,
        Some(value) if value == expected => HookState::Installed,
        Some(_) => HookState::Changed,
    }
}

/// Whether the settings can actually take effect.
pub(crate) fn hook_satisfied(wrapper: &WrapperConfig, state: HookState) -> bool {
    if !wrapper.gamemode && !wrapper.gamescope {
        return true;
    }
    state == HookState::Installed
}

pub(crate) fn script_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no-data-dir: {}", e))?;
    Ok(dir.join(SCRIPT_NAME))
}

fn expected_hook(path: &std::path::Path) -> String {
    format!("{} %command%", path.display())
}

/// Writes the script for the current settings and makes it executable.
pub(crate) fn write_script(app: &tauri::AppHandle, config: &AppConfig) -> Result<PathBuf, String> {
    let path = script_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("script-failed: {}", e))?;
    }
    std::fs::write(&path, wrapper_script(&config.wrapper))
        .map_err(|e| format!("script-failed: {}: {}", path.display(), e))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| format!("script-failed: {}", e))?;
    }

    Ok(path)
}

fn local_config(config: &AppConfig) -> Result<LocalConfig, String> {
    let steam_path = config
        .steam_path
        .clone()
        .filter(|p| std::path::Path::new(p).is_dir())
        .or_else(detect_steam_path)
        .ok_or_else(|| "no-steam-path: could not find your Steam library".to_string())?;
    find_local_config(&steam_root(&steam_path))
}

/// Reads what Steam currently holds for DayZ. `Ok(None)` means the file was
/// readable and simply had no value.
pub(crate) fn current_launch_options(config: &AppConfig) -> Result<Option<String>, String> {
    let found = local_config(config)?;
    let text = std::fs::read_to_string(&found.path)
        .map_err(|e| format!("read-failed: {}: {}", found.path.display(), e))?;
    Ok(read_launch_options(&text, DAYZ_APP_ID))
}

fn gamescope_version() -> Option<String> {
    let output = crate::commands::system::external_command("gamescope")
        .arg("--version")
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout).to_string()
        + &String::from_utf8_lossy(&output.stderr);
    // "gamescope version 3.16.25 (gcc 16.1.1)"
    text.split_whitespace()
        .skip_while(|w| *w != "version")
        .nth(1)
        .map(|v| v.to_string())
}

fn status(app: &tauri::AppHandle, config: &AppConfig) -> WrapperStatus {
    let path = script_path(app).unwrap_or_else(|_| PathBuf::from(SCRIPT_NAME));
    let expected = expected_hook(&path);
    let (hook, launch_options, account_id) = match local_config(config) {
        Ok(found) => match std::fs::read_to_string(&found.path) {
            Ok(text) => {
                let current = read_launch_options(&text, DAYZ_APP_ID);
                (
                    hook_state(current.as_deref(), &expected),
                    current,
                    Some(found.account_id),
                )
            }
            Err(_) => (HookState::Unreadable, None, Some(found.account_id)),
        },
        Err(_) => (HookState::Unreadable, None, None),
    };

    WrapperStatus {
        hook,
        launch_options,
        script_path: path.display().to_string(),
        expected_hook: expected,
        preview: preview_line(&config.wrapper),
        account_id,
        steam_running: steam_running(),
        gamescope_installed: binary_exists("gamescope"),
        gamescope_version: gamescope_version(),
        gamemode_installed: binary_exists("gamemoderun"),
    }
}

#[tauri::command]
pub fn get_wrapper_status(app: tauri::AppHandle) -> WrapperStatus {
    let config = crate::commands::config::read_config(&app);
    status(&app, &config)
}

/// Points Steam's launch options at our script, importing whatever was there.
///
/// Steam holds this file in memory and writes it back on exit, so the client
/// has to be down for the edit to survive. `replace` is the user's answer to
/// launch options DZL could not parse.
#[tauri::command]
pub async fn install_wrapper_hook(
    app: tauri::AppHandle,
    replace: bool,
) -> Result<WrapperStatus, String> {
    let mut config = crate::commands::config::read_config(&app);
    let found = local_config(&config)?;
    let path = script_path(&app)?;
    let expected = expected_hook(&path);

    let text = std::fs::read_to_string(&found.path)
        .map_err(|e| format!("read-failed: {}: {}", found.path.display(), e))?;
    let current = read_launch_options(&text, DAYZ_APP_ID);

    match import_launch_options(current.as_deref().unwrap_or(""), &path.display().to_string()) {
        ImportResult::Empty | ImportResult::AlreadyHooked => {}
        ImportResult::Parsed {
            wrapper,
            trailing_args,
        } => {
            config.wrapper = WrapperConfig {
                previous_launch_options: current.clone(),
                ..wrapper
            };
            for arg in trailing_args {
                if !config.custom_args.contains(&arg) {
                    config.custom_args.push(arg);
                }
            }
        }
        ImportResult::Unparseable(original) => {
            if !replace {
                return Err(format!("import-conflict: {}", original));
            }
            config.wrapper.previous_launch_options = current.clone();
        }
    }

    write_script(&app, &config)?;

    let restart = steam_running();
    if restart {
        crate::commands::system::shutdown_steam().await?;
    }
    let write = write_launch_options(&found, DAYZ_APP_ID, &expected);
    if restart {
        crate::commands::system::start_steam().await?;
    }
    write?;

    crate::commands::config::save_config(&app, &config)?;
    Ok(status(&app, &config))
}

/// Puts back whatever Steam held before DZL hooked it, and deletes the script.
#[tauri::command]
pub async fn remove_wrapper_hook(app: tauri::AppHandle) -> Result<WrapperStatus, String> {
    let mut config = crate::commands::config::read_config(&app);
    let found = local_config(&config)?;
    let restore = config.wrapper.previous_launch_options.clone().unwrap_or_default();

    let restart = steam_running();
    if restart {
        crate::commands::system::shutdown_steam().await?;
    }
    let write = write_launch_options(&found, DAYZ_APP_ID, &restore);
    if restart {
        crate::commands::system::start_steam().await?;
    }
    write?;

    if let Ok(path) = script_path(&app) {
        let _ = std::fs::remove_file(path);
    }
    config.wrapper.previous_launch_options = None;
    crate::commands::config::save_config(&app, &config)?;
    Ok(status(&app, &config))
}
```

In `config.rs`: rename the private `write_config` to `pub(crate) fn save_config`, keep its behaviour, update its callers, and have `set_config` regenerate the script after saving so config and script cannot drift:

```rust
#[tauri::command]
pub fn set_config(app: tauri::AppHandle, config: AppConfig) -> Result<AppConfig, String> {
    let mut config = config;
    config.launch_options = merge_launch_options(&config.launch_options);
    save_config(&app, &config)?;
    // Best effort: a settings save must not fail because the script could not
    // be written, but the wrapper section surfaces the problem on its next read.
    let _ = crate::commands::wrapper::write_script(&app, &config);
    Ok(config)
}
```

In `join.rs`: add `pub wrapper_hook_ok: bool` to `JoinRequirements`, add the `hook_installed: bool` parameter to `check_requirements_logic`, set the field with `crate::commands::wrapper::hook_satisfied(&config.wrapper, if hook_installed { HookState::Installed } else { HookState::NotInstalled })`, and in `check_join_requirements` compute `hook_installed` from `current_launch_options(&config)` compared against the expected hook. In `run_join`, call `write_script(app, &config)` right before `spawn_steam`, ignoring the error the same way `set_config` does.

In `system.rs`: add `pub gamemode_installed: bool` to `EnvironmentReport`, filled with `binary_exists("gamemoderun")`, and make `binary_exists` and `external_command` visible to `wrapper.rs` if they are not already.

In `lib.rs`: register `commands::wrapper::get_wrapper_status`, `commands::wrapper::install_wrapper_hook` and `commands::wrapper::remove_wrapper_hook`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings`
Expected: the whole Rust suite passes, clippy clean.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src
git commit -m "feat: install and report the wrapper hook"
```

---

### Task 7: Settings surface

**Files:**
- Create: `src/components/WrapperSettings.tsx`
- Create: `src/components/wrapperSettings.test.tsx`
- Modify: `src/types/launcher.ts`
- Modify: `src/components/SettingsPage.tsx`

**Interfaces:**
- Consumes: the three commands from Task 6, `AppConfig.wrapper`.
- Produces: `export function WrapperSettings({ config, save }: { config: AppConfig; save: (patch: Partial<AppConfig>) => Promise<AppConfig | null> })`.

- [ ] **Step 1: Write the failing tests**

Create `src/components/wrapperSettings.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { WrapperSettings } from "./WrapperSettings";
import type { AppConfig, WrapperStatus } from "../types/launcher";

const mockInvoke = vi.mocked(invoke);

const status = (patch: Partial<WrapperStatus> = {}): WrapperStatus => ({
  hook: "notInstalled",
  launchOptions: null,
  scriptPath: "/home/u/.local/share/com.dzl.launcher/dzl-wrap.sh",
  expectedHook: "/home/u/.local/share/com.dzl.launcher/dzl-wrap.sh %command%",
  preview: "%command%",
  accountId: "419704515",
  steamRunning: false,
  gamescopeInstalled: true,
  gamescopeVersion: "3.16.25",
  gamemodeInstalled: true,
  ...patch,
});

const config = (patch: Partial<AppConfig["wrapper"]> = {}): AppConfig =>
  ({
    steamPath: null,
    playerName: "Survivor",
    steamLogin: null,
    useSteamcmd: true,
    killRunningDayz: true,
    updateModsOnJoin: false,
    hideToTrayOnLaunch: false,
    launchOptions: [],
    customArgs: [],
    setupComplete: true,
    wrapper: {
      gamemode: false,
      gamescope: false,
      width: null,
      height: null,
      refresh: null,
      displayMode: "fullscreen",
      forceGrabCursor: false,
      extraArgs: "",
      env: [],
      previousLaunchOptions: null,
      ...patch,
    },
  }) as AppConfig;

describe("WrapperSettings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports what it found on the machine", async () => {
    mockInvoke.mockResolvedValue(status());
    render(<WrapperSettings config={config()} save={vi.fn()} />);

    await waitFor(() => screen.getByText(/3\.16\.25/));
    expect(screen.getByText(/GameMode/)).toBeTruthy();
  });

  it("hides the gamescope fields until gamescope is on", async () => {
    mockInvoke.mockResolvedValue(status());
    const { rerender } = render(<WrapperSettings config={config()} save={vi.fn()} />);

    await waitFor(() => screen.getByText(/3\.16\.25/));
    expect(screen.queryByLabelText(/width/i)).toBeNull();

    rerender(<WrapperSettings config={config({ gamescope: true })} save={vi.fn()} />);
    expect(screen.getByLabelText(/width/i)).toBeTruthy();
  });

  it("disables a wrapper whose binary is missing", async () => {
    mockInvoke.mockResolvedValue(status({ gamescopeInstalled: false, gamescopeVersion: null }));
    render(<WrapperSettings config={config()} save={vi.fn()} />);

    await waitFor(() => screen.getByText(/not on PATH/i));
    expect(screen.getByRole("checkbox", { name: /gamescope/i })).toHaveProperty("disabled", true);
  });

  it("installs the hook when asked", async () => {
    mockInvoke.mockResolvedValue(status());
    render(<WrapperSettings config={config({ gamescope: true })} save={vi.fn()} />);

    await waitFor(() => screen.getByRole("button", { name: /install/i }));
    screen.getByRole("button", { name: /install/i }).click();

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("install_wrapper_hook", { replace: false }),
    );
  });

  it("asks before replacing launch options it could not read", async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "get_wrapper_status") return status({ launchOptions: "mangohud %command%" });
      throw new Error("import-conflict: mangohud %command%");
    });
    render(<WrapperSettings config={config({ gamescope: true })} save={vi.fn()} />);

    await waitFor(() => screen.getByRole("button", { name: /install/i }));
    screen.getByRole("button", { name: /install/i }).click();

    await waitFor(() => screen.getByText(/mangohud %command%/));
    screen.getByRole("button", { name: /replace/i }).click();

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("install_wrapper_hook", { replace: true }),
    );
  });

  it("warns when Steam holds something DZL did not write", async () => {
    mockInvoke.mockResolvedValue(
      status({ hook: "changed", launchOptions: "gamescope -f -- %command%" }),
    );
    render(<WrapperSettings config={config({ gamescope: true })} save={vi.fn()} />);

    await waitFor(() => screen.getByText(/changed outside/i));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- wrapperSettings`
Expected: FAIL, `./WrapperSettings` cannot be resolved.

- [ ] **Step 3: Implement**

Add to `src/types/launcher.ts`:

```ts
export type DisplayMode = "fullscreen" | "borderless" | "windowed";

export interface WrapperConfig {
  gamemode: boolean;
  gamescope: boolean;
  width: number | null;
  height: number | null;
  refresh: number | null;
  displayMode: DisplayMode;
  forceGrabCursor: boolean;
  extraArgs: string;
  env: string[];
  previousLaunchOptions: string | null;
}

export type HookState = "notInstalled" | "installed" | "changed" | "unreadable";

export interface WrapperStatus {
  hook: HookState;
  launchOptions: string | null;
  scriptPath: string;
  expectedHook: string;
  preview: string;
  accountId: string | null;
  steamRunning: boolean;
  gamescopeInstalled: boolean;
  gamescopeVersion: string | null;
  gamemodeInstalled: boolean;
}
```

and `wrapper: WrapperConfig;` to `AppConfig`, plus `gamemodeInstalled: boolean;` to `EnvironmentReport`.

Write `src/components/WrapperSettings.tsx` using the existing primitives (`Banner`, `Button`, `CheckRow`, `Code`, `Field`, `Select`, `SegmentedControl`, `Spinner`, `TextInput`). Structure:

- `useEffect` loads `get_wrapper_status` on mount and after every mutation; keep it in state with a `refresh()` callback.
- A hook row: the state in words, the account it belongs to, and an Install or Reinstall button. Disabled with an explanation when neither binary is present. When `steamRunning` is true the button's confirmation copy says Steam will be closed and restarted.
- Detection rows for GameMode and gamescope, mirroring `StatusRow` from `SettingsPage.tsx`. Because that helper is local to `SettingsPage`, export it from `SettingsPage.tsx` and import it here rather than duplicating it.
- `CheckRow` for GameMode and gamescope, each `disabled` when its binary is missing, calling `save({ wrapper: { ...config.wrapper, gamemode } })`.
- When `config.wrapper.gamescope`, render `Field`-wrapped numeric inputs labelled Width, Height and Refresh rate (`aria-label` matching those words so the tests find them), a `SegmentedControl` for the display mode, a `CheckRow` for Force grab cursor, and a `TextInput` for extra arguments.
- The preview from `status.preview` inside `<Code>`.
- Install errors starting with `import-conflict:` set a piece of state holding the original string; render it in a `Banner` with Replace and Cancel buttons, where Replace calls `install_wrapper_hook` with `replace: true`.
- A `Banner` when `hook === "changed"` explaining Steam's launch options were changed outside DZL and offering Reinstall, and a Remove button when the hook is installed.

Render `<WrapperSettings config={config} save={save} />` inside a new `Section` in `SettingsPage.tsx`, titled "Wrappers" with the description "gamescope and GameMode, applied by a script DZL hooks into Steam.", placed directly after the Launch options section.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test && npm run build`
Expected: the new suite passes, typecheck and bundle succeed.

- [ ] **Step 5: Commit**

```bash
git add src/components/WrapperSettings.tsx src/components/wrapperSettings.test.tsx src/types/launcher.ts src/components/SettingsPage.tsx
git commit -m "feat: configure gamescope and GameMode in settings"
```

---

### Task 8: Warnings in the places people get it wrong

**Files:**
- Create: `src/utils/wrapperArgs.ts`, `src/utils/wrapperArgs.test.ts`
- Modify: `src/components/SettingsPage.tsx`
- Modify: `src/components/JoinModal.tsx`

**Interfaces:**
- Consumes: `JoinRequirements.wrapperHookOk` from Task 6.
- Produces: `export function wrapperTokensIn(value: string): string[]`.

This is the fix for the failure that started the work: a wrapper pasted into Extra arguments reaches DayZ as literal arguments and is ignored.

- [ ] **Step 1: Write the failing test**

Create `src/utils/wrapperArgs.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { wrapperTokensIn } from "./wrapperArgs";

describe("wrapperTokensIn", () => {
  it("spots a wrapper pasted into the arguments field", () => {
    expect(
      wrapperTokensIn(
        'LD_PRELOAD="" gamemoderun gamescope -W 2560 -H 1440 -f -- %command%',
      ),
    ).toEqual(["gamemoderun", "gamescope", "%command%"]);
  });

  it("finds mangohud too", () => {
    expect(wrapperTokensIn("mangohud %command%")).toEqual(["mangohud", "%command%"]);
  });

  it("says nothing about ordinary DayZ arguments", () => {
    expect(wrapperTokensIn("-newUI -noSplash -world=empty")).toEqual([]);
  });

  it("ignores case and surrounding punctuation", () => {
    expect(wrapperTokensIn("GameScope -f")).toEqual(["gamescope"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- wrapperArgs`
Expected: FAIL, `./wrapperArgs` cannot be resolved.

- [ ] **Step 3: Implement**

Create `src/utils/wrapperArgs.ts`:

```ts
/**
 * Wrapper commands belong in the Wrappers section, not in the arguments DZL
 * passes to DayZ. Pasted here they reach the game as literal arguments and are
 * ignored, which looks exactly like the launcher dropping them.
 */
const WRAPPER_TOKENS = ["gamemoderun", "gamescope", "mangohud", "%command%"];

export function wrapperTokensIn(value: string): string[] {
  const haystack = value.toLowerCase();
  return WRAPPER_TOKENS.filter((token) => haystack.includes(token));
}
```

In `SettingsPage.tsx`, under the Extra arguments `Field`, render a warning when `wrapperTokensIn(customArgs).length > 0`:

```tsx
{wrapperTokensIn(customArgs).length > 0 && (
  <Banner tone="warn" title="Those are wrapper commands">
    {wrapperTokensIn(customArgs).join(", ")} run <em>around</em> the game, so DayZ
    receives them as ordinary arguments and ignores them. Set them up in the
    Wrappers section instead; MangoHud goes in its environment rows as{" "}
    <code>MANGOHUD=1</code>.
  </Banner>
)}
```

In `JoinModal.tsx`, inside the confirm view, render a non-blocking banner when `requirements.wrapperHookOk === false`:

```tsx
{!requirements.wrapperHookOk && (
  <Banner tone="warn" title="Wrapper settings are not active">
    gamescope or GameMode is switched on in settings, but Steam's launch options
    no longer point at DZL's script, so the game will start without them. Open
    Settings and reinstall the hook.
  </Banner>
)}
```

Add `wrapperHookOk: boolean;` to the `JoinRequirements` interface in `src/types/launcher.ts`, and add it to any `JoinRequirements` fixture in `src/hooks/useJoinServer.test.ts` that fails to typecheck.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test && npm run build`
Expected: pass, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/utils/wrapperArgs.ts src/utils/wrapperArgs.test.ts src/components/SettingsPage.tsx src/components/JoinModal.tsx src/types/launcher.ts src/hooks/useJoinServer.test.ts
git commit -m "feat: warn when wrapper commands go in the wrong field"
```

---

### Task 9: Documentation and full verification

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-26-gamescope-gamemode-wrapper-design.md` (correct the account-resolution note from Task 2)

- [ ] **Step 1: Document the feature**

Add to the README's feature list, under a heading that matches the existing style:

```markdown
**Wrappers**
- gamescope and GameMode configured in the launcher: resolution, refresh rate,
  fullscreen or borderless, force grab cursor, plus free-form gamescope
  arguments and environment variables
- Set up once by hooking Steam's launch options for DayZ at a script DZL
  generates, so later changes need no Steam restart. Existing launch options are
  imported and can be restored
- Because the hook lives in Steam's launch options, launching DayZ from Steam
  itself picks up the same settings
```

Correct the spec's Install section: current Steam does not write `MostRecent` into `loginusers.vdf`, so account resolution is single-account first, then `MostRecent` if present, then newest `localconfig.vdf` by mtime.

- [ ] **Step 2: Run everything CI runs**

```sh
npm test
npm run build
cd src-tauri && cargo test
cargo clippy --all-targets -- -D warnings
```

Expected: all green.

- [ ] **Step 3: Manual check against the real machine**

Run `npm run tauri dev`, then in Settings under Wrappers confirm the import of the existing string produces gamescope on, 2560x1440, 180Hz, fullscreen and force grab cursor, install the hook, and verify:

```sh
grep -A2 '"221100"' ~/.steam/steam/userdata/*/config/localconfig.vdf | grep LaunchOptions
cat ~/.local/share/com.dzl.launcher/dzl-wrap.sh
```

Then join a server from DZL and, while the game loads, confirm the wrapper really reached gamescope:

```sh
pgrep -af gamescope
```

Expected: the argv shows `-W 2560 -H 1440 -r 180 -f --force-grab-cursor`. This is the check that answers the original question about `--force-grab-cursor`.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/superpowers/specs
git commit -m "docs: describe gamescope and GameMode support"
```

---

## Self-Review Notes

Spec coverage: the hook (Tasks 1, 2, 6), the script (Task 4), config schema (Task 3), settings surface (Task 7), import and removal (Tasks 5, 6), failure handling and drift (Tasks 2, 6, 8), the custom-args warning (Task 8), testing (throughout), documentation and the known scope change (Task 9).

Two deliberate deviations from the spec, both recorded in Task 9's spec correction:
1. Account resolution puts single-account and mtime ahead of `MostRecent`, because current Steam does not write that key.
2. The spec's failure path of showing the hook line for manual pasting is covered by `WrapperStatus.expectedHook` always being rendered in the Wrappers section, rather than only on shutdown failure. It costs nothing and is more useful.
