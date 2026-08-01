import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { PlayersCell, skeletonRowCount, ROW_HEIGHT } from "./ServerTable";
import type { QueryResult } from "../types/launcher";

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

describe("skeletonRowCount", () => {
  it("fills the available height exactly when it divides evenly", () => {
    expect(skeletonRowCount(ROW_HEIGHT * 20)).toBe(20);
  });

  it("covers a partial row rather than leaving a gap at the bottom", () => {
    expect(skeletonRowCount(ROW_HEIGHT * 20 + 1)).toBe(21);
  });

  it("fills a tall window", () => {
    expect(skeletonRowCount(2000)).toBe(40);
  });

  it("falls back to a sensible count before the height is measured", () => {
    expect(skeletonRowCount(0)).toBeGreaterThan(0);
    expect(skeletonRowCount(Number.NaN)).toBeGreaterThan(0);
  });
});

describe("PlayersCell", () => {
  it("shows the queue length when players are waiting to get in", () => {
    render(
      <PlayersCell players={60} maxPlayers={60} result={queryResult({ queue: 9 })} />,
    );

    expect(screen.getByText("+9")).toBeTruthy();
  });

  it("shows no queue marker when nobody is waiting", () => {
    render(
      <PlayersCell players={42} maxPlayers={60} result={queryResult({ queue: 0 })} />,
    );

    expect(screen.queryByText(/^\+/)).toBeNull();
  });

  it("shows no queue marker for a server that has not been queried", () => {
    render(<PlayersCell players={42} maxPlayers={60} result={undefined} />);

    expect(screen.queryByText(/^\+/)).toBeNull();
  });

  it("prefers the live player count over the master list", () => {
    render(
      <PlayersCell
        players={42}
        maxPlayers={60}
        result={queryResult({ players: 59, maxPlayers: 60 })}
      />,
    );

    expect(screen.getByText("59")).toBeTruthy();
    expect(screen.queryByText("42")).toBeNull();
  });

  it("falls back to the master list when the server did not answer", () => {
    render(
      <PlayersCell
        players={42}
        maxPlayers={60}
        result={queryResult({ online: false, players: null, queue: null })}
      />,
    );

    expect(screen.getByText("42")).toBeTruthy();
  });
});
