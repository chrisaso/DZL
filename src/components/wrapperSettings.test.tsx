import { render, screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { WrapperSettings } from "./WrapperSettings";
import type { AppConfig, WrapperConfig, WrapperStatus } from "../types/launcher";

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

const config = (patch: Partial<WrapperConfig> = {}): AppConfig =>
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

function renderWrapper(appConfig: AppConfig) {
  return render(
    <WrapperSettings
      config={appConfig}
      save={vi.fn().mockResolvedValue(appConfig)}
      reload={vi.fn().mockResolvedValue(undefined)}
    />,
  );
}

describe("WrapperSettings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports what it found on the machine", async () => {
    mockInvoke.mockResolvedValue(status());
    renderWrapper(config());

    await waitFor(() => screen.getByText(/3\.16\.25/));
    expect(screen.getByRole("checkbox", { name: /GameMode/ })).toHaveProperty(
      "disabled",
      false,
    );
  });

  it("hides the gamescope fields until gamescope is on", async () => {
    mockInvoke.mockResolvedValue(status());
    const { rerender } = renderWrapper(config());

    await waitFor(() => screen.getByText(/3\.16\.25/));
    expect(screen.queryByLabelText(/width/i)).toBeNull();

    rerender(
      <WrapperSettings
        config={config({ gamescope: true })}
        save={vi.fn()}
        reload={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/width/i)).toBeTruthy();
  });

  it("disables a wrapper whose binary is missing", async () => {
    mockInvoke.mockResolvedValue(
      status({ gamescopeInstalled: false, gamescopeVersion: null }),
    );
    renderWrapper(config());

    await waitFor(() => screen.getByText(/not on PATH/i));
    expect(
      screen.getByRole("checkbox", { name: /gamescope/i }),
    ).toHaveProperty("disabled", true);
  });

  it("installs the hook when asked", async () => {
    mockInvoke.mockResolvedValue(status());
    renderWrapper(config({ gamescope: true }));

    await waitFor(() => screen.getByRole("button", { name: /install/i }));
    screen.getByRole("button", { name: /install/i }).click();

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("install_wrapper_hook", {
        replace: false,
      }),
    );
  });

  it("asks before replacing launch options it could not read", async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "get_wrapper_status") return status();
      throw new Error("import-conflict: mangohud %command%");
    });
    renderWrapper(config({ gamescope: true }));

    await waitFor(() => screen.getByRole("button", { name: /install/i }));
    screen.getByRole("button", { name: /install/i }).click();

    await waitFor(() => screen.getByText(/mangohud %command%/));
    screen.getByRole("button", { name: /replace/i }).click();

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("install_wrapper_hook", {
        replace: true,
      }),
    );
  });

  it("warns when Steam holds something DZL did not write", async () => {
    mockInvoke.mockResolvedValue(
      status({ hook: "changed", launchOptions: "gamescope -f -- %command%" }),
    );
    renderWrapper(config({ gamescope: true }));

    await waitFor(() => screen.getByText(/changed outside/i));
  });

  it("offers nothing to hook when neither wrapper is installed", async () => {
    mockInvoke.mockResolvedValue(
      status({
        gamescopeInstalled: false,
        gamescopeVersion: null,
        gamemodeInstalled: false,
      }),
    );
    renderWrapper(config());

    await waitFor(() => screen.getByText(/neither wrapper is installed/i));
    expect(screen.getByRole("button", { name: /install/i })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("shows what Steam will run", async () => {
    mockInvoke.mockResolvedValue(
      status({ preview: "gamemoderun gamescope -W 2560 -f -- %command%" }),
    );
    renderWrapper(config({ gamemode: true, gamescope: true, width: 2560 }));

    await waitFor(() =>
      screen.getByText("gamemoderun gamescope -W 2560 -f -- %command%"),
    );
  });
});
