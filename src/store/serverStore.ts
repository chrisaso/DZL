import { create } from "zustand";
import type { Server } from "../types/server";
import { fetchServers as fetchServersApi, fetchServer as fetchServerApi } from "../api/dzsa";

export function deduplicateServers(servers: Server[]): Server[] {
  const seen = new Set<string>();
  return servers.filter((s) => {
    const id = `${s.endpoint.ip}:${s.endpoint.port}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

const CACHE_KEY = "zed-server-cache";
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  servers: Server[];
  timestamp: number;
}

function readCache(): Server[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const entry: CacheEntry = JSON.parse(raw);
    if (Date.now() - entry.timestamp > CACHE_TTL) return null;
    return entry.servers;
  } catch {
    return null;
  }
}

function writeCache(servers: Server[]) {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ servers, timestamp: Date.now() } satisfies CacheEntry),
    );
  } catch {
    // Quota exceeded — cache is best-effort
  }
}

interface ServerStore {
  servers: Server[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  fetchServers: () => Promise<void>;
  forceRefresh: () => Promise<void>;
  refreshServer: (ip: string, port: number) => Promise<void>;
}

// Prevents concurrent fetches (e.g. React StrictMode double-effect) from
// racing against each other and doubling the window for the filter race.
let fetchInFlight = false;

export const useServerStore = create<ServerStore>((set, get) => ({
  servers: [],
  loading: false,
  refreshing: false,
  error: null,
  fetchServers: async () => {
    if (fetchInFlight) return;
    fetchInFlight = true;

    const cached = readCache();

    if (cached) {
      // Cache is fresh — single set, no background fetch.
      // A double-set (cache then network) caused a render where Zustand's
      // async set() fired before React committed the pending setFilters update,
      // producing a render with stale filters.search = "" and all servers visible.
      set({ servers: cached, loading: false, refreshing: false, error: null });
      fetchInFlight = false;
      return;
    }

    // No cache — full blocking load, single set after fetch.
    set({ loading: true, error: null });
    try {
      const raw = await fetchServersApi();
      const servers = deduplicateServers(raw);
      set({ servers, loading: false });
      writeCache(servers);
    } catch (e) {
      set({ error: (e as Error).message, loading: false });
    } finally {
      fetchInFlight = false;
    }
  },
  forceRefresh: async () => {
    if (!fetchInFlight) {
      try {
        localStorage.removeItem(CACHE_KEY);
      } catch {
        // localStorage unavailable — proceed anyway
      }
    }
    await get().fetchServers();
  },
  refreshServer: async (ip: string, port: number) => {
    try {
      const fresh = await fetchServerApi(ip, port);
      set((state) => ({
        servers: state.servers.map((s) =>
          s.endpoint.ip === ip && s.endpoint.port === port ? fresh : s,
        ),
      }));
    } catch (e) {
      console.warn(`[refreshServer] ${ip}:${port} —`, e);
      // Leave existing data intact — no crash, no fallback fetch
    }
  },
}));

/** @internal Test-only — resets the fetchInFlight guard between tests. */
export function _resetFetchGuard() {
  fetchInFlight = false;
}
