import { describe, test, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFilters } from "./useFilters";
import type { Server } from "../types/server";

function makeServer(overrides: Partial<Server> & { name: string }): Server {
  return {
    gamePort: 2302,
    sponsor: false,
    profile: false,
    endpoint: { ip: "1.2.3.4", port: 2302 },
    game: "dayz",
    nameOverride: false,
    map: "chernarusplus",
    folder: "dayz",
    players: 10,
    maxPlayers: 60,
    environment: "pc",
    password: false,
    version: "1.27",
    mission: "dayzOffline.chernarusplus",
    vac: true,
    battlEye: true,
    firstPersonOnly: false,
    shard: "private",
    timeAcceleration: 1,
    time: "12:00",
    mods: [],
    ...overrides,
  };
}

const SERVERS: Server[] = [
  makeServer({ name: "Namalsk Survivors", map: "namalsk" }),
  makeServer({ name: "Chernarus PvP", map: "chernarusplus" }),
  makeServer({ name: "Livonia Hardcore", map: "livonia", version: "1.26" }),
  makeServer({ name: "PvE Paradise", map: "namalsk" }),
];

describe("useFilters – search", () => {
  test("empty search returns all servers", () => {
    const { result } = renderHook(() =>
      useFilters(SERVERS, new Set()),
    );
    expect(result.current.filtered).toHaveLength(4);
  });

  test("search only matches server name, not map or version", () => {
    const { result } = renderHook(() =>
      useFilters(SERVERS, new Set()),
    );

    act(() => {
      result.current.updateFilter("search", "namalsk");
    });

    // "Namalsk Survivors" matches; "Chernarus PvP" on map=namalsk does NOT
    expect(result.current.filtered).toHaveLength(1);
    expect(result.current.filtered[0].name).toBe("Namalsk Survivors");
  });

  test("search is case-insensitive", () => {
    const { result } = renderHook(() =>
      useFilters(SERVERS, new Set()),
    );

    act(() => {
      result.current.updateFilter("search", "LIVONIA");
    });

    expect(result.current.filtered).toHaveLength(1);
    expect(result.current.filtered[0].name).toBe("Livonia Hardcore");
  });

  test("search is a substring match", () => {
    const { result } = renderHook(() =>
      useFilters(SERVERS, new Set()),
    );

    act(() => {
      result.current.updateFilter("search", "PvP");
    });

    expect(result.current.filtered).toHaveLength(1);
    expect(result.current.filtered[0].name).toBe("Chernarus PvP");
  });

  test("search query matching multiple names returns all matching servers", () => {
    const { result } = renderHook(() =>
      useFilters(SERVERS, new Set()),
    );

    act(() => {
      result.current.updateFilter("search", "P");
    });

    const names = result.current.filtered.map((s) => s.name);
    expect(names).toContain("Chernarus PvP");
    expect(names).toContain("PvE Paradise");
    expect(names).not.toContain("Namalsk Survivors");
    expect(names).not.toContain("Livonia Hardcore");
  });

  test("search is re-applied immediately when servers prop updates", () => {
    let servers = SERVERS.slice(0, 2); // Namalsk Survivors, Chernarus PvP

    const { result, rerender } = renderHook(
      ({ s }: { s: Server[] }) => useFilters(s, new Set()),
      { initialProps: { s: servers } },
    );

    act(() => {
      result.current.updateFilter("search", "Livonia");
    });

    // No match yet — Livonia not in initial two servers
    expect(result.current.filtered).toHaveLength(0);

    // Simulate what Zustand does: update the servers prop
    servers = SERVERS; // now includes Livonia Hardcore
    rerender({ s: servers });

    // Must show only "Livonia Hardcore", not all 4 servers
    expect(result.current.filtered).toHaveLength(1);
    expect(result.current.filtered[0].name).toBe("Livonia Hardcore");
  });
});
