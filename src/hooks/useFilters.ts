import { useState, useMemo, useRef } from "react";
import type { Server } from "../types/server";

export interface Filters {
  search: string;
  map: string;
  version: string;
  favoritesOnly: boolean;
  hideFull: boolean;
  hideEmpty: boolean;
  firstPersonOnly: boolean;
  thirdPersonOnly: boolean;
  moddedOnly: boolean;
  battlEyeOnly: boolean;
  vacOnly: boolean;
  passwordProtected: boolean;
}

export type SortKey = "name" | "map" | "players" | "time";
export type SortDir = "asc" | "desc";

const DEFAULT_FILTERS: Filters = {
  search: "",
  map: "",
  version: "",
  favoritesOnly: false,
  hideFull: false,
  hideEmpty: false,
  firstPersonOnly: false,
  thirdPersonOnly: false,
  moddedOnly: false,
  battlEyeOnly: false,
  vacOnly: false,
  passwordProtected: false,
};

export function useFilters(servers: Server[], favorites: Set<string>) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [sortKey, setSortKey] = useState<SortKey>("players");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Updated synchronously in updateFilter/resetFilters so that useMemo reads
  // the correct search string even when Zustand's useSyncExternalStore forces a
  // re-render before React has committed the setFilters update.
  const searchRef = useRef(DEFAULT_FILTERS.search);

  const maps = useMemo(
    () => [...new Set(servers.map((s) => s.map))].filter(Boolean).sort(),
    [servers],
  );

  const versions = useMemo(
    () => [...new Set(servers.map((s) => s.version))].filter(Boolean).sort().reverse(),
    [servers],
  );

  // Structural identity key — changes only when servers are added or removed,
  // not when individual server data (e.g. player count) is patched in-place
  // by refreshServer.
  const serverStructureKey = useMemo(
    () => servers.map((s) => `${s.endpoint.ip}:${s.endpoint.port}`).join(","),
    [servers],
  );

  // Sort order is stored in a ref so React can never discard or invalidate it.
  // useMemo is a performance hint — React 19 can recompute memos even without
  // dep changes. A ref update is imperative and survives concurrent rendering.
  //
  // The ref is updated only when the server set or user-chosen sort params
  // change. refreshServer() patches data without changing server IDs, so
  // serverStructureKey stays the same and the ref is left untouched — servers
  // stay in their current positions.
  const sortCacheRef = useRef<{
    structureKey: string;
    sortKey: SortKey;
    sortDir: SortDir;
    order: Map<string, number>;
  } | null>(null);

  const cache = sortCacheRef.current;
  if (
    cache === null ||
    cache.structureKey !== serverStructureKey ||
    cache.sortKey !== sortKey ||
    cache.sortDir !== sortDir
  ) {
    sortCacheRef.current = {
      structureKey: serverStructureKey,
      sortKey,
      sortDir,
      order: new Map(
        [...servers]
          .sort((a, b) => {
            let cmp = 0;
            switch (sortKey) {
              case "name": cmp = a.name.localeCompare(b.name); break;
              case "map": cmp = a.map.localeCompare(b.map); break;
              case "players": cmp = a.players - b.players; break;
              case "time": cmp = a.time.localeCompare(b.time); break;
            }
            return sortDir === "asc" ? cmp : -cmp;
          })
          .map((s, i) => [`${s.endpoint.ip}:${s.endpoint.port}`, i]),
      ),
    };
  }

  // Capture here so it is closed over by the filtered memo below.
  // It is the same Map object on data-only patches (cache hit), so
  // React sees no dep change for that specific value.
  const sortOrder = (sortCacheRef.current as NonNullable<typeof sortCacheRef.current>).order;

  const filtered = useMemo(() => {
    let result = servers;

    if (searchRef.current) {
      const q = searchRef.current.toLowerCase();
      result = result.filter((s) => s.name.toLowerCase().includes(q));
    }
    if (filters.map) {
      result = result.filter((s) => s.map === filters.map);
    }
    if (filters.version) {
      result = result.filter((s) => s.version === filters.version);
    }
    if (filters.favoritesOnly) {
      result = result.filter((s) =>
        favorites.has(`${s.endpoint.ip}:${s.endpoint.port}`),
      );
    }
    if (filters.hideFull) {
      result = result.filter((s) => s.players < s.maxPlayers);
    }
    if (filters.hideEmpty) {
      result = result.filter((s) => s.players > 0);
    }
    if (filters.firstPersonOnly) {
      result = result.filter((s) => s.firstPersonOnly);
    }
    if (filters.thirdPersonOnly) {
      result = result.filter((s) => !s.firstPersonOnly);
    }
    if (filters.moddedOnly) {
      result = result.filter((s) => s.mods.length > 0);
    }
    if (filters.battlEyeOnly) {
      result = result.filter((s) => s.battlEye);
    }
    if (filters.vacOnly) {
      result = result.filter((s) => s.vac);
    }
    if (filters.passwordProtected) {
      result = result.filter((s) => s.password);
    }

    return [...result].sort((a, b) => {
      const ai = sortOrder.get(`${a.endpoint.ip}:${a.endpoint.port}`) ?? Infinity;
      const bi = sortOrder.get(`${b.endpoint.ip}:${b.endpoint.port}`) ?? Infinity;
      return ai - bi;
    });
  // sortOrder replaces sortKey/sortDir here: it is a new Map reference only
  // when the user explicitly changes sort params, so those changes still
  // trigger a memo re-run while data-only patches (same Map reference) do not.
  }, [servers, filters, favorites, sortOrder]);

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    if (key === "search") searchRef.current = value as string;
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function setSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function resetFilters() {
    searchRef.current = DEFAULT_FILTERS.search;
    setFilters(DEFAULT_FILTERS);
  }

  return {
    filters,
    updateFilter,
    filtered,
    maps,
    versions,
    sortKey,
    sortDir,
    setSort,
    resetFilters,
  };
}
