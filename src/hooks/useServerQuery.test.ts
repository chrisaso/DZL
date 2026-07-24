import { renderHook, act, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { useServerQuery } from "./useServerQuery";

const mockInvoke = vi.mocked(invoke);

function result(ip: string, port: number, pingMs: number) {
  return {
    ip,
    port,
    online: true,
    pingMs,
    players: 10,
    maxPlayers: 60,
    name: "Test",
    map: "chernarusplus",
    version: "1.29",
  };
}

describe("useServerQuery", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stores results keyed by ip:port", async () => {
    mockInvoke.mockResolvedValue([result("1.2.3.4", 2303, 42)]);
    const { result: hook } = renderHook(() => useServerQuery());

    await act(async () => {
      await hook.current.query([{ ip: "1.2.3.4", port: 2303 }]);
    });

    expect(hook.current.get("1.2.3.4", 2303)?.pingMs).toBe(42);
  });

  it("does not re-query a server that was just measured", async () => {
    mockInvoke.mockResolvedValue([result("1.2.3.4", 2303, 42)]);
    const { result: hook } = renderHook(() => useServerQuery());

    await act(async () => {
      await hook.current.query([{ ip: "1.2.3.4", port: 2303 }]);
    });
    await act(async () => {
      await hook.current.query([{ ip: "1.2.3.4", port: 2303 }]);
    });

    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it("re-queries when forced, so an explicit refresh updates the ping", async () => {
    mockInvoke.mockResolvedValueOnce([result("1.2.3.4", 2303, 42)]);
    const { result: hook } = renderHook(() => useServerQuery());

    await act(async () => {
      await hook.current.query([{ ip: "1.2.3.4", port: 2303 }]);
    });

    mockInvoke.mockResolvedValueOnce([result("1.2.3.4", 2303, 91)]);
    await act(async () => {
      await hook.current.query([{ ip: "1.2.3.4", port: 2303 }], true);
    });

    expect(mockInvoke).toHaveBeenCalledTimes(2);
    await waitFor(() =>
      expect(hook.current.get("1.2.3.4", 2303)?.pingMs).toBe(91),
    );
  });

  it("keeps the previous readings when a batch fails", async () => {
    mockInvoke.mockResolvedValueOnce([result("1.2.3.4", 2303, 42)]);
    const { result: hook } = renderHook(() => useServerQuery());
    await act(async () => {
      await hook.current.query([{ ip: "1.2.3.4", port: 2303 }]);
    });

    mockInvoke.mockRejectedValueOnce(new Error("network gone"));
    await act(async () => {
      await hook.current.query([{ ip: "1.2.3.4", port: 2303 }], true);
    });

    expect(hook.current.get("1.2.3.4", 2303)?.pingMs).toBe(42);
  });
});
