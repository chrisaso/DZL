/**
 * Backend errors arrive as `code: human readable detail`. The code is there so
 * the UI can offer the right fix instead of showing the user a raw exit status.
 */
export interface FriendlyError {
  title: string;
  detail: string;
  /** A command the user should run in a terminal, when one would fix it. */
  command?: string;
  /** Whether the fix lives in the settings tab. */
  settings?: boolean;
}

const TITLES: Record<string, string> = {
  "steamcmd-login-required": "steamcmd is not signed in",
  "steamcmd-not-found": "steamcmd is not installed",
  "no-steam-login": "No Steam account set",
  "no-steam-path": "Steam library not found",
  "dayz-not-installed": "DayZ is not in that library",
  "no-player-name": "In-game name not set",
  "mods-missing": "Mods are still missing",
  "steamcmd-failed": "steamcmd could not finish",
  "download-missing": "The download did not land where expected",
  "consolidate-failed": "Could not move the downloaded mod",
  "symlink-failed": "Could not link a mod into DayZ",
  "launch-failed": "Could not start Steam",
  "steam-shutdown-timeout": "Steam would not close",
  "steam-start-timeout": "Steam did not start",
  "pkexec-missing": "Cannot raise the limit automatically",
  "pkexec-cancelled": "Permission request was cancelled",
};

const SETTINGS_FIXES = new Set([
  "no-steam-login",
  "no-steam-path",
  "dayz-not-installed",
  "no-player-name",
  "steamcmd-not-found",
]);

/** Pulls a `steamcmd +login name +quit` style command out of a message. */
function extractCommand(text: string): string | undefined {
  const backticked = text.match(/`([^`]+)`/);
  if (backticked) return backticked[1];

  // The trailing +quit is part of the command, not the sentence around it.
  const bare = text.match(/\b(steamcmd \+login \S+(?: \+quit)?)/);
  return bare?.[1];
}

export function describeError(raw: unknown): FriendlyError {
  const message = String(raw ?? "").replace(/^Error:\s*/i, "").trim();
  if (!message) return { title: "Something went wrong", detail: "No details given." };

  const separator = message.indexOf(":");
  const code = separator === -1 ? "" : message.slice(0, separator).trim();
  const rest = separator === -1 ? message : message.slice(separator + 1).trim();

  const known = TITLES[code];
  if (!known) {
    // Unknown shape — show it verbatim rather than inventing a friendly lie.
    return { title: "Something went wrong", detail: message };
  }

  const command = extractCommand(rest);
  return {
    title: known,
    // The command is shown separately, so drop it from the prose.
    detail: command ? rest.replace(/`[^`]+`/, "this command").trim() : rest,
    command,
    settings: SETTINGS_FIXES.has(code),
  };
}
