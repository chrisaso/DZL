use crate::commands::system::{binary_exists, workshop_dir, DAYZ_APP_ID};
use serde::{Deserialize, Serialize};

/// Result of probing steamcmd's cached credentials.
///
/// The launcher never handles passwords. steamcmd caches its own login token
/// after a one-time interactive `steamcmd +login <user> +quit` in a terminal; all we
/// do is verify that token still works.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LoginStatus {
    pub installed: bool,
    pub logged_in: bool,
    /// Machine-readable reason: ok, not-installed, no-account, needs-login,
    /// needs-steam-guard, rate-limited, invalid-password, timeout, unknown.
    pub reason: String,
    pub message: String,
    /// The command the user should run in a terminal to fix things.
    pub fix_command: Option<String>,
}

/// The one-time sign-in the user has to run themselves, in the single place it
/// is defined so every message shows the same thing.
///
/// `+quit` matters: without it steamcmd stays in its interactive prompt after
/// logging in, and it is not obvious that you are meant to type `quit`.
pub(crate) fn login_command(login: &str) -> String {
    format!("steamcmd +login {} +quit", login)
}

fn base_args(login: &str) -> Vec<String> {
    vec![
        "+@ShutdownOnFailedCommand".into(),
        "1".into(),
        // Fail instead of blocking on an interactive password prompt; the GUI
        // has no terminal to answer it.
        "+@NoPromptForPassword".into(),
        "1".into(),
        "+login".into(),
        login.into(),
    ]
}

/// Removes the colour escapes steamcmd sprays through its output, including
/// mid-word ones like `Waiting for user info...\x1b[0mOK` that otherwise break
/// any attempt to match a phrase.
pub(crate) fn strip_ansi(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars();

    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            // Skip to the final byte of the escape sequence.
            for next in chars.by_ref() {
                if next.is_ascii_alphabetic() || next == '~' || next == '@' {
                    break;
                }
            }
        } else {
            out.push(c);
        }
    }

    out
}

/// Classifies steamcmd's console output after a login attempt.
///
/// Failures are checked before successes, and each marker has to be specific:
/// "cached credential" alone matches "Logging in using cached credentials",
/// which is what steamcmd says when the login *works*.
pub(crate) fn parse_login_output(output: &str, success: bool) -> (bool, &'static str, String) {
    let lower = strip_ansi(output).to_lowercase();

    if lower.contains("two-factor") || lower.contains("steam guard") {
        return (
            false,
            "needs-steam-guard",
            "Steam Guard needs a code — sign in once in a terminal".into(),
        );
    }
    if lower.contains("invalid password") {
        return (
            false,
            "invalid-password",
            "Steam rejected the stored credentials — sign in again in a terminal".into(),
        );
    }
    if lower.contains("rate limit") {
        return (
            false,
            "rate-limited",
            "Steam is rate limiting logins — wait a few minutes and retry".into(),
        );
    }
    if lower.contains("cached credentials not found")
        || lower.contains("no cached credentials")
        || lower.contains("login failure")
        || (lower.contains("failed (") && lower.contains("login"))
    {
        return (
            false,
            "needs-login",
            "No cached credentials — sign in once in a terminal".into(),
        );
    }

    // Nothing went wrong, so look for proof it went right.
    let signed_in = lower.contains("logged in ok")
        || lower.contains("waiting for user info...ok")
        || lower.contains("to steam public...ok")
        || lower.contains("logging in using cached credentials");

    if success && signed_in {
        return (true, "ok", "Signed in and ready to download mods".into());
    }
    if success {
        // Clean exit without a recognisable banner; steamcmd changes its
        // wording between versions, so trust the exit code.
        return (true, "ok", "steamcmd login accepted".into());
    }

    (
        false,
        "unknown",
        "steamcmd could not log in — sign in once in a terminal".into(),
    )
}

