import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { useLiveDataReady } from "./useLiveDataReady";

describe("useLiveDataReady", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("waits while the first query is still in flight", () => {
    const { result, rerender } = renderHook(
      ({ querying }) => useLiveDataReady(true, querying),
      { initialProps: { querying: false } },
    );

    expect(result.current).toBe(false);

    rerender({ querying: true });

    expect(result.current).toBe(false);
  });

  it("is ready once the first query settles", () => {
    const { result, rerender } = renderHook(
      ({ querying }) => useLiveDataReady(true, querying),
      { initialProps: { querying: false } },
    );

    rerender({ querying: true });
    rerender({ querying: false });

    expect(result.current).toBe(true);
  });

  it("gives up waiting when no query ever settles", () => {
    const { result } = renderHook(() => useLiveDataReady(true, true));

    expect(result.current).toBe(false);

    act(() => void vi.advanceTimersByTime(5_000));

    expect(result.current).toBe(true);
  });

  it("gives up waiting when no query ever starts", () => {
    const { result } = renderHook(() => useLiveDataReady(true, false));

    act(() => void vi.advanceTimersByTime(5_000));

    expect(result.current).toBe(true);
  });

  it("does not start the clock before there is anything to query", () => {
    const { result } = renderHook(() => useLiveDataReady(false, false));

    act(() => void vi.advanceTimersByTime(5_000));

    expect(result.current).toBe(false);
  });

  it("is ready at once when live data is already in hand", () => {
    // Leaving the tab and coming back remounts the list against a warm query
    // cache, so no batch fires and there is nothing to wait for.
    const { result } = renderHook(() => useLiveDataReady(true, false, true));

    expect(result.current).toBe(true);
  });

  it("stays ready when later scrolling queries more rows", () => {
    const { result, rerender } = renderHook(
      ({ querying }) => useLiveDataReady(true, querying),
      { initialProps: { querying: false } },
    );

    rerender({ querying: true });
    rerender({ querying: false });
    expect(result.current).toBe(true);

    rerender({ querying: true });

    expect(result.current).toBe(true);
  });
});
