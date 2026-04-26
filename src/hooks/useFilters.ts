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
    () => [...new Set(servers.map((s) => s.map))].sort(),
    [servers],
  );

  const versions = useMemo(
    () => [...new Set(servers.map((s) => s.version))].sort().reverse(),
    [servers],
  );

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
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "map":
          cmp = a.map.localeCompare(b.map);
          break;
        case "players":
          cmp = a.players - b.players;
          break;
        case "time":
          cmp = a.time.localeCompare(b.time);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  // All five deps are required: servers (source data), filters (every filter
  // field including search), favorites (Set ref changes on toggle), sortKey,
  // sortDir. Missing any one would produce stale filtered results.
  }, [servers, filters, favorites, sortKey, sortDir]);

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