/// Verifies that steamcmd can log in non-interactively with cached credentials.
#[tauri::command]
pub async fn check_steamcmd_login(login: Option<String>) -> LoginStatus {
    if !binary_exists("steamcmd") {
        return LoginStatus {
            installed: false,
            logged_in: false,
            reason: "not-installed".into(),
            message: "steamcmd is not installed or not on PATH".into(),
            fix_command: None,
        };
    }

    let login = match login
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
    {
        Some(l) => l,
        None => {
            return LoginStatus {
                installed: true,
                logged_in: false,
                reason: "no-account".into(),
                message: "Set your Steam account name — anonymous cannot download DayZ mods".into(),
                fix_command: None,
            }
        }
    };

    let fix_command = Some(login_command(&login));

    let mut args = base_args(&login);
    args.push("+quit".into());

    let run = tokio::time::timeout(
        std::time::Duration::from_secs(120),
        crate::commands::system::external_command_async("steamcmd")
            .args(&args)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .output(),
    )
    .await;

    let output = match run {
        Err(_) => {
            return LoginStatus {
                installed: true,
                logged_in: false,
                reason: "timeout".into(),
                message: "steamcmd timed out — sign in once in a terminal".into(),
                fix_command,
            }
        }
        Ok(Err(e)) => {
            return LoginStatus {
                installed: true,
                logged_in: false,
                reason: "unknown".into(),
                message: format!("Could not run steamcmd: {}", e),
                fix_command,
            }
        }
        Ok(Ok(out)) => out,
    };

    let combined = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let (logged_in, reason, message) = parse_login_output(&combined, output.status.success());

    LoginStatus {
        installed: true,
        logged_in,
        reason: reason.into(),
        message,
        fix_command: if logged_in { None } else { fix_command },
    }
}

/// Extracts the percentage from steamcmd's `progress: 42.53 (n / n)` lines.
pub(crate) fn parse_progress_percent(line: &str) -> Option<f32> {
    let rest = line.split("progress:").nth(1)?.trim_start();
    let number: String = rest
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    number.parse().ok()
}

/// Extracts the install path from `Success. Downloaded item 123 to "/path" ...`.
pub(crate) fn parse_download_path(line: &str) -> Option<String> {
    if !line.contains("Downloaded item") {
        return None;
    }
    let start = line.find('"')? + 1;
    let end = line[start..].find('"')? + start;
    Some(line[start..end].to_string())
}

/// True when a steamcmd line reports a failed workshop download.
pub(crate) fn is_download_failure(line: &str) -> bool {
    let lower = line.to_lowercase();
    lower.contains("error!") && lower.contains("download item")
}

/// True when a line shows steamcmd could not authenticate.
pub(crate) fn is_login_failure(line: &str) -> bool {
    let lower = line.to_lowercase();
    lower.contains("cached credentials not found")
        || lower.contains("no cached credentials")
        || lower.contains("invalid password")
        || lower.contains("login failure")
}

/// steamcmd exits 5 on any login problem, which is by far the most common way
/// a download fails: the account name is set in the launcher, but nobody has
/// done the one-time terminal sign-in that caches the token.
const EXIT_LOGIN_FAILURE: i32 = 5;

/// Turns a steamcmd failure into something a user can act on. The leading
/// code is machine-readable so the UI can offer the right fix.
pub(crate) fn classify_failure(
    exit_code: i32,
    saw_login_failure: bool,
    reported_error: Option<&str>,
    login: &str,
    workshop_id: &str,
) -> String {
    if saw_login_failure || exit_code == EXIT_LOGIN_FAILURE {
        return format!(
            "steamcmd-login-required: steamcmd is not signed in as {}. Run \
             `{}` once in a terminal, finish any Steam Guard prompt, then try \
             again.",
            login,
            login_command(login)
        );
    }

    if let Some(error) = reported_error {
        return format!("steamcmd-failed: {}", error);
    }

    format!(
        "steamcmd-failed: exit {} while downloading {}. Check that the mod is \
         still on the Workshop and that you have disk space.",
        exit_code, workshop_id
    )
}

