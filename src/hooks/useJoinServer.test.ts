import { renderHook, act, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

import { useJoinServer, collectIssues, toModRefs } from "./useJoinServer";
import { invoke } from "@tauri-apps/api/core";
import type { JoinRequirements } from "../types/launcher";
import type { Server } from "../types/server";

const mockInvoke = vi.mocked(invoke);

const mockServer: Server = {
  endpoint: { ip: "1.2.3.4", port: 2304 },
  gamePort: 2302,
  mods: [{ steamWorkshopId: 123456, name: "TestMod" }],
  name: "Test Server",
  game: "dayz",
  map: "chernarusplus",
  folder: "",
  players: 10,
  maxPlayers: 60,
  environment: "pc",
  password: false,
  version: "1.28",
  mission: "",
  vac: true,
  battlEye: true,
  firstPersonOnly: false,
  shard: "public",
  timeAcceleration: 1,
  time: "12:00",
  sponsor: false,
  profile: false,
  nameOverride: false,
};

function requirements(overrides: Partial<JoinRequirements> = {}): JoinRequirements {
  return {
    steamPath: "/steamapps",
    dayzInstalled: true,
    missingMods: [],
    playerName: "Survivor",
    playerNameNeeded: false,
    useSteamcmd: true,
    steamLogin: "someone",
    steamLoginNeeded: false,
    updateModsOnJoin: false,
    maxMapCountOk: true,
    steamRunning: false,
    closeSteamPreference: true,
    ...overrides,
  };
}

/** Answers each command by name so ordering between calls doesn't matter. */
function mockCommands(handlers: Record<string, unknown>) {
  mockInvoke.mockImplementation((command: string) => {
    if (command in handlers) {
      const value = handlers[command];
      return value instanceof Error
        ? Promise.reject(value)
        : Promise.resolve(value);
    }
    return Promise.resolve(undefined);
  });
}

describe("collectIssues", () => {
  it("reports nothing when the environment is ready", () => {
    expect(collectIssues(requirements())).toEqual([]);
  });

  it("reports a missing Steam library", () => {
    const issues = collectIssues(requirements({ steamPath: null }));
    expect(issues.map((i) => i.code)).toContain("no-steam-path");
  });

  it("does not blame DayZ when the library itself is missing", () => {
    const issues = collectIssues(
      requirements({ steamPath: null, dayzInstalled: false }),
    );
    expect(issues.map((i) => i.code)).not.toContain("dayz-not-installed");
  });

  it("reports a missing player name", () => {
    const issues = collectIssues(requirements({ playerNameNeeded: true }));
    expect(issues.map((i) => i.code)).toContain("no-player-name");
  });

  it("reports a missing steam login and points at settings", () => {
    const issues = collectIssues(requirements({ steamLoginNeeded: true }));
    const issue = issues.find((i) => i.code === "no-steam-login");
    expect(issue?.fix).toBe("settings");
  });

  it("reports a low max_map_count with a sysctl fix", () => {
    const issues = collectIssues(requirements({ maxMapCountOk: false }));
    const issue = issues.find((i) => i.code === "max-map-count");
    expect(issue?.fix).toBe("sysctl");
  });
});

describe("toModRefs", () => {
  it("stringifies workshop ids for the backend", () => {
    expect(toModRefs(mockServer)).toEqual([
      { workshopId: "123456", name: "TestMod" },
    ]);
  });
});

describe("useJoinServer", () => {
  beforeEach(() => vi.clearAllMocks());

  it("starts in idle state", () => {
    const { result } = renderHook(() => useJoinServer());
    expect(result.current.state.kind).toBe("idle");
  });

  it("moves to checking when startJoin is called", () => {
    mockInvoke.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useJoinServer());
    act(() => result.current.startJoin(mockServer));
    expect(result.current.state.kind).toBe("checking");
  });

  it("blocks when the environment is not ready", async () => {
    mockCommands({ check_join_requirements: requirements({ steamPath: null }) });
    const { result } = renderHook(() => useJoinServer());

    act(() => result.current.startJoin(mockServer));

    await waitFor(() => expect(result.current.state.kind).toBe("blocked"));
    if (result.current.state.kind !== "blocked") throw new Error("wrong state");
    expect(result.current.state.issues[0].code).toBe("no-steam-path");
  });

  it("blocks when a steam login is required for downloads", async () => {
    mockCommands({
      check_join_requirements: requirements({
        steamLoginNeeded: true,
        steamLogin: null,
        missingMods: [{ workshopId: "123456", name: "TestMod" }],
      }),
    });
    const { result } = renderHook(() => useJoinServer());

    act(() => result.current.startJoin(mockServer));

    await waitFor(() => expect(result.current.state.kind).toBe("blocked"));
  });

  it("offers the workshop route when steamcmd is disabled and mods are missing", async () => {
    mockCommands({
      check_join_requirements: requirements({
        useSteamcmd: false,
        missingMods: [{ workshopId: "123456", name: "TestMod" }],
      }),
    });
    const { result } = renderHook(() => useJoinServer());

    act(() => result.current.startJoin(mockServer));

    await waitFor(() => expect(result.current.state.kind).toBe("subscribe"));
  });

  it("goes straight to confirm when everything is ready", async () => {
    mockCommands({ check_join_requirements: requirements() });
    const { result } = renderHook(() => useJoinServer());

    act(() => result.current.startJoin(mockServer));

    await waitFor(() => expect(result.current.state.kind).toBe("confirm"));
  });

  it("sends the join request and reports success", async () => {
    mockCommands({ check_join_requirements: requirements(), join_server: undefined });
    const onLaunched = vi.fn();
    const { result } = renderHook(() => useJoinServer({ onLaunched }));

    act(() => result.current.startJoin(mockServer));
    await waitFor(() => expect(result.current.state.kind).toBe("confirm"));

    await act(async () => {
      result.current.confirm({
        password: "hunter2",
        updateMods: true,
        closeSteam: false,
      });
    });

    await waitFor(() => expect(result.current.state.kind).toBe("done"));
    expect(mockInvoke).toHaveBeenCalledWith("join_server", {
      request: {
        ip: "1.2.3.4",
        gamePort: 2302,
        mods: [{ workshopId: "123456", name: "TestMod" }],
        password: "hunter2",
        updateMods: true,
        // Declining to close Steam has to reach the backend, not be dropped.
        closeSteam: false,
      },
    });
    expect(onLaunched).toHaveBeenCalledWith(mockServer);
  });

  it("leaves the Steam decision to the backend when not asked", async () => {
    mockCommands({ check_join_requirements: requirements(), join_server: undefined });
    const { result } = renderHook(() => useJoinServer());

    act(() => result.current.startJoin(mockServer));
    await waitFor(() => expect(result.current.state.kind).toBe("confirm"));

    await act(async () => {
      result.current.confirm();
    });

    await waitFor(() => expect(result.current.state.kind).toBe("done"));
    const request = mockInvoke.mock.calls.find(
      ([command]) => command === "join_server",
    )?.[1] as { request: { closeSteam: boolean | null } };
    expect(request.request.closeSteam).toBeNull();
  });

  it("surfaces a failed join as an error", async () => {
    mockCommands({
      check_join_requirements: requirements(),
      join_server: new Error("steamcmd-failed: exit 1"),
    });
    const onLaunched = vi.fn();
    const { result } = renderHook(() => useJoinServer({ onLaunched }));

    act(() => result.current.startJoin(mockServer));
    await waitFor(() => expect(result.current.state.kind).toBe("confirm"));

    await act(async () => {
      result.current.confirm();
    });

    await waitFor(() => expect(result.current.state.kind).toBe("error"));
    if (result.current.state.kind !== "error") throw new Error("wrong state");
    expect(result.current.state.message).toContain("steamcmd-failed");
    expect(onLaunched).not.toHaveBeenCalled();
  });

  it("surfaces a failed requirements check as an error", async () => {
    mockCommands({ check_join_requirements: new Error("boom") });
    const { result } = renderHook(() => useJoinServer());

    act(() => result.current.startJoin(mockServer));

    await waitFor(() => expect(result.current.state.kind).toBe("error"));
  });

  it("dismiss resets state to idle", async () => {
    mockCommands({ check_join_requirements: requirements({ steamPath: null }) });
    const { result } = renderHook(() => useJoinServer());

    act(() => result.current.startJoin(mockServer));
    await waitFor(() => expect(result.current.state.kind).toBe("blocked"));

    act(() => result.current.dismiss());
    expect(result.current.state.kind).toBe("idle");
  });

  it("confirm does nothing while idle", async () => {
    const { result } = renderHook(() => useJoinServer());
    await act(async () => {
      result.current.confirm();
    });
    expect(result.current.state.kind).toBe("idle");
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
