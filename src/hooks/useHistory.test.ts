import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { useHistory, record, HISTORY_LIMIT } from "./useHistory";
import type { HistoryEntry } from "../types/launcher";
import type { Server } from "../types/server";

function makeServer(ip: string, port: number, name: string): Server {
  return {
    gamePort: port,
    sponsor: false,
    profile: false,
    endpoint: { ip, port },
    game: "dayz",
    name,
    nameOverride: false,
    map: "chernarusplus",
    folder: "dayz",
    players: 0,
    maxPlayers: 60,
    environment: "pc",
    password: false,
    version: "1.28",
    mission: "",
    vac: true,
    battlEye: true,
    firstPersonOnly: false,
    shard: "private",
    timeAcceleration: 1,
    time: "12:00",
    mods: [],
  };
}

function entry(id: string, timestamp = 0): HistoryEntry {
  return { id, name: id, ip: id, port: 2302, gamePort: 2302, timestamp };
}

describe("record", () => {
  it("puts the newest entry first", () => {
    const result = record([entry("a")], entry("b"));
    expect(result.map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("moves a re-joined server back to the top instead of duplicating it", () => {
    const result = record([entry("a"), entry("b")], entry("b", 99));
    expect(result.map((e) => e.id)).toEqual(["b", "a"]);
    expect(result[0].timestamp).toBe(99);
  });

  it("caps the list at the limit", () => {
    const full = Array.from({ length: HISTORY_LIMIT }, (_, i) => entry(`s${i}`));
    const result = record(full, entry("new"));
    expect(result).toHaveLength(HISTORY_LIMIT);
    expect(result[0].id).toBe("new");
    expect(result.map((e) => e.id)).not.toContain(`s${HISTORY_LIMIT - 1}`);
  });
});

describe("useHistory", () => {
  beforeEach(() => localStorage.clear());

  it("starts empty", () => {
    const { result } = renderHook(() => useHistory());
    expect(result.current.history).toEqual([]);
  });

  it("records a joined server and persists it", () => {
    const { result } = renderHook(() => useHistory());

    act(() => result.current.add(makeServer("1.2.3.4", 2304, "Test"), 1234));

    expect(result.current.history[0]).toMatchObject({
      id: "1.2.3.4:2304",
      name: "Test",
      timestamp: 1234,
    });
    expect(localStorage.getItem("zed-history")).toContain("1.2.3.4:2304");
  });

  it("reloads persisted history", () => {
    localStorage.setItem("zed-history", JSON.stringify([entry("5.6.7.8:2302")]));
    const { result } = renderHook(() => useHistory());
    expect(result.current.history).toHaveLength(1);
  });

  it("survives corrupt storage", () => {
    localStorage.setItem("zed-history", "not json");
    const { result } = renderHook(() => useHistory());
    expect(result.current.history).toEqual([]);
  });

  it("removes and clears entries", () => {
    const { result } = renderHook(() => useHistory());

    act(() => result.current.add(makeServer("1.1.1.1", 2302, "A")));
    act(() => result.current.add(makeServer("2.2.2.2", 2302, "B")));
    act(() => result.current.remove("1.1.1.1:2302"));

    expect(result.current.history.map((e) => e.id)).toEqual(["2.2.2.2:2302"]);

    act(() => result.current.clear());
    expect(result.current.history).toEqual([]);
  });
});
