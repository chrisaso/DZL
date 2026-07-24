import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerStore } from "../store/serverStore";
import { useFilters } from "../hooks/useFilters";
import { Sidebar } from "../components/Sidebar";
import { ServerTable } from "../components/ServerTable";
import { ServerDetail } from "../components/ServerDetail";
import { Button, Icon } from "../components/ui";
import type { HistoryEntry, QueryResult } from "../types/launcher";
import type { Server } from "../types/server";
import { serverId, timeAgo } from "../utils/format";

function SkeletonRow() {
  return (
    <tr>
      <td className="w-9 px-2 py-2.5 border-b border-trim/40">
        <div className="skeleton w-5 h-5 mx-auto" />
      </td>
      <td className="px-3 py-2.5 border-b border-trim/40">
        <div className="skeleton h-3.5 w-3/4 mb-1.5" />
        <div className="skeleton h-2.5 w-1/3" />
      </td>
      <td className="w-36 px-3 py-2.5 border-b border-trim/40">
        <div className="skeleton h-3.5 w-20" />
      </td>
      <td className="w-20 px-3 py-2.5 border-b border-trim/40">
        <div className="skeleton h-3.5 w-12 ml-auto" />
      </td>
      <td className="w-16 px-3 py-2.5 border-b border-trim/40">
        <div className="skeleton h-3.5 w-10 ml-auto" />
      </td>
      <td className="w-16 px-3 py-2.5 border-b border-trim/40">
        <div className="skeleton h-3.5 w-6 ml-auto" />
      </td>
      <td className="w-20 px-2 py-2.5 border-b border-trim/40" />
    </tr>
  );
}

function LoadingTable() {
  return (
    <div className="flex-1 overflow-y-auto min-h-0">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-10 bg-surface">
          <tr>
            <th className="w-9 px-2 py-2.5 border-b border-trim" />
            {["Name", "Map", "Players", "Time", "Mods"].map((h) => (
              <th
                key={h}
                className="px-3 py-2.5 font-medium text-xs text-secondary uppercase tracking-wider border-b border-trim text-left"
              >
                {h}
              </th>
            ))}
            <th className="w-20 px-2 py-2.5 border-b border-trim" />
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 18 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8">
      <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center text-accent">
        <Icon name="warning" size={20} />
      </div>
      <div>
        <p className="text-sm font-medium text-primary mb-1">
          Failed to load servers
        </p>
        <p className="text-xs text-muted max-w-xs">{error}</p>
      </div>
      <Button variant="secondary" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

/** Recently played servers that the master list no longer returns. */
function OfflineHistory({
  entries,
  onForget,
}: {
  entries: HistoryEntry[];
  onForget: (id: string) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <div className="border-t border-trim px-4 py-3">
      <p className="text-xs font-semibold text-muted uppercase tracking-widest mb-2">
        Offline ({entries.length})
      </p>
      <div className="space-y-1.5">
        {entries.map((entry) => (
          <div key={entry.id} className="flex items-center gap-3 text-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-muted shrink-0" />
            <span className="text-secondary truncate flex-1">{entry.name}</span>
            <span className="text-xs font-mono text-muted">{entry.id}</span>
            <span className="text-xs text-muted">{timeAgo(entry.timestamp)}</span>
            <button
              onClick={() => onForget(entry.id)}
              title="Forget this server"
              className="text-muted hover:text-accent transition-colors cursor-pointer"
            >
              <Icon name="close" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ServerList({
  favorites,
  toggleFavorite,
  history,
  onForgetHistory,
  onJoin,
  queryResults,
  onVisibleChange,
  onRefreshPing,
  installedMods,
}: {
  favorites: Set<string>;
  toggleFavorite: (id: string) => void;
  history: HistoryEntry[];
  onForgetHistory: (id: string) => void;
  onJoin: (server: Server) => void;
  queryResults: Map<string, QueryResult>;
  onVisibleChange: (servers: Server[]) => void;
  /** Re-queries one server's live data, ignoring the ping cache. */
  onRefreshPing: (ip: string, port: number) => Promise<void>;
  installedMods: Set<string>;
}) {
  const { servers, loading, error, fetchServers, refreshServer } = useServerStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const recentIds = useMemo(() => new Set(history.map((e) => e.id)), [history]);

  const {
    filters,
    updateFilter,
    filtered,
    maps,
    versions,
    sortKey,
    sortDir,
    setSort,
    resetFilters,
    activeFilterCount,
  } = useFilters(servers, favorites, recentIds);

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  const selectedServer =
    selectedId != null
      ? filtered.find((s) => serverId(s) === selectedId) ?? null
      : null;

  const handleSelect = useCallback(
    (id: string) => setSelectedId((prev) => (prev === id ? null : id)),
    [],
  );

  // Refreshing a row has to update everything that row shows: the master-list
  // record (players, time, version, mods) and the live ping, which is cached
  // separately and would otherwise stay stale.
  const handleRefreshServer = useCallback(
    async (ip: string, port: number) => {
      await Promise.all([refreshServer(ip, port), onRefreshPing(ip, port)]);
    },
    [refreshServer, onRefreshPing],
  );

  // A favourite or recently played server that has dropped off the master list
  // is still worth showing — dayz-ctl lists those in red rather than hiding them.
  const offlineHistory =
    filters.view === "recent"
      ? history.filter(
          (entry) => !servers.some((s) => serverId(s) === entry.id),
        )
      : [];

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      <Sidebar
        filters={filters}
        updateFilter={updateFilter}
        maps={maps}
        versions={versions}
        totalCount={servers.length}
        filteredCount={filtered.length}
        favoriteCount={favorites.size}
        recentCount={history.length}
        activeFilterCount={activeFilterCount}
        onReset={resetFilters}
      />

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {loading && <LoadingTable />}
        {!loading && error && <ErrorState error={error} onRetry={fetchServers} />}
        {!loading && !error && (
          <>
            <ServerTable
              servers={filtered}
              selectedId={selectedId}
              onSelect={handleSelect}
              favorites={favorites}
              onFavoriteToggle={toggleFavorite}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={setSort}
              onRefresh={handleRefreshServer}
              onJoin={onJoin}
              queryResults={queryResults}
              onVisibleChange={onVisibleChange}
            />
            <OfflineHistory entries={offlineHistory} onForget={onForgetHistory} />
          </>
        )}

        {selectedServer && (
          <ServerDetail
            server={selectedServer}
            isFavorite={favorites.has(serverId(selectedServer))}
            onFavoriteToggle={toggleFavorite}
            onRefresh={() =>
              handleRefreshServer(
                selectedServer.endpoint.ip,
                selectedServer.endpoint.port,
              )
            }
            onClose={() => setSelectedId(null)}
            onJoin={onJoin}
            queryResult={queryResults.get(serverId(selectedServer))}
            installedMods={installedMods}
          />
        )}
      </div>
    </div>
  );
}
