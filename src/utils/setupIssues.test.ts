import { describe, it, expect } from "vitest";
import {
  collectSetupIssues,
  hasFieldIssue,
  issuesForSection,
} from "./setupIssues";
import type { AppConfig, EnvironmentReport } from "../types/launcher";

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    steamPath: "/steamapps",
    playerName: "Survivor",
    steamLogin: "someone",
    useSteamcmd: true,
    closeSteamForDownloads: true,
    killRunningDayz: true,
    updateModsOnJoin: false,
    launchOptions: [],
    customArgs: [],
    setupComplete: true,
    ...overrides,
  };
}

function env(overrides: Partial<EnvironmentReport> = {}): EnvironmentReport {
  return {
    steamInstalled: true,
    steamcmdInstalled: true,
    steamPath: "/steamapps",
    steamPathDetected: true,
    dayzPath: "/steamapps/common/DayZ",
    dayzInstalled: true,
    maxMapCount: 1_048_576,
    requiredMaxMapCount: 1_048_576,
    maxMapCountOk: true,
    canFixMaxMapCount: true,
    sysctlFixCommand: "…",
    steamRunning: false,
    dayzRunning: false,
    geoLookupAvailable: true,
    ...overrides,
  };
}

describe("collectSetupIssues", () => {
  it("reports nothing when everything is configured", () => {
    expect(collectSetupIssues(config(), env())).toEqual([]);
  });

  it("reports nothing before config and environment have loaded", () => {
    expect(collectSetupIssues(null, env())).toEqual([]);
    expect(collectSetupIssues(config(), null)).toEqual([]);
  });

  it("flags a missing in-game name as blocking", () => {
    const issues = collectSetupIssues(config({ playerName: "  " }), env());
    const issue = issues.find((i) => i.id === "player-name");
    expect(issue?.blocking).toBe(true);
    expect(issue?.field).toBe("playerName");
  });

  it("flags a missing DayZ install against the steam path field", () => {
    const issues = collectSetupIssues(config(), env({ dayzInstalled: false }));
    expect(hasFieldIssue(issues, "steamPath")).toBe(true);
  });

  it("flags a low max_map_count without blocking vanilla play", () => {
    const issues = collectSetupIssues(
      config(),
      env({ maxMapCountOk: false, maxMapCount: 65_530 }),
    );
    const issue = issues.find((i) => i.id === "max-map-count");
    expect(issue?.blocking).toBe(false);
    expect(issue?.detail).toContain("65,530");
  });

  it("only asks for a steam account when steamcmd is in use", () => {
    const withSteamcmd = collectSetupIssues(config({ steamLogin: null }), env());
    expect(hasFieldIssue(withSteamcmd, "steamLogin")).toBe(true);

    const without = collectSetupIssues(
      config({ steamLogin: null, useSteamcmd: false }),
      env(),
    );
    expect(hasFieldIssue(without, "steamLogin")).toBe(false);
  });

  it("only reports missing steamcmd when steamcmd is in use", () => {
    const on = collectSetupIssues(config(), env({ steamcmdInstalled: false }));
    expect(on.some((i) => i.id === "steamcmd-missing")).toBe(true);

    const off = collectSetupIssues(
      config({ useSteamcmd: false }),
      env({ steamcmdInstalled: false }),
    );
    expect(off.some((i) => i.id === "steamcmd-missing")).toBe(false);
  });

  it("groups issues by settings section", () => {
    const issues = collectSetupIssues(
      config({ playerName: null, steamLogin: null }),
      env({ maxMapCountOk: false }),
    );

    expect(issuesForSection(issues, "game").map((i) => i.id)).toEqual([
      "player-name",
    ]);
    expect(issuesForSection(issues, "system").map((i) => i.id)).toEqual([
      "max-map-count",
    ]);
    expect(issuesForSection(issues, "downloads").map((i) => i.id)).toEqual([
      "steam-login",
    ]);
  });
});
