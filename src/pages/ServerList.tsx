import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerStore } from "../store/serverStore";
import { useFilters } from "../hooks/useFilters";
import { useLiveDataReady } from "../hooks/useLiveDataReady";
import { Sidebar } from "../components/Sidebar";
import {
  ServerTable,
  COLUMN_WIDTHS,
  skeletonRowCount,
} from "../components/ServerTable";
import { ServerDetail } from "../components/ServerDetail";
import { Button, Icon } from "../components/ui";
import type { HistoryEntry, QueryResult } from "../types/launcher";
import type { Server } from "../types/server";
import { serverId, timeAgo } from "../utils/format";

function SkeletonRow() {
  return (
    <tr>
      <td className="px-2 py-2.5 border-b border-trim/40">
        <div className="skeleton w-5 h-5 mx-auto" />
      </td>
      <td className="px-3 py-2.5 border-b border-trim/40">
        <div className="skeleton h-3.5 w-3/4 mb-1.5" />
        <div className="skeleton h-2.5 w-1/3" />
      </td>
      <td className="px-3 py-2.5 border-b border-trim/40">
        <div className="skeleton h-3.5 w-20" />
      </td>
      <td className="px-3 py-2.5 border-b border-trim/40">
        <div className="skeleton h-3.5 w-16 ml-auto" />
      </td>
      <td className="px-3 py-2.5 border-b border-trim/40">
        <div className="skeleton h-3.5 w-10 ml-auto" />
      </td>
      <td className="px-3 py-2.5 border-b border-trim/40">
        <div className="skeleton h-3.5 w-6 ml-auto" />
      </td>
      <td className="px-3 py-2.5 border-b border-trim/40">
        <div className="skeleton h-3.5 w-8 ml-auto" />
      </td>
      <td className="px-2 py-2.5 border-b border-trim/40" />
    </tr>
  );
}

/**
 * Placeholder rows in the shape of the real table. It renders as many rows as
 * the space it is given, because a fixed count leaves a dead band at the
 * bottom of a tall window; the overflow is clipped rather than scrollable so
 * the last row is cut off by the edge instead of stopping short of it.
 */
function LoadingTable() {
  const ref = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState(() => skeletonRowCount(0));

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setRows(skeletonRowCount(el.clientHeight));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="flex-1 overflow-hidden min-h-0">
      <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
        <colgroup>
          {COLUMN_WIDTHS.map((width, i) => (
            <col key={i} style={width ? { width } : undefined} />
          ))}
        </colgroup>
        <thead className="sticky top-0 z-10 bg-surface">
          <tr>
            <th className="px-2 py-2.5 border-b border-trim" />
            {["Name", "Map", "Players", "Time", "Mods", "Ping"].map((h, i) => (
              <th
                key={h}
                className={`px-3 py-2.5 font-medium text-xs text-secondary uppercase tracking-wider border-b border-trim ${
                  i < 2 ? "text-left" : "text-right"
                }`}
              >
                {h}
              </th>
            ))}
            <th className="px-2 py-2.5 border-b border-trim" />
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, i) => (
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
  querying,
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
  /** Whether a live query batch is in flight. */
  querying: boolean;
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

  // Ping and queue land a beat after the master list. Keep the skeleton up
  // until that first batch settles so the rows appear complete rather than
  // filling in two columns a second later.
  const liveReady = useLiveDataReady(
    !loading && !error && filtered.length > 0,
    querying,
    queryResults.size > 0,
  );

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
  // is still worth showing; dayz-ctl lists those in red rather than hiding them.
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
          // The table stays mounted behind the skeleton: its virtualizer is what
          // decides which rows to query, so unmounting it would leave the first
          // batch unfired and the skeleton up until the deadline.
          <div className="relative flex flex-col flex-1 min-h-0">
            {!liveReady && (
              <div className="absolute inset-0 z-20 bg-base flex flex-col">
                <LoadingTable />
              </div>
            )}
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
          </div>
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
