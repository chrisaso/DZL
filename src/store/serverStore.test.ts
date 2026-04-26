import { describe, test, expect } from "vitest";
import { deduplicateServers } from "./serverStore";
import type { Server } from "../types/server";

function makeServer(ip: string, port: number, name = "Test Server"): Server {
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
    version: "1.27",
    mission: "dayzOffline.chernarusplus",
    vac: true,
    battlEye: true,
    firstPersonOnly: false,
    shard: "private",
    timeAcceleration: 1,
    time: "12:00",
    mods: [],
  };
}

describe("deduplicateServers", () => {
  test("returns all servers when every ip:port is unique", () => {
    const servers = [
      makeServer("1.2.3.4", 2302),
      makeServer("1.2.3.4", 2303),
      makeServer("5.6.7.8", 2302),
    ];
    expect(deduplicateServers(servers)).toHaveLength(3);
  });

  test("removes the second entry when two servers share the same ip:port", () => {
    const first = makeServer("172.111.51.230", 27017, "WormWood US2 A");
    const second = makeServer("172.111.51.230", 27017, "WormWood US2 B");
    const other = makeServer("172.111.51.230", 27016, "WormWood US1");

    const result = deduplicateServers([first, second, other]);

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("WormWood US2 A");
    expect(result[1].name).toBe("WormWood US1");
  });

  test("keeps the first occurrence when three entries share the same ip:port", () => {
    const servers = [
      makeServer("1.2.3.4", 2302, "First"),
      makeServer("1.2.3.4", 2302, "Second"),
      makeServer("1.2.3.4", 2302, "Third"),
    ];
    const result = deduplicateServers(servers);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("First");
  });

  test("returns an empty array unchanged", () => {
    expect(deduplicateServers([])).toEqual([]);
  });
});
