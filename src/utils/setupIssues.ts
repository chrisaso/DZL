import type { AppConfig, EnvironmentReport } from "../types/launcher";

/**
 * Setup problems derived from the stored config and the machine environment.
 *
 * This is the "is the launcher ready at all" check that drives the banner, the
 * Settings page and the tab badge. The per-join preflight in `useJoinServer`
 * answers a narrower question — whether *this* server can be joined right now —
 * from requirements the backend computes.
 */
export type SetupField = "playerName" | "steamPath" | "steamLogin";

export type SetupSection = "system" | "game" | "downloads";

export interface SetupIssue {
  id:
    | "dayz-not-found"
    | "max-map-count"
    | "steamcmd-missing"
    | "player-name"
    | "steam-login";
  title: string;
  detail: string;
  section: SetupSection;
  /** Settings field to highlight, when the fix is a value the user types. */
  field?: SetupField;
  /** Blocks joining any server, as opposed to only modded ones. */
  blocking: boolean;
}

export function collectSetupIssues(
  config: AppConfig | null,
  env: EnvironmentReport | null,
): SetupIssue[] {
  if (!config || !env) return [];

  const issues: SetupIssue[] = [];

  if (!env.dayzInstalled) {
    issues.push({
      id: "dayz-not-found",
      title: "DayZ not found",
      detail: env.steamPath
        ? `No common/DayZ folder under ${env.steamPath}. Point the launcher at the library that holds the game.`
        : "No Steam library found. Set the steamapps folder that holds DayZ.",
      section: "game",
      field: "steamPath",
      blocking: true,
    });
  }

  if (!config.playerName?.trim()) {
    issues.push({
      id: "player-name",
      title: "No in-game name set",
      detail: "DayZ needs a survivor name before it will connect to a server.",
      section: "game",
      field: "playerName",
      blocking: true,
    });
  }

  if (!env.maxMapCountOk) {
    issues.push({
      id: "max-map-count",
      title: "vm.max_map_count is too low",
      detail: `DayZ crashes on modded servers below ${env.requiredMaxMapCount.toLocaleString()}. Currently ${env.maxMapCount.toLocaleString()}.`,
      section: "system",
      blocking: false,
    });
  }

  if (config.useSteamcmd && !env.steamcmdInstalled) {
    issues.push({
      id: "steamcmd-missing",
      title: "steamcmd is not installed",
      detail:
        "Install steamcmd to download mods automatically, or turn steamcmd off and subscribe on the Steam Workshop instead.",
      section: "downloads",
      blocking: false,
    });
  }

  if (config.useSteamcmd && !config.steamLogin?.trim()) {
    issues.push({
      id: "steam-login",
      title: "No Steam account for mod downloads",
      detail:
        "DayZ workshop content cannot be downloaded anonymously. Add your account name and sign in to steamcmd once in a terminal.",
      section: "downloads",
      field: "steamLogin",
      blocking: false,
    });
  }

  return issues;
}

export function issuesForSection(
  issues: SetupIssue[],
  section: SetupSection,
): SetupIssue[] {
  return issues.filter((issue) => issue.section === section);
}

export function hasFieldIssue(issues: SetupIssue[], field: SetupField): boolean {
  return issues.some((issue) => issue.field === field);
}