/// Turns a raw steamcmd chunk into displayable lines. steamcmd redraws
/// progress with carriage returns, so a single `\n` line can carry many
/// updates, so keep the last one.
pub(crate) fn last_segment(chunk: &str) -> &str {
    chunk.rsplit('\r').next().unwrap_or(chunk).trim()
}

/// A steamcmd output line ready to show a human: newest redraw only, and no
/// colour escapes, which otherwise reach the UI as literal `[0m` garbage.
pub(crate) fn clean_line(raw: &str) -> String {
    strip_ansi(last_segment(raw)).trim().to_string()
}

/// Where a workshop item may have landed. steamcmd downloads into whichever
/// Steam root it resolves, which is not always the library the game lives in.
pub(crate) fn download_search_paths(
    steam_path: &str,
    home: &str,
    workshop_id: &str,
) -> Vec<String> {
    let mut roots = vec![workshop_dir(steam_path).to_string_lossy().to_string()];
    for base in [
        format!("{}/.steam/steamcmd/steamapps", home),
        format!("{}/.steam/root/steamapps", home),
        format!("{}/.steam/steam/steamapps", home),
        format!("{}/.local/share/Steam/steamapps", home),
        format!("{}/Steam/steamapps", home),
    ] {
        let candidate = format!("{}/workshop/content/{}", base, DAYZ_APP_ID);
        if !roots.contains(&candidate) {
            roots.push(candidate);
        }
    }
    roots
        .into_iter()
        .map(|r| format!("{}/{}", r, workshop_id))
        .collect()
}

/// Ensures a freshly downloaded mod ends up in the library the game reads from,
/// moving it there if steamcmd used a different Steam root.
pub(crate) fn consolidate_download(
    steam_path: &str,
    workshop_id: &str,
    reported_path: Option<&str>,
) -> Result<(), String> {
    let home = std::env::var("HOME").unwrap_or_default();
    consolidate_download_from(steam_path, workshop_id, &home, reported_path)
}

/// Testable core of [`consolidate_download`] with the home directory injected
/// rather than read from the environment.
///
/// `reported_path` is the location steamcmd printed on success, which beats
/// guessing when the user has an unusual Steam root.
pub(crate) fn consolidate_download_from(
    steam_path: &str,
    workshop_id: &str,
    home: &str,
    reported_path: Option<&str>,
) -> Result<(), String> {
    let target = workshop_dir(steam_path).join(workshop_id);
    if target.is_dir() {
        return Ok(());
    }

    let found = reported_path
        .map(String::from)
        .into_iter()
        .chain(download_search_paths(steam_path, home, workshop_id))
        .map(std::path::PathBuf::from)
        .find(|p| p.is_dir())
        .ok_or_else(|| {
            format!(
                "download-missing: steamcmd reported success but {} is not in the library",
                workshop_id
            )
        })?;

    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("consolidate-failed: {}: {}", workshop_id, e))?;
    }

    // Same filesystem: a rename is instant. Across filesystems it fails with
    // CrossesDevices, so fall back to a copy.
    if std::fs::rename(&found, &target).is_ok() {
        return Ok(());
    }

    copy_dir_recursive(&found, &target)
        .map_err(|e| format!("consolidate-failed: {}: {}", workshop_id, e))?;
    let _ = std::fs::remove_dir_all(&found);
    Ok(())
}

fn copy_dir_recursive(from: &std::path::Path, to: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let dest = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&entry.path(), &dest)?;
        } else {
            std::fs::copy(entry.path(), dest)?;
        }
    }
    Ok(())
}

