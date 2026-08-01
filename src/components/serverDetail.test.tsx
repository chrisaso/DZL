import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));

import { ServerDetail } from "./ServerDetail";
import type { QueryResult } from "../types/launcher";
import type { Server } from "../types/server";

const server = {
  gamePort: 2302,
  sponsor: false,
  profile: false,
  endpoint: { ip: "127.0.0.1", port: 2303 },
  game: "dayz",
  name: "Test Server",
  nameOverride: false,
  map: "chernarusplus",
  folder: "dayz",
  players: 60,
  maxPlayers: 60,
  environment: "l",
  password: false,
  version: "1.29.163451",
  mission: "dayzOffline",
  vac: true,
  battlEye: true,
  firstPersonOnly: false,
  shard: "",
  timeAcceleration: 4,
  time: "08:03",
  mods: [],
} satisfies Server;

function queryResult(overrides: Partial<QueryResult> = {}): QueryResult {
  return {
    ip: "127.0.0.1",
    port: 2303,
    online: true,
    pingMs: 24,
    players: 60,
    maxPlayers: 60,
    queue: 0,
    name: "Test Server",
    map: "chernarusplus",
    version: "1.29.163451",
    ...overrides,
  };
}

function renderDetail(result: QueryResult | undefined) {
  return render(
    <ServerDetail
      server={server}
      isFavorite={false}
      onFavoriteToggle={() => {}}
      onRefresh={async () => {}}
      onClose={() => {}}
      onJoin={() => {}}
      queryResult={result}
      installedMods={new Set()}
    />,
  );
}

describe("ServerDetail", () => {
  it("reports how many players are waiting in the queue", () => {
    renderDetail(queryResult({ queue: 9 }));

    expect(screen.getByText("+9 waiting")).toBeTruthy();
  });

  it("says nothing about a queue when nobody is waiting", () => {
    renderDetail(queryResult({ queue: 0 }));

    expect(screen.queryByText(/waiting/)).toBeNull();
  });

  it("says nothing about a queue for a server that has not been queried", () => {
    renderDetail(undefined);

    expect(screen.queryByText(/waiting/)).toBeNull();
  });
});
