import { useCallback, useState } from "react";
import type { HistoryEntry } from "../types/launcher";
import type { Server } from "../types/server";

const STORAGE_KEY = "zed-history";
export const HISTORY_LIMIT = 10;

function load(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function save(entries: HistoryEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage full or unavailable — history is a convenience, not critical.
  }
}

/**
 * Most-recently-played list, newest first, capped at {@link HISTORY_LIMIT}.
 * Re-joining a server moves it back to the top rather than duplicating it.
 */
export function record(
  entries: HistoryEntry[],
  entry: HistoryEntry,
  limit = HISTORY_LIMIT,
): HistoryEntry[] {
  const without = entries.filter((e) => e.id !== entry.id);
  return [entry, ...without].slice(0, limit);
}

export function useHistory() {
  const [history, setHistory] = useState<HistoryEntry[]>(load);

  const add = useCallback((server: Server, at: number = Date.now()) => {
    const entry: HistoryEntry = {
      id: `${server.endpoint.ip}:${server.endpoint.port}`,
      name: server.name,
      ip: server.endpoint.ip,
      port: server.endpoint.port,
      gamePort: server.gamePort,
      timestamp: at,
    };
    setHistory((prev) => {
      const next = record(prev, entry);
      save(next);
      return next;
    });
  }, []);

  const remove = useCallback((id: string) => {
    setHistory((prev) => {
      const next = prev.filter((e) => e.id !== id);
      save(next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setHistory([]);
    save([]);
  }, []);

  return { history, add, remove, clear };
}