/// Downloads or updates a single workshop item, streaming steamcmd's output
/// back through `on_line` so the UI can show live progress.
pub(crate) async fn download_workshop_item<F>(
    login: &str,
    workshop_id: &str,
    steam_path: &str,
    mut on_line: F,
) -> Result<(), String>
where
    F: FnMut(&str, Option<f32>),
{
    use tokio::io::AsyncBufReadExt;

    if !binary_exists("steamcmd") {
        return Err("steamcmd-not-found: steamcmd is not installed or not on PATH".to_string());
    }

    let mut args = base_args(login);
    args.extend([
        "+workshop_download_item".to_string(),
        DAYZ_APP_ID.to_string(),
        workshop_id.to_string(),
        "validate".to_string(),
        "+quit".to_string(),
    ]);

    let mut child = crate::commands::system::external_command_async("steamcmd")
        .args(&args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("steamcmd-not-found: {}", e))?;

    let mut failure: Option<String> = None;
    let mut reported_path: Option<String> = None;
    let mut login_failed = false;

    if let Some(stdout) = child.stdout.take() {
        let mut lines = tokio::io::BufReader::new(stdout).lines();
        while let Ok(Some(raw)) = lines.next_line().await {
            let cleaned = clean_line(&raw);
            let line = cleaned.as_str();
            if line.is_empty() {
                continue;
            }
            if is_download_failure(line) {
                failure = Some(line.to_string());
            }
            if is_login_failure(line) {
                login_failed = true;
            }
            if let Some(path) = parse_download_path(line) {
                reported_path = Some(path);
            }
            on_line(line, parse_progress_percent(line));
        }
    }

    let status = child.wait().await.map_err(|e| e.to_string())?;

    if failure.is_some() || login_failed || !status.success() {
        return Err(classify_failure(
            status.code().unwrap_or(-1),
            login_failed,
            failure.as_deref(),
            login,
            workshop_id,
        ));
    }

    consolidate_download(steam_path, workshop_id, reported_path.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Verbatim from a real successful run, escapes and all. steamcmd never
    /// prints "Logged in OK", and it breaks its own phrases with colour codes.
    const REAL_SUCCESS: &str = "Loading Steam API...\u{1b}[0mOK\n\
         \u{1b}[0m\u{1b}[1mLogging in using cached credentials.\n\
         \u{1b}[0mLogging in user 'adaptiq_' [U:1:419704515] to Steam Public...\u{1b}[0mOK\n\
         \u{1b}[0mWaiting for client config...\u{1b}[0mOK\n\
         \u{1b}[0mWaiting for user info...\u{1b}[0mOK\n";

    /// Verbatim from a real run with no cached token.
    const REAL_NO_CREDENTIALS: &str = "\u{1b}[0m\u{1b}[1mCached credentials not found.\n\
         \u{1b}[0mFAILED (No cached credentials and @NoPromptForPassword is set)\n";

    #[test]
    fn strip_ansi_removes_mid_word_escapes() {
        assert_eq!(
            strip_ansi("Waiting for user info...\u{1b}[0mOK"),
            "Waiting for user info...OK"
        );
        assert_eq!(strip_ansi("plain text"), "plain text");
    }

    #[test]
    fn a_real_successful_login_is_recognised() {
        let (ok, reason, _) = parse_login_output(REAL_SUCCESS, true);
        assert!(ok, "a working login must not be reported as a failure");
        assert_eq!(reason, "ok");
    }

    #[test]
    fn using_cached_credentials_is_success_not_a_missing_credentials_error() {
        // "Logging in using cached credentials" contains the substring
        // "cached credential"; matching that loosely broke a working login.
        let (ok, _, _) = parse_login_output("Logging in using cached credentials.\n", true);
        assert!(ok);
    }

    #[test]
    fn a_real_missing_credentials_run_is_recognised() {
        let (ok, reason, _) = parse_login_output(REAL_NO_CREDENTIALS, false);
        assert!(!ok);
        assert_eq!(reason, "needs-login");
    }

    #[test]
    fn login_output_recognises_success() {
        let (ok, reason, _) = parse_login_output("Logging in user...\nLogged in OK\n", true);
        assert!(ok);
        assert_eq!(reason, "ok");
    }

    #[test]
    fn login_output_recognises_steam_guard() {
        let (ok, reason, _) = parse_login_output(
            "This account is protected by Steam Guard.\nTwo-factor code:",
            false,
        );
        assert!(!ok);
        assert_eq!(reason, "needs-steam-guard");
    }

    #[test]
    fn login_output_recognises_missing_cached_credentials() {
        let (ok, reason, msg) =
            parse_login_output("No cached credentials and NoPromptForPassword set", false);
        assert!(!ok);
        assert_eq!(reason, "needs-login");
        assert!(msg.contains("terminal"));
    }

    #[test]
    fn login_output_recognises_rate_limit() {
        let (_, reason, _) = parse_login_output("FAILED (Rate Limit Exceeded)", false);
        assert_eq!(reason, "rate-limited");
    }

    #[test]
    fn login_output_recognises_invalid_password() {
        let (_, reason, _) = parse_login_output("FAILED (Invalid Password)", false);
        assert_eq!(reason, "invalid-password");
    }

    #[test]
    fn login_banner_without_clean_exit_is_not_trusted() {
        let (ok, _, _) = parse_login_output("Logged in OK", false);
        assert!(!ok, "a non-zero exit must not be reported as logged in");
    }

    #[test]
    fn progress_percent_is_parsed() {
        let line = "Update state (0x61) downloading, progress: 42.53 (12345 / 67890)";
        assert_eq!(parse_progress_percent(line), Some(42.53));
    }

    #[test]
    fn progress_percent_absent_returns_none() {
        assert_eq!(parse_progress_percent("Logging in user..."), None);
    }

    #[test]
    fn download_path_is_extracted() {
        let line = r#"Success. Downloaded item 12345 to "/home/u/.steam/steamapps/workshop/content/221100/12345" (5 bytes)"#;
        assert_eq!(
            parse_download_path(line).as_deref(),
            Some("/home/u/.steam/steamapps/workshop/content/221100/12345")
        );
    }

    #[test]
    fn download_failure_is_detected() {
        assert!(is_download_failure(
            "ERROR! Download item 12345 failed (Failure)."
        ));
        assert!(!is_download_failure("Success. Downloaded item 12345"));
    }

    #[test]
    fn login_failure_lines_are_detected() {
        // The exact line steamcmd prints with no cached token.
        assert!(is_login_failure("Cached credentials not found."));
        assert!(is_login_failure(
            "FAILED (No cached credentials and @NoPromptForPassword is set)"
        ));
        assert!(is_login_failure("FAILED (Invalid Password)"));
        assert!(!is_login_failure("Downloading item 12345 ..."));
    }

    #[test]
    fn the_sign_in_command_quits_when_it_is_done() {
        // Without +quit steamcmd sits at its own prompt afterwards.
        assert_eq!(login_command("adaptiq_"), "steamcmd +login adaptiq_ +quit");
    }

    #[test]
    fn exit_five_is_reported_as_a_login_problem_with_the_fix() {
        let message = classify_failure(5, false, None, "adaptiq_", "3457620661");
        assert!(message.starts_with("steamcmd-login-required:"));
        assert!(
            message.contains(&login_command("adaptiq_")),
            "the message must contain the exact command to run: {}",
            message
        );
    }

    #[test]
    fn a_login_failure_line_wins_over_the_exit_code() {
        let message = classify_failure(1, true, None, "someone", "42");
        assert!(message.starts_with("steamcmd-login-required:"));
    }

    #[test]
    fn other_failures_keep_steamcmds_own_message() {
        let message = classify_failure(
            8,
            false,
            Some("ERROR! Download item 42 failed (Failure)."),
            "someone",
            "42",
        );
        assert!(message.starts_with("steamcmd-failed:"));
        assert!(message.contains("Download item 42 failed"));
    }

    #[test]
    fn an_unexplained_exit_still_names_the_mod() {
        let message = classify_failure(9, false, None, "someone", "777");
        assert!(message.starts_with("steamcmd-failed:"));
        assert!(message.contains("777"));
        assert!(!message.contains("+login"), "not a login problem");
    }

    #[test]
    fn last_segment_keeps_final_carriage_return_chunk() {
        assert_eq!(last_segment("old\rnewer\rnewest  "), "newest");
        assert_eq!(last_segment("plain line"), "plain line");
    }

    #[test]
    fn progress_lines_reach_the_ui_without_escape_codes() {
        // Exactly what showed up in the download progress text.
        assert_eq!(
            clean_line("\u{1b}[0mWaiting for user info...\u{1b}[0mOK"),
            "Waiting for user info...OK"
        );
    }

    #[test]
    fn clean_line_still_keeps_only_the_newest_redraw() {
        assert_eq!(
            clean_line("\u{1b}[0mold progress\rnewest progress"),
            "newest progress"
        );
    }

    #[test]
    fn download_search_paths_prefer_configured_library() {
        let paths = download_search_paths("/lib/steamapps", "/home/t", "999");
        assert_eq!(paths[0], "/lib/steamapps/workshop/content/221100/999");
        assert!(paths.iter().any(|p| p.contains("/.steam/steamcmd/")));
        assert!(paths.iter().all(|p| p.ends_with("/999")));
    }

    #[test]
    fn download_search_paths_are_deduplicated() {
        let paths = download_search_paths("/home/t/.steam/steam/steamapps", "/home/t", "999");
        let mut sorted = paths.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(sorted.len(), paths.len());
    }

    #[test]
    fn consolidate_moves_download_into_configured_library() {
        let base = std::env::temp_dir().join("zld-consolidate");
        let _ = std::fs::remove_dir_all(&base);
        let library = base.join("library/steamapps");
        let home = base.join("home");
        let stray = home.join(".steam/steamcmd/steamapps/workshop/content/221100/4242");
        std::fs::create_dir_all(&stray).unwrap();
        std::fs::write(stray.join("meta.cpp"), "name = \"Stray\";").unwrap();
        std::fs::create_dir_all(&library).unwrap();

        consolidate_download_from(
            library.to_str().unwrap(),
            "4242",
            home.to_str().unwrap(),
            None,
        )
        .unwrap();

        assert!(workshop_dir(library.to_str().unwrap())
            .join("4242/meta.cpp")
            .is_file());
        assert!(
            !stray.exists(),
            "stray copy should be moved, not duplicated"
        );

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn consolidate_is_a_no_op_when_already_in_library() {
        let base = std::env::temp_dir().join("zld-consolidate-noop");
        let _ = std::fs::remove_dir_all(&base);
        let library = base.join("steamapps");
        let target = workshop_dir(library.to_str().unwrap()).join("777");
        std::fs::create_dir_all(&target).unwrap();

        consolidate_download_from(library.to_str().unwrap(), "777", "/nonexistent-home", None)
            .unwrap();
        assert!(target.is_dir());

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn consolidate_reports_missing_download() {
        let base = std::env::temp_dir().join("zld-consolidate-missing");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();

        let err =
            consolidate_download_from(base.to_str().unwrap(), "555", "/nonexistent-home", None)
                .unwrap_err();
        assert!(err.starts_with("download-missing:"));

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn consolidate_prefers_the_path_steamcmd_reported() {
        let base = std::env::temp_dir().join("zld-consolidate-reported");
        let _ = std::fs::remove_dir_all(&base);
        let library = base.join("steamapps");
        let reported = base.join("odd/location/1234");
        std::fs::create_dir_all(&reported).unwrap();
        std::fs::write(reported.join("meta.cpp"), "name = \"Odd\";").unwrap();
        std::fs::create_dir_all(&library).unwrap();

        consolidate_download_from(
            library.to_str().unwrap(),
            "1234",
            "/nonexistent-home",
            reported.to_str(),
        )
        .unwrap();

        assert!(workshop_dir(library.to_str().unwrap())
            .join("1234/meta.cpp")
            .is_file());

        let _ = std::fs::remove_dir_all(&base);
    }
}
