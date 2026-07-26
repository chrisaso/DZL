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

/// Reads a quoted token starting at `rest`, honouring backslash escapes, and
/// returns it with whatever follows the closing quote.
fn read_quoted(rest: &str) -> Option<(&str, &str)> {
    let body = rest.strip_prefix('"')?;
    let mut escaped = false;
    for (i, c) in body.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        match c {
            '\\' => escaped = true,
            '"' => return Some((&body[..i], &body[i + 1..])),
            _ => {}
        }
    }
    None
}

/// A `"key"\t\t"value"` pair, with the value still escaped.
fn parse_pair(line: &str) -> Option<(&str, &str)> {
    let (key, rest) = read_quoted(line.trim_start())?;
    let (value, tail) = read_quoted(rest.trim_start())?;
    if !tail.trim().is_empty() {
        return None;
    }
    Some((key, value))
}

/// A line holding nothing but a quoted key, which opens a block.
fn parse_key_only(line: &str) -> Option<&str> {
    let (key, tail) = read_quoted(line.trim())?;
    if !tail.is_empty() {
        return None;
    }
    Some(key)
}

fn indent_of(line: &str) -> &str {
    &line[..line.len() - line.trim_start().len()]
}

fn same_key(a: &str, b: &str) -> bool {
    a.eq_ignore_ascii_case(b)
}

fn stack_matches(stack: &[String], path: &[&str]) -> bool {
    stack.len() == path.len() && stack.iter().zip(path).all(|(a, b)| same_key(a, b))
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
        let vdf = sample(&dayz_block(
            "\t\t\t\t\t\t\"LaunchOptions\"\t\t\"gamescope -f -- %command%\"\n",
        ));
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

        assert_eq!(
            read_launch_options(&out, "221100").as_deref(),
            Some("wrap %command%")
        );
        assert!(out.contains("\"LastPlayed\"\t\t\"99\""));
        assert!(
            out.contains("\t\t\t\t\t\t\"LaunchOptions\"\t\t\"wrap %command%\""),
            "matches the indentation of its siblings"
        );
    }

    #[test]
    fn creates_the_app_block_when_the_game_was_never_launched() {
        let out = set_launch_options(&sample(""), "221100", "wrap %command%").unwrap();

        assert_eq!(
            read_launch_options(&out, "221100").as_deref(),
            Some("wrap %command%")
        );
        assert!(out.contains("\"440\""), "existing apps survive");
    }

    #[test]
    fn escapes_quotes_on_write() {
        let out =
            set_launch_options(&sample(""), "221100", "LD_PRELOAD=\"\" wrap %command%").unwrap();
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
        let err =
            set_launch_options("\"UserLocalConfigStore\"\n{\n}\n", "221100", "x").unwrap_err();
        assert!(err.starts_with("no-apps-block"), "got {}", err);
    }

    #[test]
    fn matches_keys_case_insensitively() {
        let vdf = sample(&dayz_block("\t\t\t\t\t\t\"launchoptions\"\t\t\"old\"\n"))
            .replace("\"Valve\"", "\"valve\"");
        let out = set_launch_options(&vdf, "221100", "new %command%").unwrap();
        assert_eq!(
            read_launch_options(&out, "221100").as_deref(),
            Some("new %command%")
        );
        assert_eq!(out.lines().count(), vdf.lines().count());
    }
}
